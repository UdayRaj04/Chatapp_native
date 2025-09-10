import React, { useState, useEffect } from 'react';
import {
  View,
  FlatList,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';  // New: For user icons (person-circle)
import { useSafeAreaInsets } from 'react-native-safe-area-context';  // From previous (for padding)
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, { AxiosError } from 'axios';
import io, { Socket } from 'socket.io-client';

const API_BASE = 'http://192.168.29.93:5000/api';

const WEBSITE_URL = 'https://udayaj.web.app';  // New: Customize this URL (e.g., your portfolio)

interface User {
  _id: string;
  id?: string;
  username: string;
  email: string;
  bio?: string;  // Optional: Bio if available
  insta_username?: string;  // Optional: Insta if available
  avatar_url?: string;  // New: For profile pic
}

export default function ChatListScreen({ navigation }: { navigation: any }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  
  // Safe area for dynamic padding (from previous)
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(120, insets.bottom + 70);

  useEffect(() => {
    loadUser();
    fetchUsers();

    const initSocket = async () => {
      const token = await AsyncStorage.getItem('token');
      if (token) {
        const newSocket = io(API_BASE.replace('/api', ''), {
          auth: { token },
        });
        setSocket(newSocket);
        newSocket.on('connect_error', () => Alert.alert('Socket Error', 'Connection failed'));

        newSocket.on('userOnline', (data) => {
          console.log('User online:', data.userId);
          setOnlineUsers((prev) => new Set([...prev, data.userId]));
        });

        newSocket.on('userOffline', (data) => {
          console.log('User offline:', data.userId);
          setOnlineUsers((prev) => {
            const newSet = new Set(prev);
            newSet.delete(data.userId);
            return newSet;
          });
        });

        newSocket.on('onlineUsersList', (data) => {
          console.log('Initial online users:', data.onlineUsers);
          setOnlineUsers(new Set(data.onlineUsers));
        });

        newSocket.on('connect', () => {
          console.log('Socket connected - requesting online users');
          newSocket.emit('getOnlineUsers');
        });
      }
    };
    initSocket();

    return () => {
      socket?.disconnect();
    };
  }, []);

  const loadUser = async (): Promise<void> => {
    const userStr = await AsyncStorage.getItem('user');
    if (userStr) {
      setCurrentUser(JSON.parse(userStr));
    }
    setLoading(false);
  };

  const fetchUsers = async (): Promise<void> => {
    const token = await AsyncStorage.getItem('token');
    if (!token) return;
    try {
      const response = await axios.get<User[]>(`${API_BASE}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const validUsers = response.data.filter(u => 
        u && u.username && (u._id || u.id) && typeof u.username === 'string'
      );
      setUsers(validUsers);
    } catch (err) {
      const error = err as AxiosError;
      Alert.alert('Error', error.response?.data?.error || 'Failed to load users');
    }
  };

  const startChat = (otherUser: User): void => {
    const userId = otherUser.id || otherUser._id;
    console.log('Starting chat with userId:', userId);
    if (!userId) {
      Alert.alert('Error', 'Invalid user data');
      return;
    }
    navigation.navigate('Chat', {
      otherUserId: userId,
      otherUserName: otherUser.username,
    });
  };


  // New: Handle footer link click (open website)
      const openWebsite = async (): Promise<void> => {
        try {
          const supported = await Linking.canOpenURL(WEBSITE_URL);
          if (supported) {
            await Linking.openURL(WEBSITE_URL);
            console.log('Opened website:', WEBSITE_URL);
          } else {
            Alert.alert('Error', `Cannot open ${WEBSITE_URL}`);
          }
        } catch (err) {
          console.error('Website open error:', err);
          Alert.alert('Error', 'Unable to open website. Check your connection.');
        }
      };

  const renderUser = ({ item }: { item: User }): JSX.Element => {
    if (!item || !item.username || !(item._id || item.id)) {
      return (
        <View style={styles.userItem}>
          <View style={styles.userContent}>
            <Text style={styles.username}>Invalid user entry</Text>
          </View>
        </View>
      );
    }
    const userId = item.id || item._id;
    const isOnline = onlineUsers.has(userId);
    const userIdShort = userId.substring(0, 8) + '...';
    const fullAvatarUrl = item.avatar_url ? `${API_BASE.replace('/api', '')}${item.avatar_url}` : null;  // New: Full URL for avatar

    // New: Render avatar or default icon
    const renderAvatar = (): JSX.Element => {
      if (fullAvatarUrl) {
        return (
          <View style={styles.iconContainer}>
            <Image 
              source={{ uri: fullAvatarUrl }} 
              style={styles.avatarIcon}
              onError={(e) => console.log('ChatList avatar load error for', item.username, ':', e.nativeEvent.error)}
            />
            {isOnline && <View style={styles.onlineDot} />}
          </View>
        );
      }
      return (
        <View style={styles.iconContainer}>
          <Ionicons 
            name="person-circle" 
            size={50} 
            color={isOnline ? '#007AFF' : '#ccc'}  // Green for online, gray for offline
          />
          {/* Optional: Small online dot (green circle below icon) */}
          {isOnline && (
            <View style={styles.onlineDot} />
          )}
        </View>
      );
    };

    return (
      <TouchableOpacity onPress={() => startChat(item)} style={styles.userItem} activeOpacity={0.7}>
        <View style={styles.userContent}>
          {/* Updated: Use renderAvatar for pic or icon */}
          {renderAvatar()}
          {/* Text content on right */}
          <View style={styles.textContent}>
            <Text style={styles.username}>{item.username}</Text>
            {item.bio && <Text style={styles.bioText}>{item.bio}</Text>}  {/* Optional: Show bio if available */}
            {isOnline && <Text style={styles.onlineBadge}>Online</Text>}
            <Text style={styles.idText}>{"(ID: " + userIdShort + ")"}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = (): JSX.Element => (
    <View style={[styles.emptyContainer, { paddingBottom: bottomPadding }]}>
      <ActivityIndicator size="small" color="#999" />
      <Text style={styles.emptyText}>No users available. Invite friends!</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text style={styles.loadingText}>Loading chats...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={{ 
       paddingLeft: 20,paddingRight:20, paddingBottom:10, paddingTop:35,  
  flexDirection: 'row',       // 👈 Arrange items in a row
  alignItems: 'center',       // 👈 Vertically center icon & text
  backgroundColor: '#007AFF',
  justifyContent:"space-between",
}}>
  <Image 
    source={require('../assets/logos.png')}
    style={{ height: 60, width: 60, marginRight: 10 }}  // 👈 space between logo & text
  />
  <View style={{ flexDirection: 'column', alignItems: 'center' }}>
  <Text style={styles.title}>
    Seamless Chat
  </Text>
  <Text style={styles.title1}>
    ({onlineUsers.size -1} Online Users)
  </Text>
  </View>
</View>
      <FlatList
        data={users}
        keyExtractor={(item, index) => (item._id || item.id || index.toString())}
        renderItem={renderUser}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomPadding }]}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        bounces={true}
        showsVerticalScrollIndicator={true}
        initialNumToRender={10}
        maxToRenderPerBatch={5}
        windowSize={10}
        removeClippedSubviews={true}
        extraData={users}
        getItemLayout={(data, index) => ({ length: 70, offset: 70 * index, index })}
      />
      {/* New: Footer Link at Bottom */}
                  <View style={styles.footer}>
                    <TouchableOpacity onPress={openWebsite} activeOpacity={0.7}>
                      <Text style={styles.footerText}>(Designed by UdayRaj)</Text>
                    </TouchableOpacity>
                  </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    padding: 0,
    color: '#ffffffff',
    textAlign: 'center',
    
    
    
  },
  title1: {
    marginLeft:80,
    fontSize: 12,
    fontWeight: 'bold',
    padding: 0,
    color: '#ffffffce',
    textAlign: 'center',
    
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  listContent: {
    paddingHorizontal: 10,
  },
  userItem: {
    backgroundColor: '#fff',
    marginVertical: 5,
    marginHorizontal: 10,
    borderRadius: 10,
    padding: 15,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
    // New: Taller for icon row
    minHeight: 70,
  },
  userContent: {
    flex: 1,
    flexDirection: 'row',  // New: Row for icon + text
    alignItems: 'center',  // New: Vertical center
  },
  // New: Icon container (left side)
  iconContainer: {
    marginRight: 15,  // Space between icon and text
    position: 'relative',  // For online dot positioning
  },
  // New: Avatar image style (round, same size as icon)
  avatarIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,  // Round like icon
  },
  // New: Text content wrapper (right side)
  textContent: {
    flex: 1,  // Take remaining space
    flexDirection: 'column',  // Stack username, badge, ID
    justifyContent: 'flex-start',
  },
  username: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 2,  // Small space before badge/ID
  },
  // New: Optional bio text style
  bioText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  onlineBadge: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: 'bold',
    marginBottom: 2,
  },
  idText: {
    fontSize: 12,
    color: 'gray',
  },
  // New: Online status dot (small green circle under icon)
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#007AFF',
    borderWidth: 2,
    borderColor: '#fff',  // White border for visibility
  },
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 16,
    color: 'gray',
    textAlign: 'center',
    marginTop: 10,
  },

  
  // New: Footer Styles (Bottom Link)
  footer: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 10,  // Extra space above (will add insets.bottom dynamically)
    backgroundColor: '#f5f5f5',  // Matches container
    marginBottom:100,
  },
  footerText: {
    fontSize: 12,
    color: '#1f6affff',
    fontStyle: 'italic',
    textAlign: 'center',
    textDecorationLine: 'underline',  // Underline for link feel
  }, 
});