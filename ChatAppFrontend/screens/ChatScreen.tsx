import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  Button,
  FlatList,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Image,
  TouchableOpacity,
  Modal,
  Dimensions,
  PermissionsAndroid,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import io, { Socket } from 'socket.io-client';
import axios, { AxiosError } from 'axios';
import CryptoJS from 'crypto-js';
import { API_BASE } from '../config';

// Conditional WebRTC (prevents web crashes)
let mediaDevices: any = null;
let RTCView: any = null;
let RTCPeerConnection: any = null;
let RTCIceCandidate: any = null;  // For web ICE

if (Platform.OS !== 'web') {
  try {
    const webrtc = require('react-native-webrtc');
    mediaDevices = webrtc.mediaDevices;
    RTCView = webrtc.RTCView;
    RTCPeerConnection = webrtc.RTCPeerConnection;
  } catch (err) {
    console.error('Mobile WebRTC load failed:', err);
  }
} else {
  mediaDevices = navigator.mediaDevices;
  RTCView = null;
  RTCPeerConnection = (window as any).RTCPeerConnection || (window as any).webkitRTCPeerConnection;
  RTCIceCandidate = (window as any).RTCIceCandidate || (window as any).webkitRTCIceCandidate;
}

interface Message {
  from: string;
  to: string;
  encryptedContent?: string;
  content?: string;
  timestamp?: string | Date;
  isOwn: boolean;
}

interface ChatMessage {
  from: string;
  to: string;
  encryptedContent: string;
  timestamp: string | Date;
}

interface User {
  id?: string;
  _id?: string;
  username: string;
  email?: string;  // Optional now
  avatar_url?: string;
}

interface RouteParams {
  otherUserId: string;
  otherUserName: string;
  currentUserId?: string;
}

export default function ChatScreen({ route }: { route: { params: RouteParams } }) {
  const { otherUserId: paramOtherUserId, otherUserName, currentUserId: paramCurrentUserId } = route.params;
  const [otherUserId, setOtherUserId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState<string>('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [socketReady, setSocketReady] = useState<boolean>(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [isPartnerOnline, setIsPartnerOnline] = useState<boolean>(false);
  const [otherUser, setOtherUser] = useState<User>({ username: otherUserName, id: paramOtherUserId, email: '' });  // Add email: ''

  const [testMode, setTestMode] = useState<boolean>(false);  // For solo testing

  // Call state
  const [showCallModal, setShowCallModal] = useState<boolean>(false);
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [callType, setCallType] = useState<'audio' | 'video'>('video');
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [pc, setPc] = useState<any>(null);
  const [isCallActive, setIsCallActive] = useState<boolean>(false);
  const [callState, setCallState] = useState<'idle' | 'ringing' | 'connecting' | 'active' | 'ended'>('idle'); // ringing = outgoing, active = connected

  const flatListRef = useRef<FlatList>(null);
  const socketRetries = useRef<number>(0);
  const maxRetries = 3;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Video dimensions (fixed for styles)
  const screenHeight = Dimensions.get('window').height;

  const insets = useSafeAreaInsets();
  const keyboardVerticalOffset = insets.bottom - 55;
  const navigation = useNavigation<any>();

  // Validate and set otherUserId on mount
  useEffect(() => {
    console.log('ChatScreen mount - params:', { paramOtherUserId, otherUserName, paramCurrentUserId });
    if (!paramOtherUserId || typeof paramOtherUserId !== 'string' || paramOtherUserId.length < 10) {
      console.error('Invalid otherUserId from params:', paramOtherUserId);
      setError('Invalid chat partner ID from navigation');
      Alert.alert('Error', 'Invalid chat partner - Go back and try again');
      setIsLoading(false);
      return;
    }
    setOtherUserId(paramOtherUserId);
    setOtherUser({ id: paramOtherUserId, username: otherUserName, email: '' });  // Add email: ''
    console.log('OtherUserId validated and set:', paramOtherUserId);
  }, [paramOtherUserId]);

  // Fetch other user's profile for avatar_url
  useEffect(() => {
    const fetchOtherUser = async (): Promise<void> => {
      if (!otherUserId) return;
      try {
        const token = await AsyncStorage.getItem('token');
        if (!token) {
          console.warn('No token for fetching other user');
          return;
        }
        console.log('Fetching other user profile for ID:', otherUserId);
        const response = await axios.get<User>(`${API_BASE}/users/${otherUserId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setOtherUser({
          id: response.data.id || response.data._id,
          username: response.data.username,
          email: response.data.email || '',  // Add email
          avatar_url: response.data.avatar_url || '',
        });
        console.log('Fetched other user for chat:', response.data);
      } catch (err) {
        console.error('Fetch other user error:', err);
        setOtherUser({ id: otherUserId, username: otherUserName, email: '' });  // Fallback
      }
    };
    fetchOtherUser();
  }, [otherUserId]);

  // Generate shared E2E key and IV
  const getSharedKeyAndIV = (user1Id: string, user2Id: string): { key: CryptoJS.lib.WordArray; iv: CryptoJS.lib.WordArray } => {
    if (!user1Id || !user2Id || typeof user1Id !== 'string' || typeof user2Id !== 'string' || user1Id.length < 10 || user2Id.length < 10) {
      console.error('Invalid IDs for key generation:', { user1Id, user2Id });
      throw new Error('Invalid user IDs for encryption key');
    }
    try {
      const sortedIds = [user1Id, user2Id].sort().join('_');
      console.log('Generating key/IV from sorted IDs:', sortedIds);
      
      const keyHash = CryptoJS.SHA256(sortedIds + '_chat_salt').toString(CryptoJS.enc.Hex);
      const key = CryptoJS.enc.Hex.parse(keyHash);
      
      const ivHash = CryptoJS.MD5(sortedIds + '_iv_salt').toString(CryptoJS.enc.Hex);
      const iv = CryptoJS.enc.Hex.parse(ivHash);
      
      if (!key.words || key.words.length === 0 || key.sigBytes !== 32) {
        throw new Error('Invalid key generated');
      }
      if (!iv.words || iv.words.length === 0 || iv.sigBytes !== 16) {
        throw new Error('Invalid IV generated');
      }
      
      console.log('Key/IV details:', { 
        keySigBytes: key.sigBytes, 
        keyWordsLength: key.words.length, 
        ivSigBytes: iv.sigBytes,
        ivWordsLength: iv.words.length
      });
      
      return { key, iv };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Key/IV generation error:', errMsg);
      throw new Error(`Key/IV generation failed: ${errMsg}`);
    }
  };

  // Encrypt message
  const encryptMessage = (content: string, key: CryptoJS.lib.WordArray, iv: CryptoJS.lib.WordArray): string => {
    if (!content || !key || !iv) {
      throw new Error('Missing content, key, or IV for encryption');
    }
    try {
      console.log('Starting encryption - content length:', content.length, 'key sigBytes:', key.sigBytes, 'iv sigBytes:', iv.sigBytes);
      console.log('Key words preview:', key.words ? `[${key.words[0]}, ${key.words[1]}...]` : 'undefined');
      console.log('IV words preview:', iv.words ? `[${iv.words[0]}, ${iv.words[1]}...]` : 'undefined');
      
      const encrypted = CryptoJS.AES.encrypt(content, key, { iv: iv });
      
      if (!encrypted || !encrypted.ciphertext) {
        throw new Error('Encryption produced invalid output');
      }
      
      const result = encrypted.toString();
      console.log('Encryption successful - result length:', result.length);
      return result;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Encryption error details:', {
        errMessage: errMsg,
        errStack: err instanceof Error ? err.stack : undefined,
        contentType: typeof content,
        contentLength: content.length,
        keyType: typeof key,
        keySigBytes: key ? key.sigBytes : 'no key',
        ivType: typeof iv,
        ivSigBytes: iv ? iv.sigBytes : 'no iv'
      });
      throw new Error(`Encryption failed: ${errMsg}`);
    }
  };

  // Decrypt message
  const decryptMessage = (encryptedContent: string, key: CryptoJS.lib.WordArray, iv: CryptoJS.lib.WordArray): string => {
    if (!key || !iv) {
      return '[Key/IV Missing - User Not Loaded]';
    }
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedContent, key, { iv: iv });
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      return decrypted || '[Decryption Failed]';
    } catch (err) {
      console.error('Decryption error:', err);
      return '[Decryption Failed - Possible Key Mismatch]';
    }
  };

  // Load user
  useEffect(() => {
    const loadUser = async (): Promise<void> => {
      try {
        console.log('Loading user from AsyncStorage...');
        const userStr = await AsyncStorage.getItem('user');
        const token = await AsyncStorage.getItem('token');
        console.log('Storage loaded:', { userExists: !!userStr, tokenExists: !!token });
        if (paramCurrentUserId) {
          setCurrentUserId(paramCurrentUserId);
          console.log('CurrentUserId from params:', paramCurrentUserId);
          return;
        }
        if (!userStr) {
          throw new Error('No user data in storage - please login again');
        }
        const user = JSON.parse(userStr) as User;
        const userId = user.id || user._id;
        if (!userId) {
          throw new Error('No ID in stored user data');
        }
        setCurrentUserId(userId);
        console.log('CurrentUserId loaded successfully:', userId);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('Load user error:', errMsg);
        setError(`Failed to load user: ${errMsg}`);
        Alert.alert('Error', `Failed to load user data: ${errMsg}. Please login again.`);
      }
    };
    loadUser();
  }, [paramCurrentUserId]);

  // Set isLoading false after all loads
  useEffect(() => {
    if (currentUserId && otherUserId && socketReady) {
      console.log('All states ready - exiting loading');
      setIsLoading(false);
      setError('');
    }
  }, [currentUserId, otherUserId, socketReady]);

  // Fetch messages
  useEffect(() => {
    if (!currentUserId || !otherUserId) {
      console.log('Fetch messages skipped - IDs not ready:', { currentUserId, otherUserId });
      return;
    }
    console.log('Fetching messages for IDs:', { current: currentUserId, other: otherUserId });
    const fetchMessages = async (): Promise<void> => {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        setError('No auth token - please login again');
        Alert.alert('Error', 'No token found - please login again');
        return;
      }
      try {
        const response = await axios.get<ChatMessage[]>(`${API_BASE}/messages/${otherUserId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        console.log('Messages fetched:', response.data.length);
        const { key, iv } = getSharedKeyAndIV(currentUserId, otherUserId);
        const sortedMessages = response.data.sort((a, b) => {
          const dateA = new Date(a.timestamp || 0).getTime();
          const dateB = new Date(b.timestamp || 0).getTime();
          return dateA - dateB;
        });
        const decryptedMessages = sortedMessages.map((m) => ({
          ...m,
          content: decryptMessage(m.encryptedContent, key, iv),
          isOwn: m.from === currentUserId,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
        }));
        setMessages(decryptedMessages);
        console.log('Messages decrypted and set (sorted):', decryptedMessages.length);
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: false });
        }, 100);
      } catch (err) {
        const error = err as AxiosError<{ error?: string }>;  // Type assertion
        console.error('Fetch messages error:', error.response?.data || error.message);
        setError('Failed to load messages - check backend');
        Alert.alert('Error', error.response?.data?.error || 'Failed to load messages');
      }
    };
    fetchMessages();
  }, [currentUserId, otherUserId]);

  // Socket setup (with call listeners)
  useEffect(() => {
    if (!currentUserId || !otherUserId) {
      console.log('Socket init skipped - IDs not ready');
      return;
    }

    const initSocket = async () => {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        setError('No auth token for socket');
        Alert.alert('Error', 'No token for chat connection - please login again');
        return;
      }
      console.log('Initializing socket with token (exists: true), to:', otherUserId);

      const socketUrl = API_BASE.replace('/api', '');
      console.log('Socket URL:', socketUrl);

      const newSocket = io(socketUrl, {
        auth: { token },
        transports: ['websocket'],
        timeout: 5000,
      });

      newSocket.emit('joinChat', otherUserId);

      newSocket.on('connect', () => {
        console.log('Socket connected and ready!');
        setSocketReady(true);
        socketRetries.current = 0;
        setError('');
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        newSocket.emit('getOnlineUsers');
      });

      newSocket.on('connect_error', (err) => {
        console.error('Socket connect error:', err.message);
        setSocketReady(false);
        socketRetries.current += 1;
        setError(`Connection failed (attempt ${socketRetries.current}): ${err.message}`);
        Alert.alert('Connection Error', `Failed to connect: ${err.message}. Retrying...`);

        if (socketRetries.current < maxRetries) {
          console.log(`Retrying socket in 5s (attempt ${socketRetries.current + 1})`);
          setTimeout(() => initSocket(), 5000);
        } else {
          Alert.alert('Connection Failed', 'Max retries reached. Check backend/network and try again.');
        }
      });

      // Online status listeners
      newSocket.on('userOnline', (data) => {
        console.log('User online event:', data.userId);
        if (data.userId === otherUserId) {
          setIsPartnerOnline(true);
        }
      });

      newSocket.on('userOffline', (data) => {
        console.log('User offline event:', data.userId);
        if (data.userId === otherUserId) {
          setIsPartnerOnline(false);
        }
      });

      newSocket.on('onlineUsersList', (data) => {
        console.log('Online users list received:', data.onlineUsers);
        setIsPartnerOnline(data.onlineUsers.includes(otherUserId));
      });

      // Message listener
      newSocket.on('receiveMessage', (msg: ChatMessage) => {
        console.log('Received message:', msg);
        if (msg.from === currentUserId) {
          console.log('Ignoring self-message echo to prevent duplicate');
          return;
        }
        const { key, iv } = getSharedKeyAndIV(currentUserId, otherUserId);
        const decrypted = decryptMessage(msg.encryptedContent, key, iv);
        setMessages((prev) => {
          const newMessages = [
            ...prev,
            { 
              ...msg, 
              content: decrypted, 
              isOwn: msg.from === currentUserId,
              timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
            },
          ];
          return newMessages.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
        });
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 0);
      });

      newSocket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        setSocketReady(false);
        setError('Disconnected - reconnecting...');
      });

      // Call listeners
      newSocket.on('incomingCall', (data: any) => {
        console.log(`${Platform.OS}: Incoming call from ${data.from} (${data.type}), room ${data.roomId}`);
        if (data.to !== currentUserId) {
          console.log(`${Platform.OS}: Incoming call not for me, ignoring`);
          return;
        }
        setIncomingCall(data); // Store offer/roomId/type
        setShowCallModal(true);
        setCallType(data.type as 'audio' | 'video');
        Alert.alert('Incoming Call', `${data.from} is calling via ${data.type}.`);
      });

      newSocket.on('callAccepted', (data: any) => {
        console.log(`${Platform.OS}: Call accepted by peer:`, data);
        setIsCallActive(true);
        setCallState('active');
      });

      newSocket.on('callRejected', (data: any) => {
        console.log('❌ Call rejected:', data);
        Alert.alert('Call Rejected', 'The call was declined.');
        endCall();
      });

      newSocket.on('callEnded', (data: any) => {
        console.log('📞 Call ended:', data);
        endCall();
      });

      newSocket.on('answer', async (data: any) => {
        console.log(`${Platform.OS}: Answer received from ${data.from} for room ${data.roomId} (type: ${data.answer?.type})`);
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          console.log(`${Platform.OS}: Remote description set - wait for ontrack`);
        } catch (err: any) {
          console.error(`${Platform.OS}: Answer handling error:`, err);
        }
      });

      newSocket.on('ice-candidate', async (data: any) => {
        console.log('🧊 ICE candidate received:', data);
        if (!pc || !data.candidate) return;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.error('ICE candidate error:', err);
        }
      });

      newSocket.on('callError', (data: any) => {
        console.log(`${Platform.OS}: Call error:`, data.message);
        Alert.alert('Call Failed', data.message);
        setShowCallModal(false);
        endCall();
      });

      setSocket(newSocket);

      timeoutRef.current = setTimeout(() => {
        if (!socketReady) {
          console.error('Socket timeout - no connection after 10s');
          setError('Connection timeout - check IP/backend');
          Alert.alert('Timeout', 'Chat connection timed out. Verify backend is running.');
        }
      }, 10000);
    };

    initSocket();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      socket?.disconnect();
      setSocketReady(false);
      socketRetries.current = 0;
    };
  }, [currentUserId, otherUserId]);

  // Safe emit helper
  const safeEmit = (event: string, data: any): boolean => {
    if (!socket || !socketReady) {
      console.error('Safe emit failed - socket not ready:', event);
      Alert.alert('Offline', 'Reconnecting to server...');
      return false;
    }
    socket.emit(event, data);
    return true;
  };

  // Test mode toggle
  const toggleTestMode = () => {
    setTestMode(prev => !prev);
    setIsPartnerOnline(prev => !prev);
    Alert.alert('Test Mode', `Partner ${!testMode ? 'online' : 'offline'} (simulated for calls)`);
  };

  // Get local stream for call
  const getLocalStream = async (type: 'audio' | 'video'): Promise<MediaStream | null> => {
    try {
      console.log(`getLocalStream called on ${Platform.OS} for ${type} call`);
      if (Platform.OS === 'android') {
        const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
        if (type === 'video') perms.push(PermissionsAndroid.PERMISSIONS.CAMERA);
        const results = await PermissionsAndroid.requestMultiple(perms);
        console.log('Android permissions:', results);
        if (type === 'video' && results[PermissionsAndroid.PERMISSIONS.CAMERA] !== 'granted') {
          Alert.alert('Denied', 'Camera required for video');
          return null;
        }
        if (results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !== 'granted') {
          Alert.alert('Denied', 'Mic required for calls');
          return null;
        }
      } else if (Platform.OS === 'web') {
        console.log('Web: Requesting getUserMedia (needs HTTPS)');
      }
      
      if (!mediaDevices) {
        console.error('mediaDevices unavailable on', Platform.OS);
        Alert.alert('Error', 'WebRTC not available - use mobile for calls');
        return null;
      }
      
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video' ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false,
      });
      
      stream.getTracks().forEach((track: MediaStreamTrack) => {
        track.enabled = true;
        console.log(`${Platform.OS} local ${track.kind} track enabled: ${track.readyState}`);
      });
      
      console.log(`${Platform.OS} stream acquired: ${stream.getTracks().length} tracks`);
      return stream;
    } catch (err: any) {
      console.error(`${Platform.OS} stream error:`, err.name, err.message);
      Alert.alert('Error', `${Platform.OS === 'web' ? 'HTTPS required' : 'Permission denied'}: ${err.message}`);
      return null;
    }
  };

  // Create PeerConnection for call
  const createPeerConnection = async (roomId: string, type: 'audio' | 'video'): Promise<any | null> => {
    console.log(`${Platform.OS}: Creating PC for ${type} call in room ${roomId}`);
    
    if (!RTCPeerConnection) {
      console.error(`${Platform.OS}: RTCPeerConnection unavailable`);
      if (Platform.OS === 'web') {
        Alert.alert('Web Error', 'Use HTTPS for WebRTC (try ngrok)');
      } else {
        Alert.alert('Error', 'WebRTC not supported - rebuild with dev client');
      }
      return null;
    }
    
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
      ]
    };
    
    const pc = new RTCPeerConnection(config);
    console.log(`${Platform.OS}: PC created with ${config.iceServers.length} ICE servers`);
    setPc(pc);

    const stream = await getLocalStream(type);
    if (!stream || stream.getTracks().length === 0) {
      console.error(`${Platform.OS}: No valid stream (tracks: ${stream?.getTracks().length || 0})`);
      pc.close();
      return null;
    }

    console.log(`${Platform.OS}: Adding ${stream.getTracks().length} tracks to PC`);
    stream.getTracks().forEach((track: MediaStreamTrack) => {
      console.log(`  - ${track.kind} track (enabled: ${track.enabled})`);
      pc.addTrack(track, stream);
    });
    setLocalStream(stream);

    if (socket) {
      socket.emit('acceptCall', { roomId });
      console.log(`${Platform.OS}: Joined call room ${roomId}`);
    }

    // Cross-platform ontrack (works for both)
    pc.ontrack = (event: RTCTrackEvent) => {
      console.log(`${Platform.OS} ontrack: Remote stream with ${event.streams[0]?.getTracks().length || 0} tracks`);
      event.streams[0]?.getTracks().forEach((track: MediaStreamTrack) => {
        console.log(`  Remote ${track.kind} track received (enabled: ${track.enabled})`);
      });
      setRemoteStream(event.streams[0]);
      setIsCallActive(true);
      Alert.alert('Connected', `${Platform.OS} call active`);
    };

    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        console.log(`${Platform.OS}: ICE candidate generated (${event.candidate.type})`);
        safeEmit('ice-candidate', { roomId, candidate: event.candidate });
      }
    };

    // Update createPeerConnection: Only end on 'failed', not 'disconnected' (normal for signaling)
    pc.onconnectionstatechange = () => {
      console.log(`${Platform.OS} PC state: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        console.log(`${Platform.OS}: ✅ Connected - streams should flow`);
      } else if (pc.connectionState === 'failed') {
        console.error(`${Platform.OS}: ❌ PC failed - ending call`);
        endCall();
        Alert.alert('Failed', `${Platform.OS} connection failed. Check network.`);
      } else if (pc.connectionState === 'disconnected') {
        console.log(`${Platform.OS}: PC disconnected (transient? monitoring)`);
        // Don't end - wait for ICE or manual
      }
    };

    // Update oniceconnectionstatechange: Add timeout for 'checking'
    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      console.log(`${Platform.OS} ICE state: ${iceState}`);
      if (iceState === 'completed' || iceState === 'connected') {
        console.log(`${Platform.OS}: ICE complete - full media flow`);
      } else if (iceState === 'failed') {
        console.error(`${Platform.OS}: ICE failed - ending after 10s`);
        setTimeout(() => {
          if (pc.iceConnectionState === 'failed') endCall();
        }, 10000); // 10s grace
      } else if (iceState === 'checking') {
        console.log(`${Platform.OS}: ICE checking (gathering candidates...)`);
      } else if (iceState === 'disconnected') {
        console.log(`${Platform.OS}: ICE disconnected (network? not ending)`);
      }
    };

    return pc;
  };

  // Initiate call: Notify recipient, then wait for them to accept before creating media.
  const initiateCall = async (type: 'audio' | 'video') => {
    console.log(`${Platform.OS}: Initiating ${type} call to ${otherUserId}`);
    
    if (!isPartnerOnline && !testMode) {
      Alert.alert('Offline', `${otherUser.username} is offline`);
      return;
    }
    if (!socketReady) {
      Alert.alert('Error', 'Not connected to server');
      return;
    }

    const roomId = [currentUserId, otherUserId].sort().join('_');
    setCallType(type);
    setCallState('ringing');
    setShowCallModal(true);

    // Send notification only
    if (!safeEmit('initiateCall', { to: otherUserId, type, roomId })) {
      console.error('Initiate call failed');
      setShowCallModal(false);
      setCallState('idle');
      return;
    }

    console.log(`Call initiated - waiting for ${otherUser.username} to accept`);

    // Define handleCallAccepted as async function
    const handleCallAccepted = async (data: any) => {
      if (data.roomId !== roomId) return;
      
      console.log('Peer accepted - starting media');
      setCallState('active');

      let pc: any = null;
      try {
        // Now create PC and stream
        pc = await createPeerConnection(roomId, type);
        if (!pc) {
          console.error('PC creation failed after acceptance');
          setCallState('ended');
          setShowCallModal(false);
          safeEmit('endCall', { roomId });
          return;
        }

        // Create and send offer
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: type === 'video',
        });
        await pc.setLocalDescription(offer);
        safeEmit('offer', { roomId, offer: pc.localDescription });
        console.log('Offer sent after acceptance');
      } catch (err: any) {
        console.error('Media setup failed after acceptance:', err);
        endCall();
      }
    };

    socket?.on('callAccepted', handleCallAccepted);
  };

  // Accept call: Notify caller, then create PC and wait for their offer.
  const acceptCall = async () => {
    if (!incomingCall || !socketReady) {
      Alert.alert('Error', 'Cannot accept call');
      return;
    }
    
    const { roomId, type } = incomingCall;
    setCallType(type);
    setCallState('connecting');
    setShowCallModal(true);
    setIncomingCall(null);

    // Notify caller
    safeEmit('acceptCall', { roomId });
    console.log('Emitted acceptCall - preparing media');

    // Create PC and stream
    const pc = await createPeerConnection(roomId, type);
    if (!pc) {
      console.error('PC creation failed on accept');
      safeEmit('endCall', { roomId });
      setCallState('ended');
      setShowCallModal(false);
      return;
    }

    // Use useCallback for handleOffer
    const handleOffer = useCallback(async (data: any) => {
      if (data.roomId !== roomId) return;
      console.log('Received offer, creating answer');

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        safeEmit('answer', { roomId, answer: pc.localDescription });
        console.log('Answer sent - call connected');
        setCallState('active');
      } catch (err: any) {
        console.error('Answer creation failed:', err);
        endCall();
      }
    }, [roomId]);

    // Set listener
    socket?.on('offer', handleOffer);

    // Cleanup on unmount or when call ends
    return () => {
      socket?.off('offer', handleOffer);
    };
  };

  // Reject call
  const rejectCall = () => {
    if (incomingCall && socketReady) {
      safeEmit('rejectCall', { roomId: incomingCall.roomId });
    }
    setShowCallModal(false);
    setIncomingCall(null);
    console.log('❌ Call rejected');
  };

  // End call
  const endCall = () => {
    console.log('Call ended');
    setIsCallActive(false);
    setCallState('idle');
    setShowCallModal(false);
    const roomId = [currentUserId, otherUserId].sort().join('_');
    if (socketReady) {
      safeEmit('endCall', { roomId });
      console.log(`${Platform.OS}: Emitted endCall to room`);
    }
    console.log(`${Platform.OS}: Call ended - cleanup complete`);
  };

  // Send message
  const sendMessage = (): void => {
    if (!message.trim() || !socket || !currentUserId || !otherUserId || !socketReady) {
      console.warn('Send blocked - missing state:', { 
        message: !!message.trim(), 
        socket: !!socket, 
        currentUserId, 
        otherUserId, 
        socketReady 
      });
      Alert.alert('Info', 'Chat not ready - check connection and try again.');
      return;
    }
    try {
      console.log('Sending message with IDs:', { current: currentUserId, other: otherUserId });
      const { key, iv } = getSharedKeyAndIV(currentUserId, otherUserId);
      const encryptedContent = encryptMessage(message, key, iv);
      console.log('Encryption successful, emitting to socket');
      socket.emit('sendMessage', { to: otherUserId, encryptedContent });
      const newMsg: Message = {
        from: currentUserId,
        to: otherUserId,
        content: message,
        isOwn: true,
        timestamp: new Date(),
      };
      setMessages((prev) => {
        const updated = [...prev, newMsg].sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 0);
        return updated;
      });
      setMessage('');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Send message full error:', errorMessage);
      Alert.alert('Error', `Failed to send: ${errorMessage}`);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    let timestampText = '';
    try {
      const ts = item.timestamp ? new Date(item.timestamp) : new Date();
      if (ts && !isNaN(ts.getTime())) {
        timestampText = ts.toLocaleTimeString();
      }
    } catch (err) {
      console.warn('Invalid timestamp, skipping:', item.timestamp);
    }

    return (
      <View style={[styles.messageContainer, item.isOwn ? styles.ownContainer : styles.otherContainer]}>
        <View style={[styles.message, item.isOwn ? styles.ownMessage : styles.otherMessage]}>
          <Text style={styles.messageText}>{item.content || 'Empty message'}</Text>
        </View>
        {timestampText && <Text style={styles.timestamp}>{timestampText}</Text>}
      </View>
    );
  };

  // Auto-scroll listeners
  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener('keyboardDidShow', () => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });
    const keyboardDidHideListener = Keyboard.addListener('keyboardDidHide', () => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });

    return () => {
      keyboardDidHideListener?.remove();
      keyboardDidShowListener?.remove();
    };
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 300);
    }
  }, [messages]);

  // Handle header tap - Navigate to user profile
  const openUserProfile = (): void => {
    if (!otherUserId || !otherUser.username) {
      Alert.alert('Error', 'Cannot load profile - invalid user data');
      return;
    }
    console.log('Opening profile for user:', otherUser.username);
    navigation.navigate('UserProfile', {
      otherUserId,
      otherUserName: otherUser.username,
      isPartnerOnline,
    });
  };

  // Render clickable header (with call buttons)
  const renderHeader = () => (
    <TouchableOpacity onPress={openUserProfile} activeOpacity={0.7} style={styles.headerTouchable}>
      {/* Partner avatar/icon on left */}
      {renderHeaderAvatar()}
      {/* Title text in center */}
      <View style={styles.headerText}>
        <Text style={styles.header}>Chat with {otherUser.username || 'User'}</Text>
        <Text style={styles.headerId}>ID: {shortId}</Text>
        {(isPartnerOnline || testMode) && <Text style={styles.headerOnline}>Online</Text>}
      </View>
      {/* Call buttons on right
      <View style={styles.headerCallButtons}>
        <TouchableOpacity 
          style={styles.testButton} 
          onPress={toggleTestMode}
          disabled={!socketReady}
        >
          <Text style={styles.testButtonText}>Test</Text>
        </TouchableOpacity>
        {RTCPeerConnection ? (
          <>
            <TouchableOpacity 
              style={styles.audioCallButton} 
              onPress={() => initiateCall('audio')}
              disabled={!socketReady || !isPartnerOnline}
            >
              <Ionicons name="call-outline" size={24} color="#4CAF50" />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.videoCallButton} 
              onPress={() => initiateCall('video')}
              disabled={!socketReady || !isPartnerOnline}
            >
              <Ionicons name="videocam-outline" size={24} color="#2196F3" />
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.testButtonText}>Calls unavailable</Text>
        )}
      </View> */}
    </TouchableOpacity>
  );

  // Render header avatar
  const renderHeaderAvatar = () => {
    const fullAvatarUrl = otherUser.avatar_url ? `${API_BASE.replace('/api', '')}${otherUser.avatar_url}` : null;

    if (fullAvatarUrl) {
      return (
        <View style={styles.headerIconContainer}>
          <Image 
            source={{ uri: fullAvatarUrl }} 
            style={styles.headerAvatarIcon}
            onError={(e) => console.log('Chat header avatar load error for', otherUser.username, ':', e.nativeEvent.error)}
          />
          {(isPartnerOnline || testMode) && <View style={styles.onlineDot} />}
        </View>
      );
    }
    return (
      <View style={styles.headerIconContainer}>
        <Ionicons 
          name="person-circle" 
          size={40}
          color={(isPartnerOnline || testMode) ? '#007AFF' : '#ccc'}
        />
        {(isPartnerOnline || testMode) && (
          <View style={styles.onlineDot} />
        )}
      </View>
    );
  };

  // In renderCallModal, the logic remains largely the same, but the state transitions are now more distinct.
  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);

  // Render call modal
  const renderCallModal = () => (
    <Modal 
      visible={showCallModal} 
      transparent 
      animationType="fade" 
      presentationStyle={Platform.OS === 'android' ? 'overFullScreen' : 'fullScreen'}
      onRequestClose={endCall}
    >
      <View style={styles.callModalOverlay}>
        {callState === 'ringing' ? (
          // Outgoing ringing screen (caller)
          <View style={styles.callModalContent}>
            <Ionicons name={callType === 'video' ? 'videocam' : 'call'} size={60} color="#007AFF" />
            <Text style={styles.callModalTitle}>Calling {otherUser.username}</Text>
            <Text style={styles.callModalSubtitle}>Ringing...</Text>
            <TouchableOpacity style={styles.endButton} onPress={endCall}>
              <Ionicons name="close-circle" size={24} color="white" />
              <Text style={styles.callButtonText}>End</Text>
            </TouchableOpacity>
          </View>
        ) : callState === 'connecting' ? (
          // Connecting: After accept, before media flows
          <View style={styles.callModalContent}>
            <Ionicons name={callType === 'video' ? 'videocam' : 'call'} size={60} color="#007AFF" />
            <Text style={styles.callModalTitle}>Connecting...</Text>
            <Text style={styles.callModalSubtitle}>Preparing video call</Text>
            <TouchableOpacity style={styles.endButton} onPress={endCall}>
              <Ionicons name="close-circle" size={24} color="white" />
              <Text style={styles.callButtonText}>End</Text>
            </TouchableOpacity>
          </View>
        ) : incomingCall ? (
          // Incoming accept/reject
          <View style={styles.callModalContent}>
            <Ionicons name={callType === 'video' ? 'videocam' : 'call'} size={60} color="#007AFF" />
            <Text style={styles.callModalTitle}>Incoming {callType} Call</Text>
            <Text style={styles.callModalSubtitle}>{otherUser.username} is calling</Text>
            <View style={styles.callModalButtons}>
              <TouchableOpacity style={styles.acceptButton} onPress={acceptCall}>
                <Ionicons name="checkmark-circle" size={24} color="white" />
                <Text style={styles.callButtonText}>Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.rejectButton} onPress={rejectCall}>
                <Ionicons name="close-circle" size={24} color="white" />
                <Text style={styles.callButtonText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          // Active call (after acceptance)
          <View style={styles.videoContainer}>
            {/* Remote Video - Mobile RTCView, Web fallback */}
            {Platform.OS !== 'web' && remoteStream && RTCView ? (
              <RTCView streamURL={remoteStream.toURL()} style={styles.remoteVideo} objectFit="cover" />
            ) : (
              <View style={styles.remoteVideo}>
                <Text style={styles.noStreamText}>
                  {Platform.OS === 'web' ? 'Web: HTTPS + camera/mic needed' : 'Video connecting...'}
                </Text>
              </View>
            )}
            {/* Local Video - Mobile only */}
            {Platform.OS !== 'web' && localStream && callType === 'video' && RTCView ? (
              <RTCView streamURL={localStream.toURL()} style={styles.localVideo} objectFit="cover" mirror={true} />
            ) : null}
            {/* Controls - All platforms */}
            <View style={styles.activeControls}>
              <TouchableOpacity style={styles.controlButton} onPress={() => {
                if (localStream) {
                  const audioTrack = localStream.getAudioTracks()[0];
                  if (audioTrack) {
                    audioTrack.enabled = !audioTrack.enabled;
                    console.log(`${Platform.OS}: Audio ${audioTrack.enabled ? 'unmuted' : 'muted'}`);
                  }
                }
              }}>
                <Ionicons name="mic" size={30} color="#fff" />
              </TouchableOpacity>
              {callType === 'video' && (
                <TouchableOpacity style={styles.controlButton} onPress={() => {
                  if (localStream) {
                    const videoTrack = localStream.getVideoTracks()[0];
                    if (videoTrack) {
                      videoTrack.enabled = !videoTrack.enabled;
                      console.log(`${Platform.OS}: Video ${videoTrack.enabled ? 'on' : 'off'}`);
                    }
                  }
                }}>
                  <Ionicons name="videocam" size={30} color="#fff" />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.endCallButton} onPress={endCall}>
                <Ionicons name="close-circle" size={30} color="#ff4444" />
              </TouchableOpacity>
            </View>
            <Text style={styles.partnerNameOverlay}>{otherUser.username} ({Platform.OS})</Text>
          </View>
        )}
      </View>
    </Modal>
  );

  // Enhanced loading
  if (isLoading || !currentUserId || !otherUserId || !socketReady) {
    return (
      <KeyboardAvoidingView style={styles.container} behavior="padding" keyboardVerticalOffset={keyboardVerticalOffset}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color='#007AFF' />
          <Text style={styles.loadingText}>Connecting to chat... (Calls ready after connect)</Text>
          {error && <Text style={styles.errorText}>{error}</Text>}
          <Button title="Retry Connection" onPress={() => { setIsLoading(true); setSocketReady(false); setError(''); }} />
        </View>
      </KeyboardAvoidingView>
    );
  }

  const shortId = otherUserId.substring(0, 8) + '...';

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior="padding"
      enabled={true}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      {/* Header with call buttons */}
      {renderHeader()}
      
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(_, index) => index.toString()}
        renderItem={renderMessage}
        style={styles.messagesList}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
        bounces={true}
        showsVerticalScrollIndicator={true}
        initialNumToRender={20}
        maxToRenderPerBatch={10}
        windowSize={21}
        removeClippedSubviews={true}
        extraData={messages}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No messages yet. Say hello!</Text>
          </View>
        }
        onContentSizeChange={() => {
          if (messages.length > 0) {
            flatListRef.current?.scrollToEnd({ animated: false });
          }
        }}
        onLayout={() => {
          if (messages.length > 0) {
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
          }
        }}
        maintainVisibleContentPosition={{
          autoscrollToTopThreshold: 10,
          minIndexForVisible: 1,
        }}
      />
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder="Type a message..."
          multiline
          maxLength={500}
          returnKeyType="send"
          onSubmitEditing={sendMessage}
          editable={socketReady}
          blurOnSubmit={false}
        />
        <Button 
          title={socketReady ? "Send" : "Connecting..."} 
          onPress={sendMessage} 
          disabled={!socketReady || !message.trim()} 
          color="#007AFF"
        />
      </View>

      {/* Call modal */}
      {renderCallModal()}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  headerTouchable: {
    flexDirection: 'row',
    alignItems: 'center', 
    paddingTop: 30,
    paddingBottom: 10,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  headerIconContainer: {
    marginRight: 12,
    position: 'relative',
  },
  headerAvatarIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  headerText: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
  },
  header: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 2,
  },
  headerId: {
    fontSize: 12,
    color: 'gray',
    marginBottom: 2,
  },
  headerOnline: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: 'bold',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#007AFF',
    borderWidth: 2,
    borderColor: '#fff',
  },
  headerCallButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  testButton: {
    padding: 5,
    marginLeft: 5,
    backgroundColor: '#e3f2fd',
    borderRadius: 5,
  },
  testButtonText: {
    fontSize: 12,
    color: '#1976d2',
  },
  audioCallButton: {
    padding: 8,
    marginLeft: 5,
    backgroundColor: '#e8f5e8',
    borderRadius: 20,
  },
  videoCallButton: {
    padding: 8,
    marginLeft: 5,
    backgroundColor: '#e3f2fd',
    borderRadius: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    color: 'red',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    padding: 10,
    paddingBottom: 10,
  },
  messageContainer: {
    marginVertical: 4,
  },
  ownContainer: {
    alignSelf: 'flex-end',
  },
  otherContainer: {
    alignSelf: 'flex-start',
  },
  message: {
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    maxWidth: '75%',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  ownMessage: {
    backgroundColor: '#c6edf8ff',
  },
  otherMessage: {
    backgroundColor: '#E5E5EA',
  },
  messageText: {
    fontSize: 16,
    lineHeight: 20,
    color: '#333',
  },
  timestamp: {
    fontSize: 11,
    color: '#999',
    alignSelf: 'flex-end',
    marginTop: 2,
    marginRight: 5,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontStyle: 'italic',
    color: '#999',
    textAlign: 'center',
    fontSize: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#ddd',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 25,
    paddingHorizontal: 15,
    paddingVertical: 12,
    marginRight: 10,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
    maxHeight: 100,
    textAlignVertical: 'center',
  },
  // Call modal styles
  callModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  callModalContent: {
    backgroundColor: 'white',
    padding: 30,
    borderRadius: 20,
    alignItems: 'center',
    width: '80%',
    maxWidth: 300,
  },
  callModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginVertical: 10,
    color: '#333',
  },
  callModalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  callModalButtons: {
    flexDirection: 'row',
    width: '100%',
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#4CAF50',
    padding: 12,
    borderRadius: 10,
    marginRight: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  rejectButton: {
    flex: 1,
    backgroundColor: '#f44336',
    padding: 12,
    borderRadius: 10,
    marginLeft: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  endButton: {
    backgroundColor: '#f44336',
    padding: 12,
    borderRadius: 10,
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  callButtonText: {
    color: 'white',
    fontSize: 16,
    marginLeft: 5,
  },
  // Video container
  videoContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  remoteVideo: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: 20,
  },
  localVideo: {
    width: 120,
    height: 120,
    position: 'absolute',
    bottom: 20,
    right: 20,
    borderRadius: 10,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  activeControls: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    backgroundColor: 'transparent',
  },
  controlButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 50,
    padding: 20,
    alignItems: 'center',
  },
  endCallButton: {
    backgroundColor: '#ff4444',
    borderRadius: 50,
    padding: 20,
    alignItems: 'center',
  },
  partnerNameOverlay: {
    position: 'absolute',
    top: 50,
    left: 20,
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    zIndex: 2,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
  },
  noStreamText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});