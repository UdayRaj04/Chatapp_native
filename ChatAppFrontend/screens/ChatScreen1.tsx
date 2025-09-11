// import React, { useState, useEffect, useRef } from 'react';
// import {
//   View,
//   TextInput,
//   Button,
//   FlatList,
//   Text,
//   StyleSheet,
//   Alert,
//   ActivityIndicator,
//   KeyboardAvoidingView,
//   Platform,
//   Keyboard,
//   Image,  // Added for avatar
//   TouchableOpacity,  // Added for clickable header and call buttons
//   Modal,  // Added for call modals
// } from 'react-native';
// import { Ionicons } from '@expo/vector-icons';  // For partner icon (person-circle)
// import { useSafeAreaInsets } from 'react-native-safe-area-context';
// import { useNavigation } from '@react-navigation/native';  // Added: For navigation to profile
// import AsyncStorage from '@react-native-async-storage/async-storage';
// import io, { Socket } from 'socket.io-client';
// import axios, { AxiosError } from 'axios';
// import CryptoJS from 'crypto-js';

// import { API_BASE, SOCKET_BASE } from '../config';  // New: Global config (adjust path if 

// // WebRTC: Conditional import - Mobile uses react-native-webrtc, Web uses native browser APIs
// let RTCIceCandidate: any, RTCSessionDescription: any, mediaDevices: any, RTCView: any, RTCPeerConnection: any;

// if (Platform.OS !== 'web') {
//   // Mobile: Import react-native-webrtc
//   const webrtc = require('react-native-webrtc');
//   RTCIceCandidate = webrtc.RTCIceCandidate;
//   RTCSessionDescription = webrtc.RTCSessionDescription;
//   mediaDevices = webrtc.mediaDevices;
//   RTCView = webrtc.RTCView;
//   RTCPeerConnection = webrtc.RTCPeerConnection;
// } else {
//   // Web: Use global browser APIs (polyfill if needed)
//   RTCPeerConnection = (window as any).RTCPeerConnection || (window as any).webkitRTCPeerConnection;
//   RTCIceCandidate = (window as any).RTCIceCandidate;
//   RTCSessionDescription = (window as any).RTCSessionDescription;
//   mediaDevices = (navigator as any).mediaDevices;
//   RTCView = 'video';  // Placeholder - we'll use native <video> on web
// }


// interface Message {
//   from: string;
//   to: string;
//   encryptedContent?: string;
//   content?: string;
//   timestamp?: string | Date;
//   isOwn: boolean;
// }

// interface ChatMessage {
//   from: string;
//   to: string;
//   encryptedContent: string;
//   timestamp: string | Date;
// }

// interface User {
//   id?: string;
//   _id?: string;
//   username: string;
//   email: string;
//   avatar_url?: string;  // New: For profile pic
// }

// interface RouteParams {
//   otherUserId: string;
//   otherUserName: string;
// }

// export default function ChatScreen({ route }: { route: { params: RouteParams } }) {
//   const { otherUserId: paramOtherUserId, otherUserName } = route.params;
//   const [otherUserId, setOtherUserId] = useState<string>('');
//   const [messages, setMessages] = useState<Message[]>([]);
//   const [message, setMessage] = useState<string>('');
//   const [socket, setSocket] = useState<Socket | null>(null);
//   const [socketReady, setSocketReady] = useState<boolean>(false);
//   const [currentUserId, setCurrentUserId] = useState<string>('');
//   const [isLoading, setIsLoading] = useState<boolean>(true);
//   const [error, setError] = useState<string>('');
//   const [isPartnerOnline, setIsPartnerOnline] = useState<boolean>(false);  // Track partner's online status
//   const [otherUser, setOtherUser] = useState<User>({ username: otherUserName, id: paramOtherUserId });  // New: Full other user with avatar_url
//   const flatListRef = useRef<FlatList>(null);
//   const socketRetries = useRef<number>(0);
//   const maxRetries = 3;
//   const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  
//   // New: Calling state
//   const [showCallModal, setShowCallModal] = useState(false);  // Incoming/outgoing call modal
//   const [incomingCall, setIncomingCall] = useState<any>(null);  // { from, roomId, type }
//   const [localStream, setLocalStream] = useState<any>(null);
//   const [remoteStream, setRemoteStream] = useState<any>(null);
//   const [pc, setPc] = useState<any>(null);  // PeerConnection
//   const [isCallActive, setIsCallActive] = useState(false);
//   const [callType, setCallType] = useState('');  // 'audio' or 'video'
  
//   // Safe area for keyboard offset
//   const insets = useSafeAreaInsets();
//   const keyboardVerticalOffset = insets.bottom - 55;

//   // Added: Navigation hook
//   const navigation = useNavigation<any>();

//   // New: WebRTC config (shared)
//   const iceServers = [
//     { urls: 'stun:stun.l.google.com:19302' },  // Free Google STUN
//   ];

//   // Validate and set otherUserId on mount
//   useEffect(() => {
//     console.log('ChatScreen mount - params:', { paramOtherUserId, otherUserName });
//     if (!paramOtherUserId || typeof paramOtherUserId !== 'string' || paramOtherUserId.length < 10) {
//       console.error('Invalid otherUserId from params:', paramOtherUserId);
//       setError('Invalid chat partner ID from navigation');
//       Alert.alert('Error', 'Invalid chat partner - Go back and try again');
//       setIsLoading(false);
//       return;
//     }
//     setOtherUserId(paramOtherUserId);
//     setOtherUser({ id: paramOtherUserId, username: otherUserName });  // Initial otherUser
//     console.log('OtherUserId validated and set:', paramOtherUserId);
//   }, [paramOtherUserId]);

//   // New: Fetch other user's profile for avatar_url
//   useEffect(() => {
//     const fetchOtherUser = async (): Promise<void> => {
//       if (!otherUserId) return;
//       try {
//         const token = await AsyncStorage.getItem('token');
//         if (!token) {
//           console.warn('No token for fetching other user');
//           return;
//         }
//         console.log('Fetching other user profile for ID:', otherUserId);
//         const response = await axios.get<User>(`${API_BASE}/users/${otherUserId}`, {
//           headers: { Authorization: `Bearer ${token}` },
//         });
//         setOtherUser({
//           id: response.data.id || response.data._id,
//           username: response.data.username,
//           avatar_url: response.data.avatar_url || '',  // Set avatar_url
//         });
//         console.log('Fetched other user for chat:', response.data);  // Debug: Includes avatar_url
//       } catch (err) {
//         console.error('Fetch other user error:', err);
//         // Fallback to initial params - no avatar
//         setOtherUser({ id: otherUserId, username: otherUserName });
//       }
//     };
//     fetchOtherUser();
//   }, [otherUserId]);

//   // Generate shared E2E key and IV (unchanged)
//   const getSharedKeyAndIV = (user1Id: string, user2Id: string): { key: CryptoJS.lib.WordArray; iv: CryptoJS.lib.WordArray } => {
//     if (!user1Id || !user2Id || typeof user1Id !== 'string' || typeof user2Id !== 'string' || user1Id.length < 10 || user2Id.length < 10) {
//       console.error('Invalid IDs for key generation:', { user1Id, user2Id });
//       throw new Error('Invalid user IDs for encryption key');
//     }
//     try {
//       const sortedIds = [user1Id, user2Id].sort().join('_');
//       console.log('Generating key/IV from sorted IDs:', sortedIds);
      
//       const keyHash = CryptoJS.SHA256(sortedIds + '_chat_salt').toString(CryptoJS.enc.Hex);
//       const key = CryptoJS.enc.Hex.parse(keyHash);
      
//       const ivHash = CryptoJS.MD5(sortedIds + '_iv_salt').toString(CryptoJS.enc.Hex);
//       const iv = CryptoJS.enc.Hex.parse(ivHash);
      
//       if (!key.words || key.words.length === 0 || key.sigBytes !== 32) {
//         throw new Error('Invalid key generated');
//       }
//       if (!iv.words || iv.words.length === 0 || iv.sigBytes !== 16) {
//         throw new Error('Invalid IV generated');
//       }
      
//       console.log('Key/IV details:', { 
//         keySigBytes: key.sigBytes, 
//         keyWordsLength: key.words.length, 
//         ivSigBytes: iv.sigBytes,
//         ivWordsLength: iv.words.length
//       });
      
//       return { key, iv };
//     } catch (err) {
//       console.error('Key/IV generation error:', err);
//       throw new Error(`Key/IV generation failed: ${err.message}`);
//     }
//   };

//   // Encrypt message (unchanged)
//   const encryptMessage = (content: string, key: CryptoJS.lib.WordArray, iv: CryptoJS.lib.WordArray): string => {
//     if (!content || !key || !iv) {
//       throw new Error('Missing content, key, or IV for encryption');
//     }
//     try {
//       console.log('Starting encryption - content length:', content.length, 'key sigBytes:', key.sigBytes, 'iv sigBytes:', iv.sigBytes);
//       console.log('Key words preview:', key.words ? `[${key.words[0]}, ${key.words[1]}...]` : 'undefined');
//       console.log('IV words preview:', iv.words ? `[${iv.words[0]}, ${iv.words[1]}...]` : 'undefined');
      
//       const encrypted = CryptoJS.AES.encrypt(content, key, { iv: iv });
      
//       if (!encrypted || !encrypted.ciphertext) {
//         throw new Error('Encryption produced invalid output');
//       }
      
//       const result = encrypted.toString();
//       console.log('Encryption successful - result length:', result.length);
//       return result;
//     } catch (err) {
//       console.error('Encryption error details:', {
//         errMessage: err.message,
//         errStack: err.stack,
//         contentType: typeof content,
//         contentLength: content.length,
//         keyType: typeof key,
//         keySigBytes: key ? key.sigBytes : 'no key',
//         ivType: typeof iv,
//         ivSigBytes: iv ? iv.sigBytes : 'no iv'
//       });
//       throw new Error(`Encryption failed: ${err.message}`);
//     }
//   };

//   // Decrypt message (unchanged)
//   const decryptMessage = (encryptedContent: string, key: CryptoJS.lib.WordArray, iv: CryptoJS.lib.WordArray): string => {
//     if (!key || !iv) {
//       return '[Key/IV Missing - User Not Loaded]';
//     }
//     try {
//       const bytes = CryptoJS.AES.decrypt(encryptedContent, key, { iv: iv });
//       const decrypted = bytes.toString(CryptoJS.enc.Utf8);
//       return decrypted || '[Decryption Failed]';
//     } catch (err) {
//       console.error('Decryption error:', err);
//       return '[Decryption Failed - Possible Key Mismatch]';
//     }
//   };

//   // Load user (unchanged)
//   useEffect(() => {
//     const loadUser = async (): Promise<void> => {
//       try {
//         console.log('Loading user from AsyncStorage...');
//         const userStr = await AsyncStorage.getItem('user');
//         const token = await AsyncStorage.getItem('token');
//         console.log('Storage loaded:', { userExists: !!userStr, tokenExists: !!token });
//         if (!userStr) {
//           throw new Error('No user data in storage - please login again');
//         }
//         const user = JSON.parse(userStr) as User;
//         const userId = user.id || user._id;
//         if (!userId) {
//           throw new Error('No ID in stored user data');
//         }
//         setCurrentUserId(userId);
//         console.log('CurrentUserId loaded successfully:', userId);
//       } catch (err) {
//         console.error('Load user error:', err);
//         setError(`Failed to load user: ${err.message}`);
//         Alert.alert('Error', `Failed to load user data: ${err.message}. Please login again.`);
//       }
//     };
//     loadUser();
//   }, []);

//   // Set isLoading false after all loads (unchanged)
//   useEffect(() => {
//     if (currentUserId && otherUserId && socketReady) {
//       console.log('All states ready - exiting loading');
//       setIsLoading(false);
//       setError('');
//     }
//   }, [currentUserId, otherUserId, socketReady]);

//   // Fetch messages (unchanged from previous - with sort and scroll)
//   useEffect(() => {
//     if (!currentUserId || !otherUserId) {
//       console.log('Fetch messages skipped - IDs not ready:', { currentUserId, otherUserId });
//       return;
//     }
//     console.log('Fetching messages for IDs:', { current: currentUserId, other: otherUserId });
//     const fetchMessages = async (): Promise<void> => {
//       const token = await AsyncStorage.getItem('token');
//       if (!token) {
//         setError('No auth token - please login again');
//         Alert.alert('Error', 'No token found - please login again');
//         return;
//       }
//       try {
//         const response = await axios.get<ChatMessage[]>(`${API_BASE}/messages/${otherUserId}`, {
//           headers: { Authorization: `Bearer ${token}` },
//         });
//         console.log('Messages fetched:', response.data.length);
//         const { key, iv } = getSharedKeyAndIV(currentUserId, otherUserId);
//         // Sort by timestamp ascending (oldest first)
//         const sortedMessages = response.data.sort((a, b) => {
//           const dateA = new Date(a.timestamp || 0).getTime();
//           const dateB = new Date(b.timestamp || 0).getTime();
//           return dateA - dateB;
//         });
//         const decryptedMessages = sortedMessages.map((m) => ({
//           ...m,
//           content: decryptMessage(m.encryptedContent, key, iv),
//           isOwn: m.from === currentUserId,
//           timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
//         }));
//         setMessages(decryptedMessages);
//         console.log('Messages decrypted and set (sorted):', decryptedMessages.length);
//         // Scroll to end after state update
//         setTimeout(() => {
//           flatListRef.current?.scrollToEnd({ animated: false });
//         }, 100);
//       } catch (err) {
//         const error = err as AxiosError;
//         console.error('Fetch messages error:', error.response?.data || error.message);
//         setError('Failed to load messages - check backend');
//         Alert.alert('Error', error.response?.data?.error || 'Failed to load messages');
//       }
//     };
//     fetchMessages();
//   }, [currentUserId, otherUserId]);

//   // Socket setup (enhanced: Add online status listeners for partner + call signaling)
//   useEffect(() => {
//     if (!currentUserId || !otherUserId) {
//       console.log('Socket init skipped - IDs not ready');
//       return;
//     }

//     const initSocket = async () => {
//       const token = await AsyncStorage.getItem('token');
//       if (!token) {
//         setError('No auth token for socket');
//         Alert.alert('Error', 'No token for chat connection - please login again');
//         return;
//       }
//       console.log('Initializing socket with token (exists: true), to:', otherUserId);

//       const socketUrl = API_BASE.replace('/api', '');
//       console.log('Socket URL:', socketUrl);

//       const newSocket = io(socketUrl, {
//         auth: { token },
//         transports: ['websocket'],
//         timeout: 5000,
//       });

//       newSocket.emit('joinChat', otherUserId);

//       newSocket.on('connect', () => {
//         console.log('Socket connected and ready!');
//         setSocketReady(true);
//         socketRetries.current = 0;
//         setError('');
//         if (timeoutRef.current) {
//           clearTimeout(timeoutRef.current);
//           timeoutRef.current = null;
//         }
//         // Request online users list on connect
//         newSocket.emit('getOnlineUsers');
//       });

//       newSocket.on('connect_error', (err) => {
//         console.error('Socket connect error:', err.message);
//         setSocketReady(false);
//         socketRetries.current += 1;
//         setError(`Connection failed (attempt ${socketRetries.current}): ${err.message}`);
//         Alert.alert('Connection Error', `Failed to connect: ${err.message}. Retrying...`);

//         if (socketRetries.current < maxRetries) {
//           console.log(`Retrying socket in 5s (attempt ${socketRetries.current + 1})`);
//           setTimeout(() => initSocket(), 5000);
//         } else {
//           Alert.alert('Connection Failed', 'Max retries reached. Check backend/network and try again.');
//         }
//       });

//       // Listen for online status events (global, but filter for partner)
//       newSocket.on('userOnline', (data) => {
//         console.log('User online event:', data.userId);
//         if (data.userId === otherUserId) {
//           setIsPartnerOnline(true);
//         }
//       });

//       newSocket.on('userOffline', (data) => {
//         console.log('User offline event:', data.userId);
//         if (data.userId === otherUserId) {
//           setIsPartnerOnline(false);
//         }
//       });

//       newSocket.on('onlineUsersList', (data) => {
//         console.log('Online users list received:', data.onlineUsers);
//         setIsPartnerOnline(data.onlineUsers.includes(otherUserId));
//       });

//       // Fixed: Skip if message is from self (prevents duplicate on send echo)
//       newSocket.on('receiveMessage', (msg: ChatMessage) => {
//         console.log('Received message:', msg);
//         // New: Ignore if from self (already added optimistically in sendMessage)
//         if (msg.from === currentUserId) {
//           console.log('Ignoring self-message echo to prevent duplicate');
//           return;  // Skip adding - already in local state
//         }
//         const { key, iv } = getSharedKeyAndIV(currentUserId, otherUserId);
//         const decrypted = decryptMessage(msg.encryptedContent, key, iv);
//         setMessages((prev) => {
//           const newMessages = [
//             ...prev,
//             { 
//               ...msg, 
//               content: decrypted, 
//               isOwn: msg.from === currentUserId,
//               timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
//             },
//           ];
//           // Sort after add
//           return newMessages.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
//         });
//         // Scroll after add
//         setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 0);
//       });

//       // New: Call signaling listeners
//       newSocket.on('incomingCall', (data) => {
//         console.log('Incoming call:', data);
//         setIncomingCall(data);
//         setShowCallModal(true);  // Show ringing modal
//       });

//       newSocket.on('callInitiated', ({ roomId }) => {
//         console.log('Call initiated, room:', roomId);
//         setShowCallModal(true);  // Show calling UI
//       });

//       newSocket.on('callAccepted', ({ roomId }) => {
//         console.log('Call accepted, room:', roomId);
//         setIsCallActive(true);
//         setShowCallModal(false);  // Close calling, show active call
//       });

//       newSocket.on('callRejected', ({ roomId, reason }) => {
//         console.log('Call rejected:', reason);
//         Alert.alert('Call Rejected', reason || 'Call declined');
//         endCall();
//       });

//       newSocket.on('callEnded', ({ roomId, reason }) => {
//         console.log('Call ended:', reason);
//         endCall();
//       });

//       newSocket.on('offer', ({ offer }) => {
//         console.log('Received offer');
//         if (pc) {
//           pc.setRemoteDescription(new RTCSessionDescription(offer)).then(() => {
//             pc.createAnswer().then(answer => {
//               pc.setLocalDescription(answer);
//               const roomId = incomingCall?.roomId || `${currentUserId}_${otherUserId}`.split('_').sort().join('_');
//               socket.emit('answer', { roomId, answer });
//             });
//           }).catch(err => console.error('Offer error:', err));
//         }
//       });

//       newSocket.on('answer', ({ answer }) => {
//         console.log('Received answer');
//         if (pc) {
//           pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(err => console.error('Answer error:', err));
//         }
//       });

//       newSocket.on('ice-candidate', ({ candidate }) => {
//         console.log('Received ICE candidate');
//         if (pc && candidate) {
//           pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => console.error('ICE error:', err));
//         }
//       });

//       newSocket.on('disconnect', (reason) => {
//         console.log('Socket disconnected:', reason);
//         setSocketReady(false);
//         setError('Disconnected - reconnecting...');
//       });

//       setSocket(newSocket);

//       timeoutRef.current = setTimeout(() => {
//         if (!socketReady) {
//           console.error('Socket timeout - no connection after 10s');
//           setError('Connection timeout - check IP/backend');
//           Alert.alert('Timeout', 'Chat connection timed out. Verify backend is running.');
//         }
//       }, 10000);
//     };

//     initSocket();

//     return () => {
//       if (timeoutRef.current) clearTimeout(timeoutRef.current);
//       socket?.disconnect();
//       setSocketReady(false);
//       socketRetries.current = 0;
//     };
//   }, [currentUserId, otherUserId]);

//   const sendMessage = (): void => {
//     if (!message.trim() || !socket || !currentUserId || !otherUserId || !socketReady) {
//       console.warn('Send blocked - missing state:', { 
//         message: !!message.trim(), 
//         socket: !!socket, 
//         currentUserId, 
//         otherUserId, 
//         socketReady 
//       });
//       Alert.alert('Info', 'Chat not ready - check connection and try again.');
//       return;
//     }
//     try {
//       console.log('Sending message with IDs:', { current: currentUserId, other: otherUserId });
//       const { key, iv } = getSharedKeyAndIV(currentUserId, otherUserId);
//       const encryptedContent = encryptMessage(message, key, iv);
//       console.log('Encryption successful, emitting to socket');
//       socket.emit('sendMessage', { to: otherUserId, encryptedContent });
//       // Optimistic add: Add to local state immediately (will be echoed back, but skipped below)
//       const newMsg: Message = {
//         from: currentUserId,
//         to: otherUserId,
//         content: message,
//         isOwn: true,
//         timestamp: new Date(),
//       };
//       setMessages((prev) => {
//         const updated = [...prev, newMsg].sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
//         // Scroll after add
//         setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 0);
//         return updated;
//       });
//       setMessage('');  // Clear input after optimistic add
//     } catch (err) {
//       console.error('Send message full error:', err);
//       Alert.alert('Error', `Failed to send: ${err.message}`);
//       // Optional: Rollback optimistic add on error (remove last message if isOwn)
//       // setMessages(prev => prev.slice(0, -1));
//     }
//   };

//   const renderMessage = ({ item }: { item: Message }): JSX.Element => {
//     let timestampText = '';
//     try {
//       const ts = item.timestamp ? new Date(item.timestamp) : new Date();
//       if (ts && !isNaN(ts.getTime())) {
//         timestampText = ts.toLocaleTimeString();
//       }
//     } catch (err) {
//       console.warn('Invalid timestamp, skipping:', item.timestamp);
//     }

//     return (
//       <View style={[styles.messageContainer, item.isOwn ? styles.ownContainer : styles.otherContainer]}>
//         <View style={[styles.message, item.isOwn ? styles.ownMessage : styles.otherMessage]}>
//           <Text style={styles.messageText}>{item.content || 'Empty message'}</Text>
//         </View>
//         {timestampText && <Text style={styles.timestamp}>{timestampText}</Text>}
//       </View>
//     );
//   };

//   // Auto-scroll on keyboard show/hide (unchanged)
//   useEffect(() => {
//     const keyboardDidShowListener = Keyboard.addListener('keyboardDidShow', () => {
//       flatListRef.current?.scrollToEnd({ animated: true });
//     });
//     const keyboardDidHideListener = Keyboard.addListener('keyboardDidHide', () => {
//       flatListRef.current?.scrollToEnd({ animated: true });
//     });

//     return () => {
//       keyboardDidHideListener?.remove();
//       keyboardDidShowListener?.remove();
//     };
//   }, []);

//   // Auto-scroll to bottom on messages change (unchanged)
//   useEffect(() => {
//     if (messages.length > 0) {
//       setTimeout(() => {
//         flatListRef.current?.scrollToEnd({ animated: true });
//       }, 300);
//     }
//   }, [messages]);

//   // New: Handle header tap - Navigate to user profile
//   const openUserProfile = (): void => {
//     if (!otherUserId || !otherUser.username) {
//       Alert.alert('Error', 'Cannot load profile - invalid user data');
//       return;
//     }
//     console.log('Opening profile for user:', otherUser.username);
//     navigation.navigate('UserProfile', {
//       otherUserId,
//       otherUserName: otherUser.username,
//       isPartnerOnline,
//     });
//   };

//   // New: Initialize PeerConnection (Web-Compatible)
//   const createPeerConnection = (roomId: string, type: string) => {
//     let peerConnection: any;
//     if (Platform.OS === 'web') {
//       // Web: Native browser APIs
//       if (!RTCPeerConnection) {
//         Alert.alert('Error', 'WebRTC not supported in this browser. Please use Chrome or Firefox.');
//         return null;
//       }
//       peerConnection = new RTCPeerConnection({ iceServers });

//       // Get user media (web)
//       navigator.mediaDevices.getUserMedia({ 
//         audio: true, 
//         video: type === 'video' ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false 
//       }).then(stream => {
//         setLocalStream(stream);
//         stream.getTracks().forEach((track: any) => peerConnection.addTrack(track, stream));
//         // Update local video on web
//         const localVideo = document.getElementById('localVideo') as HTMLVideoElement;
//         if (localVideo) {
//           localVideo.srcObject = stream;
//           localVideo.play();
//         }
//       }).catch(err => {
//         console.error('Web media error:', err);
//         Alert.alert('Permission Error', `Camera/Mic denied: ${err.message}`);
//       });

//       // Remote stream
//       peerConnection.ontrack = (event: any) => {
//         setRemoteStream(event.streams[0]);
//         const remoteVideo = document.getElementById('remoteVideo') as HTMLVideoElement;
//         if (remoteVideo) {
//           remoteVideo.srcObject = event.streams[0];
//           remoteVideo.play();
//         }
//       };

//     } else {
//       // Mobile: Use react-native-webrtc
//       if (!RTCPeerConnection) {
//         Alert.alert('Error', 'WebRTC not available on this device.');
//         return null;
//       }
//       peerConnection = new RTCPeerConnection({ iceServers });
//       setPc(peerConnection);

//       mediaDevices.getUserMedia({ 
//         audio: true, 
//         video: type === 'video' 
//       }).then(stream => {
//         setLocalStream(stream);
//         stream.getTracks().forEach((track: any) => peerConnection.addTrack(track, stream));
//       }).catch(err => {
//         console.error('Mobile media error:', err);
//         Alert.alert('Permission Error', `Camera/Mic denied: ${err.message}`);
//       });

//       peerConnection.ontrack = (event: any) => {
//         setRemoteStream(event.streams[0]);
//       };
//     }

//     // Shared: ICE candidates
//     peerConnection.onicecandidate = (event: any) => {
//       if (event.candidate) {
//         socket?.emit('ice-candidate', { roomId, candidate: event.candidate });
//       }
//     };

//     // Shared: Connection state
//     peerConnection.onconnectionstatechange = () => {
//       console.log('Connection state:', peerConnection.connectionState);
//       if (peerConnection.connectionState === 'connected') {
//         setIsCallActive(true);
//       } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
//         endCall();
//       }
//     };

//     setPc(peerConnection);
//     return peerConnection;
//   };

//   // New: Initiate outgoing call
//   const initiateCall = (type: 'audio' | 'video') => {
//     if (!isPartnerOnline) {
//       Alert.alert('Unavailable', 'Partner is offline - cannot call');
//       return;
//     }
//     const roomId = `${currentUserId}_${otherUserId}`.split('_').sort().join('_');
//     socket?.emit('initiateCall', { to: otherUserId, type });
//     setCallType(type);
//     const peerConnection = createPeerConnection(roomId, type);
//     if (!peerConnection) return;

//     // Create offer
//     peerConnection.createOffer().then((offer: any) => {
//       peerConnection.setLocalDescription(offer);
//       socket?.emit('offer', { roomId, offer });
//     }).catch(err => {
//       console.error('Offer creation error:', err);
//       Alert.alert('Error', 'Failed to initiate call');
//     });

//     setShowCallModal(true);  // Show calling UI
//   };

//   // New: Accept incoming call
//   const acceptCall = () => {
//     if (!incomingCall) return;
//     const roomId = incomingCall.roomId;
//     socket?.emit('acceptCall', { roomId });
//     const peerConnection = createPeerConnection(roomId, incomingCall.type);
//     if (!peerConnection) return;
//     setCallType(incomingCall.type);
//     setIncomingCall(null);
//     setShowCallModal(false);  // Close ringing, show active call
//   };

//   // New: Reject/end call
//   const rejectOrEndCall = (reason = 'ended') => {
//     if (incomingCall) {
//       socket?.emit('rejectCall', { roomId: incomingCall.roomId, reason });
//     } else {
//       const roomId = `${currentUserId}_${otherUserId}`.split('_').sort().join('_');
//       socket?.emit('endCall', { roomId });
//     }
//     endCall();
//   };

//   // New: End call cleanup
//   const endCall = () => {
//     if (localStream) {
//       localStream.getTracks().forEach((track: any) => track.stop());
//     }
//     if (remoteStream) {
//       remoteStream.getTracks().forEach((track: any) => track.stop());
//     }
//     if (pc) {
//       pc.close();
//     }
//     // Web: Stop video elements
//     if (Platform.OS === 'web') {
//       const localVideo = document.getElementById('localVideo') as HTMLVideoElement;
//       const remoteVideo = document.getElementById('remoteVideo') as HTMLVideoElement;
//       if (localVideo) localVideo.srcObject = null;
//       if (remoteVideo) remoteVideo.srcObject = null;
//     }
//     setLocalStream(null);
//     setRemoteStream(null);
//     setPc(null);
//     setIsCallActive(false);
//     setShowCallModal(false);
//     setIncomingCall(null);
//     setCallType('');
//   };

//   // New: Render clickable header (wraps entire header in TouchableOpacity)
//   const renderHeader = (): JSX.Element => {
//     const shortId = otherUserId.substring(0, 8) + '...';
//     const fullAvatarUrl = otherUser.avatar_url ? `${API_BASE.replace('/api', '')}${otherUser.avatar_url}` : null;

//     return (
//       <TouchableOpacity onPress={openUserProfile} activeOpacity={0.7} style={styles.headerTouchable}>
//         {/* Partner avatar/icon on left */}
//         <View style={styles.headerIconContainer}>
//           {fullAvatarUrl ? (
//             <Image 
//               source={{ uri: fullAvatarUrl }} 
//               style={styles.headerAvatarIcon}
//               onError={(e) => console.log('Chat header avatar load error for', otherUser.username, ':', e.nativeEvent.error)}
//             />
//           ) : (
//             <Ionicons 
//               name="person-circle" 
//               size={40}  // Slightly smaller for header
//               color={isPartnerOnline ? '#007AFF' : '#ccc'}  // Green for online, gray for offline
//             />
//           )}
//           {isPartnerOnline && <View style={styles.onlineDot} />}
//         </View>
//         {/* Title text on right */}
//         <View style={styles.headerText}>
//           <Text style={styles.header}>Chat with {otherUser.username || 'User'}</Text>
//           <Text style={styles.headerId}>ID: {shortId}</Text>
//           {isPartnerOnline && <Text style={styles.headerOnline}>Online</Text>}
//           {/* New: Call buttons (only if online) */}
//           {isPartnerOnline && (
//             <View style={styles.callButtons}>
//               <TouchableOpacity onPress={() => initiateCall('audio')} style={styles.callButton}>
//                 <Ionicons name="call-outline" size={20} color="#4CAF50" />
//               </TouchableOpacity>
//               <TouchableOpacity onPress={() => initiateCall('video')} style={styles.callButton}>
//                 <Ionicons name="videocam-outline" size={20} color="#4CAF50" />
//               </TouchableOpacity>
//             </View>
//           )}
//         </View>
//       </TouchableOpacity>
//     );
//   };

//   // New: Call Modal (Ringing/Calling UI) - Unchanged
//   const renderCallModal = () => (
//     <Modal visible={showCallModal} transparent animationType="fade">
//       <View style={styles.modalOverlay}>
//         <View style={styles.callModal}>
//           {incomingCall ? (
//             // Incoming ringing
//             <>
//               <Ionicons name="call-outline" size={80} color="#007AFF" />
//               <Text style={styles.callTitle}>Incoming Call</Text>
//               <Text style={styles.callSubtitle}>from {otherUser.username || incomingCall.from}</Text>
//               <Text style={styles.callType}>{incomingCall.type === 'video' ? 'Video' : 'Audio'} Call</Text>
//               <View style={styles.callActions}>
//                 <TouchableOpacity onPress={acceptCall} style={styles.acceptButton}>
//                   <Ionicons name="checkmark-circle" size={30} color="#4CAF50" />
//                 </TouchableOpacity>
//                 <TouchableOpacity onPress={() => rejectOrEndCall()} style={styles.rejectButton}>
//                   <Ionicons name="close-circle" size={30} color="#ff6b6b" />
//                 </TouchableOpacity>
//               </View>
//             </>
//           ) : (
//             // Outgoing calling
//             <>
//               <Ionicons name="call-outline" size={80} color="#007AFF" />
//               <Text style={styles.callTitle}>Calling...</Text>
//               <Text style={styles.callSubtitle}>{otherUser.username}</Text>
//               <Text style={styles.callType}>{callType === 'video' ? 'Video' : 'Audio'} Call</Text>
//               <TouchableOpacity onPress={() => rejectOrEndCall()} style={styles.endButton}>
//                 <Ionicons name="call-end" size={30} color="#ff6b6b" />
//               </TouchableOpacity>
//             </>
//           )}
//         </View>
//       </View>
//     </Modal>
//   );

//   // New: Active Call View (Web-Compatible Full Screen)
//   const renderActiveCall = () => (
//     isCallActive && (
//       <Modal visible={true} animationType="slide" presentationStyle="fullScreen">
//         <View style={styles.callScreen}>
//           {Platform.OS === 'web' ? (
//             // Web: Use native <video> elements
//             <>
//               <video 
//                 id="remoteVideo" 
//                 autoPlay 
//                 playsInline 
//                 style={styles.remoteVideo} 
//                 muted  // Mute remote to avoid echo
//                 onLoadedMetadata={() => console.log('Remote video loaded')}
//               />
//               <video 
//                 id="localVideo" 
//                 autoPlay 
//                 playsInline 
//                 muted
//                 style={styles.localVideo}
//                 onLoadedMetadata={() => console.log('Local video loaded')}
//               />
//             </>
//           ) : (
//             // Mobile: Use RTCView
//             <>
//               {remoteStream && callType === 'video' && (
//                 <RTCView streamURL={remoteStream.toURL()} style={styles.remoteVideo} objectFit="cover" />
//               )}
//               {localStream && callType === 'video' && (
//                 <RTCView streamURL={localStream.toURL()} style={styles.localVideo} objectFit="cover" />
//               )}
//             </>
//           )}
//           {/* Partner name */}
//           <Text style={styles.activeCallTitle}>{otherUser.username}</Text>
//           <Text style={styles.activeCallType}>{callType === 'video' ? 'Video Call' : 'Audio Call'}</Text>
//           {/* Controls */}
//           <View style={styles.callControls}>
//             <TouchableOpacity 
//               onPress={() => {
//                 // Toggle mute (shared)
//                 if (localStream) {
//                   const audioTrack = localStream.getAudioTracks()[0];
//                   if (audioTrack) audioTrack.enabled = !audioTrack.enabled;
//                 }
//               }} 
//               style={styles.controlButton}
//             >
//               <Ionicons name="mic" size={30} color="#fff" />
//             </TouchableOpacity>
//             {callType === 'video' && (
//               <TouchableOpacity 
//                 onPress={() => {
//                   // Toggle camera (shared)
//                   if (localStream) {
//                     const videoTrack = localStream.getVideoTracks()[0];
//                     if (videoTrack) videoTrack.enabled = !videoTrack.enabled;
//                   }
//                 }} 
//                 style={styles.controlButton}
//               >
//                 <Ionicons name="videocam" size={30} color="#fff" />
//               </TouchableOpacity>
//             )}
//             <TouchableOpacity onPress={() => rejectOrEndCall()} style={styles.endCallButton}>
//               <Ionicons name="call-end" size={30} color="#ff6b6b" />
//             </TouchableOpacity>
//           </View>
//           {!remoteStream && <Text style={styles.connectingText}>Connecting...</Text>}
//         </View>
//       </Modal>
//     )
//   );

//   // Enhanced loading with error (unchanged)
//   if (isLoading || !currentUserId || !otherUserId || !socketReady) {
//     return (
//       <KeyboardAvoidingView style={styles.container} behavior="padding" keyboardVerticalOffset={keyboardVerticalOffset}>
//         <View style={styles.loadingContainer}>
//           <ActivityIndicator size="large" color='#007AFF' />
//           <Text style={styles.loadingText}>Connecting to chat...</Text>
//           {error && <Text style={styles.errorText}>{error}</Text>}
//           <Button title="Retry Connection" onPress={() => { setIsLoading(true); setSocketReady(false); setError(''); }} />
//         </View>
//       </KeyboardAvoidingView>
//     );
//   }

//   const shortId = otherUserId.substring(0, 8) + '...';

//   return (
//     <KeyboardAvoidingView 
//       style={styles.container} 
//       behavior="padding"
//       enabled={true}
//       keyboardVerticalOffset={keyboardVerticalOffset}
//     >
//       {/* Updated: Clickable Header */}
//       {renderHeader()}
      
//       <FlatList
//         ref={flatListRef}
//         data={messages}
//         keyExtractor={(_, index) => index.toString()}
//         renderItem={renderMessage}
//         style={styles.messagesList}
//         contentContainerStyle={styles.messagesContent}
//         keyboardShouldPersistTaps="handled"
//         bounces={true}
//         showsVerticalScrollIndicator={true}
//         initialNumToRender={20}
//         maxToRenderPerBatch={10}
//         windowSize={21}
//         removeClippedSubviews={true}
//         extraData={messages}
//         ListEmptyComponent={
//           <View style={styles.emptyContainer}>
//             <Text style={styles.emptyText}>No messages yet. Say hello!</Text>
//           </View>
//         }
//         onContentSizeChange={() => {
//           if (messages.length > 0) {
//             flatListRef.current?.scrollToEnd({ animated: false });
//           }
//         }}
//         onLayout={() => {
//           if (messages.length > 0) {
//             setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
//           }
//         }}
//         maintainVisibleContentPosition={{
//           autoscrollToTopThreshold: 10,
//           minIndexForVisible: 1,
//         }}
//       />
//       <View style={styles.inputContainer}>
//         <TextInput
//           style={styles.input}
//           value={message}
//           onChangeText={setMessage}
//           placeholder="Type a message..."
//           multiline
//           maxLength={500}
//           returnKeyType="send"
//           onSubmitEditing={sendMessage}
//           editable={socketReady}
//           blurOnSubmit={false}
//         />
//         <Button 
//           title={socketReady ? "Send" : "Connecting..."} 
//           onPress={sendMessage} 
//           disabled={!socketReady || !message.trim()} 
//           color="#007AFF"
//         />
//       </View>
//       {/* New: Call Modals */}
//       {renderCallModal()}
//       {renderActiveCall()}
//     </KeyboardAvoidingView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     marginBottom:50,
//     flex: 1,
//     backgroundColor: '#f0f0f0',
//   },
//   // New: Clickable header style (mirrors headerContainer for full tap area)
//   headerTouchable: {
//     flexDirection: 'row',  // Row for icon + text
//     alignItems: 'center', 
//     paddingTop: 30, // Vertical center
//     paddingBottom: 10,
//     paddingLeft:20,
//     backgroundColor: '#fff',
//     borderBottomWidth: 1,
//     borderBottomColor: '#ddd',
//     elevation: 2,
//     shadowColor: '#000',
//     shadowOffset: { width: 0, height: 1 },
//     shadowOpacity: 0.2,
//     shadowRadius: 1.41,
//   },
//   // Header icon container (left side)
//   headerIconContainer: {
//     marginRight: 12,  // Space between icon and text
//     position: 'relative',  // For online dot
//   },
//   // New: Header avatar image style (round, same size as icon)
//   headerAvatarIcon: {
//     width: 40,
//     height: 40,
//     borderRadius: 20,  // Round like icon
//   },
//   // Header text wrapper (right side)
//   headerText: {
//     flex: 1,  // Take remaining space
//     flexDirection: 'column',  // Stack title, ID, online, buttons
//     justifyContent: 'center',
//   },
//   header: {
//     fontSize: 18,
//     fontWeight: 'bold',
//     color: '#333',
//     marginBottom: 2,  // Space before ID/online
//   },
//   // ID text below title
//   headerId: {
//     fontSize: 12,
//     color: 'gray',
//     marginBottom: 2,
//   },
//   // Online badge below ID
//   headerOnline: {
//     fontSize: 12,
//     color: '#007AFF',
//     fontWeight: 'bold',
//     marginBottom: 5,
//   },
//   // New: Call buttons row
//   callButtons: {
//     flexDirection: 'row',
//     marginTop: 5,
//   },
//   callButton: {
//     padding: 5,
//     marginRight: 10,
//   },
//   // Online dot (same as ChatList)
//   onlineDot: {
//     position: 'absolute',
//     bottom: 0,
//     right: 0,
//     width: 10,
//     height: 10,
//     borderRadius: 5,
//     backgroundColor: '#007AFF',
//     borderWidth: 2,
//     borderColor: '#fff',
//   },
//   loadingContainer: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     backgroundColor: '#f0f0f0',
//   },
//   loadingText: {
//     marginTop: 10,
//     fontSize: 16,
//     color: '#666',
//   },
//   errorText: {
//     color: 'red',
//     fontSize: 14,
//     textAlign: 'center',
//     marginTop: 10,
//     marginBottom: 10,
//   },
//   messagesList: {
//     flex: 1,
//   },
//   messagesContent: {
//     padding: 10,
//     paddingBottom: 10,
//   },
//   messageContainer: {
//     marginVertical: 4,
//   },
//   ownContainer: {
//     alignSelf: 'flex-end',
//   },
//   otherContainer: {
//     alignSelf: 'flex-start',
//   },
//   message: {
//     paddingHorizontal: 15,
//     paddingVertical: 10,
//     borderRadius: 20,
//     maxWidth: '75%',
//     elevation: 1,
//     shadowColor: '#000',
//     shadowOffset: { width: 0, height: 1 },
//     shadowOpacity: 0.1,
//     shadowRadius: 2,
//   },
//   ownMessage: {
//     backgroundColor: '#c6edf8ff',
//   },
//   otherMessage: {
//     backgroundColor: '#E5E5EA',
//   },
//   messageText: {
//     fontSize: 16,
//     lineHeight: 20,
//     color: '#333',
//   },
//   timestamp: {
//     fontSize: 11,
//     color: '#999',
//     alignSelf: 'flex-end',
//     marginTop: 2,
//     marginRight: 5,
//   },
//   emptyContainer: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     padding: 20,
//   },
//   emptyText: {
//     fontStyle: 'italic',
//     color: '#999',
//     textAlign: 'center',
//     fontSize: 16,
//   },
//   inputContainer: {
//     flexDirection: 'row',
//     padding: 10,
//     backgroundColor: '#fff',
//     borderTopWidth: 1,
//     borderTopColor: '#ddd',
//     elevation: 2,
//     shadowColor: '#000',
//     shadowOffset: { width: 0, height: -1 },
//     shadowOpacity: 0.1,
//     shadowRadius: 2,
//   },
//   input: {
//     flex: 1,
//     borderWidth: 1,
//     borderColor: '#ddd',
//     borderRadius: 25,
//     paddingHorizontal: 15,
//     paddingVertical: 12,
//     marginRight: 10,
//     fontSize: 16,
//     backgroundColor: '#f9f9f9',
//     maxHeight: 100,
//     textAlignVertical: 'center',
//   },
//   // New: Call modal styles
//   modalOverlay: {
//     flex: 1,
//     backgroundColor: 'rgba(0,0,0,0.5)',
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   callModal: {
//     backgroundColor: '#fff',
//     borderRadius: 20,
//     padding: 30,
//     alignItems: 'center',
//     width: '80%',
//     elevation: 10,
//   },
//   callTitle: {
//     fontSize: 18,
//     fontWeight: 'bold',
//     marginTop: 10,
//     color: '#333',
//   },
//   callSubtitle: {
//     fontSize: 16,
//     color: '#666',
//     marginTop: 5,
//   },
//   callType: {
//     fontSize: 14,
//     color: '#999',
//     marginTop: 5,
//     marginBottom: 20,
//   },
//   callActions: {
//     flexDirection: 'row',
//     justifyContent: 'space-around',
//     width: '100%',
//   },
//   acceptButton: {
//     padding: 20,
//     backgroundColor: '#4CAF50',
//     borderRadius: 30,
//   },
//   rejectButton: {
//     padding: 20,
//     backgroundColor: '#ff6b6b',
//     borderRadius: 30,
//   },
//   endButton: {
//     backgroundColor: '#ff6b6b',
//     paddingHorizontal: 20,
//     paddingVertical: 10,
//     borderRadius: 20,
//     marginTop: 10,
//   },
//   // New: Active call screen styles
//   callScreen: {
//     flex: 1,
//     backgroundColor: '#000',
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   remoteVideo: {
//     flex: 1,
//     width: '100%',
//   },
//   localVideo: {
//     position: 'absolute',
//     bottom: 150,
//     right: 20,
//     width: 120,
//     height: 160,
//     borderRadius: 10,
//     borderWidth: 2,
//     borderColor: '#fff',
//   },
//   activeCallTitle: {
//     position: 'absolute',
//     top: 50,
//     fontSize: 24,
//     fontWeight: 'bold',
//     color: '#fff',
//     textAlign: 'center',
//     width: '100%',
//   },
//   activeCallType: {
//     position: 'absolute',
//     top: 80,
//     fontSize: 16,
//     color: '#fff',
//     textAlign: 'center',
//     width: '100%',
//   },
//   callControls: {
//     flexDirection: 'row',
//     justifyContent: 'space-around',
//     padding: 20,
//     position: 'absolute',
//     bottom: 0,
//     left: 0,
//     right: 0,
//     backgroundColor: 'rgba(0,0,0,0.5)',
//   },
//   controlButton: {
//     padding: 15,
//     borderRadius: 30,
//     backgroundColor: 'rgba(255,255,255,0.2)',
//   },
//   endCallButton: {
//     padding: 15,
//     borderRadius: 30,
//     backgroundColor: '#ff6b6b',
//   },
//   connectingText: {
//     position: 'absolute',
//     top: '50%',
//     color: '#fff',
//     fontSize: 18,
//     textAlign: 'center',
//   },
// });


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
  Image,  // Added for avatar
  TouchableOpacity,  // Added for clickable header
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';  // For partner icon (person-circle)
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';  // Added: For navigation to profile
import AsyncStorage from '@react-native-async-storage/async-storage';
import io, { Socket } from 'socket.io-client';
import axios, { AxiosError } from 'axios';
import CryptoJS from 'crypto-js';
import { API_BASE } from '../config';  // New: Global config (adjust path if 

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
  avatar_url?: string;  // New: For profile pic
}

interface RouteParams {
  otherUserId: string;
  otherUserName: string;
}

export default function ChatScreen({ route }: { route: { params: RouteParams } }) {
  const { otherUserId: paramOtherUserId, otherUserName } = route.params;
  const [otherUserId, setOtherUserId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState<string>('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [socketReady, setSocketReady] = useState<boolean>(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [isPartnerOnline, setIsPartnerOnline] = useState<boolean>(false);  // Track partner's online status
  const [otherUser, setOtherUser] = useState<User>({ username: otherUserName, id: paramOtherUserId });  // New: Full other user with avatar_url
  const flatListRef = useRef<FlatList>(null);
  const socketRetries = useRef<number>(0);
  const maxRetries = 3;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Safe area for keyboard offset
  const insets = useSafeAreaInsets();
  const keyboardVerticalOffset = insets.bottom - 55;

  // Added: Navigation hook
  const navigation = useNavigation<any>();

  // Validate and set otherUserId on mount
  useEffect(() => {
    console.log('ChatScreen mount - params:', { paramOtherUserId, otherUserName });
    if (!paramOtherUserId || typeof paramOtherUserId !== 'string' || paramOtherUserId.length < 10) {
      console.error('Invalid otherUserId from params:', paramOtherUserId);
      setError('Invalid chat partner ID from navigation');
      Alert.alert('Error', 'Invalid chat partner - Go back and try again');
      setIsLoading(false);
      return;
    }
    setOtherUserId(paramOtherUserId);
    setOtherUser({ id: paramOtherUserId, username: otherUserName });  // Initial otherUser
    console.log('OtherUserId validated and set:', paramOtherUserId);
  }, [paramOtherUserId]);

  // New: Fetch other user's profile for avatar_url
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
          avatar_url: response.data.avatar_url || '',  // Set avatar_url
        });
        console.log('Fetched other user for chat:', response.data);  // Debug: Includes avatar_url
      } catch (err) {
        console.error('Fetch other user error:', err);
        // Fallback to initial params - no avatar
        setOtherUser({ id: otherUserId, username: otherUserName });
      }
    };
    fetchOtherUser();
  }, [otherUserId]);

  // Generate shared E2E key and IV (unchanged)
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

  // Encrypt message (unchanged)
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

  // Decrypt message (unchanged)
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

  // Load user (unchanged)
  useEffect(() => {
    const loadUser = async (): Promise<void> => {
      try {
        console.log('Loading user from AsyncStorage...');
        const userStr = await AsyncStorage.getItem('user');
        const token = await AsyncStorage.getItem('token');
        console.log('Storage loaded:', { userExists: !!userStr, tokenExists: !!token });
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
  }, []);

  // Set isLoading false after all loads (unchanged)
  useEffect(() => {
    if (currentUserId && otherUserId && socketReady) {
      console.log('All states ready - exiting loading');
      setIsLoading(false);
      setError('');
    }
  }, [currentUserId, otherUserId, socketReady]);

  // Fetch messages (unchanged from previous - with sort and scroll)
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
        // Sort by timestamp ascending (oldest first)
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
        // Scroll to end after state update
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

  // Socket setup (enhanced: Add online status listeners for partner)
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
        // Request online users list on connect
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

      // Listen for online status events (global, but filter for partner)
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

      // Fixed: Skip if message is from self (prevents duplicate on send echo)
      newSocket.on('receiveMessage', (msg: ChatMessage) => {
        console.log('Received message:', msg);
        // New: Ignore if from self (already added optimistically in sendMessage)
        if (msg.from === currentUserId) {
          console.log('Ignoring self-message echo to prevent duplicate');
          return;  // Skip adding - already in local state
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
          // Sort after add
          return newMessages.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
        });
        // Scroll after add
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 0);
      });

      newSocket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        setSocketReady(false);
        setError('Disconnected - reconnecting...');
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
      // Optimistic add: Add to local state immediately (will be echoed back, but skipped below)
      const newMsg: Message = {
        from: currentUserId,
        to: otherUserId,
        content: message,
        isOwn: true,
        timestamp: new Date(),
      };
      setMessages((prev) => {
        const updated = [...prev, newMsg].sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
        // Scroll after add
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 0);
        return updated;
      });
      setMessage('');  // Clear input after optimistic add
    } catch (err) {
      console.error('Send message full error:', err);
      Alert.alert('Error', `Failed to send: ${err.message}`);
      // Optional: Rollback optimistic add on error (remove last message if isOwn)
      // setMessages(prev => prev.slice(0, -1));
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

  // Auto-scroll on keyboard show/hide (unchanged)
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

  // Auto-scroll to bottom on messages change (unchanged)
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 300);
    }
  }, [messages]);

  // New: Handle header tap - Navigate to user profile
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

  // New: Render clickable header (wraps entire header in TouchableOpacity)
  const renderHeader = (): JSX.Element => (
    <TouchableOpacity onPress={openUserProfile} activeOpacity={0.7} style={styles.headerTouchable}>
      {/* Partner avatar/icon on left */}
      {renderHeaderAvatar()}
      {/* Title text on right */}
      <View style={styles.headerText}>
        <Text style={styles.header}>Chat with {otherUser.username || 'User'}</Text>
        <Text style={styles.headerId}>ID: {shortId}</Text>
        {isPartnerOnline && <Text style={styles.headerOnline}>Online</Text>}
      </View>
    </TouchableOpacity>
  );

  // New: Render header avatar (pic or icon with online dot)
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
          {isPartnerOnline && <View style={styles.onlineDot} />}
        </View>
      );
    }
    return (
      <View style={styles.headerIconContainer}>
        <Ionicons 
          name="person-circle" 
          size={40}  // Slightly smaller for header
          color={isPartnerOnline ? '#007AFF' : '#ccc'}  // Green for online, gray for offline
        />
        {/* Optional: Small online dot */}
        {isPartnerOnline && (
          <View style={styles.onlineDot} />
        )}
      </View>
    );
  };

  // Enhanced loading with error (unchanged)
  if (isLoading || !currentUserId || !otherUserId || !socketReady) {
    return (
      <KeyboardAvoidingView style={styles.container} behavior="padding" keyboardVerticalOffset={keyboardVerticalOffset}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color='#007AFF' />
          <Text style={styles.loadingText}>Connecting to chat...</Text>
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
      {/* Updated: Clickable Header */}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  // New: Clickable header style (mirrors headerContainer for full tap area)
  headerTouchable: {
    flexDirection: 'row',  // Row for icon + text
    alignItems: 'center', 
    paddingTop: 30, // Vertical center
    paddingBottom: 10,
    paddingLeft:20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  // Header icon container (left side)
  headerIconContainer: {
    marginRight: 12,  // Space between icon and text
    position: 'relative',  // For online dot
  },
  // New: Header avatar image style (round, same size as icon)
  headerAvatarIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,  // Round like icon
  },
  // Header text wrapper (right side)
  headerText: {
    flex: 1,  // Take remaining space
    flexDirection: 'column',  // Stack title, ID, online
    justifyContent: 'center',
  },
  header: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 2,  // Space before ID/online
  },
  // ID text below title
  headerId: {
    fontSize: 12,
    color: 'gray',
    marginBottom: 2,
  },
  // Online badge below ID
  headerOnline: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: 'bold',
  },
  // Online dot (same as ChatList)
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
});

