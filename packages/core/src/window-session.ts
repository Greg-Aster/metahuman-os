/**
 * Window Session Management for Multi-Window Support
 * 
 * Extends the existing session system to track individual browser windows/tabs
 * and coordinate between them to prevent race conditions.
 */

import fs from 'fs';
import path from 'path';
import { systemPaths } from './path-builder.js';
import { generateUUID } from './uuid.js';
import { audit } from './audit.js';
import { getSession, validateSession } from './sessions.js';

/**
 * Window session represents an individual browser tab/window
 */
export interface WindowSession {
  windowId: string;        // Unique window identifier (UUID)
  sessionId: string;       // Parent user session ID
  userId: string;          // User who owns this window
  userAgent?: string;      // Browser user agent
  title?: string;          // Window/tab title for identification
  createdAt: string;       // Window creation timestamp
  lastActivity: string;    // Last activity timestamp
  isActive: boolean;       // Whether window is currently active/focused
  metadata?: {
    url?: string;          // Current page URL
    viewState?: string;    // Current view (chat, tasks, etc.)
    [key: string]: any;
  };
}

/**
 * Window registry storage
 */
interface WindowStore {
  windows: WindowSession[];
  version: number;
}

/**
 * Window activity heartbeat
 */
export interface WindowHeartbeat {
  windowId: string;
  timestamp: string;
  isActive: boolean;
  metadata?: Record<string, any>;
}

// Window session expiration (5 minutes of inactivity)
const WINDOW_SESSION_TIMEOUT = 5 * 60 * 1000;

/**
 * Get the path to the windows registry file
 */
function getWindowsFilePath(): string {
  return path.join(systemPaths.run, 'windows.json');
}

/**
 * Load window registry from file
 */
function loadWindows(): WindowStore {
  if (!fs.existsSync(getWindowsFilePath())) {
    return { windows: [], version: 1 };
  }

  try {
    const raw = fs.readFileSync(getWindowsFilePath(), 'utf-8');
    return JSON.parse(raw) as WindowStore;
  } catch (error) {
    console.error('[window-session] Failed to load windows registry:', error);
    return { windows: [], version: 1 };
  }
}

/**
 * Save window registry to file
 */
function saveWindows(store: WindowStore): void {
  try {
    const dir = path.dirname(getWindowsFilePath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(getWindowsFilePath(), JSON.stringify(store, null, 2), 'utf-8');
  } catch (error) {
    console.error('[window-session] Failed to save windows registry:', error);
    throw error;
  }
}

/**
 * Create a new window session
 */
export function createWindowSession(
  sessionId: string,
  metadata?: { 
    userAgent?: string;
    title?: string;
    url?: string;
    viewState?: string;
  }
): WindowSession | null {
  // Validate parent session exists
  const parentSession = validateSession(sessionId);
  if (!parentSession) {
    console.warn('[window-session] Cannot create window: parent session invalid');
    return null;
  }

  const store = loadWindows();
  const now = new Date().toISOString();

  const windowSession: WindowSession = {
    windowId: generateUUID(),
    sessionId,
    userId: parentSession.userId,
    userAgent: metadata?.userAgent,
    title: metadata?.title,
    createdAt: now,
    lastActivity: now,
    isActive: true,
    metadata: {
      url: metadata?.url,
      viewState: metadata?.viewState,
    },
  };

  store.windows.push(windowSession);
  saveWindows(store);

  audit({
    level: 'info',
    category: 'system',
    event: 'window_session_created',
    details: {
      windowId: windowSession.windowId,
      sessionId,
      userId: parentSession.userId,
      userAgent: metadata?.userAgent,
    },
    actor: parentSession.userId,
  });

  return windowSession;
}

/**
 * Get window session by window ID
 */
export function getWindowSession(windowId: string): WindowSession | null {
  const store = loadWindows();
  return store.windows.find(w => w.windowId === windowId) || null;
}

/**
 * Validate and update window session activity
 */
export function validateWindowSession(windowId: string): WindowSession | null {
  const store = loadWindows();
  const window = store.windows.find(w => w.windowId === windowId);

  if (!window) {
    return null;
  }

  // Check if window has timed out
  const lastActivity = new Date(window.lastActivity);
  const now = new Date();
  
  if (now.getTime() - lastActivity.getTime() > WINDOW_SESSION_TIMEOUT) {
    // Window session expired, remove it
    store.windows = store.windows.filter(w => w.windowId !== windowId);
    saveWindows(store);

    audit({
      level: 'info',
      category: 'system',
      event: 'window_session_expired',
      details: { windowId, userId: window.userId },
      actor: window.userId,
    });

    return null;
  }

  // Validate parent session is still valid
  const parentSession = validateSession(window.sessionId);
  if (!parentSession) {
    // Parent session expired, remove window
    store.windows = store.windows.filter(w => w.windowId !== windowId);
    saveWindows(store);

    audit({
      level: 'info',
      category: 'system',
      event: 'window_session_orphaned',
      details: { windowId, sessionId: window.sessionId, userId: window.userId },
      actor: window.userId,
    });

    return null;
  }

  // Update activity
  window.lastActivity = now.toISOString();
  saveWindows(store);

  return window;
}

/**
 * Send heartbeat from a window to keep it alive and update state
 */
export function sendWindowHeartbeat(heartbeat: WindowHeartbeat): boolean {
  const store = loadWindows();
  const window = store.windows.find(w => w.windowId === heartbeat.windowId);

  if (!window) {
    return false;
  }

  // Update window activity and metadata
  window.lastActivity = heartbeat.timestamp;
  window.isActive = heartbeat.isActive;
  
  if (heartbeat.metadata) {
    window.metadata = { ...window.metadata, ...heartbeat.metadata };
  }

  saveWindows(store);
  return true;
}

/**
 * Close a window session (user closes tab/window)
 */
export function closeWindowSession(windowId: string): boolean {
  const store = loadWindows();
  const window = store.windows.find(w => w.windowId === windowId);

  if (!window) {
    return false;
  }

  store.windows = store.windows.filter(w => w.windowId !== windowId);
  saveWindows(store);

  audit({
    level: 'info',
    category: 'system',
    event: 'window_session_closed',
    details: { windowId, userId: window.userId },
    actor: window.userId,
  });

  return true;
}

/**
 * List all active windows for a user
 */
export function listUserWindows(userId: string): WindowSession[] {
  const store = loadWindows();
  const now = new Date();

  return store.windows
    .filter(w => w.userId === userId)
    .filter(w => {
      const lastActivity = new Date(w.lastActivity);
      return now.getTime() - lastActivity.getTime() < WINDOW_SESSION_TIMEOUT;
    });
}

/**
 * Check if user has multiple active windows
 */
export function hasMultipleWindows(userId: string): boolean {
  return listUserWindows(userId).length > 1;
}

/**
 * Get the most recently active window for a user
 */
export function getMostRecentWindow(userId: string): WindowSession | null {
  const windows = listUserWindows(userId);
  if (windows.length === 0) return null;

  return windows.sort((a, b) => 
    new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  )[0];
}

/**
 * Cleanup expired window sessions
 */
export function cleanupExpiredWindows(): number {
  const store = loadWindows();
  const now = new Date();
  const before = store.windows.length;

  store.windows = store.windows.filter(w => {
    const lastActivity = new Date(w.lastActivity);
    return now.getTime() - lastActivity.getTime() < WINDOW_SESSION_TIMEOUT;
  });

  const removed = before - store.windows.length;

  if (removed > 0) {
    saveWindows(store);

    audit({
      level: 'info',
      category: 'system',
      event: 'window_sessions_cleaned_up',
      details: { removed, remaining: store.windows.length },
      actor: 'system',
    });
  }

  return removed;
}

/**
 * Get window statistics
 */
export function getWindowStats(): {
  total: number;
  byUser: Record<string, number>;
  activeWindows: number;
  multiWindowUsers: string[];
} {
  const store = loadWindows();
  const now = new Date();
  
  const activeWindows = store.windows.filter(w => {
    const lastActivity = new Date(w.lastActivity);
    return now.getTime() - lastActivity.getTime() < WINDOW_SESSION_TIMEOUT;
  });

  const byUser: Record<string, number> = {};
  const multiWindowUsers: string[] = [];

  for (const window of activeWindows) {
    byUser[window.userId] = (byUser[window.userId] || 0) + 1;
  }

  for (const [userId, count] of Object.entries(byUser)) {
    if (count > 1) {
      multiWindowUsers.push(userId);
    }
  }

  return {
    total: store.windows.length,
    byUser,
    activeWindows: activeWindows.length,
    multiWindowUsers,
  };
}