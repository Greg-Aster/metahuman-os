/**
 * MetaHuman Mobile - Node.js Backend
 *
 * This runs inside the Android app via nodejs-mobile.
 * It handles:
 * - API requests from the UI (via HTTP server - SAME AS WEB)
 * - Agent execution
 * - Local file storage
 * - LLM routing
 *
 * UNIFIED ARCHITECTURE:
 * Mobile runs an HTTP server on localhost, WebView makes fetch() requests.
 * This means cookies work identically to web - SAME CODE FOR BOTH.
 */

const cordova = require('cordova-bridge');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ============================================================================
// POLYFILL: AbortController for Node.js v12
// Node.js v12 (used by nodejs-mobile) doesn't have AbortController (added in v15).
// We need to polyfill it before loading any other modules that might use it.
// ============================================================================
if (typeof AbortController === 'undefined') {
  const { AbortController, AbortSignal } = require('./shims/abort-controller.js');
  global.AbortController = AbortController;
  global.AbortSignal = AbortSignal;
  console.log('[Node.js] AbortController polyfill loaded');
}

// Get the app's data directory for file storage
const dataDir = cordova.app.datadir();

console.log('[Node.js] Starting MetaHuman Mobile backend');
console.log('[Node.js] Node version:', process.version);
console.log('[Node.js] Data directory:', dataDir);

// Set up environment for the handlers
// This is needed because path-builder.ts uses import.meta.url to find root
// On mobile, we override this to use the app's data directory
process.env.METAHUMAN_MOBILE = 'true';
process.env.METAHUMAN_DATA_DIR = dataDir;
process.env.METAHUMAN_ROOT = dataDir; // Override root for mobile

// ============================================================================
// COPY BUNDLED CONFIG FILES TO DATA DIRECTORY
// On first run (or when configs are missing), copy bundled files from assets
// ============================================================================
function copyBundledConfigs() {
  // The bundled configs are in the same directory as main.js
  // nodejs-mobile extracts nodejs-project/ contents to files/www/
  // So main.js and etc/ end up as siblings in files/www/
  const bundledEtc = path.join(__dirname, 'etc');
  const dataEtc = path.join(dataDir, 'etc');

  console.log('[Node.js] Looking for bundled etc at:', bundledEtc);

  // Check if bundled etc exists
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

  console.log('[Node.js] ✅ Config files initialized');
}

// Run config copy before loading handlers
copyBundledConfigs();

// ============================================================================
// POLYFILL: fs/promises for Node.js v12
// Node.js v12 (used by nodejs-mobile) doesn't have the 'fs/promises' module.
// We patch Module._resolveFilename to redirect it to our shim.
// ============================================================================
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'fs/promises') {
    // Redirect to our shim
    return originalResolveFilename(path.join(__dirname, 'shims', 'fs-promises.js'), parent, isMain, options);
  }
  return originalResolveFilename(request, parent, isMain, options);
};

// Try to load the unified HTTP adapter - SAME CODE AS WEB
let handleHttpRequest = null;
let initializeMobileAgents = null;
let stopMobileAgents = null;
let handlersLoaded = false;
let agentsInitialized = false;

try {
  // Load unified HTTP adapter - SAME CODE AS WEB SERVER
  // This includes: cookie parsing, user resolution, routing, response formatting
  const httpAdapter = require('./dist/http-adapter.js');
  handleHttpRequest = httpAdapter.handleHttpRequest;

  // Also load agent management (mobile-specific)
  const handlers = require('./dist/handlers.js');
  initializeMobileAgents = handlers.initializeMobileAgents;
  stopMobileAgents = handlers.stopMobileAgents;

  handlersLoaded = true;
  console.log('[Node.js] ✅ Unified HTTP adapter loaded - SAME CODE AS WEB');
} catch (error) {
  console.error('[Node.js] ⚠️ Failed to load unified HTTP adapter:', error.message);
  console.log('[Node.js] Falling back to stub handlers');
}

// =============================================================================
// HTTP SERVER - Uses unified HTTP adapter (SAME CODE AS WEB)
// =============================================================================

const HTTP_PORT = 4322; // Mobile uses different port than web (4321)
let httpServer = null;

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

// Create HTTP server - Uses unified HTTP adapter (SAME CODE AS WEB)
function startHttpServer() {
  httpServer = http.createServer(async (req, res) => {
    // Enable CORS for WebView
    // Note: When credentials are included, origin must be explicit (not *)
    const origin = req.headers.origin || 'https://localhost';
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
    const body = await parseBody(req);

    console.log('[HTTP]', req.method, url.pathname);

    try {
      if (handlersLoaded && handleHttpRequest) {
        // Use unified HTTP adapter - SAME CODE AS WEB
        // Cookie parsing, user resolution, routing all happen inside
        console.log('[HTTP] Calling handleHttpRequest for:', url.pathname);
        console.log('[HTTP] Cookie header:', req.headers.cookie);
        const result = await handleHttpRequest({
          path: url.pathname,
          method: req.method,
          body,
          query: Object.fromEntries(url.searchParams),
          headers: req.headers,
          cookieHeader: req.headers.cookie,
        });
        console.log('[HTTP] Result received - isStreaming:', result.isStreaming, 'hasStream:', !!result.stream);
        console.log('[HTTP] Result status:', result.status, 'body preview:', typeof result.body === 'string' ? result.body.substring(0, 200) : '(non-string)');

        // Set response cookies (formatted by unified adapter)
        if (result.cookies && result.cookies.length > 0) {
          res.setHeader('Set-Cookie', result.cookies);
        }

        // Set response headers
        for (const [key, value] of Object.entries(result.headers)) {
          res.setHeader(key, value);
        }

        // Handle streaming responses (SSE)
        if (result.isStreaming && result.stream) {
          console.log('[HTTP] Streaming response detected for:', url.pathname);
          console.log('[HTTP] Headers:', JSON.stringify(result.headers));
          res.writeHead(result.status);
          try {
            let chunkCount = 0;
            for await (const chunk of result.stream) {
              chunkCount++;
              console.log('[HTTP] Stream chunk', chunkCount, ':', chunk.substring(0, 100));
              res.write(chunk);
            }
            console.log('[HTTP] Stream complete, total chunks:', chunkCount);
          } catch (streamError) {
            console.error('[HTTP] Stream error:', streamError);
          } finally {
            res.end();
          }
        } else {
          // Non-streaming response
          res.writeHead(result.status);
          res.end(result.body);
        }
      } else {
        // Fallback to stub handlers
        const stubResponse = await handleRequestStub({
          id: 'stub',
          path: url.pathname,
          method: req.method,
          body,
        });

        res.setHeader('Content-Type', 'application/json');
        res.writeHead(stubResponse.status || 200);
        res.end(JSON.stringify(stubResponse.data || { error: stubResponse.error }));
      }
    } catch (error) {
      console.error('[HTTP] Handler error:', error);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`[Node.js] ✅ HTTP server listening on http://127.0.0.1:${HTTP_PORT}`);
    // Notify UI of the HTTP port
    cordova.channel.post('http-ready', { port: HTTP_PORT });
  });

  httpServer.on('error', (err) => {
    console.error('[Node.js] HTTP server error:', err);
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
        runtime: 'nodejs-mobile',
        dataDir,
        handlersLoaded,
        version: process.version
      }
    };
  }

  if (path === '/api/boot') {
    return {
      id,
      status: 200,
      data: {
        authenticated: false,
        version: '1.0.0-mobile',
        runtime: 'nodejs-mobile',
        handlersLoaded,
        features: {
          localAgents: false,
          localStorage: true,
          llmBridge: false
        }
      }
    };
  }

  // Profile management endpoints
  if (path === '/api/profiles' && method === 'GET') {
    return {
      id,
      status: 200,
      data: {
        profiles: listProfiles()
      }
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

  // Default: route not found
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

    console.log('[Node.js] ✅ System directories initialized');
    return true;
  } catch (error) {
    console.error('[Node.js] ⚠️ Failed to initialize system dirs:', error);
    return false;
  }
}

// Initialize a user profile with full directory structure
function initializeProfile(username) {
  const profileRoot = path.join(dataDir, 'profiles', username);

  try {
    const profileDirs = [
      // Persona
      path.join(profileRoot, 'persona'),
      path.join(profileRoot, 'persona', 'desires', 'nascent'),
      path.join(profileRoot, 'persona', 'desires', 'pending'),
      path.join(profileRoot, 'persona', 'desires', 'active'),
      path.join(profileRoot, 'persona', 'desires', 'completed'),
      path.join(profileRoot, 'persona', 'desires', 'rejected'),
      path.join(profileRoot, 'persona', 'desires', 'abandoned'),
      // Memory
      path.join(profileRoot, 'memory', 'episodic'),
      path.join(profileRoot, 'memory', 'inbox'),
      path.join(profileRoot, 'memory', 'index'),
      path.join(profileRoot, 'memory', 'tasks', 'active'),
      path.join(profileRoot, 'memory', 'tasks', 'completed'),
      path.join(profileRoot, 'memory', 'tasks', 'projects'),
      // Config
      path.join(profileRoot, 'etc'),
      // State
      path.join(profileRoot, 'state'),
      path.join(profileRoot, 'state', 'agency'),
      // Output
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

    console.log('[Node.js] ✅ Profile initialized:', username);
    return { success: true, profileRoot };
  } catch (error) {
    console.error('[Node.js] ⚠️ Failed to initialize profile:', error);
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
cordova.channel.on('agent-init', (msg) => {
  const username = msg && msg.username;
  console.log('[Node.js] Agent init request for user:', username);

  if (!handlersLoaded || !initializeMobileAgents) {
    console.log('[Node.js] Handlers not loaded, skipping agent init');
    cordova.channel.post('agent-status', {
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
      console.log('[Node.js] ✅ Agents initialized for:', username);
      cordova.channel.post('agent-status', {
        status: 'ok',
        username,
        agentsRunning: true
      });
    } else {
      console.log('[Node.js] No username provided, agents not started');
      agentsInitialized = false;
      cordova.channel.post('agent-status', {
        status: 'ok',
        agentsRunning: false
      });
    }
  } catch (error) {
    console.error('[Node.js] Agent initialization failed:', error);
    cordova.channel.post('agent-status', {
      status: 'error',
      error: error.message
    });
  }
});

// Handle agent stop request
cordova.channel.on('agent-stop', () => {
  console.log('[Node.js] Agent stop request');

  if (agentsInitialized && stopMobileAgents) {
    try {
      stopMobileAgents();
      agentsInitialized = false;
      currentUsername = null;
      console.log('[Node.js] ✅ Agents stopped');
      cordova.channel.post('agent-status', {
        status: 'ok',
        agentsRunning: false
      });
    } catch (error) {
      console.error('[Node.js] Agent stop failed:', error);
      cordova.channel.post('agent-status', {
        status: 'error',
        error: error.message
      });
    }
  }
});

// Handle the 'pause' and 'resume' events
cordova.app.on('pause', (pauseLock) => {
  console.log('[Node.js] app paused.');

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

cordova.app.on('resume', () => {
  console.log('[Node.js] app resumed.');

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

  cordova.channel.post('engine', 'resumed');
});

// Notify UI that Node.js is ready
cordova.channel.post('ready', {
  status: 'ok',
  dataDir,
  version: process.version,
  handlersLoaded,
  systemInitialized,
  agentsAvailable: handlersLoaded && initializeMobileAgents !== null,
  profiles: listProfiles()
});

console.log('[Node.js] Backend ready, waiting for requests...');
console.log('[Node.js] Agents available:', handlersLoaded && initializeMobileAgents !== null);
