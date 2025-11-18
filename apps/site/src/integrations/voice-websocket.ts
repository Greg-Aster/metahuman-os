/**
 * Astro Integration for Voice WebSocket
 * Adds WebSocket support to Astro dev/preview servers
 */

import type { AstroIntegration } from 'astro';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { isWebSocketUpgrade, acceptWebSocket } from '../lib/websocket.js';
import { handleVoiceStream } from '../lib/voice-stream-handler.js';
import { validateSession } from '@metahuman/core/sessions';
import { getUser } from '@metahuman/core/users';

export default function voiceWebSocketIntegration(): AstroIntegration {
  return {
    name: 'voice-websocket',
    hooks: {
      'astro:server:setup': ({ server }) => {
        console.log('[voice-websocket] Installing WebSocket handler...');

        // Hook into the HTTP server's upgrade event
        server.httpServer?.on('upgrade', (request: IncomingMessage, socket: Duplex, _head: Buffer) => {
          const url = new URL(request.url!, `http://${request.headers.host}`);

          // Only handle /voice-stream path
          if (url.pathname === '/voice-stream' && isWebSocketUpgrade(request)) {
            console.log('[voice-websocket] Accepting WebSocket connection');

            // Extract username and session cookie
            let username: string | undefined;
            let sessionCookie: string | undefined;
            const cookieHeader = request.headers.cookie;
            if (cookieHeader) {
              const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
                const [key, value] = cookie.trim().split('=');
                acc[key] = value;
                return acc;
              }, {} as Record<string, string>);

              const sessionToken = cookies['mh_session'];
              if (sessionToken) {
                sessionCookie = `mh_session=${sessionToken}`;
                const session = validateSession(sessionToken);
                if (session && session.role !== 'anonymous') {
                  const user = getUser(session.userId);
                  if (user) {
                    username = user.username;
                    console.log('[voice-websocket] User authenticated:', username);
                  }
                }
              }
            }

            const ws = acceptWebSocket(socket, request);
            handleVoiceStream(ws, username, sessionCookie).catch((error) => {
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
