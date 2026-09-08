/**
 * Session Management System
 *
 * Handles user sessions with expiration, validation, and cleanup.
 * Owns the system-level session database, independent of encrypted profiles.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { systemPaths } from './path-builder.js';
import { generateUUID } from './uuid.js';
import { audit } from './audit.js';
import { getUser, getUserByUsername } from './users.js';
import { eventBus } from './infrastructure/event-bus/client.js';

const LOG_PREFIX = '[sessions]';

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
    [key: string]: unknown; // Allow additional metadata fields with unknown type for safety
  };
}

/**
 * Session storage
 */
interface SessionStore {
  sessions: Session[];
  version: number;
  /** One authenticated selection for the current server, shared with Brain workers. */
  runtime?: { id: string; pid: number; sessionId?: string; selectionRevision?: number };
}

let ownedRuntimeId: string | undefined;

/** Called by the Coordinator's existing startup owner, never by a background worker. */
export function beginAuthenticatedRuntime(): void {
  const id = generateUUID();
  mutateSessions(store => { store.runtime = { id, pid: process.pid, selectionRevision: 0 }; });
  ownedRuntimeId = id;
}

function liveRuntime(store: SessionStore): SessionStore['runtime'] | undefined {
  const runtime = store.runtime;
  if (!runtime?.id || !Number.isSafeInteger(runtime.pid) || runtime.pid < 1) return undefined;
  try { process.kill(runtime.pid, 0); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return undefined;
    throw error;
  }
  return runtime;
}

export function getAuthenticatedRuntimeId(): string | undefined {
  return liveRuntime(loadSessions())?.id;
}

/** Authentication handlers call this only after checking profile storage readiness. */
export function selectAuthenticatedSession(sessionId: string | null): void {
  mutateSessions(store => {
    if (!ownedRuntimeId || store.runtime?.id !== ownedRuntimeId || store.runtime.pid !== process.pid) {
      throw new Error('Only the current authentication runtime can select a session');
    }
    if (sessionId === null) {
      if (!store.runtime.sessionId && (store.runtime.selectionRevision ?? 0) > 0) return;
      delete store.runtime.sessionId;
      store.runtime.selectionRevision = (store.runtime.selectionRevision ?? 0) + 1;
      return;
    }
    const session = store.sessions.find(candidate => candidate.id === sessionId);
    if (!session || !(Date.parse(session.expiresAt) > Date.now()) || isSessionTooOld(session)
      || !getUser(session.userId)) throw new Error('An active authenticated session is required');
    if (store.runtime.sessionId === sessionId) return;
    store.runtime.sessionId = sessionId;
    store.runtime.selectionRevision = (store.runtime.selectionRevision ?? 0) + 1;
  });
}

/** Restore a surviving browser login on its first authenticated request after restart. */
export async function restoreAuthenticatedSession(sessionId: string, userId: string): Promise<void> {
  if (!ownedRuntimeId) return;
  const snapshot = loadSessions();
  const runtime = snapshot.runtime;
  // Explicit login, switching, logout and locking retain authority over ordinary
  // requests. In particular, polling must not undo a lock while storage unmounts.
  if (runtime?.id !== ownedRuntimeId || runtime.pid !== process.pid
    || runtime.sessionId || (runtime.selectionRevision ?? 0) !== 0) return;
  const candidate = snapshot.sessions.find(session => session.id === sessionId);
  if (!candidate || candidate.userId !== userId || candidate.role === 'guest'
    || !(Date.parse(candidate.expiresAt) > Date.now()) || isSessionTooOld(candidate)
    || !getUser(userId)) return;

  const { getEncryptionStatus } = await import('./encryption-manager.js');
  const storage = await getEncryptionStatus(userId);
  if (!storage.unlocked || !storage.available || storage.error) return;

  mutateSessions(store => {
    // Storage checks can await external mounts. Do not overwrite a newer login,
    // logout, lock or server runtime when that check returns.
    if (store.runtime?.id !== runtime.id || ownedRuntimeId !== runtime.id
      || store.runtime.pid !== process.pid || store.runtime.sessionId
      || (store.runtime.selectionRevision ?? 0) !== 0) return;
    const session = store.sessions.find(entry => entry.id === sessionId);
    if (!session || session.userId !== userId || session.role === 'guest'
      || !(Date.parse(session.expiresAt) > Date.now()) || isSessionTooOld(session)
      || !getUser(userId)) return;
    store.runtime.sessionId = sessionId;
    store.runtime.selectionRevision = 1;
  });
}

/** Wake existing background owners after a committed selection change; never expose cookies. */
export function onAuthenticatedSessionChange(listener: () => void): () => void {
  return eventBus.subscribe(event => {
    if (event.event === 'session.selection_changed') listener();
  });
}

/** Locking a profile clears readiness without deleting sessions or saved work. */
export function clearAuthenticatedUser(userId: string): void {
  mutateSessions(store => {
    if (!store.runtime) return;
    const selected = store.sessions.find(session => session.id === store.runtime!.sessionId);
    if (selected && selected.userId !== userId) return;
    if (!selected && (store.runtime.selectionRevision ?? 0) > 0) return;
    delete store.runtime.sessionId;
    store.runtime.selectionRevision = (store.runtime.selectionRevision ?? 0) + 1;
  });
}

// Session expiration times
const OWNER_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const GUEST_SESSION_DURATION = 60 * 60 * 1000; // 1 hour

// Maximum session age (absolute limit regardless of activity)
// After this time from creation, session MUST be re-authenticated
const MAX_SESSION_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// Request bursts should not rewrite the complete session store for every API
// call. Expiry is absolute, so coalescing this informational timestamp does not
// extend session lifetime or weaken validation.
export const SESSION_ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;

export function shouldPersistSessionActivity(
  session: Pick<Session, 'lastActivity'>,
  nowMs = Date.now()
): boolean {
  const lastActivityMs = Date.parse(session.lastActivity);
  return !Number.isFinite(lastActivityMs)
    || nowMs - lastActivityMs >= SESSION_ACTIVITY_WRITE_INTERVAL_MS;
}

/**
 * Check if session has exceeded maximum age
 */
function isSessionTooOld(session: Session): boolean {
  const createdAt = new Date(session.createdAt);
  const now = new Date();
  return !Number.isFinite(createdAt.getTime()) || (now.getTime() - createdAt.getTime()) > MAX_SESSION_AGE;
}

let sessionDatabase: Database.Database | undefined;

function database(): Database.Database {
  if (sessionDatabase) return sessionDatabase;
  fs.mkdirSync(path.dirname(systemPaths.sessionsFile), { recursive: true });
  const db = new Database(systemPaths.sessionsFile);
  try {
    fs.chmodSync(systemPaths.sessionsFile, 0o600);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.exec('CREATE TABLE IF NOT EXISTS session_store (id INTEGER PRIMARY KEY CHECK(id = 1), document TEXT NOT NULL)');
    const legacy = path.join(systemPaths.run, 'sessions.json');
    db.transaction(() => {
      if (db.prepare('SELECT 1 FROM session_store WHERE id = 1').get()) return;
      const store: SessionStore = fs.existsSync(legacy)
        ? JSON.parse(fs.readFileSync(legacy, 'utf8')) : { sessions: [], version: 1 };
      if (!Array.isArray(store.sessions) || store.version !== 1) throw new Error('Invalid legacy session database');
      // Import cookies, not an authentication selection from an earlier server.
      delete store.runtime;
      db.prepare('INSERT INTO session_store VALUES (1, ?)').run(JSON.stringify(store));
    }).immediate();
    // The old file is an inert, recoverable migration backup, never a fallback.
    if (fs.existsSync(legacy)) {
      try {
        fs.chmodSync(legacy, 0o600);
        fs.renameSync(legacy, `${legacy}.migrated-${generateUUID()}`);
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    sessionDatabase = db;
    return db;
  } catch (error) { db.close(); throw error; }
}

function loadSessions(): SessionStore {
  const row = database().prepare('SELECT document FROM session_store WHERE id = 1').get() as { document: string };
  return JSON.parse(row.document);
}

/** Read, change and commit at one owner; concurrent activity cannot overwrite login/logout. */
function mutateSessions<T>(mutate: (store: SessionStore) => T): T {
  const db = database();
  let selectionChanged = false;
  const result = db.transaction(() => {
    const store = loadSessions();
    const before = JSON.stringify(store);
    const selectedBefore = store.runtime?.sessionId;
    const result = mutate(store);
    if (store.runtime?.sessionId && !store.sessions.some(session => session.id === store.runtime!.sessionId
      && Date.parse(session.expiresAt) > Date.now() && !isSessionTooOld(session))) {
      delete store.runtime.sessionId;
      store.runtime.selectionRevision = (store.runtime.selectionRevision ?? 0) + 1;
    }
    const after = JSON.stringify(store);
    if (after !== before) db.prepare('UPDATE session_store SET document = ? WHERE id = 1').run(after);
    selectionChanged = selectedBefore !== store.runtime?.sessionId;
    return result;
  }).immediate();
  if (selectionChanged) eventBus.emit('core', 'session.selection_changed');
  return result;
}

/**
 * Create a new session
 */
export function createSession(
  userId: string,
  role: 'owner' | 'standard' | 'guest',
  metadata?: { userAgent?: string; ip?: string }
): Session {

  
  // Input validation
  if (!userId || typeof userId !== 'string') {
    throw new Error('createSession: userId must be a non-empty string');
  }
  if (!role || !['owner', 'standard', 'guest'].includes(role)) {
    throw new Error('createSession: role must be owner, standard, or guest');
  }
  
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

  mutateSessions(store => { store.sessions.push(session); });

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

  
  // Input validation
  if (!sessionId || typeof sessionId !== 'string') {
    console.error(`${LOG_PREFIX} Invalid sessionId: ${sessionId}`);
    return null;
  }
  
  const store = loadSessions();
  return store.sessions.find((s) => s.id === sessionId) || null;
}

/**
 * Validate session (check expiration and max age, update activity)
 */
export function validateSession(sessionId: string): Session | null {

  
  // Input validation
  if (!sessionId || typeof sessionId !== 'string') {
    console.error(`${LOG_PREFIX} Invalid sessionId provided for validation: ${sessionId}`);
    return null;
  }
  
  return mutateSessions(store => {
    const session = store.sessions.find((s) => s.id === sessionId);

    if (!session) {
      return null;
    }

    // Check if expired
    const now = new Date();
    const expiresAt = new Date(session.expiresAt);

    if (!Number.isFinite(expiresAt.getTime()) || now >= expiresAt) {
      // Session expired, delete it
      store.sessions = store.sessions.filter((s) => s.id !== sessionId);

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

      audit({
        level: 'info',
        category: 'security',
        event: 'session_max_age_exceeded',
        details: { sessionId, userId: session.userId, createdAt: session.createdAt },
        actor: session.userId,
      });

      return null;
    }

    // Coalesce activity persistence. Expiry and max-age removals above remain
    // immediate; this timestamp is used only for activity display/selection.
    if (shouldPersistSessionActivity(session, now.getTime())) {
      session.lastActivity = now.toISOString();
    }

    return session;
  });
}

/**
 * Delete session (logout)
 */
export function deleteSession(sessionId: string): boolean {

  
  // Input validation
  if (!sessionId || typeof sessionId !== 'string') {
    console.error(`${LOG_PREFIX} Invalid sessionId provided for deletion: ${sessionId}`);
    return false;
  }
  
  return mutateSessions(store => {
    const session = store.sessions.find((s) => s.id === sessionId);

    if (!session) {
      return false;
    }

    store.sessions = store.sessions.filter((s) => s.id !== sessionId);
    // Logout can race the first request after restart, before any selection exists.
    if (store.runtime && !store.runtime.sessionId) {
      store.runtime.selectionRevision = Math.max(1, store.runtime.selectionRevision ?? 0);
    }

    audit({
      level: 'info',
      category: 'security',
      event: 'session_deleted',
      details: { sessionId, userId: session.userId },
      actor: session.userId,
    });

    return true;
  });
}

/**
 * Delete all sessions for a user
 */
export function deleteUserSessions(userId: string): number {

  
  // Input validation
  if (!userId || typeof userId !== 'string') {
    console.error(`${LOG_PREFIX} Invalid userId provided for session deletion: ${userId}`);
    return 0;
  }
  
  return mutateSessions(store => {
    const userSessions = store.sessions.filter((s) => s.userId === userId);
    const count = userSessions.length;

    store.sessions = store.sessions.filter((s) => s.userId !== userId);

    if (count > 0) {
      if (store.runtime && !store.runtime.sessionId) {
        store.runtime.selectionRevision = Math.max(1, store.runtime.selectionRevision ?? 0);
      }
      audit({
        level: 'info',
        category: 'security',
        event: 'user_sessions_deleted',
        details: { userId, count },
        actor: userId,
      });
    }

    return count;
  });
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
  return mutateSessions(store => {
    const now = new Date();
    const before = store.sessions.length;

    store.sessions = store.sessions.filter((s) => {
      const expiresAt = new Date(s.expiresAt);
      return now <= expiresAt;
    });

    const removed = before - store.sessions.length;

    if (removed > 0) {

      audit({
        level: 'info',
        category: 'system',
        event: 'sessions_cleaned_up',
        details: { removed, remaining: store.sessions.length },
        actor: 'system',
      });
    }

    return removed;
  });
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
  mutateSessions(store => {
    const index = store.sessions.findIndex((s) => s.id === session.id);

    if (index !== -1) {
      store.sessions[index] = session;
    }
  });
}

/**
 * Extend session expiration (refresh)
 */
export function refreshSession(sessionId: string): Session | null {

  
  // Input validation
  if (!sessionId || typeof sessionId !== 'string') {
    console.error(`${LOG_PREFIX} Invalid sessionId provided for refresh: ${sessionId}`);
    return null;
  }
  
  return mutateSessions(store => {
    const session = store.sessions.find((s) => s.id === sessionId);

    if (!session) {
      return null;
    }

    // Check if already expired
    const now = new Date();
    const expiresAt = new Date(session.expiresAt);

    if (!Number.isFinite(expiresAt.getTime()) || now >= expiresAt) {
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

    audit({
      level: 'info',
      category: 'security',
      event: 'session_refreshed',
      details: { sessionId, userId: session.userId, expiresAt: session.expiresAt },
      actor: session.userId,
    });

    return session;
  });
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
 * Resolve the profile authenticated and storage-ready in this server lifetime.
 * Stored cookies and activity history alone do not activate background recovery.
 */
export function getCurrentlyActiveUser(): { userId: string; username: string; role: string } | null {
  const store = loadSessions();
  const runtime = liveRuntime(store);
  const session = runtime?.sessionId && store.sessions.find(candidate => candidate.id === runtime.sessionId);
  if (!session || !(Date.parse(session.expiresAt) > Date.now()) || isSessionTooOld(session)) return null;
  const user = getUser(session.userId);
  return user ? { userId: user.id, username: user.username, role: user.role } : null;
}

/**
 * Get the target user for agent execution
 *
 * Priority order:
 * 1. Explicit username option (from --user CLI arg)
 * 2. MH_TRIGGER_USERNAME environment variable (set by API when user triggers agent)
 * 3. getCurrentlyActiveUser() fallback (for scheduler-triggered agents)
 *
 * This ensures that:
 * - API-triggered agents ALWAYS process the authenticated user's data
 * - Scheduler-triggered agents process the currently active authenticated user
 * - CLI can override with explicit --user flag
 *
 * @param options - Optional object with username property
 * @returns User info or null if no user can be determined
 */
export function getTargetUser(options?: { username?: string }): { userId: string; username: string; role: string } | null {
  // Priority 1: Explicit username from options (--user CLI arg)
  if (options?.username) {
    const user = getUserByUsername(options.username);
    return user ? { userId: user.id, username: user.username, role: user.role } : null;
  }

  // Priority 2: MH_TRIGGER_USERNAME from API (user who clicked the button)
  const triggerUsername = process.env.MH_TRIGGER_USERNAME;
  if (triggerUsername) {
    const user = getUserByUsername(triggerUsername);
    return user ? { userId: user.id, username: user.username, role: user.role } : null;
  }

  // Priority 3: Current authenticated user (scheduler fallback)
  return getCurrentlyActiveUser();
}
