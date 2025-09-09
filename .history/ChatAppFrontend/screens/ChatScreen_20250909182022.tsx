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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';  // For partner icon (person-circle)
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import io, { Socket } from 'socket.io-client';
import axios, { AxiosError } from 'axios';
import CryptoJS from 'crypto-js';

const API_BASE = 'http://192.168.29.93:5000/api';

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
  const flatListRef = useRef<FlatList>(null);
  const socketRetries = useRef<number>(0);
  const maxRetries = 3;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Safe area for keyboard offset
  const insets = useSafeAreaInsets();
  const keyboardVerticalOffset = insets.bottom + 70;

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
    console.log('OtherUserId validated and set:', paramOtherUserId);
  }, [paramOtherUserId]);

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
      {/* Enhanced Header: Icon + Title */}
      <View style={styles.headerContainer}>
        {/* Partner icon on left */}
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
        {/* Title text on right */}
        <View style={styles.headerText}>
          <Text style={styles.header}>Chat with {otherUserName || 'User'}</Text>
          <Text style={styles.headerId}>ID: {shortId}</Text>
          {isPartnerOnline && <Text style={styles.headerOnline}>Online</Text>}
        </View>
      </View>
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
    marginBottom:30,
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  // Enhanced: Header with row layout for icon + text
  headerContainer: {
    flexDirection: 'row',  // Row for icon + text
    alignItems: 'center', 
    pa // Vertical center
    paddingBottom: 10,
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
    backgroundColor: '#DCF8C6',
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