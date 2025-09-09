import React from 'react';
import { View, Text, Button, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';

const WEBSITE_URL = 'https://udayaj.web.app';  // New: Customize this URL (e.g., your portfolio)

export default function ProfileScreen() {
  const navigation = useNavigation();

  const handleLogout = async () => {
    try {
      await AsyncStorage.multiRemove(['token', 'user']);
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });  // Back to login
    } catch (err) {
      Alert.alert('Error', 'Logout failed');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      <Text>Manage your account here</Text>
      <Button title="Logout" onPress={handleLogout} color="#ff3b30" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
});