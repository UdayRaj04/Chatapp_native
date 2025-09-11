import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { API_BASE, SOCKET_BASE } from '../config';  // New: Global config (adjust path if 

interface AuthContextType {
  isAuthenticated: boolean | null;
  isLoading: boolean;
  validateAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Validate auth (same logic as before)
  const validateAuth = async (): Promise<void> => {
    try {
      setIsLoading(true);
      const token = await AsyncStorage.getItem('token');
      const userStr = await AsyncStorage.getItem('user');

      if (!token) {
        console.log('No token found - not authenticated');
        setIsAuthenticated(false);
        return;
      }

      if (!userStr) {
        console.log('Token exists but no user data - clear and not authenticated');
        await AsyncStorage.removeItem('token');
        setIsAuthenticated(false);
        return;
      }

      // Validate token with backend
      try {
        const response = await axios.get(`${API_BASE}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        // Valid - refresh user
        const freshUser = response.data;
        await AsyncStorage.setItem('user', JSON.stringify(freshUser));
        console.log('Token valid - authenticated');
        setIsAuthenticated(true);
      } catch (validationErr: any) {
        console.error('Token validation failed:', validationErr.response?.status || validationErr.message);
        if (validationErr.response?.status === 401) {
          await AsyncStorage.multiRemove(['token', 'user']);
          console.log('Invalid token - cleared storage');
        }
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error('Auth check error (e.g., offline):', err);
      // Offline fallback
      const userStr = await AsyncStorage.getItem('user');
      if (userStr) {
        setIsAuthenticated(true);
        console.log('Offline fallback - authenticated');
      } else {
        setIsAuthenticated(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Logout: Clear storage and set state to false (triggers re-render to AuthStack)
  const logout = async (): Promise<void> => {
    try {
      await AsyncStorage.multiRemove(['token', 'user']);
      console.log('Logout: Storage cleared, setting unauthenticated');
      setIsAuthenticated(false);
    } catch (err) {
      console.error('Logout error:', err);
      Alert.alert('Logout Failed', 'Please try again or restart the app.');
    }
  };

  // Run validation on mount
  useEffect(() => {
    validateAuth();
  }, []);

  const value: AuthContextType = {
    isAuthenticated,
    isLoading,
    validateAuth,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};