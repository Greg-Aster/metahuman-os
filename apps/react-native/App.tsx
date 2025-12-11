/**
 * MetaHuman OS - React Native App
 *
 * This is a thin wrapper that:
 * 1. Starts nodejs-mobile-react-native backend (Node.js 18)
 * 2. Loads Svelte UI in WebView
 * 3. Bridges communication between WebView and Node.js
 *
 * The SAME @metahuman/core handlers run on mobile as on web.
 * No more separate code paths!
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, ActivityIndicator, Text, Platform } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import nodejs from 'nodejs-mobile-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

interface NodeStatus {
  ready: boolean;
  httpPort: number | null;
  error: string | null;
}

export default function App() {
  const webviewRef = useRef<WebView>(null);
  const [nodeStatus, setNodeStatus] = useState<NodeStatus>({
    ready: false,
    httpPort: null,
    error: null,
  });

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
  const handleWebViewMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('[App] Message from WebView:', JSON.stringify(data).substring(0, 200));

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
