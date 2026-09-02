/**
 * MetaHuman Mobile - Node.js Backend (React Native)
 *
 * This runs inside the Android app via nodejs-mobile-react-native.
 * NODE.JS 18 - No polyfills needed!
 *
 * Key benefits over Capacitor version:
 * - Native fetch() (no polyfills)
 * - Native AbortController
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

// Get the app's data directory for file storage
const dataDir = rn_bridge.app.datadir();

console.log('[Node.js] Starting MetaHuman Mobile backend (React Native)');
console.log('[Node.js] Node version:', process.version);
console.log('[Node.js] Data directory:', dataDir);
console.log('[Node.js] Has native fetch:', typeof fetch !== 'undefined');
console.log('[Node.js] Has native AbortController:', typeof AbortController !== 'undefined');

// Load .env file from bundled assets (contains version info)
const bundledEnvPath = path.join(__dirname, '.env');
if (fs.existsSync(bundledEnvPath)) {
  try {
    const envContent = fs.readFileSync(bundledEnvPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join('=').trim();
        }
      }
    }
    console.log('[Node.js] Loaded bundled .env (APP_VERSION=' + process.env.APP_VERSION + ')');
  } catch (e) {
    console.warn('[Node.js] Failed to load .env:', e.message);
  }
}

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

  if (!fs.existsSync(bundledEtc)) {
    throw new Error(`Bundled configuration is missing: ${bundledEtc}`);
  }

  const cognitiveGraphsDir = path.join(dataEtc, 'cognitive-graphs');
  const customGraphsDir = path.join(cognitiveGraphsDir, 'custom');
  fs.mkdirSync(cognitiveGraphsDir, { recursive: true });
  fs.mkdirSync(customGraphsDir, { recursive: true });

  // Copy cognitive graphs (always overwrite to get latest)
  const bundledGraphs = path.join(bundledEtc, 'cognitive-graphs');
  for (const file of fs.readdirSync(bundledGraphs)) {
    const src = path.join(bundledGraphs, file);
    if (fs.statSync(src).isFile() && file.endsWith('.json')) {
      fs.copyFileSync(src, path.join(cognitiveGraphsDir, file));
    }
  }

  const bundledCustom = path.join(bundledGraphs, 'custom');
  if (fs.existsSync(bundledCustom)) {
    for (const file of fs.readdirSync(bundledCustom)) {
      if (file.endsWith('.json')) {
        fs.copyFileSync(
          path.join(bundledCustom, file),
          path.join(customGraphsDir, file),
        );
      }
    }
  }

  // Copy essential config files (only if they don't exist to preserve user changes)
  const configFiles = ['models.json', 'agents.json', 'llm-backend.json'];
  for (const file of configFiles) {
    const src = path.join(bundledEtc, file);
    const dst = path.join(dataEtc, file);
    if (!fs.existsSync(src)) {
      throw new Error(`Bundled configuration file is missing: ${src}`);
    }
    if (!fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
    }
  }

  console.log('[Node.js] Config files initialized');
}

// Run config copy before loading handlers
copyBundledConfigs();

// The canonical bundle is required. A partial shadow API would hide packaging
// failures and write profile data through a second implementation.
const {
  handleHttpRequest,
  parseCookies,
  resolveUserFromCookie,
} = require('./dist/http-adapter.js');
const mobileHandlers = require('./dist/handlers.js');
const { initializeMobileAgents, stopMobileAgents } = mobileHandlers;
const { createMobileAgentLifecycle } = require('./mobile-agent-lifecycle.js');

if (typeof handleHttpRequest !== 'function'
  || typeof parseCookies !== 'function'
  || typeof resolveUserFromCookie !== 'function'
  || typeof initializeMobileAgents !== 'function'
  || typeof stopMobileAgents !== 'function'
  || typeof createMobileAgentLifecycle !== 'function') {
  throw new Error('Mobile backend bundle is missing required HTTP or agent exports');
}

const mobileAgentLifecycle = createMobileAgentLifecycle({
  initializeAgents: username => initializeMobileAgents(dataDir, username),
  stopAgents: () => stopMobileAgents(),
});

async function resolveRequestUserAndEnsureAgents(req, pathname) {
  if (pathname === '/api/auth/logout') return undefined;
  const cookies = parseCookies(req.headers.cookie);
  const user = resolveUserFromCookie(cookies.mh_session);
  if (user?.isAuthenticated) {
    await mobileAgentLifecycle.ensure(user.username);
  }
  return user;
}

console.log('[Node.js] Unified HTTP adapter loaded');

// =============================================================================
// HTTP SERVER - Unified server serving BOTH static UI AND API routes
// Same architecture as web: one server serves everything
// =============================================================================

const HTTP_PORT = 4322;
let httpServer = null;

// WiFi broadcast mode - allows other devices on the network to connect
let wifiBroadcastEnabled = false;
let localNetworkInfo = null;

// Load WiFi broadcast setting from config
function loadWifiBroadcastSetting() {
  try {
    const configPath = path.join(dataDir, 'etc', 'network.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      wifiBroadcastEnabled = config.wifiBroadcastEnabled === true;
      console.log('[Node.js] WiFi broadcast mode:', wifiBroadcastEnabled ? 'ENABLED' : 'disabled');
    }
  } catch (e) {
    console.warn('[Node.js] Failed to load network config:', e.message);
  }
}

// Save WiFi broadcast setting
function saveWifiBroadcastSetting(enabled) {
  try {
    const configPath = path.join(dataDir, 'etc', 'network.json');
    const etcDir = path.join(dataDir, 'etc');
    if (!fs.existsSync(etcDir)) {
      fs.mkdirSync(etcDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify({ wifiBroadcastEnabled: enabled }, null, 2));
    wifiBroadcastEnabled = enabled;
    console.log('[Node.js] WiFi broadcast setting saved:', enabled);
    return true;
  } catch (e) {
    console.error('[Node.js] Failed to save network config:', e.message);
    return false;
  }
}

// Get local IP addresses for network display
function getLocalNetworkAddresses() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const [name, netInterfaces] of Object.entries(interfaces)) {
    if (!netInterfaces) continue;
    for (const iface of netInterfaces) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (iface.internal || iface.family !== 'IPv4') continue;
      addresses.push({
        interface: name,
        address: iface.address,
        url: `http://${iface.address}:${HTTP_PORT}`,
      });
    }
  }

  return addresses;
}

// Load setting on startup
loadWifiBroadcastSetting();

// Static files directory - bundled UI assets
const STATIC_DIR = path.join(__dirname, 'www');
const STATIC_ROOT = path.resolve(STATIC_DIR);

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
    const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);
    const pathname = url.pathname;

    // Route: /api/* -> API handlers (unified codebase)
    if (pathname.startsWith('/api/')) {
      const body = await parseBody(req);
      console.log('[API]', req.method, pathname);

      // Handle network-related endpoints directly (before unified adapter)
      if (pathname === '/api/network-info') {
        const addresses = getLocalNetworkAddresses();
        localNetworkInfo = {
          wifiBroadcastEnabled,
          port: HTTP_PORT,
          addresses,
          localUrl: `http://127.0.0.1:${HTTP_PORT}`,
          networkUrls: wifiBroadcastEnabled ? addresses.map(a => a.url) : [],
        };
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(localNetworkInfo));
        return;
      }

      if (pathname === '/api/network-settings' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ wifiBroadcastEnabled }));
        return;
      }

      if (pathname === '/api/network-settings' && req.method === 'POST') {
        const enabled = body && body.wifiBroadcastEnabled === true;
        const saved = saveWifiBroadcastSetting(enabled);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(saved ? 200 : 500);
        res.end(JSON.stringify({
          success: saved,
          wifiBroadcastEnabled: enabled,
          message: saved
            ? (enabled ? 'WiFi broadcast enabled. Restart app to apply.' : 'WiFi broadcast disabled. Restart app to apply.')
            : 'Failed to save setting',
        }));
        return;
      }

      try {
        const resolvedUser = await resolveRequestUserAndEnsureAgents(req, pathname);
        const result = await handleHttpRequest({
          path: pathname,
          method: req.method,
          body,
          query: Object.fromEntries(url.searchParams),
          headers: req.headers,
          cookieHeader: req.headers.cookie,
          resolvedUser,
        });

        if (pathname === '/api/auth/logout' && result.status >= 200 && result.status < 300) {
          await mobileAgentLifecycle.stop();
        }

        if (result.cookies && result.cookies.length > 0) {
          res.setHeader('Set-Cookie', result.cookies);
        }
        for (const [key, value] of Object.entries(result.headers)) {
          res.setHeader(key, value);
        }

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
    const requestedFile = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(STATIC_ROOT, requestedFile);

    // Security: Prevent directory traversal
    if (filePath !== STATIC_ROOT && !filePath.startsWith(`${STATIC_ROOT}${path.sep}`)) {
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

  // Determine bind address based on WiFi broadcast setting
  const bindAddress = wifiBroadcastEnabled ? '0.0.0.0' : '127.0.0.1';

  httpServer.listen(HTTP_PORT, bindAddress, () => {
    console.log(`[Node.js] HTTP server listening on http://${bindAddress}:${HTTP_PORT}`);
    console.log('[Node.js] Serving: Static UI + API routes (unified architecture)');

    if (wifiBroadcastEnabled) {
      const addresses = getLocalNetworkAddresses();
      console.log('[Node.js] WiFi broadcast ENABLED - accessible on local network:');
      for (const addr of addresses) {
        console.log(`[Node.js]   ${addr.interface}: ${addr.url}`);
      }
    } else {
      console.log('[Node.js] WiFi broadcast disabled - local only');
    }

    // Notify React Native that HTTP server is ready
    rn_bridge.channel.send({
      type: 'http-ready',
      port: HTTP_PORT,
      wifiBroadcastEnabled,
      networkAddresses: wifiBroadcastEnabled ? getLocalNetworkAddresses() : [],
    });
  });

  httpServer.on('error', (err) => {
    console.error('[Node.js] HTTP server error:', err);
    rn_bridge.channel.send({ type: 'error', error: err.message });
  });
}

// Start HTTP server
startHttpServer();

// ============================================================================
// LOCAL MODEL SERVICE AUTO-START
// If localModels.autoStart is true in llm-backend.json, start the service
// ============================================================================
async function checkLocalModelsAutoStart() {
  try {
    const llmBackendPath = path.join(dataDir, 'etc', 'llm-backend.json');
    if (!fs.existsSync(llmBackendPath)) {
      console.log('[Node.js] No llm-backend.json found, skipping local models auto-start');
      return;
    }

    const config = JSON.parse(fs.readFileSync(llmBackendPath, 'utf-8'));
    const localModels = config.localModels;

    if (!localModels?.enabled || !localModels?.autoStart) {
      console.log('[Node.js] Local models auto-start disabled');
      return;
    }

    console.log('[Node.js] Local models auto-start enabled, attempting to start service...');

    // Try to load the local model service manager from bundled handlers
    try {
      if (mobileHandlers.startLocalModelService) {
        const modelsDir = path.join(dataDir, 'models');
        // Ensure models directory exists
        if (!fs.existsSync(modelsDir)) {
          fs.mkdirSync(modelsDir, { recursive: true });
        }

        const success = await mobileHandlers.startLocalModelService({
          modelsDir,
          preloadEmbeddings: localModels.embeddings?.preloadAtStartup ?? true,
          preloadLLM: localModels.llm?.preloadAtStartup ?? false,
        });

        if (success) {
          console.log('[Node.js] Local model service started successfully');
        } else {
          console.log('[Node.js] Local model service failed to start (will retry on demand)');
        }
      } else {
        console.log('[Node.js] startLocalModelService not available in bundled handlers');
      }
    } catch (e) {
      console.log('[Node.js] Local model service not available:', e.message);
      console.log('[Node.js] Service can be started manually via Settings → Backend');
    }
  } catch (error) {
    console.error('[Node.js] Error checking local models config:', error.message);
  }
}

// Check local models auto-start after a short delay (let HTTP server stabilize)
setTimeout(checkLocalModelsAutoStart, 2000);

// Initialize system directories
function initializeSystemDirs() {
  const systemDirs = [
    path.join(dataDir, 'profiles'),
    path.join(dataDir, 'etc'),
    path.join(dataDir, 'logs', 'audit'),
    path.join(dataDir, 'logs', 'run'),
  ];

  for (const dir of systemDirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
  console.log('[Node.js] System directories initialized');
}

// Initialize on startup
initializeSystemDirs();

// Handle app lifecycle events
rn_bridge.app.on('pause', (pauseLock) => {
  console.log('[Node.js] App paused');
  mobileAgentLifecycle.stop({ retainUsername: true })
    .then(() => console.log('[Node.js] Agents paused'))
    .catch(error => console.error('[Node.js] Failed to pause agents:', error))
    .finally(() => pauseLock.release());
});

rn_bridge.app.on('resume', () => {
  console.log('[Node.js] App resumed');
  mobileAgentLifecycle.resume()
    .then(state => {
      if (state.runningUsername) {
        console.log('[Node.js] Agents resumed for:', state.runningUsername);
      }
    })
    .catch(error => console.error('[Node.js] Failed to resume agents:', error));
});

// Notify React Native that Node.js is ready
rn_bridge.channel.send({
  type: 'ready',
  status: 'ok',
  dataDir,
  version: process.version,
  agentsAvailable: true,
  features: {
    nativeFetch: typeof fetch !== 'undefined',
    nativeAbortController: typeof AbortController !== 'undefined',
  }
});

console.log('[Node.js] Backend ready (React Native), waiting for requests...');
console.log('[Node.js] Native APIs available: fetch, AbortController, fs/promises');
