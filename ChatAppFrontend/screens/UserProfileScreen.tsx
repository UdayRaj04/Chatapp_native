import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, { AxiosError } from 'axios';

const API_BASE = 'http://192.168.29.93:5000/api';

interface User {
  id?: string;
  _id?: string;
  username: string;
  email?: string;  // Optional: May not show for privacy
  bio?: string;
  insta_username?: string;
  avatar_url?: string;
}

interface RouteParams {
  otherUserId: string;
  otherUserName: string;
  isPartnerOnline?: boolean;  // Optional: From Chat
}

export default function UserProfileScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { otherUserId, otherUserName, isPartnerOnline = false } = route.params as RouteParams;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    fetchUserProfile();
  }, [otherUserId]);

  const fetchUserProfile = async (): Promise<void> => {
    const token = await AsyncStorage.getItem('token');
    if (!token) {
      setError('No auth token - please login again');
      setLoading(false);
      return;
    }

    // Fallback to passed params if no fetch
    setUser({
      id: otherUserId,
      username: otherUserName,
      // Other fields will be fetched or empty
    });

    try {
      const response = await axios.get<User>(`${API_BASE}/users/${otherUserId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser(response.data);
      console.log('Fetched other user profile:', response.data.username);
    } catch (err) {
      const error = err as AxiosError;
      console.error('Fetch user profile error:', error.response?.data || error.message);
      // Fallback: Use passed data (e.g., offline or private profile)
      setError('Could not load full profile (may be private or offline)');
      setUser({
        id: otherUserId,
        username: otherUserName,
        bio: '',  // Empty fallback
        insta_username: '',
        avatar_url: '',
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>User not found</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>Back to Chat</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const fullAvatarUrl = user.avatar_url ? `${API_BASE.replace('/api', '')}${user.avatar_url}` : null;

  const openInstagram = (): void => {
    if (user.insta_username) {
      const instaUrl = `https://instagram.com/${user.insta_username}`;
      // Use Linking (import if needed)
      // Linking.openURL(instaUrl).catch(() => Alert.alert('Error', 'Cannot open Instagram'));
    }
  };

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]} contentContainerStyle={styles.scrollContent}>
      {/* Header with Back Button */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButtonHeader}>
          <Ionicons name="arrow-back" size={24} color="#007AFF" />
          <Text style={styles.backTextHeader}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      {/* Avatar */}
      <View style={styles.avatarContainer}>
        {fullAvatarUrl ? (
          <Image 
            source={{ uri: fullAvatarUrl }} 
            style={styles.avatar}
            onError={(e) => console.log('Profile avatar load error:', e.nativeEvent.error)}
          />
        ) : (
          <Ionicons name="person-circle" size={100} color="#ccc" />
        )}
        {isPartnerOnline && <View style={styles.onlineDot} />}
      </View>

      {/* Username */}
      <Text style={styles.username}>{user.username}</Text>

      {/* Online Status */}
      {isPartnerOnline && <Text style={styles.onlineBadge}>Online</Text>}

      {/* Bio */}
      {user.bio && (
        <View style={styles.bioContainer}>
          <Text style={styles.bioLabel}>Bio</Text>
          <Text style={styles.bioText}>{user.bio}</Text>
        </View>
      )}

      {/* Instagram */}
      {user.insta_username && (
        <TouchableOpacity style={styles.instaContainer} onPress={openInstagram}>
          <Ionicons name="logo-instagram" size={20} color="#E4405F" />
          <Text style={styles.instaText}>@{user.insta_username}</Text>
        </TouchableOpacity>
      )}

      {/* ID (Optional - for debug) */}
      <View style={styles.idContainer}>
        <Text style={styles.idLabel}>User ID</Text>
        <Text style={styles.idText}>{otherUserId.substring(0, 8) + '...'}</Text>
      </View>

      {/* Error if any */}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Back Button (Footer) */}
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <Text style={styles.backText}>Back to Chat</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    alignItems: 'center',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    elevation: 2,
    marginBottom: 20,
  },
  backButtonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 5,
  },
  backTextHeader: {
    marginLeft: 5,
    fontSize: 16,
    color: '#007AFF',
    fontWeight: 'bold',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 20,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    borderWidth: 3,
    borderColor: '#fff',
  },
  username: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  onlineBadge: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: 'bold',
    marginBottom: 20,
  },
  bioContainer: {
    backgroundColor: '#fff',
    width: '100%',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    elevation: 2,
  },
  bioLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  bioText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  instaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    width: '100%',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    elevation: 2,
  },
  instaText: {
    marginLeft: 10,
    fontSize: 16,
    color: '#E4405F',
    fontWeight: 'bold',
  },
  idContainer: {
    backgroundColor: '#fff',
    width: '100%',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    elevation: 2,
  },
  idLabel: {
    fontSize: 14,
    color: '#999',
    marginBottom: 5,
  },
  idText: {
    fontSize: 12,
    color: '#666',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 14,
    textAlign: 'center',
    margin: 10,
  },
  backButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 10,
    marginTop: 20,
  },
  backText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});