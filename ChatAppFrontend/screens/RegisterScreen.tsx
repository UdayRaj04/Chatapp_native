import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,  // New: For logo
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';  // For input icons
import { useSafeAreaInsets } from 'react-native-safe-area-context';  // For insets (provider in App.tsx)
import { useNavigation } from '@react-navigation/native';  // For navigation (still needed for Login)
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios, { AxiosError } from 'axios';

// New: Import Auth Context
import { useAuth } from '../contexts/AuthContext';  // Adjust path (e.g., '../../contexts/AuthContext')

const API_BASE = 'http://192.168.29.93:5000/api';

interface RegisterResponse {
  token: string;
  user: {
    id?: string;
    _id?: string;
    username: string;
    email: string;
  };
}

export default function RegisterScreen() {
  const [username, setUsername] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [usernameError, setUsernameError] = useState<string>('');
  const [emailError, setEmailError] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');
  const [confirmPasswordError, setConfirmPasswordError] = useState<string>('');
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();  // Use insets from root provider

  // New: Access auth context
  const { validateAuth } = useAuth();

  const validateUsername = (username: string): boolean => {
    if (!username) {
      setUsernameError('Username is required');
      return false;
    }
    if (username.length < 3) {
      setUsernameError('Username must be at least 3 characters');
      return false;
    }
    setUsernameError('');
    return true;
  };

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email) {
      setEmailError('Email is required');
      return false;
    }
    if (!emailRegex.test(email)) {
      setEmailError('Invalid email format');
      return false;
    }
    setEmailError('');
    return true;
  };

  const validatePassword = (password: string): boolean => {
    if (!password) {
      setPasswordError('Password is required');
      return false;
    }
    if (password.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return false;
    }
    setPasswordError('');
    return true;
  };

  const validateConfirmPassword = (confirmPassword: string): boolean => {
    if (!confirmPassword) {
      setConfirmPasswordError('Please confirm your password');
      return false;
    }
    if (confirmPassword !== password) {
      setConfirmPasswordError('Passwords do not match');
      return false;
    }
    setConfirmPasswordError('');
    return true;
  };

  const handleRegister = async (): Promise<void> => {
    if (!validateUsername(username) || !validateEmail(email) || !validatePassword(password) || !validateConfirmPassword(confirmPassword)) return;

    setLoading(true);
    try {
      const response = await axios.post<RegisterResponse>(`${API_BASE}/auth/register`, {
        username,
        email,
        password,
      });
      await AsyncStorage.setItem('token', response.data.token);
      await AsyncStorage.setItem('user', JSON.stringify(response.data.user));
      console.log('Registration successful - token and user saved, triggering validation');  // Debug log

      // New: Trigger global auth validation instead of direct navigation
      // This updates isAuthenticated = true → Switches to MainTabs automatically
      await validateAuth();

      Alert.alert('Success', 'Account created! Logging in...');
      console.log('Registration validation complete - should switch to MainTabs');
    } catch (err) {
      const error = err as AxiosError;
      console.error('Registration error:', error.response?.data || error.message);  // Debug log
      // Clear any partial storage on failure
      await AsyncStorage.multiRemove(['token', 'user']);
      Alert.alert('Registration Failed', error.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { paddingTop: insets.top }]} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      enabled={true}
    >
      {/* Title with Logo */}
      <View style={styles.titleContainer}>
        {/* New: Bigger Logo */}
        <Image 
          source={require('../assets/logos.png')}  // Adjust path if needed (e.g., '../../assets/logo.png')
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>Seamless Chat</Text>
        <Text style={styles.subtitle}>Create your account to get started</Text>
      </View>

      {/* Form */}
      <View style={styles.formContainer}>
        {/* Username Input */}
        <View style={styles.inputContainer}>
          <Ionicons name="person" size={24} color="#999" style={styles.inputIcon} />
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
            editable={!loading}  // Disable during loading
          />
        </View>
        {usernameError ? <Text style={styles.errorText}>{usernameError}</Text> : null}

        {/* Email Input */}
        <View style={styles.inputContainer}>
          <Ionicons name="mail" size={24} color="#999" style={styles.inputIcon} />
          <TextInput
            style={[styles.input, emailError ? styles.inputError : null]}
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              if (emailError) validateEmail(text);
            }}
            placeholder="Email"
            keyboardType="email-address"
            autoCapitalize="none"
            onBlur={() => validateEmail(email)}
            editable={!loading}  // Disable during loading
          />
        </View>
        {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}

        {/* Password Input */}
        <View style={styles.inputContainer}>
          <Ionicons name="lock-closed" size={24} color="#999" style={styles.inputIcon} />
          <TextInput
            style={[styles.input, passwordError ? styles.inputError : null]}
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (passwordError) validatePassword(text);
              if (confirmPasswordError) validateConfirmPassword(confirmPassword);
            }}
            placeholder="Password"
            secureTextEntry={true}
            onBlur={() => validatePassword(password)}
            editable={!loading}  // Disable during loading
          />
        </View>
        {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

        {/* Confirm Password Input */}
        <View style={styles.inputContainer}>
          <Ionicons name="lock-closed" size={24} color="#999" style={styles.inputIcon} />
          <TextInput
            style={[styles.input, confirmPasswordError ? styles.inputError : null]}
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              if (confirmPasswordError) validateConfirmPassword(text);
            }}
            placeholder="Confirm Password"
            secureTextEntry={true}
            onBlur={() => validateConfirmPassword(confirmPassword)}
            editable={!loading}  // Disable during loading
          />
        </View>
        {confirmPasswordError ? <Text style={styles.errorText}>{confirmPasswordError}</Text> : null}

        {/* Register Button */}
        <TouchableOpacity 
          style={[styles.button, loading ? styles.buttonDisabled : null]} 
          onPress={handleRegister}
          disabled={loading}
          activeOpacity={0.7}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Register</Text>
          )}
        </TouchableOpacity>

        {/* Login Link */}
        <TouchableOpacity 
          style={styles.linkContainer}
          onPress={() => navigation.navigate('Login')}
          disabled={loading}  // Disable during loading
        >
          <Text style={styles.linkText}>Already have an account? Login</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleContainer: {
    alignItems: 'center',
    marginBottom: 50,  // Increased: More space after logo/title to form
  },
  // New: Logo Style (Bigger, Centered)
  logo: {
    width: 120,  // Bigger size - adjust as needed (e.g., 100 for smaller)
    height: 120,
    marginBottom: 20,  // Space between logo and title
    alignSelf: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  formContainer: {
    width: '85%',  // Responsive width
    alignItems: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: 15,
    paddingHorizontal: 15,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    width: '100%',
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
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
    alignSelf: 'flex-start',
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingVertical: 15,
    width: '100%',
    alignItems: 'center',
    marginTop: 10,
    elevation: 2,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  linkContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  linkText: {
    color: '#007AFF',
    fontSize: 16,
    textDecorationLine: 'underline',
  },
});