/**
 * MetaHuman OS - React Native App
 *
 * This is a thin wrapper that:
 * 1. Starts nodejs-mobile-react-native backend (Node.js 18)
 * 2. Loads Svelte UI in WebView
 * 3. Bridges communication between WebView and Node.js
 * 4. Provides native speech-to-text via device's speech recognition
 *
 * The SAME @metahuman/core handlers run on mobile as on web.
 * No more separate code paths!
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { StyleSheet, View, ActivityIndicator, Text, Platform, Linking, PermissionsAndroid } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import nodejs from 'nodejs-mobile-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Voice, { SpeechResultsEvent, SpeechErrorEvent, SpeechStartEvent, SpeechEndEvent } from '@react-native-voice/voice';

interface NodeStatus {
  ready: boolean;
  httpPort: number | null;
  error: string | null;
}

interface SpeechState {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  hasPermission: boolean;
}

export default function App() {
  const webviewRef = useRef<WebView>(null);
  const [nodeStatus, setNodeStatus] = useState<NodeStatus>({
    ready: false,
    httpPort: null,
    error: null,
  });

  // Native speech recognition state
  const [speechState, setSpeechState] = useState<SpeechState>({
    isListening: false,
    transcript: '',
    interimTranscript: '',
    error: null,
    hasPermission: false,
  });

  // Request microphone permission (Android)
  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') {
      return true; // iOS handles permissions differently
    }

    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message: 'MetaHuman needs access to your microphone for voice input.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      const hasPermission = granted === PermissionsAndroid.RESULTS.GRANTED;
      setSpeechState(prev => ({ ...prev, hasPermission }));
      console.log('[App] Microphone permission:', hasPermission ? 'granted' : 'denied');
      return hasPermission;
    } catch (err) {
      console.error('[App] Permission request error:', err);
      return false;
    }
  }, []);

  // Request all app permissions at startup (storage for updates, etc.)
  const requestAllPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') {
      return;
    }

    try {
      // Request multiple permissions at once
      const permissions = [
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ];

      // Add storage permissions for older Android versions
      const androidVersion = Platform.Version;
      if (typeof androidVersion === 'number' && androidVersion < 33) {
        permissions.push(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
        if (androidVersion < 30) {
          permissions.push(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
        }
      }

      // For Android 13+, add media permissions
      if (typeof androidVersion === 'number' && androidVersion >= 33) {
        // These are typed as any because they're newer permissions
        const mediaPerms = [
          'android.permission.READ_MEDIA_IMAGES',
          'android.permission.READ_MEDIA_AUDIO',
          'android.permission.READ_MEDIA_VIDEO',
          'android.permission.POST_NOTIFICATIONS',
        ];
        // Note: requestMultiple only works with known permissions from PermissionsAndroid.PERMISSIONS
        // For newer permissions, they need to be declared in manifest and are auto-granted or require settings
      }

      console.log('[App] Requesting permissions:', permissions);
      const results = await PermissionsAndroid.requestMultiple(permissions);

      for (const [perm, result] of Object.entries(results)) {
        console.log(`[App] Permission ${perm}: ${result}`);
      }

      // Update speech permission state
      if (results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED) {
        setSpeechState(prev => ({ ...prev, hasPermission: true }));
      }
    } catch (err) {
      console.error('[App] Permission request error:', err);
    }
  }, []);

  // Send message to WebView
  const sendToWebView = useCallback((message: object) => {
    if (webviewRef.current) {
      webviewRef.current.postMessage(JSON.stringify(message));
    }
  }, []);

  // Voice event handlers
  const onSpeechStart = useCallback((e: SpeechStartEvent) => {
    console.log('[App] Speech started');
    setSpeechState(prev => ({ ...prev, isListening: true, error: null }));
    sendToWebView({ type: 'speech-start' });
  }, [sendToWebView]);

  const onSpeechEnd = useCallback((e: SpeechEndEvent) => {
    console.log('[App] Speech ended');
    setSpeechState(prev => ({ ...prev, isListening: false }));
    sendToWebView({ type: 'speech-end' });
  }, [sendToWebView]);

  const onSpeechResults = useCallback((e: SpeechResultsEvent) => {
    const transcript = e.value?.[0] || '';
    console.log('[App] Speech results:', transcript);
    setSpeechState(prev => ({ ...prev, transcript, interimTranscript: '' }));
    // Send final transcript to WebView
    sendToWebView({ type: 'speech-result', transcript, isFinal: true });
  }, [sendToWebView]);

  const onSpeechPartialResults = useCallback((e: SpeechResultsEvent) => {
    const interimTranscript = e.value?.[0] || '';
    console.log('[App] Partial results:', interimTranscript);
    setSpeechState(prev => ({ ...prev, interimTranscript }));
    // Send interim transcript to WebView for real-time display
    sendToWebView({ type: 'speech-result', transcript: interimTranscript, isFinal: false });
  }, [sendToWebView]);

  const onSpeechError = useCallback((e: SpeechErrorEvent) => {
    const errorMsg = e.error?.message || 'Speech recognition error';
    console.error('[App] Speech error:', errorMsg);
    setSpeechState(prev => ({ ...prev, isListening: false, error: errorMsg }));
    sendToWebView({ type: 'speech-error', error: errorMsg });
  }, [sendToWebView]);

  // Start speech recognition
  const startSpeechRecognition = useCallback(async () => {
    try {
      // Check/request permission first
      const hasPermission = await requestMicPermission();
      if (!hasPermission) {
        sendToWebView({ type: 'speech-error', error: 'Microphone permission denied' });
        return;
      }

      console.log('[App] Starting speech recognition...');
      setSpeechState(prev => ({ ...prev, transcript: '', interimTranscript: '', error: null }));

      await Voice.start('en-US');
    } catch (err) {
      console.error('[App] Failed to start speech recognition:', err);
      sendToWebView({ type: 'speech-error', error: (err as Error).message });
    }
  }, [requestMicPermission, sendToWebView]);

  // Stop speech recognition
  const stopSpeechRecognition = useCallback(async () => {
    try {
      console.log('[App] Stopping speech recognition...');
      await Voice.stop();
    } catch (err) {
      console.error('[App] Failed to stop speech recognition:', err);
    }
  }, []);

  // Cancel speech recognition (discard results)
  const cancelSpeechRecognition = useCallback(async () => {
    try {
      console.log('[App] Cancelling speech recognition...');
      await Voice.cancel();
      setSpeechState(prev => ({ ...prev, isListening: false, transcript: '', interimTranscript: '' }));
    } catch (err) {
      console.error('[App] Failed to cancel speech recognition:', err);
    }
  }, []);

  // Set up Voice event listeners and request permissions on startup
  useEffect(() => {
    Voice.onSpeechStart = onSpeechStart;
    Voice.onSpeechEnd = onSpeechEnd;
    Voice.onSpeechResults = onSpeechResults;
    Voice.onSpeechPartialResults = onSpeechPartialResults;
    Voice.onSpeechError = onSpeechError;

    // Request ALL permissions on startup (microphone, storage, etc.)
    // This makes the app ask for permissions like other official apps do
    requestAllPermissions();

    // Check if speech recognition is available
    Voice.isAvailable().then(available => {
      console.log('[App] Speech recognition available:', available);
    });

    return () => {
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, [onSpeechStart, onSpeechEnd, onSpeechResults, onSpeechPartialResults, onSpeechError, requestAllPermissions]);

  useEffect(() => {
    // Listen for messages from Node.js backend
    nodejs.channel.addListener('message', (msg: any) => {
      console.log('[App] Message from Node.js:', JSON.stringify(msg).substring(0, 200));

      if (msg.type === 'ready') {
        console.log('[App] Node.js backend ready');
        setNodeStatus(prev => ({ ...prev, ready: true }));
      } else if (msg.type === 'http-ready') {
        console.log('[App] HTTP server ready on port:', msg.port);
        setNodeStatus(prev => ({ ...prev, httpPort: msg.port }));
      } else if (msg.type === 'error') {
        console.error('[App] Node.js error:', msg.error);
        setNodeStatus(prev => ({ ...prev, error: msg.error }));
      }

      // Forward other messages to WebView if needed
      if (webviewRef.current && msg.type !== 'ready' && msg.type !== 'http-ready') {
        webviewRef.current.postMessage(JSON.stringify(msg));
      }
    });

    // Start Node.js backend
    console.log('[App] Starting Node.js backend...');
    nodejs.start('main.js');

    return () => {
      // Some versions of nodejs-mobile-react-native might not have removeListener
      if (typeof nodejs.channel.removeListener === 'function') {
        nodejs.channel.removeListener('message', () => {});
      }
    };
  }, []);

  // Handle messages from WebView
  const handleWebViewMessage = async (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('[App] Message from WebView:', JSON.stringify(data).substring(0, 200));

      // Handle native speech recognition requests
      if (data.type === 'speech-start') {
        console.log('[App] WebView requested speech start');
        await startSpeechRecognition();
        return;
      }

      if (data.type === 'speech-stop') {
        console.log('[App] WebView requested speech stop');
        await stopSpeechRecognition();
        return;
      }

      if (data.type === 'speech-cancel') {
        console.log('[App] WebView requested speech cancel');
        await cancelSpeechRecognition();
        return;
      }

      // Query if native speech is available
      if (data.type === 'speech-check') {
        const available = await Voice.isAvailable();
        sendToWebView({
          type: 'speech-available',
          available: !!available,
          platform: Platform.OS,
        });
        return;
      }

      // Handle URL opening (for APK downloads, etc.)
      if (data.type === 'open-url' && data.url) {
        console.log('[App] Opening URL:', data.url);

        // Check if this is an APK download
        const isApk = data.url.toLowerCase().endsWith('.apk');
        if (isApk) {
          console.log('[App] APK download detected - opening download URL');
          // Note: For APK installation, user needs to enable "Install unknown apps" for the browser/app
          // Settings > Apps > [Browser] > Install unknown apps > Allow
        }

        try {
          const supported = await Linking.canOpenURL(data.url);
          if (supported) {
            await Linking.openURL(data.url);
            console.log('[App] URL opened successfully');
            sendToWebView({
              type: 'url-opened',
              url: data.url,
              success: true,
              isApk,
              message: isApk
                ? 'Download started. After download completes, tap the notification to install. ' +
                  'If installation is blocked, go to Settings > Apps > MetaHuman OS > Install unknown apps > Allow'
                : undefined,
            });
          } else {
            console.error('[App] Cannot open URL (not supported):', data.url);
            sendToWebView({
              type: 'url-opened',
              url: data.url,
              success: false,
              error: 'URL not supported by this device. Try copying the URL manually.',
            });
          }
        } catch (err) {
          console.error('[App] Failed to open URL:', err);
          sendToWebView({
            type: 'url-opened',
            url: data.url,
            success: false,
            error: (err as Error).message,
          });
        }
        return;
      }

      // Open app settings (for enabling "Install unknown apps")
      if (data.type === 'open-app-settings') {
        console.log('[App] Opening app settings');
        try {
          await Linking.openSettings();
          sendToWebView({ type: 'settings-opened', success: true });
        } catch (err) {
          console.error('[App] Failed to open settings:', err);
          sendToWebView({ type: 'settings-opened', success: false, error: (err as Error).message });
        }
        return;
      }

      // Forward to Node.js if needed (most communication goes via HTTP)
      if (data.type === 'agent-init' || data.type === 'agent-stop') {
        nodejs.channel.send(data);
      }
    } catch (e) {
      console.error('[App] Failed to parse WebView message:', e);
    }
  };

  // Show loading screen until Node.js HTTP server is ready
  if (!nodeStatus.httpPort) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#10b981" />
          <Text style={styles.loadingText}>
            {nodeStatus.error
              ? `Error: ${nodeStatus.error}`
              : nodeStatus.ready
                ? 'Starting HTTP server...'
                : 'Starting Node.js backend...'}
          </Text>
          <Text style={styles.loadingSubtext}>
            Node.js 18 with native fetch
          </Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // WebView loads from local Node.js HTTP server
  // This is the UNIFIED ARCHITECTURE - same as web:
  // - Node.js serves static UI files AND handles API routes
  // - WebView makes HTTP requests to localhost:4322
  // - Cookies, sessions, auth all work identically to web
  const webViewSource = { uri: `http://127.0.0.1:${nodeStatus.httpPort}` };

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <WebView
          ref={webviewRef}
          source={webViewSource}
          key={`webview-${nodeStatus.httpPort}`}
          style={styles.webview}
          onMessage={handleWebViewMessage}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.error('[App] WebView error:', JSON.stringify(nativeEvent));
          }}
          onHttpError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.error('[App] WebView HTTP error:', nativeEvent.statusCode);
          }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          allowFileAccess={true}
          allowFileAccessFromFileURLs={true}
          allowUniversalAccessFromFileURLs={true}
          mixedContentMode="always"
          originWhitelist={['*']}
          // Allow loading local files and making HTTP requests
          allowingReadAccessToURL={Platform.OS === 'ios' ? 'www/' : undefined}
        />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  webview: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#e5e5e5',
  },
  loadingSubtext: {
    marginTop: 8,
    fontSize: 12,
    color: '#737373',
  },
});
