import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
  ScrollView,
  Linking,  // For Insta link
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, { AxiosError } from 'axios';
import { useAuth } from '../contexts/AuthContext';  // Adjust path (e.g., 
import { API_BASE, SOCKET_BASE } from '../config';  // New: Global config (adjust path if 

interface User {
  id?: string;
  _id?: string;
  username: string;
  email: string;
  bio?: string;
  insta_username?: string;
  avatar_url?: string;
}

export default function ProfileScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [updating, setUpdating] = useState<boolean>(false);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [username, setUsername] = useState<string>('');
  const [bio, setBio] = useState<string>('');
  const [instaUsername, setInstaUsername] = useState<string>('');
  const [usernameError, setUsernameError] = useState<string>('');
  const [instaError, setInstaError] = useState<string>('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);  // Local or full URL for pic
  const [uploading, setUploading] = useState<boolean>(false);
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  // Load current user on mount - Fixed: Prefer backend fetch for fresh data
  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async (): Promise<void> => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      let loadedUser: User;

      // New: First try fresh fetch from backend (/me) if token exists
      if (token) {
        try {
          console.log('Fetching fresh user profile from backend...');
          const response = await axios.get<User>(`${API_BASE}/users/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          loadedUser = response.data;
          console.log('Loaded user from backend:', loadedUser);  // Debug: Check bio/avatar_url
          // Update storage with fresh data
          await AsyncStorage.setItem('user', JSON.stringify(loadedUser));
        } catch (backendErr) {
          console.warn('Backend fetch failed (e.g., offline), falling back to storage:', backendErr.message);
          // Fallback to AsyncStorage
          const userStr = await AsyncStorage.getItem('user');
          if (!userStr) throw new Error('No user data in storage');
          loadedUser = JSON.parse(userStr) as User;
          console.log('Loaded user from storage (fallback):', loadedUser);  // Debug
        }
      } else {
        throw new Error('No token - please login again');
      }

      // Set states
      setUser(loadedUser);
      setUsername(loadedUser.username || '');
      setBio(loadedUser.bio || '');
      setInstaUsername(loadedUser.insta_username || '');

      // New: Set avatar URI from stored/backend URL (full path for Image)
      if (loadedUser.avatar_url) {
        const fullPicUrl = `${API_BASE.replace('/api', '')}${loadedUser.avatar_url}`;  // e.g., http://192.168.29.93:5000/uploads/file.jpg
        setAvatarUri(fullPicUrl);
        console.log('Set avatar URI:', fullPicUrl);  // Debug
      } else {
        setAvatarUri(null);
      }
    } catch (err) {
      console.error('Load user error:', err);
      Alert.alert('Error', `Failed to load profile: ${err.message}. Please login again.`);
    } finally {
      setLoading(false);
    }
  };

  // Pick image (unchanged)
  const pickImage = async (): Promise<void> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission', 'Gallery access needed for avatar upload');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets[0]) {
      const uri = result.assets[0].uri;
      setAvatarUri(uri);  // Preview local
      console.log('Image picked:', uri);
      await uploadAvatar(uri);
    }
  };

  // Upload avatar (unchanged, but log response)
  const uploadAvatar = async (uri: string): Promise<void> => {
    setUploading(true);
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No token');

      const formData = new FormData();
      formData.append('avatar', {
        uri,
        type: 'image/jpeg',
        name: 'avatar.jpg',
      } as any);

      const response = await axios.post(`${API_BASE}/users/upload-avatar`, formData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });

      // Update with response
      const updatedUser = response.data.user;
      await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
      setUser(updatedUser);
      const fullPicUrl = updatedUser.avatar_url ? `${API_BASE.replace('/api', '')}${updatedUser.avatar_url}` : null;
      setAvatarUri(fullPicUrl);
      console.log('Avatar uploaded, new user:', updatedUser);  // Debug
      Alert.alert('Success', 'Avatar uploaded!');
    } catch (err) {
      const error = err as AxiosError;
      console.error('Upload error:', error.response?.data || error.message);
      Alert.alert('Upload Failed', error.response?.data?.error || 'Failed to upload avatar');
      setAvatarUri(null);
    } finally {
      setUploading(false);
    }
  };

  // Validate fields (unchanged)
  const validateUsername = (name: string): boolean => {
    if (!name || name.length < 3) {
      setUsernameError('Username must be at least 3 characters');
      return false;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      setUsernameError('Username can only contain letters, numbers, and underscores');
      return false;
    }
    setUsernameError('');
    return true;
  };

  const validateInstaUsername = (name: string): boolean => {
    if (!name) return true;
    if (!/^[a-zA-Z0-9_.]+$/.test(name)) {
      setInstaError('Invalid Instagram username format');
      return false;
    }
    setInstaError('');
    return true;
  };

  // Update profile (unchanged, but refetch after)
  const updateProfile = async (): Promise<void> => {
    if (!validateUsername(username) || !validateInstaUsername(instaUsername)) return;

    setUpdating(true);
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) throw new Error('No token');

      // Upload avatar if picked
      if (avatarUri && !user?.avatar_url && typeof avatarUri === 'string' && !avatarUri.startsWith('http')) {
        await uploadAvatar(avatarUri);
      }

      const response = await axios.put<User>(`${API_BASE}/users`, {
        username,
        bio,
        insta_username: instaUsername,
        avatar_url: user?.avatar_url || '',
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });

      await AsyncStorage.setItem('user', JSON.stringify(response.data));
      setUser(response.data);
      const fullPicUrl = response.data.avatar_url ? `${API_BASE.replace('/api', '')}${response.data.avatar_url}` : null;
      setAvatarUri(fullPicUrl);
      console.log('Profile updated, new user:', response.data);  // Debug

      Alert.alert('Success', 'Profile updated!');
      setEditMode(false);
      // Optional: Reload fresh to verify
      await loadUser();
    } catch (err) {
      const error = err as AxiosError;
      console.error('Update error:', error.response?.data || error.message);
      Alert.alert('Update Failed', error.response?.data?.error || 'Failed to update profile');
    } finally {
      setUpdating(false);
    }
  };


  // New: Access auth context for logout
  const { logout } = useAuth();

  // ... existing render methods (edit form, etc.)

  // Logout Button (Updated - Uses context)
  const handleLogout = async (): Promise<void> => {
    try {
      await logout();  // Clears storage + sets isAuthenticated = false (re-renders to Login)
      console.log('Logout successful - should redirect to Login');
    } catch (err) {
      console.error('Logout error:', err);
      Alert.alert('Logout Failed', 'Please try again.');
    }
  };

  // Toggle edit mode (unchanged)
  const toggleEdit = (): void => {
    setEditMode(!editMode);
    if (!editMode) {
      setUsernameError('');
      setInstaError('');
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>No profile data. Please login again.</Text>
      </View>
    );
  }

  const renderProfilePic = (): JSX.Element => {
    if (uploading) {
      return (
        <View style={styles.picLoading}>
          <ActivityIndicator size="small" color="#999" />
          <Text style={styles.loadingSmall}>Uploading...</Text>
        </View>
      );
    }
    if (avatarUri) {
      return (
        <Image 
          source={{ uri: avatarUri }} 
          style={styles.profilePic}
          onError={(e) => console.log('Image load error:', e.nativeEvent.error)}  // New: Debug blank pics
        />
      );
    }
    return (
      <Ionicons name="person-circle" size={100} color="#ccc" />
    );
  };

  return (
    <ScrollView style={[styles.container, { paddingTop: insets.top }]} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.picContainer}>
          {renderProfilePic()}
        </View>
        <Text style={styles.usernameHeader}>{user.username}</Text>
        {user.bio ? <Text style={styles.bioHeader}>{user.bio}</Text> : null}
      </View>

      {/* Info Section */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Ionicons name="mail" size={20} color="#999" />
          <Text style={styles.infoLabel}>Email:</Text>
          <Text style={styles.infoValue}>{user.email}</Text>
        </View>
        {instaUsername ? (
          <View style={styles.infoRow}>
            <Ionicons name="logo-instagram" size={20} color="#E4405F" />
            <Text style={styles.infoLabel}>Instagram:</Text>
            <TouchableOpacity onPress={() => Linking.openURL(`https://instagram.com/${instaUsername}`)}>
              <Text style={[styles.infoValue, styles.linkText]}>@{instaUsername}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {/* Edit Form */}
      {editMode ? (
        <View style={styles.editCard}>
          <Text style={styles.sectionTitle}>Edit Profile</Text>

          {/* Username */}
          <View style={styles.inputContainer}>
            <Ionicons name="person" size={20} color="#999" />
            <TextInput
              style={[styles.input, usernameError ? styles.inputError : null]}
              value={username}
              onChangeText={(text) => {
                setUsername(text);
                if (usernameError) validateUsername(text);
              }}
              placeholder="Username"
              autoCapitalize="none"
              onBlur={() => validateUsername(username)}
            />
          </View>
          {usernameError ? <Text style={styles.errorText}>{usernameError}</Text> : null}

          {/* Bio */}
          <View style={styles.inputContainer}>
            <Ionicons name="chatbubble" size={20} color="#999" />
            <TextInput
              style={styles.input}
              value={bio}
              onChangeText={setBio}
              placeholder="Bio (optional)"
              multiline
              maxLength={100}
            />
          </View>

          {/* Instagram Username */}
          <View style={styles.inputContainer}>
            <Ionicons name="logo-instagram" size={20} color="#E4405F" />
            <TextInput
              style={[styles.input, instaError ? styles.inputError : null]}
              value={instaUsername}
              onChangeText={(text) => {
                setInstaUsername(text);
                if (instaError) validateInstaUsername(text);
              }}
              placeholder="Instagram username (optional)"
              autoCapitalize="none"
              onBlur={() => validateInstaUsername(instaUsername)}
            />
          </View>
          {instaError ? <Text style={styles.errorText}>{instaError}</Text> : null}

          {/* Upload Avatar */}
          <TouchableOpacity style={styles.uploadButton} onPress={pickImage} disabled={uploading}>
            <Ionicons name="camera" size={20} color="#fff" />
            <Text style={styles.buttonText}>{uploading ? 'Uploading...' : 'Upload Avatar'}</Text>
          </TouchableOpacity>
          {avatarUri && !user?.avatar_url ? <Text style={styles.infoValue}>Selected image will upload on save</Text> : null}

          {/* Buttons */}
          <TouchableOpacity style={styles.updateButton} onPress={updateProfile} disabled={updating || uploading}>
            {updating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Update Profile</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={toggleEdit}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.editButton} onPress={toggleEdit}>
          <Ionicons name="create" size={20} color="#fff" />
          <Text style={styles.editButtonText}>Edit Profile</Text>
        </TouchableOpacity>
      )}

      {/* Logout */}
      <TouchableOpacity 
        style={styles.logoutButton} 
        onPress={handleLogout}  // Updated: Calls context logout
        activeOpacity={0.7}
      >
        <Ionicons name="log-out" size={20} color="#fff" />
        <Text style={styles.logoutText}>Logout</Text>
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
    flexGrow: 1,
    paddingBottom: 20,
  },
  header: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  picContainer: {
    alignItems: 'center',
    marginBottom: 10,
  },
  picLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#f0f0f0',
  },
  loadingSmall: {
    fontSize: 10,
    color: '#999',
    marginTop: 5,
  },
  profilePic: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  usernameHeader: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  bioHeader: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 10,
  },
  infoCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    elevation: 1,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  infoLabel: {
    fontSize: 16,
    color: '#333',
    marginLeft: 10,
    fontWeight: 'bold',
  },
  infoValue: {
    fontSize: 16,
    color: '#666',
    marginLeft: 5,
    flex: 1,
  },
  linkText: {
    color: '#E4405F',
    textDecorationLine: 'underline',
  },
  editCard: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    marginBottom: 15,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  input: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
    color: '#333',
  },
  inputError: {
    borderWidth: 1,
    borderColor: '#ff6b6b',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 12,
    marginBottom: 10,
    marginLeft: 15,
  },
  uploadButton: {
    flexDirection: 'row',
    backgroundColor: '#28a745',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  updateButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 5,
  },
  cancelButton: {
    alignItems: 'center',
  },
  cancelText: {
    color: '#007AFF',
    fontSize: 16,
  },
  editButton: {
    flexDirection: 'row',
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginBottom: 20,
  },
  editButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 5,
  },
  logoutButton: {
    flexDirection: 'row',
    backgroundColor: '#ff6b6b',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginBottom: 20,
  },
  logoutText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 5,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    fontSize: 16,
    color: 'red',
    textAlign: 'center',
    marginTop: 20,
  },
});