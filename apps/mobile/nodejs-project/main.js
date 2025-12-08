/**
 * MetaHuman Mobile - Node.js Backend
 *
 * This runs inside the Android app via nodejs-mobile.
 * It handles:
 * - API requests from the UI (via message bridge)
 * - Agent execution
 * - Local file storage
 * - LLM routing
 */

const cordova = require('cordova-bridge');
const path = require('path');
const fs = require('fs');

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

// Try to load the bundled handlers
let handleMobileRequest = null;
let initializeMobileAgents = null;
let stopMobileAgents = null;
let handlersLoaded = false;
let agentsInitialized = false;

try {
  // The handlers are bundled into dist/handlers.js
  const handlers = require('./dist/handlers.js');
  handleMobileRequest = handlers.handleMobileRequest;
  initializeMobileAgents = handlers.initializeMobileAgents;
  stopMobileAgents = handlers.stopMobileAgents;
  handlersLoaded = true;
  console.log('[Node.js] ✅ Bundled handlers loaded successfully');
} catch (error) {
  console.error('[Node.js] ⚠️ Failed to load bundled handlers:', error.message);
  console.log('[Node.js] Falling back to stub handlers');
}

// Handle messages from UI
cordova.channel.on('request', async (msg) => {
  console.log('[Node.js] Received request:', msg.id, msg.path);

  try {
    let response;

    // Route to bundled handlers if available
    if (handlersLoaded && handleMobileRequest) {
      try {
        response = await handleMobileRequest(msg);
        console.log('[Node.js] Handler response status:', response.status);
      } catch (handlerError) {
        console.error('[Node.js] Handler error:', handlerError);
        response = { id: msg.id, status: 500, error: handlerError.message };
      }
    } else {
      // Fallback to stub handlers
      response = await handleRequestStub(msg);
    }

    // Send response back to UI
    cordova.channel.post('response', response);
  } catch (error) {
    console.error('[Node.js] Request error:', error);
    cordova.channel.post('response', {
      id: msg.id,
      status: 500,
      error: error.message
    });
  }
});

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
