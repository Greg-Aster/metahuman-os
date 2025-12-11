/**
 * Global Astro Middleware
 *
 * Automatically applies user context to ALL API routes
 * Also handles Big Brother auto-start on server boot
 */

import { defineMiddleware } from 'astro:middleware';
import { withUserContext as runWithUserContext } from '@metahuman/core/context';
import { validateSession } from '@metahuman/core/sessions';
import { getUser } from '@metahuman/core/users';

// ============================================================================
// Big Brother Auto-Start (runs once on module load = server start)
// ============================================================================
let bigBrotherInitialized = false;

async function initializeBigBrother(): Promise<void> {
  if (bigBrotherInitialized) return;
  bigBrotherInitialized = true;

  try {
    const { loadOperatorConfig } = await import('@metahuman/core/config');
    const config = loadOperatorConfig();
    const bigBrotherEnabled = config.bigBrotherMode?.enabled === true;

    if (bigBrotherEnabled) {
      console.log('[middleware] 🤖 Big Brother mode enabled - auto-starting Claude session...');

      const { startClaudeSession, isClaudeSessionReady } = await import('@metahuman/core/claude-session');

      if (!isClaudeSessionReady()) {
        const started = await startClaudeSession(true);
        if (started) {
          console.log('[middleware] ✅ Claude session started automatically');
          await spawnBigBrotherTerminal();
        } else {
          console.warn('[middleware] ⚠️ Failed to start Claude session - Claude CLI may not be installed');
        }
      } else {
        console.log('[middleware] ✅ Claude session already running');
      }
    }
  } catch (err) {
    console.error('[middleware] ⚠️ Failed to auto-start Big Brother mode:', err);
  }
}

async function spawnBigBrotherTerminal(): Promise<void> {
  try {
    const { spawn, execSync } = await import('child_process');
    const fs = await import('fs');
    const path = await import('path');

    const REPO_ROOT = process.cwd().includes('/apps/site')
      ? path.resolve(process.cwd(), '../..')
      : process.cwd();
    const LOG_DIR = path.join(REPO_ROOT, 'logs/run');
    const TTYD_BIN = path.join(REPO_ROOT, 'bin/ttyd');
    const CLAUDE_PORT = 3099;

    // Check if ttyd is already running on this port
    try {
      const result = execSync(`ss -tlnp 2>/dev/null | grep :${CLAUDE_PORT}`, { encoding: 'utf8' });
      if (result.includes('ttyd')) {
        console.log('[middleware] ✅ Big Brother terminal already running on port', CLAUDE_PORT);
        return;
      }
    } catch {
      // Port not in use, continue to spawn
    }

    // Ensure log directory exists
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    // Create/clear the session log file
    const sessionLogPath = path.join(LOG_DIR, 'big-brother-session.log');
    fs.writeFileSync(sessionLogPath, `
════════════════════════════════════════════════════════════════════════════════
🤖 BIG BROTHER MODE - Claude Code Session Log
════════════════════════════════════════════════════════════════════════════════
Started: ${new Date().toISOString()}

This terminal shows all Big Brother escalations in real-time.
When the operator gets stuck, it will send prompts to Claude Code for guidance.

Waiting for escalations...
════════════════════════════════════════════════════════════════════════════════

`);

    // Spawn ttyd (note: --title-format not supported in ttyd 1.7.x)
    const logFile = path.join(LOG_DIR, 'big-brother-terminal.log');
    const ttydProcess = spawn(TTYD_BIN, [
      '--port', CLAUDE_PORT.toString(),
      '--writable',
      '--cwd', REPO_ROOT,
      '/usr/bin/tail', '-f', sessionLogPath
    ], {
      detached: true,
      stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')]
    });

    ttydProcess.unref();

    // Save PID file
    const pidFile = path.join(LOG_DIR, 'big-brother-terminal.pid');
    fs.writeFileSync(pidFile, ttydProcess.pid!.toString());

    console.log('[middleware] ✅ Big Brother terminal spawned on port', CLAUDE_PORT);
  } catch (err) {
    console.error('[middleware] ⚠️ Failed to spawn Big Brother terminal:', err);
  }
}

// Initialize Big Brother on module load (server start)
initializeBigBrother();

// CORS headers for mobile app cross-origin requests
// When the mobile app loads from file:// and calls https://mh.dndiy.org/api/*
// IMPORTANT: Access-Control-Allow-Origin cannot be '*' when using credentials
// We must echo back the request's Origin header for credentials to work
function getCorsHeaders(origin: string | null): Record<string, string> {
  return {
    // Echo back origin (or use 'null' for file:// requests)
    // This is required when Access-Control-Allow-Credentials is true
    'Access-Control-Allow-Origin': origin || 'null',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cookie, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function addCorsHeaders(response: Response, origin: string | null): Response {
  const corsHeaders = getCorsHeaders(origin);
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Only apply to API routes
  if (!context.url.pathname.startsWith('/api/')) {
    return next();
  }

  // Get Origin header for CORS (mobile app sends 'null' from file://)
  const origin = context.request.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight (OPTIONS) requests
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Error handling wrapper for auth errors
  try {
    const response = await processRequest(context, next);
    // Add CORS headers to all API responses
    return addCorsHeaders(response, origin);
  } catch (error) {
    // Convert auth errors to proper HTTP responses
    const errorMessage = (error as Error).message;

    if (errorMessage.startsWith('UNAUTHORIZED:')) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          message: errorMessage.replace('UNAUTHORIZED: ', '')
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        }
      );
    }

    if (errorMessage.startsWith('FORBIDDEN:')) {
      return new Response(
        JSON.stringify({
          error: 'Forbidden',
          message: errorMessage.replace('FORBIDDEN: ', '')
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        }
      );
    }

    // Re-throw other errors
    throw error;
  }
});

async function processRequest(context: any, next: any) {

  // Try to get session cookie
  const sessionCookie = context.cookies.get('mh_session');

  if (sessionCookie) {
    // Validate session
    const session = validateSession(sessionCookie.value);

    if (session) {
      // Handle anonymous sessions
      if (session.role === 'anonymous') {
        // All anonymous users use the 'guest' profile
        const activeProfile = session.metadata?.activeProfile || undefined;

        // Set anonymous context in locals
        context.locals.userContext = {
          userId: 'anonymous',
          username: 'anonymous', // Always 'anonymous' for anonymous users
          role: 'anonymous',
          activeProfile: activeProfile, // The selected profile ('guest')
        };

        // Run request with anonymous user context
        return await runWithUserContext(
          {
            userId: 'anonymous',
            username: 'anonymous', // Always 'anonymous' for anonymous users
            role: 'anonymous',
            activeProfile, // The selected profile ('guest')
          },
          () => next()
        );
      }

      // Get CURRENT user details from database (not cached in session)
      // This ensures role changes are immediately reflected
      const user = getUser(session.userId);

      if (user) {
        // Set user context in locals for API routes to access
        context.locals.userContext = {
          userId: user.id,
          username: user.username,
          role: user.role,
        };

        // Run request with authenticated user context
        return await runWithUserContext(
          { userId: user.id, username: user.username, role: user.role },
          () => next()
        );
      }
    }
  }

  // SECURITY: No session - run with anonymous context
  // NOTE: Dev auto-login removed for security (2025-11-20)
  // Use scripts/dev-session.ts to create auth session in development
  // Set anonymous context in locals
  context.locals.userContext = {
    userId: 'anonymous',
    username: 'anonymous',
    role: 'anonymous',
  };

  // This prevents fallback to root paths and protects owner data
  return await runWithUserContext(
    { userId: 'anonymous', username: 'anonymous', role: 'anonymous' },
    () => next()
  );
}
