import React from 'react';
import { View, Text, Button, StyleSheet, Alert, Linking, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';

const WEBSITE_URL = 'https://udayaj.web.app';  // New: Customize this URL (e.g., your portfolio)

export default function ProfileScreen() {
  const navigation = useNavigation();

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
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },

  
  // New: Footer Styles (Bottom Link)
  footer: {
    marginTop:200,  // Push to bottom
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
});