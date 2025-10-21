import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  PermissionsAndroid,
  Dimensions,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import InCallManager from 'react-native-incall-manager';
import io, { Socket } from 'socket.io-client';

import { API_BASE, SOCKET_BASE } from '../config';  // New: Global config (adjust path if 

// WebRTC: Conditional import (only mobile)
let WebRTC: any = null;
if (Platform.OS !== 'web') {
  WebRTC = {
    RTCView: require('react-native-webrtc').RTCView,
    mediaDevices: require('react-native-webrtc').mediaDevices,
    RTCPeerConnection: require('react-native-webrtc').RTCPeerConnection,
    RTCIceCandidate: require('react-native-webrtc').RTCIceCandidate,
    RTCSessionDescription: require('react-native-webrtc').RTCSessionDescription,
  };
}
const { width: screenWidth } = Dimensions.get('window');

interface RouteParams {
  otherUserId: string;
  otherUserName: string;
  callType: 'video' | 'audio';
  isIncoming?: boolean;
}

// Add timer hooks after RouteParams interface
const useCallDuration = () => {
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setDuration(prev => prev + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatDuration = () => {
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return formatDuration();
};

// Add call quality hook
const useCallQuality = (pc: RTCPeerConnection | null) => {
  const [quality, setQuality] = useState<'good' | 'medium' | 'poor'>('good');
  
  useEffect(() => {
    if (!pc) return;
    const interval = setInterval(async () => {
      const stats = await pc.getStats();
      let totalPacketsLost = 0;
      let totalPackets = 0;
      
      stats.forEach((stat) => {
        if (stat.type === 'inbound-rtp' && stat.packetsLost) {
          totalPacketsLost += stat.packetsLost;
          totalPackets += stat.packetsReceived;
        }
      });
      
      const lossRate = totalPackets ? (totalPacketsLost / totalPackets) : 0;
      setQuality(lossRate < 0.01 ? 'good' : lossRate < 0.05 ? 'medium' : 'poor');
    }, 2000);
    
    return () => clearInterval(interval);
  }, [pc]);
  
  return quality;
};

// RTCView type with correct interface
interface RTCViewInterface extends View {
  streamURL: string;
  objectFit: 'cover' | 'contain';
  mirror?: boolean;
}

// Add type for RTCView props
type RTCViewProps = {
  streamURL: string;
  style: any;
  objectFit: 'cover' | 'contain';
  mirror?: boolean;
};

export default function CallScreen() {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCalling, setIsCalling] = useState<boolean>(true);
  const [callType, setCallType] = useState<'video' | 'audio'>('video');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [pc, setPc] = useState<any>(null);  // RTCPeerConnection | null
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [speakerOn, setSpeakerOn] = useState<boolean>(false);
  const navigation = useNavigation();
  const route = useRoute();
  const { otherUserId, otherUserName, callType: initCallType, isIncoming = false } = route.params as RouteParams;

  const localVideoRef = useRef<View>(null);  // Fallback to View on web
  const remoteVideoRef = useRef<View>(null);

  // Add ring animation
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(1);
  
  useEffect(() => {
    if (isCalling) {
      ringScale.value = withRepeat(
        withSequence(
          withTiming(1.5, { duration: 1000 }),
          withTiming(1, { duration: 1000 })
        ),
        -1
      );
      ringOpacity.value = withRepeat(
        withSequence(
          withTiming(0.2, { duration: 1000 }),
          withTiming(1, { duration: 1000 })
        ),
        -1
      );
    }
  }, [isCalling]);
  
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  useEffect(() => {
    // Web Guard: Show error on web (calling not supported)
    if (Platform.OS === 'web') {
      Alert.alert('Unsupported', 'Video/audio calls are not available on web. Use mobile device.');
      navigation.goBack();
      return;
    }

    setCallType(initCallType);
    loadUserId();  // Get currentUserId
    initCall();
    InCallManager.start({ media: 'video' });

    return () => {
      InCallManager.stop();
      endCall();
    };
  }, []);

  // New: Load currentUserId (as in ChatScreen)
  const loadUserId = async () => {
    try {
      const userStr = await AsyncStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        setCurrentUserId(user.id || user._id);
      }
    } catch (err) {
      console.error('Load user ID error:', err);
    }
  };

  // Update initCall error handling
  const initCall = async () => {
    if (!WebRTC) return;

    try {
      // Request permissions (mobile only)
      if (Platform.OS === 'android') {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);
      }

      // Get local stream
      const stream = await WebRTC.mediaDevices.getUserMedia({
        video: callType === 'video',
        audio: true,
      });
      setLocalStream(stream);

      // Init PeerConnection
      const configuration = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],  // Free STUN
      };
      const peerConnection = new WebRTC.RTCPeerConnection(configuration);
      setPc(peerConnection);

      // Add local stream tracks
      stream.getTracks().forEach((track: MediaStreamTrack) => peerConnection.addTrack(track, stream));

      // Handle remote stream
      peerConnection.ontrack = (event: any) => {
        setRemoteStream(event.streams[0]);
      };

      // Handle ICE candidates
      peerConnection.onicecandidate = (event: any) => {
        if (event.candidate) {
          socket?.emit('iceCandidate', {
            from: currentUserId,
            to: otherUserId,
            candidate: event.candidate,
          });
        }
      };

      // Init socket for signaling
      const token = await AsyncStorage.getItem('token');
      const newSocket = io(API_BASE.replace('/api', ''), { auth: { token } });
      setSocket(newSocket);

      if (isIncoming) {
        // Answer incoming call (simplified - add alert for accept/decline)
        Alert.alert(
          'Incoming Call',
          `${otherUserName} is calling you (${initCallType})`,
          [
            { text: 'Decline', onPress: () => endCall(), style: 'cancel' },
            { text: 'Accept', onPress: async () => {
              await handleAnswer();
              setIsCalling(false);
            }},
          ]
        );
      } else {
        // Create offer (outgoing)
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        newSocket.emit('callOffer', {
          from: currentUserId,
          to: otherUserId,
          offer,
          type: callType,
        });
      }

      // Listen for signaling events
      newSocket.on('callOffer', async (data: any) => {
        if (data.from === otherUserId) {
          await peerConnection.setRemoteDescription(new WebRTC.RTCSessionDescription(data.offer));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          newSocket.emit('callAnswer', {
            from: currentUserId,
            to: otherUserId,
            answer,
          });
        }
      });

      newSocket.on('callAnswer', async (data: any) => {
        if (data.from === otherUserId) {
          await peerConnection.setRemoteDescription(new WebRTC.RTCSessionDescription(data.answer));
          setIsCalling(false);
        }
      });

      newSocket.on('iceCandidate', async (data: any) => {
        if (data.from === otherUserId && data.candidate) {
          await peerConnection.addIceCandidate(new WebRTC.RTCIceCandidate(data.candidate));
        }
      });

      newSocket.on('callEnded', () => {
        endCall();
      });

      newSocket.on('incomingCall', (data: any) => {
        // Handle if not already processed
        console.log('Incoming call received:', data);
      });

    } catch (error: unknown) {
      console.error('Call init error:', error);
      handleError(error);
    }
  };

  const handleAnswer = async () => {
    if (!pc || !WebRTC) return;
    // Similar to offer, but createAnswer (called on accept)
    // Note: For full incoming, emit back offer if needed
  };

  const endCall = () => {
    localStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    remoteStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    pc?.close();
    socket?.emit('endCall', { from: currentUserId, to: otherUserId });
    socket?.disconnect();
    setLocalStream(null);
    setRemoteStream(null);
    setPc(null);
    setSocket(null);
    navigation.goBack();
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) videoTrack.enabled = !videoTrack.enabled;
    }
  };

  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) audioTrack.enabled = !audioTrack.enabled;
    }
  };

  const callDuration = useCallDuration();
  const callQuality = useCallQuality(pc);
  const insets = useSafeAreaInsets();

  // Update RTCView handling
  const RTCViewComponent = Platform.OS !== 'web' && WebRTC?.RTCView
    ? WebRTC.RTCView
    : ({ style, children }: any) => (
        <View style={style}>
          {children}
          <Text style={styles.noStreamText}>Video unavailable</Text>
        </View>
      );

  // Update render methods with correct types
  const renderRemoteStream = () => {
    if (!remoteStream || !RTCViewComponent) return null;
    
    return Platform.OS === 'web' ? (
      <View style={styles.remoteVideo}>
        <Text style={styles.noStreamText}>Web video unavailable</Text>
      </View>
    ) : (
      <RTCViewComponent
        streamURL={(remoteStream as any).toURL()}
        style={styles.remoteVideo}
        objectFit="cover"
        mirror={false}
      />
    );
  };

  const renderLocalStream = () => {
    if (!localStream || !RTCViewComponent || callType !== 'video') return null;
    
    return Platform.OS === 'web' ? (
      <View style={styles.localVideo}>
        <Text style={styles.noStreamText}>Web video unavailable</Text>
      </View>
    ) : (
      <RTCViewComponent
        streamURL={(localStream as any).toURL()}
        style={styles.localVideo}
        objectFit="cover"
        mirror={true}
      />
    );
  };

  // Update main render
  if (isCalling) {
    return (
      <View style={[styles.callingContainer, { paddingTop: insets.top }]}>
        <View style={styles.callerInfo}>
          <Text style={styles.callerName}>{otherUserName}</Text>
          <Text style={styles.callStatus}>
            {isIncoming ? 'Incoming call' : 'Calling...'}
          </Text>
        </View>
        
        <Animated.View style={[styles.ringContainer, ringStyle]}>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>
              {otherUserName.charAt(0).toUpperCase()}
            </Text>
          </View>
        </Animated.View>
        
        {isIncoming ? (
          <View style={styles.incomingControls}>
            <TouchableOpacity onPress={() => endCall()} style={styles.declineButton}>
              <Ionicons name="close-circle" size={40} color="#fff" />
              <Text style={styles.buttonText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleAnswer()} style={styles.acceptButton}>
              <Ionicons name={callType === 'video' ? 'videocam' : 'call'} size={40} color="#fff" />
              <Text style={styles.buttonText}>Accept</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={endCall} style={styles.endButton}>
            <Ionicons name="close-circle" size={30} color="#fff" />
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {renderRemoteStream()}
      {renderLocalStream()}
      
      {/* Call info overlay */}
      <View style={styles.callInfo}>
        <Text style={styles.callerName}>{otherUserName}</Text>
        <Text style={styles.callDuration}>{callDuration}</Text>
        <View style={styles.qualityIndicator}>
          <Ionicons 
            name={callQuality === 'good' ? 'cellular' : 'cellular-outline'} 
            size={16} 
            color={
              callQuality === 'good' ? '#4CAF50' : 
              callQuality === 'medium' ? '#FFC107' : '#F44336'
            } 
          />
        </View>
      </View>

      {/* Controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 20 }]}>
        <TouchableOpacity 
          onPress={toggleAudio} 
          style={[
            styles.controlButton,
            !localStream?.getAudioTracks()[0]?.enabled && styles.controlButtonDisabled
          ]}
        >
          <Ionicons 
            name={localStream?.getAudioTracks()[0]?.enabled ? "mic" : "mic-off"} 
            size={24} 
            color="#fff" 
          />
          <Text style={styles.controlText}>Mute</Text>
        </TouchableOpacity>

        {callType === 'video' && (
          <TouchableOpacity 
            onPress={toggleVideo}
            style={[
              styles.controlButton,
              !localStream?.getVideoTracks()[0]?.enabled && styles.controlButtonDisabled
            ]}
          >
            <Ionicons 
              name={localStream?.getVideoTracks()[0]?.enabled ? "videocam" : "videocam-off"}
              size={24} 
              color="#fff" 
            />
            <Text style={styles.controlText}>Video</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity 
          onPress={() => {
            InCallManager.setSpeakerphoneOn(!speakerOn);
            setSpeakerOn(!speakerOn);
          }}
          style={styles.controlButton}
        >
          <Ionicons 
            name={speakerOn ? "volume-high" : "volume-low"} 
            size={24} 
            color="#fff" 
          />
          <Text style={styles.controlText}>Speaker</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={endCall} style={styles.endCallButton}>
          <Ionicons name="close-circle" size={24} color="#fff" />
          <Text style={styles.controlText}>End</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  callingContainer: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
  },
  callerInfo: {
    alignItems: 'center',
    marginTop: 60,
  },
  callerName: {
    fontSize: 28,
    color: '#fff',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  callStatus: {
    fontSize: 16,
    color: '#aaa',
  },
  ringContainer: {
    position: 'absolute',
    top: '40%',
  },
  avatarContainer: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#2196F3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 60,
    color: '#fff',
    fontWeight: 'bold',
  },
  incomingControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 30,
    marginBottom: 50,
  },
  declineButton: {
    backgroundColor: '#F44336',
    borderRadius: 50,
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acceptButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 50,
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 12,
    marginTop: 4,
  },
  callInfo: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 10,
  },
  callDuration: {
    color: '#fff',
    fontSize: 14,
    marginTop: 4,
  },
  qualityIndicator: {
    position: 'absolute',
    right: 20,
    top: 15,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  controlButton: {
    alignItems: 'center',
    padding: 12,
  },
  controlButtonDisabled: {
    opacity: 0.5,
  },
  controlText: {
    color: '#fff',
    fontSize: 12,
    marginTop: 4,
  },
  endCallButton: {
    alignItems: 'center',
    backgroundColor: '#F44336',
    padding: 12,
    borderRadius: 8,
  },
  remoteVideo: {
    flex: 1,
    width: screenWidth,
    height: screenWidth * 0.7,
    backgroundColor: '#000',  // Fallback black
  },
  localVideo: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 100,
    height: 150,
    borderRadius: 10,
    zIndex: 1,
    backgroundColor: '#000',  // Fallback
  },
  noStreamText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 20,
  },
  endButton: {
    backgroundColor: '#F44336',
    borderRadius: 50,
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 50,
  },
});