import React, { useState, useEffect, JSX } from 'react';
import {
  View,
  FlatList,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Linking,
  Image,  // Added for avatar
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';  // For search icon and user icons
import { useSafeAreaInsets } from 'react-native-safe-area-context';  // For dynamic padding
import { useNavigation } from '@react-navigation/native';  // For navigation to chat
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, { AxiosError } from 'axios';
import io, { Socket } from 'socket.io-client';
import { API_BASE, SOCKET_BASE } from '../config';  // New: Global config (adjust path if 
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

export default function SearchScreen() {
  const [allUsers, setAllUsers] = useState<User[]>([]);  // All fetched users
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);  // Filtered by search
  const [searchTerm, setSearchTerm] = useState<string>('');  // Search input
  const [loading, setLoading] = useState<boolean>(true);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const navigation = useNavigation<any>();  // For chat navigation
  
  // Safe area for dynamic bottom padding (like ChatList)
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(120, insets.bottom + 70);

  useEffect(() => {
    fetchUsers();
    initSocket();

    // Cleanup socket on unmount
    return () => {
      socket?.disconnect();
    };
  }, []);

  // Filter users based on search term (real-time)
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredUsers([]);  // Hide list if no search
    } else {
      const lowerSearch = searchTerm.toLowerCase();
      const filtered = allUsers.filter(user => 
        user.username.toLowerCase().includes(lowerSearch)
      );
      setFilteredUsers(filtered);
    }
  }, [searchTerm, allUsers, onlineUsers]);  // Re-filter on online changes

  const fetchUsers = async (): Promise<void> => {
    const token = await AsyncStorage.getItem('token');
    if (!token) {
      Alert.alert('Error', 'No token - please login again');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const response = await axios.get<User[]>(`${API_BASE}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const validUsers = response.data.filter(u => 
        u && u.username && (u._id || u.id) && typeof u.username === 'string'
      );
      setAllUsers(validUsers);
      console.log('Users fetched for search:', validUsers.length);
    } catch (err) {
      const error = err as AxiosError;
      Alert.alert('Error', error.response?.data?.error || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

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
        console.log('Initial online users for search:', data.onlineUsers);
        setOnlineUsers(new Set(data.onlineUsers));
      });

      newSocket.on('connect', () => {
        console.log('Socket connected for search');
        newSocket.emit('getOnlineUsers');
      });
    }
  };

  const startChat = (otherUser: User): void => {
    const userId = otherUser.id || otherUser._id;
    console.log('Starting chat from search with userId:', userId);
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
              onError={(e) => console.log('Search avatar load error for', item.username, ':', e.nativeEvent.error)}
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
            color={isOnline ? '#4CAF50' : '#ccc'}
          />
          {isOnline && <View style={styles.onlineDot} />}
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
      {searchTerm.trim() ? (
        <ActivityIndicator size="small" color="#999" />
      ) : null}
      <Text style={styles.emptyText}>
        {searchTerm.trim() 
          ? 'No users found matching "' + searchTerm + '". Try another name!' 
          : 'Type a name to search users'
        }
      </Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text style={styles.loadingText}>Loading users...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Centered Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={24} color="#999" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          value={searchTerm}
          onChangeText={setSearchTerm}
          placeholder="Search users by name..."
          autoCapitalize="none"
          returnKeyType="search"
          // Debounce for perf (optional - React handles well)
        />
        {searchTerm.trim() && (
          <TouchableOpacity onPress={() => setSearchTerm('')} style={styles.clearButton}>
            <Ionicons name="close-circle" size={20} color="#999" />
          </TouchableOpacity>
        )}
      </View>

      {/* Results List */}
      <FlatList
        data={filteredUsers}
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
        extraData={filteredUsers}
        getItemLayout={(data, index) => ({ length: 70, offset: 70 * index, index })}
      />

      {/* New: Footer Link at Bottom */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
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
    paddingTop: 30,
    backgroundColor: '#f5f5f5',
    // No extra padding here - lets child center naturally
  },
  // Updated: Centered Search Bar Styles
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    alignSelf: 'center',  // New: Horizontal centering
    width: '90%',  // New: Fixed width for balanced centering (adjust to '80%' if narrower)
    marginTop: 20,  // New: Top spacing (from safe area/top of screen)
    marginBottom: 10,  // New: Gap to list below
    borderRadius: 25,
    paddingHorizontal: 15,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: '#333',
  },
  clearButton: {
    padding: 5,
  },
  // List Styles (same as ChatList, with adjusted padding for centering feel)
  listContent: {
    paddingHorizontal: 10,  // Keeps list items inset (matches search bar width)
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
    minHeight: 70,
  },
  userContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    marginRight: 15,
    position: 'relative',
  },
  // New: Avatar image style (round, same size as icon)
  avatarIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,  // Round like icon
  },
  textContent: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'flex-start',
  },
  username: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  // New: Optional bio text style
  bioText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  onlineBadge: {
    fontSize: 12,
    color: '#4CAF50',
    fontWeight: 'bold',
    marginBottom: 2,
  },
  idText: {
    fontSize: 12,
    color: 'gray',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4CAF50',
    borderWidth: 2,
    borderColor: '#fff',
  },

  // New: Footer Styles (Bottom Link)
  footer: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 10,  // Extra space above (will add insets.bottom dynamically)
    backgroundColor: '#f5f5f5',  // Matches container
    marginBottom:60,
  },
  footerText: {
    fontSize: 12,
    color: '#1f6affff',
    fontStyle: 'italic',
    textAlign: 'center',
    textDecorationLine: 'underline',  // Underline for link feel
  }, 
  // Empty/Loading States
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
  emptyContainer: {
    flex: 1,
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
});