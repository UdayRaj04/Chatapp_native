import 'react-native-get-random-values';  // Polyfill first (for CryptoJS/WebRTC secure randoms)
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { LogBox, View, Text, ActivityIndicator, Platform } from 'react-native';  // Added: Platform for web checks
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

// New: Auth Context
import { AuthProvider, useAuth } from './contexts/AuthContext';  // Adjust path if needed
import UserProfileScreen from './screens/UserProfileScreen';

// New: Dynamic import for CallScreen (only on mobile)
let CallScreen: any = null;
if (Platform.OS !== 'web') {
  CallScreen = require('./screens/CallScreen').default;
}

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Main Tab Navigator (fixed: boxShadow for web compatibility)
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
          } else if (route.name === 'Call') {
            iconName = focused ? 'call' : 'call-outline';
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
          // Fixed: Use boxShadow for web (replaces shadow* deprecation)
          boxShadow: Platform.OS === 'web' ? '0 -2px 4px rgba(0,0,0,0.1)' : undefined,
          elevation: 8,  // Native shadow (mobile only)
          height: 100,
          paddingBottom: 50,
          paddingTop: 5,
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          marginBottom: 0,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginBottom: 0,
        },
        headerShown: false,
        lazy: true,
        cardStyle: { paddingBottom: 0 },
      })}
    >
      <Tab.Screen name="Chats" component={ChatListScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="Search" component={SearchScreen} options={{ title: 'Search' }} />
      <Tab.Screen name="Call" component={AnalyticsScreen} options={{ title: 'Call' }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ title: 'History' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}

// Auth Stack (Login/Register only - no CallScreen here)
function AuthStack() {
  return (
    <Stack.Navigator 
      initialRouteName="Login"
      screenOptions={{
        headerShown: false,
        cardStyle: { 
          backgroundColor: '#f5f5f5',
          // Fixed: boxShadow for web
          boxShadow: Platform.OS === 'web' ? '0 2px 4px rgba(0,0,0,0.1)' : undefined,
        },
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
    </Stack.Navigator>
  );
}

// Conditional Navigator Component (Uses Context)
function ConditionalNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  // Show loading during check
  if (isLoading || isAuthenticated === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' }}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={{ marginTop: 10, fontSize: 16, color: '#666' }}>Checking login...</Text>
      </View>
    );
  }

  // Conditional Navigation
  return (
    <NavigationContainer>
      {isAuthenticated ? (
        // Authenticated: Main Stack with Tabs and Chat
        <Stack.Navigator 
          initialRouteName="MainTabs"
          screenOptions={{
            headerShown: false,
            cardStyle: { 
              backgroundColor: '#f5f5f5',
              // Fixed: boxShadow for web (replaces shadow deprecation)
              boxShadow: Platform.OS === 'web' ? '0 1px 3px rgba(0,0,0,0.1)' : undefined,
            },
          }}
        >
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen 
            name="Chat" 
            component={ChatScreen} 
            options={{ 
              headerShown: false,
              headerTitle: 'Chat', 
              headerStyle: { backgroundColor: '#007AFF' },
              headerTintColor: '#fff',
              presentation: 'modal',
              tabBarStyle: { display: 'none' },
              // Fixed: boxShadow for Chat card
              cardStyle: { 
                backgroundColor: '#f0f0f0',
                boxShadow: Platform.OS === 'web' ? '0 2px 8px rgba(0,0,0,0.15)' : undefined,
              },
            }}
          />
          {/* New: User Profile Screen (push from Chat) */}
          <Stack.Screen 
            name="UserProfile" 
            component={UserProfileScreen} 
            options={{ 
              headerShown: false,  // Custom header inside screen
              presentation: 'card',  // Smooth push animation
              // Fixed: boxShadow
              cardStyle: { 
                backgroundColor: '#f5f5f5',
                boxShadow: Platform.OS === 'web' ? '0 2px 8px rgba(0,0,0,0.15)' : undefined,
              },
            }}
          />
          {/* Conditional: CallScreen only on mobile (in authenticated stack) */}
          {Platform.OS !== 'web' && CallScreen && (
            <Stack.Screen 
              name="CallScreen" 
              component={CallScreen} 
              options={{ 
                headerShown: false,
                // Fixed: boxShadow
                cardStyle: { 
                  backgroundColor: '#000',  // Black for call UI
                  boxShadow: Platform.OS === 'web' ? 'none' : undefined,
                },
              }}
            />
          )}
        </Stack.Navigator>
      ) : (
        // Not Authenticated: Auth Stack
        <AuthStack />
      )}
    </NavigationContainer>
  );
}

// Main App - Wrapped in SafeAreaProvider and AuthProvider
export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>  {/* New: Wraps everything for global auth */}
        <View style={{ flex: 1 }}>
          <ConditionalNavigator />  {/* New: Handles conditional nav with context */}
        </View>
      </AuthProvider>
    </SafeAreaProvider>
  );
}