import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Dimensions,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';  // For currentUserId
import { useNavigation, useRoute } from '@react-navigation/native';
import io, { Socket } from 'socket.io-client';
import InCallManager from 'react-native-incall-manager';  // For call UI

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

const API_BASE = 'http://192.168.29.93:5000/api';
const { width: screenWidth } = Dimensions.get('window');

interface RouteParams {
  otherUserId: string;
  otherUserName: string;
  callType: 'video' | 'audio';
  isIncoming?: boolean;
}

export default function CallScreen() {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCalling, setIsCalling] = useState<boolean>(true);
  const [callType, setCallType] = useState<'video' | 'audio'>('video');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [pc, setPc] = useState<any>(null);  // RTCPeerConnection | null
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { otherUserId, otherUserName, callType: initCallType, isIncoming = false } = route.params as RouteParams;

  const localVideoRef = useRef<View>(null);  // Fallback to View on web
  const remoteVideoRef = useRef<View>(null);

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

  const initCall = async () => {
    if (!WebRTC) return;  // Safety guard

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

    } catch (err) {
      console.error('Call init error:', err);
      Alert.alert('Call Error', `Failed to start call: ${err.message}`);
      navigation.goBack();
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

  // Web Fallback: Show message instead of RTCView
  const RTCViewComponent = Platform.OS === 'web' ? View : WebRTC?.RTCView;

  if (isCalling) {
    return (
      <View style={[styles.callingContainer, { boxShadow: Platform.OS === 'web' ? '0 4px 8px rgba(0,0,0,0.2)' : undefined }]}>
        <Ionicons name={callType === 'video' ? 'videocam' : 'call'} size={100} color="#007AFF" />
        <Text style={styles.callingText}>Calling {otherUserName}...</Text>
        <TouchableOpacity onPress={endCall} style={[styles.endButton, { boxShadow: Platform.OS === 'web' ? '0 2px 4px rgba(255,68,68,0.3)' : undefined }]}>
          <Ionicons name="call-end" size={30} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { boxShadow: Platform.OS === 'web' ? 'none' : undefined }]}>
      {/* Remote Video (full screen) */}
      {remoteStream && (
        <RTCViewComponent 
          streamURL={remoteStream.toURL()} 
          style={styles.remoteVideo} 
          objectFit="cover" 
          mirror={false}
        />
      )}
      {/* Local Video (small overlay) */}
      {localStream && callType === 'video' && (
        <RTCViewComponent 
          streamURL={localStream.toURL()} 
          style={styles.localVideo} 
          objectFit="cover" 
          mirror={true}
        />
      )}
      {/* Fallback if no stream (e.g., web or error) */}
      {!remoteStream && !isCalling && (
        <View style={styles.remoteVideo}>
          <Text style={styles.noStreamText}>Connecting...</Text>
        </View>
      )}
      {/* Controls */}
      <View style={[styles.controls, { boxShadow: Platform.OS === 'web' ? '0 -2px 4px rgba(0,0,0,0.1)' : undefined }]}>
        <TouchableOpacity onPress={toggleVideo} style={[styles.controlButton, { boxShadow: Platform.OS === 'web' ? '0 2px 4px rgba(0,122,255,0.3)' : undefined }]}>
          <Ionicons name={callType === 'video' ? "videocam" : "videocam-off"} size={30} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={toggleAudio} style={[styles.controlButton, { boxShadow: Platform.OS === 'web' ? '0 2px 4px rgba(0,122,255,0.3)' : undefined }]}>
          <Ionicons name="mic" size={30} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={endCall} style={[styles.endCallButton, { boxShadow: Platform.OS === 'web' ? '0 2px 4px rgba(255,68,68,0.3)' : undefined }]}>
          <Ionicons name="call-end" size={30} color="#fff" />
        </TouchableOpacity>
      </View>
      {/* Partner Name */}
      <Text style={styles.partnerName}>{otherUserName}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  callingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  callingText: {
    color: '#fff',
    fontSize: 18,
    marginTop: 20,
  },
  endButton: {
    backgroundColor: '#ff4444',
    borderRadius: 50,
    padding: 20,
    marginTop: 30,
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
    marginTop: 100,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  controlButton: {
    backgroundColor: '#007AFF',
    borderRadius: 50,
    padding: 20,
    alignItems: 'center',
  },
  endCallButton: {
    backgroundColor: '#ff4444',
    borderRadius: 50,
    padding: 20,
    alignItems: 'center',
  },
  partnerName: {
    position: 'absolute',
    top: 50,
    left: 20,
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    zIndex: 1,
  },
});