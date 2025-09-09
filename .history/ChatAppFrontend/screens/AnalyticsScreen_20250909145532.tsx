import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSocket } from '../contexts/SocketContext';  // Import context
import Icon from 'react-native-vector-icons/MaterialIcons';  // For icons

interface UserItem {
  id: string;
  name: string;  // From API or DB
  // Add analytics data: e.g., messagesSent, onlineStatus
  online: boolean;
}

export default function AnalyticsScreen() {
  const { socket, currentUserId, onlineUsers } = useSocket();
  const [users, setUsers] = useState<UserItem[]>([]);  // Fetch from API

  useEffect(() => {
    // Fetch users analytics from API (example)
    fetchUsers();
  }, []);

  useEffect(() => {
    // Update online status from socket
    setUsers(prev => prev.map(user => ({
      ...user,
      online: onlineUsers.includes(user.id)
    })));
  }, [onlineUsers]);

  const fetchUsers = async () => {
    try {
      // Replace with your API: e.g., /api/users/analytics
      const response = await fetch(`${API_BASE}/api/users`, {
        headers: { Authorization: `Bearer ${await AsyncStorage.getItem('jwtToken')}` }
      });
      const data = await response.json();
      setUsers(data.users.map((u: any) => ({ id: u._id, name: u.name, online: false })));  // Adapt to your schema
    } catch (err) {
      Alert.alert('Error', 'Failed to load users.');
    }
  };

  const initiateCall = (targetUserId: string, targetUserName: string, isVideo: boolean) => {
    if (!currentUserId || !socket) {
      Alert.alert('Error', 'Not logged in or socket not connected.');
      return;
    }
    if (currentUserId === targetUserId) {
      Alert.alert('Error', 'Cannot call yourself.');
      return;
    }
    if (!onlineUsers.includes(targetUserId)) {
      Alert.alert('Error', `${targetUserName} is offline.`);
      return;
    }

    const roomId = `${currentUserId}_${targetUserId}_${Date.now()}`;
    socket.emit('initiateCall', { to: targetUserId, roomId, isVideo });
    
    // Navigate as caller
    navigation.navigate('Call', { 
      roomId, 
      isVideo, 
      isCaller: true, 
      otherUserName: targetUserName, 
      otherUserId: targetUserId 
    });
  };

  const renderUserItem = ({ item }: { item: UserItem }) => (
    <View style={styles.userItem}>
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.name}</Text>
        <Text style={styles.userStatus}>{item.online ? 'Online' : 'Offline'}</Text>
        {/* Add analytics: e.g., <Text>Messages: {item.messagesSent}</Text> */}
      </View>
      <View style={styles.callButtons}>
        <TouchableOpacity 
          onPress={() => initiateCall(item.id, item.name, false)} 
          style={styles.voiceButton}
          disabled={!item.online}
        >
          <Icon name="phone" size={24} color={item.online ? "green" : "gray"} />
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => initiateCall(item.id, item.name, true)} 
          style={styles.videoButton}
          disabled={!item.online}
        >
          <Icon name="videocam" size={24} color={item.online ? "blue" : "gray"} />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>User Analytics</Text>
      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        renderItem={renderUserItem}
        style={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 10 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  list: { flex: 1 },
  userItem: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    padding: 15, 
    borderBottomWidth: 1, 
    borderBottomColor: '#eee' 
  },
  userInfo: { flex: 1 },
  userName: { fontSize: 18, fontWeight: 'bold' },
  userStatus: { fontSize: 14, color: 'green' },  // Green for online, red for offline
  callButtons: { flexDirection: 'row', gap: 10 },
  voiceButton: { 
    backgroundColor: '#4CAF50', 
    padding: 10, 
    borderRadius: 25, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  videoButton: { 
    backgroundColor: '#2196F3', 
    padding: 10, 
    borderRadius: 25, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
});