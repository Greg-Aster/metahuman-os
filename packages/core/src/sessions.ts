/**
 * Session Management System
 *
 * Handles user sessions with expiration, validation, and cleanup.
 * Stores sessions in logs/run/sessions.json.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { paths } from './paths.js';
import { audit } from './audit.js';

/**
 * Session object
 */
export interface Session {
  id: string; // Session token (UUID)
  userId: string; // User ID
  role: 'owner' | 'standard' | 'guest' | 'anonymous';
  createdAt: string;
  expiresAt: string;
  lastActivity: string;
  metadata?: {
    userAgent?: string;
    ip?: string;
    activeProfile?: string; // Selected profile for guest users
    [key: string]: any;
  };
}

/**
 * Session storage
 */
interface SessionStore {
  sessions: Session[];
  version: number;
}

/**
 * Get the path to the sessions file.
 * Uses system-level path since sessions.json is a global database.
 */
function getSessionsFilePath(): string {
  return paths.sessionsFile;
}

// Session expiration times
const OWNER_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const GUEST_SESSION_DURATION = 60 * 60 * 1000; // 1 hour
const ANONYMOUS_SESSION_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * Load sessions from file
 */
function loadSessions(): SessionStore {
  if (!fs.existsSync(getSessionsFilePath())) {
    return { sessions: [], version: 1 };
  }

  try {
    const raw = fs.readFileSync(getSessionsFilePath(), 'utf-8');
    return JSON.parse(raw) as SessionStore;
  } catch (error) {
    console.error('[sessions] Failed to load sessions:', error);
    return { sessions: [], version: 1 };
  }
}

/**
 * Save sessions to file
 */
function saveSessions(store: SessionStore): void {
  try {
    // Ensure directory exists
    const dir = path.dirname(getSessionsFilePath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(getSessionsFilePath(), JSON.stringify(store, null, 2), 'utf-8');
  } catch (error) {
    console.error('[sessions] Failed to save sessions:', error);
    throw error;
  }
}

/**
 * Create a new session
 */
export function createSession(
  userId: string,
  role: 'owner' | 'standard' | 'guest' | 'anonymous',
  metadata?: { userAgent?: string; ip?: string }
): Session {
  const store = loadSessions();

  // Determine expiration based on role
  let duration: number;
  switch (role) {
    case 'owner':
    case 'standard':
      duration = OWNER_SESSION_DURATION; // Standard users get same 24h session as owners
      break;
    case 'guest':
      duration = GUEST_SESSION_DURATION;
      break;
    case 'anonymous':
      duration = ANONYMOUS_SESSION_DURATION;
      break;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + duration);

  const session: Session = {
    id: randomUUID(),
    userId,
    role,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastActivity: now.toISOString(),
    metadata,
  };

  store.sessions.push(session);
  saveSessions(store);

  audit({
    level: 'info',
    category: 'security',
    event: 'session_created',
    details: {
      sessionId: session.id,
      userId,
      role,
      expiresAt: session.expiresAt,
    },
    actor: userId,
  });

  return session;
}

/**
 * Get session by ID (without validation)
 */
export function getSession(sessionId: string): Session | null {
  const store = loadSessions();
  return store.sessions.find((s) => s.id === sessionId) || null;
}

/**
 * Validate session (check expiration, update activity)
 */
export function validateSession(sessionId: string): Session | null {
  const store = loadSessions();
  const session = store.sessions.find((s) => s.id === sessionId);

  if (!session) {
    return null;
  }

  // Check if expired
  const now = new Date();
  const expiresAt = new Date(session.expiresAt);

  if (now > expiresAt) {
    // Session expired, delete it
    store.sessions = store.sessions.filter((s) => s.id !== sessionId);
    saveSessions(store);

    audit({
      level: 'info',
      category: 'security',
      event: 'session_expired',
      details: { sessionId, userId: session.userId },
      actor: session.userId,
    });

    return null;
  }

  // Update last activity
  session.lastActivity = now.toISOString();
  saveSessions(store);

  return session;
}

/**
 * Delete session (logout)
 */
export function deleteSession(sessionId: string): boolean {
  const store = loadSessions();
  const session = store.sessions.find((s) => s.id === sessionId);

  if (!session) {
    return false;
  }

  store.sessions = store.sessions.filter((s) => s.id !== sessionId);
  saveSessions(store);

  audit({
    level: 'info',
    category: 'security',
    event: 'session_deleted',
    details: { sessionId, userId: session.userId },
    actor: session.userId,
  });

  return true;
}

/**
 * Delete all sessions for a user
 */
export function deleteUserSessions(userId: string): number {
  const store = loadSessions();
  const userSessions = store.sessions.filter((s) => s.userId === userId);
  const count = userSessions.length;

  store.sessions = store.sessions.filter((s) => s.userId !== userId);
  saveSessions(store);

  if (count > 0) {
    audit({
      level: 'info',
      category: 'security',
      event: 'user_sessions_deleted',
      details: { userId, count },
      actor: userId,
    });
  }

  return count;
}

/**
 * List all active sessions
 */
export function listActiveSessions(): Session[] {
  const store = loadSessions();
  const now = new Date();

  // Filter out expired sessions
  return store.sessions.filter((s) => {
    const expiresAt = new Date(s.expiresAt);
    return now <= expiresAt;
  });
}

/**
 * List sessions for a specific user
 */
export function listUserSessions(userId: string): Session[] {
  return listActiveSessions().filter((s) => s.userId === userId);
}

/**
 * Cleanup expired sessions
 *
 * Should be run periodically (e.g., every hour)
 */
export function cleanupExpiredSessions(): number {
  const store = loadSessions();
  const now = new Date();
  const before = store.sessions.length;

  store.sessions = store.sessions.filter((s) => {
    const expiresAt = new Date(s.expiresAt);
    return now <= expiresAt;
  });

  const removed = before - store.sessions.length;

  if (removed > 0) {
    saveSessions(store);

    audit({
      level: 'info',
      category: 'system',
      event: 'sessions_cleaned_up',
      details: { removed, remaining: store.sessions.length },
      actor: 'system',
    });
  }

  return removed;
}

/**
 * Get session statistics
 */
export function getSessionStats(): {
  total: number;
  byRole: Record<string, number>;
  oldest: string | null;
  newest: string | null;
} {
  const sessions = listActiveSessions();

  const byRole: Record<string, number> = {
    owner: 0,
    standard: 0,
    guest: 0,
    anonymous: 0,
  };

  sessions.forEach((s) => {
    byRole[s.role] = (byRole[s.role] || 0) + 1;
  });

  const sorted = sessions.sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return {
    total: sessions.length,
    byRole,
    oldest: sorted.length > 0 ? sorted[0].createdAt : null,
    newest: sorted.length > 0 ? sorted[sorted.length - 1].createdAt : null,
  };
}

/**
 * Update session (save changes to metadata, etc.)
 */
export function updateSession(session: Session): void {
  const store = loadSessions();
  const index = store.sessions.findIndex((s) => s.id === session.id);

  if (index !== -1) {
    store.sessions[index] = session;
    saveSessions(store);
  }
}

/**
 * Extend session expiration (refresh)
 */
export function refreshSession(sessionId: string): Session | null {
  const store = loadSessions();
  const session = store.sessions.find((s) => s.id === sessionId);

  if (!session) {
    return null;
  }

  // Check if already expired
  const now = new Date();
  const expiresAt = new Date(session.expiresAt);

  if (now > expiresAt) {
    return null;
  }

  // Extend expiration based on role
  let duration: number;
  switch (session.role) {
    case 'owner':
    case 'standard':
      duration = OWNER_SESSION_DURATION; // Standard users get same 24h session as owners
      break;
    case 'guest':
      duration = GUEST_SESSION_DURATION;
      break;
    case 'anonymous':
      duration = ANONYMOUS_SESSION_DURATION;
      break;
  }

  session.expiresAt = new Date(now.getTime() + duration).toISOString();
  session.lastActivity = now.toISOString();
  saveSessions(store);

  audit({
    level: 'info',
    category: 'security',
    event: 'session_refreshed',
    details: { sessionId, userId: session.userId, expiresAt: session.expiresAt },
    actor: session.userId,
  });

  return session;
}
