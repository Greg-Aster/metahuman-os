/**
 * Voice WebSocket Middleware for Astro
 * Intercepts upgrade requests and handles WebSocket connections
 */

import type { MiddlewareHandler } from 'astro';
import { isWebSocketUpgrade, acceptWebSocket } from '../lib/websocket.js';
import { handleVoiceStream } from '../lib/voice-stream-handler.js';

/**
 * Astro middleware to handle WebSocket upgrades
 */
export const onRequest: MiddlewareHandler = async ({ request, locals }, next) => {
  const url = new URL(request.url);

  // Check if this is a WebSocket upgrade request for voice streaming
  if (url.pathname === '/voice-stream') {
    // Note: Astro doesn't expose the raw socket directly in middleware
    // We'll handle this via a custom server integration instead
    // This middleware is here as a placeholder and documentation
    console.log('[voice-websocket] WebSocket upgrade detected, but needs custom server');
  }

  return next();
};
