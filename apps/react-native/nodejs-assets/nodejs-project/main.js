/**
 * MetaHuman Mobile - Node.js Backend (React Native)
 *
 * This runs inside the Android/iOS app via nodejs-mobile-react-native.
 * NODE.JS 18 - No polyfills needed!
 *
 * Key benefits over Capacitor version:
 * - Native fetch() (no polyfills)
 * - Native AbortController
 * - Native crypto.randomUUID()
 * - Native fs/promises
 *
 * UNIFIED ARCHITECTURE:
 * Mobile runs an HTTP server on localhost, WebView makes fetch() requests.
 * This means cookies work identically to web - SAME CODE FOR BOTH.
 */

const rn_bridge = require('rn-bridge');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

// Get the app's data directory for file storage
const dataDir = rn_bridge.app.datadir();

console.log('[Node.js] Starting MetaHuman Mobile backend (React Native)');
console.log('[Node.js] Node version:', process.version);
console.log('[Node.js] Data directory:', dataDir);
console.log('[Node.js] Has native fetch:', typeof fetch !== 'undefined');
console.log('[Node.js] Has native AbortController:', typeof AbortController !== 'undefined');
console.log('[Node.js] Has native crypto.randomUUID:', typeof randomUUID === 'function');

// Set up environment for the handlers
process.env.METAHUMAN_MOBILE = 'true';
process.env.METAHUMAN_DATA_DIR = dataDir;
process.env.METAHUMAN_ROOT = dataDir;

// ============================================================================
// COPY BUNDLED CONFIG FILES TO DATA DIRECTORY
// On first run (or when configs are missing), copy bundled files from assets
// ============================================================================
function copyBundledConfigs() {
  const bundledEtc = path.join(__dirname, 'etc');
  const dataEtc = path.join(dataDir, 'etc');

  console.log('[Node.js] Looking for bundled etc at:', bundledEtc);

  if (!fs.existsSync(bundledEtc)) {
    console.log('[Node.js] No bundled etc/ directory found');
    return;
  }

  // Create target directories
  const cognitiveGraphsDir = path.join(dataEtc, 'cognitive-graphs');
  const customGraphsDir = path.join(cognitiveGraphsDir, 'custom');

  try {
    fs.mkdirSync(cognitiveGraphsDir, { recursive: true });
    fs.mkdirSync(customGraphsDir, { recursive: true });
  } catch (e) {
    console.error('[Node.js] Failed to create etc directories:', e.message);
  }

  // Copy cognitive graphs (always overwrite to get latest)
  const bundledGraphs = path.join(bundledEtc, 'cognitive-graphs');
  if (fs.existsSync(bundledGraphs)) {
    try {
      const files = fs.readdirSync(bundledGraphs);
      for (const file of files) {
        const src = path.join(bundledGraphs, file);
        const stat = fs.statSync(src);
        if (stat.isFile() && file.endsWith('.json')) {
          const dst = path.join(cognitiveGraphsDir, file);
          fs.copyFileSync(src, dst);
          console.log('[Node.js] Copied cognitive graph:', file);
        }
      }
    } catch (e) {
      console.error('[Node.js] Failed to copy cognitive graphs:', e.message);
    }
  }

  // Copy custom graphs if they exist
  const bundledCustom = path.join(bundledGraphs, 'custom');
  if (fs.existsSync(bundledCustom)) {
    try {
      const files = fs.readdirSync(bundledCustom);
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.copyFileSync(
            path.join(bundledCustom, file),
            path.join(customGraphsDir, file)
          );
          console.log('[Node.js] Copied custom graph:', file);
        }
      }
    } catch (e) {
      console.error('[Node.js] Failed to copy custom graphs:', e.message);
    }
  }

  // Copy essential config files (only if they don't exist to preserve user changes)
  const configFiles = ['models.json', 'agents.json', 'llm-backend.json'];
  for (const file of configFiles) {
    const src = path.join(bundledEtc, file);
    const dst = path.join(dataEtc, file);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      try {
        fs.copyFileSync(src, dst);
        console.log('[Node.js] Copied config:', file);
      } catch (e) {
        console.error('[Node.js] Failed to copy', file + ':', e.message);
      }
    }
  }

  console.log('[Node.js] Config files initialized');
}

// Run config copy before loading handlers
copyBundledConfigs();

// ============================================================================
// LOAD UNIFIED HTTP ADAPTER - SAME CODE AS WEB
// ============================================================================
let handleHttpRequest = null;
let initializeMobileAgents = null;
let stopMobileAgents = null;
let handlersLoaded = false;
let agentsInitialized = false;

try {
  // Load unified HTTP adapter - SAME CODE AS WEB SERVER
  const httpAdapter = require('./dist/http-adapter.js');
  handleHttpRequest = httpAdapter.handleHttpRequest;

  // Also load agent management
  const handlers = require('./dist/handlers.js');
  initializeMobileAgents = handlers.initializeMobileAgents;
  stopMobileAgents = handlers.stopMobileAgents;

  handlersLoaded = true;
  console.log('[Node.js] Unified HTTP adapter loaded - SAME CODE AS WEB');
} catch (error) {
  console.error('[Node.js] Failed to load unified HTTP adapter:', error.message);
  console.log('[Node.js] Falling back to stub handlers');
}

// =============================================================================
// HTTP SERVER - Unified server serving BOTH static UI AND API routes
// Same architecture as web: one server serves everything
// =============================================================================

const HTTP_PORT = 4322;
let httpServer = null;

// Static files directory - bundled UI assets
const STATIC_DIR = path.join(__dirname, 'www');

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

// Parse JSON body from request
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (!body) return resolve(undefined);
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve(body);
      }
    });
    req.on('error', reject);
  });
}

// Serve static file
function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }

    const content = fs.readFileSync(filePath);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.writeHead(200);
    res.end(content);
    return true;
  } catch (error) {
    console.error('[Static] Error serving file:', filePath, error.message);
    return false;
  }
}

// Create HTTP server
function startHttpServer() {
  // Check if static directory exists
  if (fs.existsSync(STATIC_DIR)) {
    console.log('[Node.js] Static files directory:', STATIC_DIR);
    const files = fs.readdirSync(STATIC_DIR);
    console.log('[Node.js] Static files found:', files.length);
  } else {
    console.warn('[Node.js] Static directory not found:', STATIC_DIR);
  }

  httpServer = http.createServer(async (req, res) => {
    // Enable CORS for all requests
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);
    const pathname = url.pathname;

    // Route: /api/* -> API handlers (unified codebase)
    if (pathname.startsWith('/api/')) {
      const body = await parseBody(req);
      console.log('[API]', req.method, pathname);

      try {
        if (handlersLoaded && handleHttpRequest) {
          // Use unified HTTP adapter - SAME CODE AS WEB
          const result = await handleHttpRequest({
            path: pathname,
            method: req.method,
            body,
            query: Object.fromEntries(url.searchParams),
            headers: req.headers,
            cookieHeader: req.headers.cookie,
          });

          // Set response cookies
          if (result.cookies && result.cookies.length > 0) {
            res.setHeader('Set-Cookie', result.cookies);
          }

          // Set response headers
          for (const [key, value] of Object.entries(result.headers)) {
            res.setHeader(key, value);
          }

          // Handle streaming responses (SSE)
          if (result.isStreaming && result.stream) {
            console.log('[API] Streaming response for:', pathname);
            res.writeHead(result.status);
            try {
              let chunkCount = 0;
              for await (const chunk of result.stream) {
                chunkCount++;
                res.write(chunk);
              }
              console.log('[API] Stream complete, chunks:', chunkCount);
            } catch (streamError) {
              console.error('[API] Stream error:', streamError);
            } finally {
              res.end();
            }
          } else {
            res.writeHead(result.status);
            res.end(result.body);
          }
        } else {
          // Fallback to stub handlers
          const body = await parseBody(req);
          const stubResponse = await handleRequestStub({
            id: 'stub',
            path: pathname,
            method: req.method,
            body,
          });

          res.setHeader('Content-Type', 'application/json');
          res.writeHead(stubResponse.status || 200);
          res.end(JSON.stringify(stubResponse.data || { error: stubResponse.error }));
        }
      } catch (error) {
        console.error('[API] Handler error:', error);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    // Route: Static files (UI)
    // Map URL path to file path
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(STATIC_DIR, filePath);

    // Security: Prevent directory traversal
    if (!filePath.startsWith(STATIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Try to serve the file
    if (serveStaticFile(res, filePath)) {
      return;
    }

    // If file not found, serve index.html for SPA routing
    const indexPath = path.join(STATIC_DIR, 'index.html');
    if (serveStaticFile(res, indexPath)) {
      return;
    }

    // Nothing found
    res.writeHead(404);
    res.end('Not Found');
  });

  httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`[Node.js] HTTP server listening on http://127.0.0.1:${HTTP_PORT}`);
    console.log('[Node.js] Serving: Static UI + API routes (unified architecture)');
    // Notify React Native that HTTP server is ready
    rn_bridge.channel.send({ type: 'http-ready', port: HTTP_PORT });
  });

  httpServer.on('error', (err) => {
    console.error('[Node.js] HTTP server error:', err);
    rn_bridge.channel.send({ type: 'error', error: err.message });
  });
}

// Start HTTP server
startHttpServer();

// Stub handlers (fallback when bundled handlers fail to load)
async function handleRequestStub(request) {
  const { id, path, method, body } = request;

  if (path === '/api/status') {
    return {
      id,
      status: 200,
      data: {
        status: 'ok',
        runtime: 'nodejs-mobile-react-native',
        nodeVersion: process.version,
        dataDir,
        handlersLoaded,
        features: {
          nativeFetch: typeof fetch !== 'undefined',
          nativeAbortController: typeof AbortController !== 'undefined',
          nativeRandomUUID: typeof randomUUID === 'function',
        }
      }
    };
  }

  if (path === '/api/boot') {
    return {
      id,
      status: 200,
      data: {
        authenticated: false,
        version: '1.0.0-react-native',
        runtime: 'nodejs-mobile-react-native',
        nodeVersion: process.version,
        handlersLoaded,
        features: {
          localAgents: false,
          localStorage: true,
          llmBridge: false,
          nativeFetch: true,
        }
      }
    };
  }

  // Profile management endpoints
  if (path === '/api/profiles' && method === 'GET') {
    return {
      id,
      status: 200,
      data: { profiles: listProfiles() }
    };
  }

  if (path === '/api/profiles' && method === 'POST') {
    const username = body && body.username;
    if (!username) {
      return { id, status: 400, error: 'Username required' };
    }
    const result = initializeProfile(username);
    return {
      id,
      status: result.success ? 200 : 500,
      data: result.success ? { profileRoot: result.profileRoot } : undefined,
      error: result.success ? undefined : result.error
    };
  }

  return {
    id,
    status: 404,
    error: `Stub handler: route not found: ${method} ${path}`
  };
}

// Initialize system directories
function initializeSystemDirs() {
  try {
    const systemDirs = [
      path.join(dataDir, 'profiles'),
      path.join(dataDir, 'etc'),
      path.join(dataDir, 'logs'),
      path.join(dataDir, 'logs', 'audit'),
      path.join(dataDir, 'logs', 'run'),
    ];

    for (const dir of systemDirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log('[Node.js] Created system dir:', dir);
      }
    }

    console.log('[Node.js] System directories initialized');
    return true;
  } catch (error) {
    console.error('[Node.js] Failed to initialize system dirs:', error);
    return false;
  }
}

// Initialize a user profile with full directory structure
function initializeProfile(username) {
  const profileRoot = path.join(dataDir, 'profiles', username);

  try {
    const profileDirs = [
      path.join(profileRoot, 'persona'),
      path.join(profileRoot, 'persona', 'desires', 'nascent'),
      path.join(profileRoot, 'persona', 'desires', 'pending'),
      path.join(profileRoot, 'persona', 'desires', 'active'),
      path.join(profileRoot, 'persona', 'desires', 'completed'),
      path.join(profileRoot, 'persona', 'desires', 'rejected'),
      path.join(profileRoot, 'persona', 'desires', 'abandoned'),
      path.join(profileRoot, 'memory', 'episodic'),
      path.join(profileRoot, 'memory', 'inbox'),
      path.join(profileRoot, 'memory', 'index'),
      path.join(profileRoot, 'memory', 'tasks', 'active'),
      path.join(profileRoot, 'memory', 'tasks', 'completed'),
      path.join(profileRoot, 'memory', 'tasks', 'projects'),
      path.join(profileRoot, 'etc'),
      path.join(profileRoot, 'state'),
      path.join(profileRoot, 'state', 'agency'),
      path.join(profileRoot, 'out'),
      path.join(profileRoot, 'out', 'adapters'),
    ];

    for (const dir of profileDirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Create default persona files if they don't exist
    const personaCore = path.join(profileRoot, 'persona', 'core.json');
    if (!fs.existsSync(personaCore)) {
      const defaultPersona = {
        name: username,
        created: new Date().toISOString(),
        traits: [],
        values: [],
        voice: { style: 'conversational' }
      };
      fs.writeFileSync(personaCore, JSON.stringify(defaultPersona, null, 2));
    }

    console.log('[Node.js] Profile initialized:', username);
    return { success: true, profileRoot };
  } catch (error) {
    console.error('[Node.js] Failed to initialize profile:', error);
    return { success: false, error: error.message };
  }
}

// Get list of existing profiles
function listProfiles() {
  const profilesDir = path.join(dataDir, 'profiles');
  try {
    if (!fs.existsSync(profilesDir)) {
      return [];
    }
    return fs.readdirSync(profilesDir).filter(name => {
      const profilePath = path.join(profilesDir, name);
      return fs.statSync(profilePath).isDirectory();
    });
  } catch (error) {
    console.error('[Node.js] Failed to list profiles:', error);
    return [];
  }
}

// Initialize on startup
const systemInitialized = initializeSystemDirs();

// Current active user for agents
let currentUsername = null;

// Handle agent initialization when user logs in
rn_bridge.channel.on('message', (msg) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'agent-init') {
    const username = msg.username;
    console.log('[Node.js] Agent init request for user:', username);

    if (!handlersLoaded || !initializeMobileAgents) {
      console.log('[Node.js] Handlers not loaded, skipping agent init');
      rn_bridge.channel.send({
        type: 'agent-status',
        status: 'error',
        error: 'Handlers not loaded'
      });
      return;
    }

    try {
      // Stop existing agents if running
      if (agentsInitialized && stopMobileAgents) {
        console.log('[Node.js] Stopping existing agents');
        stopMobileAgents();
      }

      // Initialize agents for new user
      if (username) {
        currentUsername = username;
        initializeMobileAgents(dataDir, username);
        agentsInitialized = true;
        console.log('[Node.js] Agents initialized for:', username);
        rn_bridge.channel.send({
          type: 'agent-status',
          status: 'ok',
          username,
          agentsRunning: true
        });
      } else {
        agentsInitialized = false;
        rn_bridge.channel.send({
          type: 'agent-status',
          status: 'ok',
          agentsRunning: false
        });
      }
    } catch (error) {
      console.error('[Node.js] Agent initialization failed:', error);
      rn_bridge.channel.send({
        type: 'agent-status',
        status: 'error',
        error: error.message
      });
    }
  } else if (msg.type === 'agent-stop') {
    console.log('[Node.js] Agent stop request');

    if (agentsInitialized && stopMobileAgents) {
      try {
        stopMobileAgents();
        agentsInitialized = false;
        currentUsername = null;
        console.log('[Node.js] Agents stopped');
        rn_bridge.channel.send({
          type: 'agent-status',
          status: 'ok',
          agentsRunning: false
        });
      } catch (error) {
        console.error('[Node.js] Agent stop failed:', error);
        rn_bridge.channel.send({
          type: 'agent-status',
          status: 'error',
          error: error.message
        });
      }
    }
  }
});

// Handle app lifecycle events
rn_bridge.app.on('pause', (pauseLock) => {
  console.log('[Node.js] App paused');

  // Stop agents on pause to save battery
  if (agentsInitialized && stopMobileAgents) {
    try {
      stopMobileAgents();
      console.log('[Node.js] Agents paused');
    } catch (error) {
      console.error('[Node.js] Failed to pause agents:', error);
    }
  }

  pauseLock.release();
});

rn_bridge.app.on('resume', () => {
  console.log('[Node.js] App resumed');

  // Restart agents on resume if we had a user
  if (currentUsername && handlersLoaded && initializeMobileAgents) {
    try {
      initializeMobileAgents(dataDir, currentUsername);
      agentsInitialized = true;
      console.log('[Node.js] Agents resumed for:', currentUsername);
    } catch (error) {
      console.error('[Node.js] Failed to resume agents:', error);
    }
  }
});

// Notify React Native that Node.js is ready
rn_bridge.channel.send({
  type: 'ready',
  status: 'ok',
  dataDir,
  version: process.version,
  handlersLoaded,
  systemInitialized,
  agentsAvailable: handlersLoaded && initializeMobileAgents !== null,
  profiles: listProfiles(),
  features: {
    nativeFetch: typeof fetch !== 'undefined',
    nativeAbortController: typeof AbortController !== 'undefined',
    nativeRandomUUID: typeof randomUUID === 'function',
  }
});

console.log('[Node.js] Backend ready (React Native), waiting for requests...');
console.log('[Node.js] Native APIs available: fetch, AbortController, crypto.randomUUID, fs/promises');
