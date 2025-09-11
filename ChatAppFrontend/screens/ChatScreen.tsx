import React, { useState, useEffect, useRef } from 'react';
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
  email: string;
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
  const [otherUser, setOtherUser] = useState<User>({ username: otherUserName, id: paramOtherUserId });
  const [testMode, setTestMode] = useState<boolean>(false);  // For solo testing

  // Call state
  const [showCallModal, setShowCallModal] = useState<boolean>(false);
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [callType, setCallType] = useState<'audio' | 'video'>('video');
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [pc, setPc] = useState<any>(null);
  const [isCallActive, setIsCallActive] = useState<boolean>(false);

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
    setOtherUser({ id: paramOtherUserId, username: otherUserName });
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
          avatar_url: response.data.avatar_url || '',
        });
        console.log('Fetched other user for chat:', response.data);
      } catch (err) {
        console.error('Fetch other user error:', err);
        setOtherUser({ id: otherUserId, username: otherUserName });
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
    } catch (err) {
      console.error('Key/IV generation error:', err);
      throw new Error(`Key/IV generation failed: ${err.message}`);
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
    } catch (err) {
      console.error('Encryption error details:', {
        errMessage: err.message,
        errStack: err.stack,
        contentType: typeof content,
        contentLength: content.length,
        keyType: typeof key,
        keySigBytes: key ? key.sigBytes : 'no key',
        ivType: typeof iv,
        ivSigBytes: iv ? iv.sigBytes : 'no iv'
      });
      throw new Error(`Encryption failed: ${err.message}`);
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
      } catch (err) {
        console.error('Load user error:', err);
        setError(`Failed to load user: ${err.message}`);
        Alert.alert('Error', `Failed to load user data: ${err.message}. Please login again.`);
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
        const error = err as AxiosError;
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
        console.log('📞 Incoming call:', data);
        setIncomingCall(data);
        setShowCallModal(true);
        setCallType(data.type as 'audio' | 'video');
        Alert.alert('Incoming Call', `${data.from} is calling you via ${data.type}.`);
      });

      newSocket.on('callAccepted', (data: any) => {
        console.log('✅ Call accepted:', data);
        setIsCallActive(true);
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

      newSocket.on('offer', async (data: any) => {
        console.log('📋 Offer received:', data);
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          newSocket.emit('answer', { roomId: data.roomId, answer });
        } catch (err) {
          console.error('Offer handling error:', err);
        }
      });

      newSocket.on('answer', async (data: any) => {
        console.log('📋 Answer received:', data);
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        } catch (err) {
          console.error('Answer handling error:', err);
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
      if (!mediaDevices) {
        throw new Error('Media devices not available');
      }
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video' ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false,
      });
      console.log(`Local stream acquired (${type}): ${stream.getTracks().length} tracks`);
      return stream;
    } catch (err: any) {
      console.error('getLocalStream error:', err);
      Alert.alert('Permission Error', err.name === 'NotAllowedError' ? 'Camera/mic denied. Enable in settings.' : err.message);
      return null;
    }
  };

  // Create PeerConnection for call
  const createPeerConnection = async (roomId: string, type: 'audio' | 'video'): Promise<RTCPeerConnection | null> => {
    if (!RTCPeerConnection) {
      Alert.alert('Error', 'WebRTC not supported on this platform');
      return null;
    }
    if (!socketReady) {
      Alert.alert('Error', 'Socket not ready for call');
      return null;
    }

    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    setPc(peerConnection);

    const stream = await getLocalStream(type);
    if (!stream) return null;

    setLocalStream(stream);
    stream.getTracks().forEach((track: MediaStreamTrack) => peerConnection.addTrack(track, stream));

    // Local preview (web only)
    if (Platform.OS === 'web' && type === 'video') {
      const localVideo = document.getElementById('localVideo') as HTMLVideoElement;
      if (localVideo) localVideo.srcObject = stream;
    }

    // Remote stream
    peerConnection.ontrack = (event: RTCTrackEvent) => {
      console.log('Remote stream received');
      setRemoteStream(event.streams[0]);
      if (Platform.OS === 'web') {
        const remoteVideo = document.getElementById('remoteVideo') as HTMLVideoElement;
        if (remoteVideo) remoteVideo.srcObject = event.streams[0];
      }
    };

    // ICE candidates
    peerConnection.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        safeEmit('ice-candidate', { roomId, candidate: event.candidate });
      }
    };

    // Connection state
    peerConnection.onconnectionstatechange = () => {
      console.log('PeerConnection state:', peerConnection.connectionState);
      if (peerConnection.connectionState === 'connected') {
        setIsCallActive(true);
        Alert.alert('Connected!', 'Call is now active');
      } else if (peerConnection.connectionState === 'failed') {
        endCall();
        Alert.alert('Failed', 'Connection failed. Retry?');
      }
    };

    console.log('PeerConnection created for room:', roomId);
    return peerConnection;
  };

  // Initiate call
  const initiateCall = async (type: 'audio' | 'video') => {
    if (!isPartnerOnline && !testMode) {
      Alert.alert('Unavailable', `${otherUser.username} is offline`);
      return;
    }
    if (!socketReady) {
      Alert.alert('Error', 'Connection required for calls');
      return;
    }

    const roomId = [currentUserId, otherUserId].sort().join('_');
    setCallType(type);
    setShowCallModal(true);

    if (!safeEmit('initiateCall', { to: otherUserId, type, roomId })) return;

    const peerConnection = await createPeerConnection(roomId, type);
    if (!peerConnection) {
      setShowCallModal(false);
      return;
    }

    try {
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video',
      });
      await peerConnection.setLocalDescription(offer);
      safeEmit('offer', { roomId, offer: peerConnection.localDescription });
      console.log(`📞 ${type} call initiated to ${otherUserId}`);
    } catch (err: any) {
      console.error('Initiate call error:', err);
      endCall();
      Alert.alert('Error', 'Failed to start call');
    }
  };

  // Accept call
  const acceptCall = async () => {
    if (!incomingCall || !socketReady) {
      Alert.alert('Error', 'Cannot accept call');
      return;
    }
    const roomId = incomingCall.roomId;
    setCallType(incomingCall.type);
    setShowCallModal(false);

    if (!safeEmit('acceptCall', { roomId })) return;

    const peerConnection = await createPeerConnection(roomId, incomingCall.type);
    if (!peerConnection) {
      safeEmit('endCall', { roomId });
      return;
    }

    setIncomingCall(null);
    console.log('✅ Call accepted');
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
    if (localStream) {
      localStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      setLocalStream(null);
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      setRemoteStream(null);
    }
    if (pc) {
      pc.close();
      setPc(null);
    }
    setIsCallActive(false);
    setShowCallModal(false);
    const roomId = [currentUserId, otherUserId].sort().join('_');
    if (socketReady) safeEmit('endCall', { roomId });
    console.log('📞 Call ended');
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
    } catch (err) {
      console.error('Send message full error:', err);
      Alert.alert('Error', `Failed to send: ${err.message}`);
    }
  };

  const renderMessage = ({ item }: { item: Message }): JSX.Element => {
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
  const renderHeader = (): JSX.Element => (
    <TouchableOpacity onPress={openUserProfile} activeOpacity={0.7} style={styles.headerTouchable}>
      {/* Partner avatar/icon on left */}
      {renderHeaderAvatar()}
      {/* Title text in center */}
      <View style={styles.headerText}>
        <Text style={styles.header}>Chat with {otherUser.username || 'User'}</Text>
        <Text style={styles.headerId}>ID: {shortId}</Text>
        {(isPartnerOnline || testMode) && <Text style={styles.headerOnline}>Online</Text>}
      </View>
      {/* Call buttons on right */}
      <View style={styles.headerCallButtons}>
        <TouchableOpacity 
          style={styles.testButton} 
          onPress={toggleTestMode}
          disabled={!socketReady}
        >
          <Text style={styles.testButtonText}>Test</Text>
        </TouchableOpacity>
        {socketReady && (isPartnerOnline || testMode) && (
          <>
            <TouchableOpacity 
              style={styles.audioCallButton} 
              onPress={() => initiateCall('audio')}
              accessibilityLabel="Audio Call"
            >
              <Ionicons name="call-outline" size={24} color="#4CAF50" />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.videoCallButton} 
              onPress={() => initiateCall('video')}
              accessibilityLabel="Video Call"
            >
              <Ionicons name="videocam-outline" size={24} color="#2196F3" />
            </TouchableOpacity>
          </>
        )}
      </View>
    </TouchableOpacity>
  );

  // Render header avatar
  const renderHeaderAvatar = (): JSX.Element => {
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

  // Render call modal
  const renderCallModal = () => (
    <Modal visible={showCallModal} transparent animationType="fade">
      <View style={styles.callModalOverlay}>
        <View style={styles.callModalContent}>
          {incomingCall ? (
            // Incoming call
            <>
              <Ionicons name={callType === 'video' ? 'videocam' : 'call'} size={60} color="#007AFF" />
              <Text style={styles.callModalTitle}>Incoming {callType} Call</Text>
              <Text style={styles.callModalSubtitle}>From: {incomingCall.from}</Text>
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
            </>
          ) : (
            // Outgoing call
            <>
              <Ionicons name={callType === 'video' ? 'videocam' : 'call'} size={60} color="#007AFF" />
              <Text style={styles.callModalTitle}>Calling {otherUser.username}</Text>
              <Text style={styles.callModalSubtitle}>{isCallActive ? 'Connected!' : 'Ringing...'}</Text>
              {isCallActive && (
                <TouchableOpacity style={styles.endButton} onPress={endCall}>
                  <Ionicons name="call-end" size={24} color="white" />
                  <Text style={styles.callButtonText}>End Call</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* Active call video overlay */}
        {isCallActive && (
          <View style={styles.videoContainer}>
            {/* Remote video (full screen) */}
            {Platform.OS === 'web' && remoteStream && (
              <video
                id="remoteVideo"
                srcObject={remoteStream}
                autoPlay
                playsInline
                style={styles.remoteVideo}
              />
            )}
            {Platform.OS !== 'web' && remoteStream && RTCView && (
              <RTCView
                streamURL={remoteStream.toURL()}
                style={styles.remoteVideo}
              />
            )}

            {/* Local video (small overlay) */}
            {localStream && callType === 'video' && (
              Platform.OS === 'web' ? (
                <video
                  id="localVideo"
                  srcObject={localStream}
                  autoPlay
                  muted
                  playsInline
                  style={styles.localVideo}
                />
              ) : (
                <RTCView
                  streamURL={localStream.toURL()}
                  style={styles.localVideo}
                  mirror={true}
                />
              )
            )}
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
    left: 0,
    right: 0,
    bottom: 0,
  },
  remoteVideo: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: 300,  // Full height
    backgroundColor: '#000',
  },
  localVideo: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 120,
    height: 160,
    borderRadius: 10,
    backgroundColor: '#000',
    zIndex: 10,
  },
});