import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  Button,
  Alert,
  Platform,
  StyleSheet,
  Dimensions,
} from 'react-native';

// NO direct import here - causes web crash. Use conditional below.

// Enhanced: WebRTC with full mock on web (prevents crashes)
let RTCIceCandidate: any = null;
let RTCSessionDescription: any = null;
let mediaDevices: any = null;
let RTCView: any = null;
let RTCPeerConnection: any = null;

if (Platform.OS !== 'web') {
  // Mobile only: Require react-native-webrtc
  try {
    const webrtc = require('react-native-webrtc');
    RTCIceCandidate = webrtc.RTCIceCandidate;
    RTCSessionDescription = webrtc.RTCSessionDescription;
    mediaDevices = webrtc.mediaDevices;
    RTCView = webrtc.RTCView;
    RTCPeerConnection = webrtc.RTCPeerConnection;
    console.log('Mobile WebRTC loaded successfully');
  } catch (err) {
    console.error('Failed to load react-native-webrtc on mobile:', err);
  }
} else {
  // Web: Use browser globals (mock to avoid errors)
  RTCIceCandidate = (window as any).RTCIceCandidate;
  RTCSessionDescription = (window as any).RTCSessionDescription;
  mediaDevices = navigator.mediaDevices;
  RTCView = null;  // Don't use RTCView on web - use <video> instead
  RTCPeerConnection = (window as any).RTCPeerConnection || (window as any).webkitRTCPeerConnection;
  console.log('Web WebRTC APIs detected');
}

export default function TestCall() {
  const [localStream, setLocalStream] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);
  const rtcViewRef = useRef<any>(null);  // For mobile RTCView

  const testMedia = async () => {
    setIsTesting(true);
    try {
      console.log('Starting media test on', Platform.OS);
      if (!mediaDevices) {
        throw new Error('WebRTC mediaDevices not available. Check browser (web) or dev build (mobile).');
      }
      let stream: any = null;

      if (Platform.OS === 'web') {
        // Web: Native browser getUserMedia
        console.log('Web: Requesting media permissions...');
        stream = await mediaDevices.getUserMedia({
          audio: true,
          video: { 
            facingMode: 'user', 
            width: { ideal: 640 }, 
            height: { ideal: 480 } 
          }
        });
        console.log('Web stream acquired:', stream.getTracks().length, 'tracks');

        // Temp video for preview (overlay)
        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;  // Mute local echo
        video.style.position = 'fixed';
        video.style.top = '10px';
        video.style.right = '10px';
        video.style.width = '200px';
        video.style.height = '150px';
        video.style.border = '2px solid #fff';
        video.style.borderRadius = '10px';
        video.style.zIndex = '9999';
        video.style.backgroundColor = '#000';
        document.body.appendChild(video);
        video.play().catch(e => console.warn('Web video play failed:', e));

      } else {
        // Mobile: react-native-webrtc getUserMedia
        console.log('Mobile: Requesting media permissions...');
        stream = await mediaDevices.getUserMedia({
          audio: true,
          video: { 
            facingMode: 'front', 
            width: { ideal: 640 }, 
            height: { ideal: 480 } 
          }
        });
        console.log('Mobile stream acquired:', stream.getTracks().length, 'tracks');

        // Show in RTCView (mobile preview)
        setLocalStream(stream);
      }

      setLocalStream(stream);
      Alert.alert(
        'Success!', 
        `Stream active on ${Platform.OS}!\nTracks: ${stream.getTracks().length} (Audio: ${stream.getAudioTracks().length}, Video: ${stream.getVideoTracks().length})\nCheck console/video preview.`
      );
      
    } catch (err: any) {
      console.error(`${Platform.OS} media test failed:`, err.name, err.message, err);
      let errorMsg = `${Platform.OS} Test Failed: ${err.message}`;
      if (err.name === 'NotAllowedError') {
        errorMsg += '\n\nPermissions denied. Enable camera/mic in settings.';
      } else if (err.name === 'NotFoundError') {
        errorMsg += '\n\nNo camera/mic found on device.';
      } else if (Platform.OS === 'web' && err.name === 'NotSupportedError') {
        errorMsg += '\n\nWebRTC requires HTTPS. Use ngrok or production host.';
      }
      Alert.alert('Error', errorMsg);
    } finally {
      setIsTesting(false);
    }
  };

  const stopTest = () => {
    if (localStream) {
      localStream.getTracks().forEach((track: any) => {
        track.stop();
        console.log('Stopped track:', track.kind);
      });
      setLocalStream(null);
      console.log('Stream stopped');
    }
    // Web: Remove temp video
    if (Platform.OS === 'web') {
      const video = document.querySelector('video[style*="fixed"]') as HTMLVideoElement;
      if (video) {
        video.srcObject = null;
        video.remove();
        console.log('Web video overlay removed');
      }
    }
    Alert.alert('Stopped', 'Media test ended. All tracks released.');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>WebRTC Media Test</Text>
      <Text style={styles.subtitle}>
        Platform: {Platform.OS}
        {'\n'}
        WebRTC Loaded: {mediaDevices ? '✅ Yes' : '❌ No'}
        {'\n'}
        Stream: {localStream ? `✅ Active (${localStream.getTracks().length} tracks)` : 'Not started'}
      </Text>

      {!localStream ? (
        <Button 
          title={isTesting ? "Testing..." : "Start Camera/Mic Test"} 
          onPress={testMedia} 
          disabled={isTesting || !mediaDevices} 
        />
      ) : (
        <Button title="Stop Test" onPress={stopTest} color="#ff6b6b" />
      )}

      {/* Mobile Preview (RTCView only on mobile) */}
      {Platform.OS !== 'web' && localStream && RTCView && (
        <RTCView
          ref={rtcViewRef}
          streamURL={localStream.toURL()}
          style={styles.videoPreview}
          objectFit="cover"
          mirror={true}  // Flip for front camera
          zOrder={1}  // Ensure on top
        />
      )}

      <Text style={styles.instructions}>
        {'\n'}Instructions:
        {'\n'}- Web: Allow permissions → Small video overlay (top-right).
        {'\n'}- Mobile: Use DEV BUILD (not Expo Go) → Grant permissions → Full preview below.
        {'\n'}- Console: Open DevTools (web) or shake device (mobile) for logs.
        {'\n'}- Errors? Check HTTPS (web), permissions, or rebuild (mobile).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f0f0f0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    color: '#666',
    lineHeight: 20,
  },
  videoPreview: {
    width: Dimensions.get('window').width - 40,
    height: 200,
    borderRadius: 10,
    marginVertical: 20,
    backgroundColor: '#000',
  },
  instructions: {
    fontSize: 12,
    textAlign: 'center',
    color: '#999',
    lineHeight: 18,
    paddingHorizontal: 10,
  },
});