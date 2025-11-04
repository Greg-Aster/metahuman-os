/**
 * Astro Integration for Voice WebSocket
 * Adds WebSocket support to Astro dev/preview servers
 */

import type { AstroIntegration } from 'astro';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { isWebSocketUpgrade, acceptWebSocket } from '../lib/websocket.js';
import { handleVoiceStream } from '../lib/voice-stream-handler.js';

export default function voiceWebSocketIntegration(): AstroIntegration {
  return {
    name: 'voice-websocket',
    hooks: {
      'astro:server:setup': ({ server }) => {
        console.log('[voice-websocket] Installing WebSocket handler...');

        // Hook into the HTTP server's upgrade event
        server.httpServer?.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
          const url = new URL(request.url!, `http://${request.headers.host}`);

          // Only handle /voice-stream path
          if (url.pathname === '/voice-stream' && isWebSocketUpgrade(request)) {
            console.log('[voice-websocket] Accepting WebSocket connection');

            const ws = acceptWebSocket(socket, request);
            handleVoiceStream(ws).catch((error) => {
              console.error('[voice-websocket] Handler error:', error);
              ws.close();
            });
          }
        });

        console.log('[voice-websocket] WebSocket handler installed at /voice-stream');
      },
    },
  };
}
