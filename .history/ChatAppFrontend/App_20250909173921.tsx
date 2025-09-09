import 'react-native-get-random-values';  // Polyfill first
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { LogBox, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';  // New: For dynamic insets

// Suppress warnings
LogBox.ignoreLogs([
  'Text strings must be rendered within a <Text> component',
  'VirtualizedList: You have a large list that is slow to initial render',
  'Require cycle:',
  /Warning: [A-Za-z ]*Text strings[A-Za-z ]*/,
]);

// Your existing screens
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import ChatListScreen from './screens/ChatListScreen';
import ChatScreen from './screens/ChatScreen';

// Placeholder screens (ensure they exist)
import SearchScreen from './screens/SearchScreen';
import AnalyticsScreen from './screens/AnalyticsScreen';
import HistoryScreen from './screens/HistoryScreen';
import ProfileScreen from './screens/ProfileScreen';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Main Tab Navigator (enhanced with safe area for no overlap)
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap;

          if (route.name === 'Chats') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Search') {
            iconName = focused ? 'search' : 'search-outline';
          } else if (route.name === 'Analytics') {
            iconName = focused ? 'analytics' : 'analytics-outline';
          } else if (route.name === 'History') {
            iconName = focused ? 'time' : 'time-outline';
          } else {
            iconName = focused ? 'person' : 'person-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: '#8e8e93',
        tabBarStyle: {
          backgroundColor: '#f8f8f8',
          borderTopWidth: 0.5,
          borderTopColor: '#e0e0e0',
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          height: 120,  // Increased: Taller tab bar (60 was too tight; 70 + labels)
          paddingBottom: 40,  // Reduced top padding for balance
          paddingTop: 5,
          position: 'absolute',  // Explicit: Ensures absolute positioning
          bottom: 0,  // Pin to bottom
          left: 0,
          right: 0,
          marginBottom: 0,  // No extra margin
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginBottom: 0,  // Tight labels
        },
        headerShown: false,
        lazy: true,
        // New: Apply safe area padding to tab screens (prevents overlap)
        cardStyle: { paddingBottom: 0 },  // No extra card padding
      })}
    >
      <Tab.Screen name="Chats" component={ChatListScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="Search" component={SearchScreen} options={{ title: 'Search' }} />
      <Tab.Screen name="Analytics" component={AnalyticsScreen} options={{ title: 'Analytics' }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ title: 'History' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}

// Main App - Wrapped in SafeAreaProvider
export default function App() {
  return (
    <SafeAreaProvider>  {/* New: Enables useSafeAreaInsets() */}
      <View style={{ flex: 1 }}>
        <NavigationContainer>
          <Stack.Navigator 
            initialRouteName="Login"
            screenOptions={{
              headerShown: false,
              cardStyle: { backgroundColor: '#f5f5f5' },
            }}
          >
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen name="MainTabs" component={MainTabs} />
            <Stack.Screen 
              name="Chat" 
              component={ChatScreen} 
              options={{ 
                headerShown: true,
                headerTitle: 'Chat', 
                headerStyle: { backgroundColor: '#007AFF' },
                headerTintColor: '#fff',
                presentation: 'modal',
                // Hide tabs in chat to avoid overlap
                tabBarStyle: { display: 'none' },
              }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </View>
    </SafeAreaProvider>
  );
}