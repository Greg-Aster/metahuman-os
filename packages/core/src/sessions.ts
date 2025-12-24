/**
 * Session Management System
 *
 * Handles user sessions with expiration, validation, and cleanup.
 * Stores sessions in logs/run/sessions.json.
 */

import fs from 'fs';
import path from 'path';
import { systemPaths } from './path-builder.js';
import { generateUUID } from './uuid.js';
import { audit } from './audit.js';

/**
 * Session object
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  NO ANONYMOUS SESSIONS - ALL USERS MUST AUTHENTICATE                      ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  owner    - Full access, 24-hour sessions                                 ║
 * ║  standard - Read/write access, 24-hour sessions                           ║
 * ║  guest    - Read-only access, 1-hour sessions (passwordless auth gate)    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export interface Session {
  id: string; // Session token (UUID)
  userId: string; // User ID
  role: 'owner' | 'standard' | 'guest';
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
  return systemPaths.sessionsFile;
}

// Session expiration times
const OWNER_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const GUEST_SESSION_DURATION = 60 * 60 * 1000; // 1 hour

// Maximum session age (absolute limit regardless of activity)
// After this time from creation, session MUST be re-authenticated
const MAX_SESSION_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Check if session has exceeded maximum age
 */
function isSessionTooOld(session: Session): boolean {
  const createdAt = new Date(session.createdAt);
  const now = new Date();
  return (now.getTime() - createdAt.getTime()) > MAX_SESSION_AGE;
}

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
  role: 'owner' | 'standard' | 'guest',
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
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + duration);

  const session: Session = {
    id: generateUUID(),
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
 * Validate session (check expiration and max age, update activity)
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

  // Check if session exceeded maximum age (must re-authenticate after 7 days)
  if (isSessionTooOld(session)) {
    store.sessions = store.sessions.filter((s) => s.id !== sessionId);
    saveSessions(store);

    audit({
      level: 'info',
      category: 'security',
      event: 'session_max_age_exceeded',
      details: { sessionId, userId: session.userId, createdAt: session.createdAt },
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

  // Check if session exceeded maximum age (don't refresh, force re-auth)
  if (isSessionTooOld(session)) {
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

/**
 * Get all logged-in users (active, non-anonymous sessions)
 *
 * Returns users who have active sessions that haven't expired.
 * Excludes anonymous sessions and sessions exceeding max age.
 *
 * @returns Array of logged-in users with userId, username, and role
 */
export function getLoggedInUsers(): Array<{ userId: string; username: string; role: string }> {
  const store = loadSessions();
  const now = new Date();
  const activeUsers = new Map<string, { userId: string; username: string; role: string }>();

  // Find all active, non-expired sessions (no anonymous sessions exist)
  for (const session of store.sessions) {
    const expiresAt = new Date(session.expiresAt);

    // Check both expiration and max age
    if (expiresAt > now && !isSessionTooOld(session)) {
      // Use userId as key to deduplicate (same user can have multiple sessions)
      if (!activeUsers.has(session.userId)) {
        // Get username from user database
        const { getUser } = require('./users.js');
        const user = getUser(session.userId);

        if (user) {
          activeUsers.set(session.userId, {
            userId: session.userId,
            username: user.username,
            role: session.role
          });
        }
      }
    }
  }

  return Array.from(activeUsers.values());
}

/**
 * Get the most recently active user
 *
 * Returns the single user with the most recent lastActivity timestamp.
 * This should be used by background agents to avoid processing multiple users.
 * Excludes sessions that have exceeded max age.
 *
 * @returns The most recently active user, or null if no active sessions
 */
export function getMostRecentlyActiveUser(): { userId: string; username: string; role: string } | null {
  const store = loadSessions();
  const now = new Date();
  let mostRecent: { session: Session; user: any } | null = null;

  for (const session of store.sessions) {
    const expiresAt = new Date(session.expiresAt);

    // Check both expiration and max age
    if (expiresAt > now && !isSessionTooOld(session)) {
      const lastActivity = new Date(session.lastActivity);

      if (!mostRecent || lastActivity > new Date(mostRecent.session.lastActivity)) {
        const { getUser } = require('./users.js');
        const user = getUser(session.userId);

        if (user) {
          mostRecent = { session, user };
        }
      }
    }
  }

  if (!mostRecent) return null;

  return {
    userId: mostRecent.session.userId,
    username: mostRecent.user.username,
    role: mostRecent.session.role
  };
}

/**
 * Get the target user for agent execution
 *
 * Priority order:
 * 1. Explicit username option (from --user CLI arg)
 * 2. MH_TRIGGER_USERNAME environment variable (set by API when user triggers agent)
 * 3. getMostRecentlyActiveUser() fallback (for scheduler-triggered agents)
 *
 * This ensures that:
 * - API-triggered agents ALWAYS process the authenticated user's data
 * - Scheduler-triggered agents process the most recently active user
 * - CLI can override with explicit --user flag
 *
 * @param options - Optional object with username property
 * @returns User info or null if no user can be determined
 */
export function getTargetUser(options?: { username?: string }): { userId: string; username: string; role: string } | null {
  // Priority 1: Explicit username from options (--user CLI arg)
  if (options?.username) {
    return { userId: options.username, username: options.username, role: 'owner' };
  }

  // Priority 2: MH_TRIGGER_USERNAME from API (user who clicked the button)
  const triggerUsername = process.env.MH_TRIGGER_USERNAME;
  if (triggerUsername) {
    return { userId: triggerUsername, username: triggerUsername, role: 'owner' };
  }

  // Priority 3: Most recently active user (scheduler fallback)
  return getMostRecentlyActiveUser();
}
