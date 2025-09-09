import React, { useEffect, useState } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Text,
  PermissionsAndroid,
  Platform,
  Dimensions,
} from 'react-native';
import { RtcEngine, createRtcEngine, ChannelProfile, ClientRole, AudioScenario, VideoEncoderConfiguration, RtcStats, UserOfflineReasonType, RtcConnectionStateType } from 'react-native-agora';  // Correct import from official package
import { useNavigation, useRoute } from '@react-navigation/native';
import io from 'socket.io-client';
import Icon from 'react-native-vector-icons/MaterialIcons';  // Assume installed
import * as Audio from 'expo-av';  // For iOS perms fallback

const { width, height } = Dimensions.get('window');
const AGORA_APP_ID = '8df640a93b514671b21fa4dd713bccd5';  // Replace with your free App ID from agora.io
const API_BASE = 'http://192.168.29.93:5000';  // Your backend

interface RouteParams {
  roomId: string;
  isVideo: boolean;
  isCaller: boolean;
  otherUserName: string;
  otherUserId?: string;  // For endCall notification
}

export default function CallScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { roomId, isVideo, isCaller, otherUserName, otherUserId } = route.params as RouteParams;
  const [engine, setEngine] = useState<RtcEngine | null>(null);
  const [socket] = useState(io(API_BASE));
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(isVideo);
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(false);
  const [callState, setCallState] = useState<'connecting' | 'connected' | 'ended'>('connecting');

  useEffect(() => {
    let initialized = false;
    const initCall = async () => {
      try {
        // Request permissions
        if (Platform.OS === 'android') {
          const grants = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
            ...(isVideo ? [PermissionsAndroid.PERMISSIONS.CAMERA] : []),
          ]);
          const micGranted = grants['android.permission.RECORD_AUDIO'] === 'granted';
          const camGranted = !isVideo || grants['android.permission.CAMERA'] === 'granted';
          if (!micGranted || !camGranted) {
            throw new Error('Permissions denied');
          }
        } else {
          // iOS: Plugin handles, but fallback
          const { status: micStatus } = await Audio.requestPermissionsAsync();
          if (micStatus !== 'granted') throw new Error('Microphone permission denied');
        }

        // Initialize Agora Engine
        const newEngine = createRtcEngine();
        await newEngine.initialize({ appId: AGORA_APP_ID, channelProfile: ChannelProfile.Communication });
        setEngine(newEngine);

        // Audio/Video setup
        await newEngine.enableAudio();
        if (isVideo) {
          await newEngine.enableVideo();
          await newEngine.setVideoEncoderConfiguration(VideoEncoderConfiguration.standardVideoDimensions());
        }

        // Set role: Broadcaster for caller, Audience for receiver
        await newEngine.setClientRole(isCaller ? ClientRole.Broadcaster : ClientRole.Audience);
        if (!isVideo) {
          await newEngine.setAudioScenario(AudioScenario.Voip);
        }

        // Join channel (token: null for testing; use real token for production)
        await newEngine.joinChannel(null, roomId, '', 0);
        setCallState('connected');
        console.log(`Joined ${isVideo ? 'Video' : 'Voice'} call in room ${roomId} as ${isCaller ? 'Broadcaster' : 'Audience'}`);

        // Event listeners
        newEngine.addListener('JoinChannelSuccess', (channel, uid, elapsed) => {
          console.log('Joined channel successfully:', channel, uid);
        });

        newEngine.addListener('UserJoined', (uid, elapsed) => {
          console.log('Remote user joined:', uid);
          setRemoteVideoEnabled(true);
          setCallState('connected');
        });

        newEngine.addListener('UserOffline', (uid, reason) => {
          console.log('Remote user offline:', uid, reason);
          Alert.alert('Call Ended', 'Remote user left the call.');
          endCall();
        });

        newEngine.addListener('RtcStats', (stats: RtcStats) => {
          // Optional: Log stats (e.g., bitrate, delay)
          console.log('RtcStats:', stats);
        });

        newEngine.addListener('ConnectionStateChanged', (state, reason) => {
          if (state === RtcConnectionStateType.ConnectionStateFailed) {
            Alert.alert('Connection Error', 'Call connection failed.');
            endCall();
          }
        });

        initialized = true;
      } catch (err) {
        console.error('Agora init error:', err);
        Alert.alert('Error', `Failed to start call: ${(err as Error).message}`);
        endCall();
      }
    };

    initCall();

    // Cleanup on unmount
    return () => {
      if (initialized && engine) {
        endCall();
      }
    };
  }, [roomId, isVideo, isCaller, otherUserId]);

  const endCall = async () => {
    if (engine) {
      await engine.stopPreview();  // Stop local preview if video
      await engine.leaveChannel();
      engine.destroy();
      setEngine(null);
    }
    // Notify backend/other user
    socket.emit('endCall', { roomId, otherUserId });  // otherUserId from params (for receiver, it's callerId)
    navigation.goBack();
    setCallState('ended');
  };

  const toggleMute = async () => {
    if (engine) {
      await engine.muteLocalAudioStream(!isMuted);
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = async () => {
    if (!engine || !isVideo) return;
    await engine.muteLocalVideoStream(!isVideoEnabled);
    setIsVideoEnabled(!isVideoEnabled);
  };

  const switchCamera = async () => {
    if (engine && isVideo) {
      await engine.switchCamera();
    }
  };

  if (callState === 'connecting' || !engine) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Connecting {isVideo ? 'Video' : 'Voice'} Call...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.callInfo}>
        {isVideo ? 'Video' : 'Voice'} Call with {otherUserName}
      </Text>
      <Text style={styles.roomInfo}>Room: {roomId.substring(0, 8)}...</Text>

      {isVideo && (
        <View style={styles.videoContainer}>
          {/* Local Video Placeholder - Use <RtcLocalView.SurfaceView style={...} /> for real video */}
          <View style={[styles.videoView, styles.localVideo, { backgroundColor: isVideoEnabled ? '#000' : '#333' }]}>
            <Text style={styles.videoText}>Your Video</Text>
          </View>
          {/* Remote Video Placeholder - Use <RtcRemoteView.SurfaceView style={...} uid={remoteUid} /> */}
          <View style={[styles.videoView, styles.remoteVideo, { backgroundColor: remoteVideoEnabled ? '#000' : '#333' }]}>
            <Text style={styles.videoText}>{otherUserName}'s Video</Text>
          </View>
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity onPress={toggleMute} style={[styles.controlButton, isMuted ? styles.mutedButton : styles.activeButton]}>
          <Icon name={isMuted ? "mic-off" : "mic"} size={30} color="#fff" />
        </TouchableOpacity>

        {isVideo && (
          <>
            <TouchableOpacity onPress={toggleVideo} style={[styles.controlButton, !isVideoEnabled ? styles.mutedButton : styles.activeButton]}>
              <Icon name={isVideoEnabled ? "videocam" : "videocam-off"} size={30} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={switchCamera} style={styles.controlButton}>
              <Icon name="flip-camera-android" size={30} color="#fff" />
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity onPress={endCall} style={styles.endButton}>
          <Icon name="call-end" size={30} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#000', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  loadingContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: '#000' 
  },
  loadingText: { color: '#fff', fontSize: 18 },
  callInfo: { color: '#fff', fontSize: 20, marginTop: 50, textAlign: 'center' },
  roomInfo: { color: '#ccc', fontSize: 12, marginBottom: 10 },
  videoContainer: { 
    flex: 1, 
    width: '100%', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  videoView: { 
    position: 'absolute', 
    borderRadius: 10 
  },
  localVideo: { 
    width: 120, 
    height: 160, 
    bottom: 100, 
    right: 20, 
    zIndex: 1 
  },
  remoteVideo: { 
    width: width, 
    height: height * 0.7, 
    zIndex: 0 
  },
  videoText: { 
    color: '#fff', 
    textAlign: 'center', 
    position: 'absolute', 
    top: '50%', 
    left: '50%', 
    transform: [{ translateX: -50 }, { translateY: -50 }] 
  },
  controls: { 
    flexDirection: 'row', 
    justifyContent: 'space-around', 
    padding: 20, 
    width: '100%', 
    backgroundColor: 'rgba(0,0,0,0.5)' 
  },
  controlButton: { 
    padding: 15, 
    borderRadius: 50 
  },
  activeButton: { backgroundColor: '#4CAF50' },
  mutedButton: { backgroundColor: '#f44336' },
  endButton: { 
    backgroundColor: '#f44336', 
    padding: 15, 
    borderRadius: 50 
  },
});