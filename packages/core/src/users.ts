/**
 * User Management System
 *
 * Handles user accounts, authentication, and role-based access.
 * Stores users in persona/users.json with bcrypt password hashing.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import { paths } from './paths.js';
import { audit } from './audit.js';

const BCRYPT_ROUNDS = 12; // Standard secure rounds for bcrypt

/**
 * User account
 */
export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: 'owner' | 'guest';
  createdAt: string;
  lastLogin?: string;
  metadata?: {
    displayName?: string;
    email?: string;
  };
}

/**
 * User without sensitive fields (for API responses)
 */
export interface SafeUser {
  id: string;
  username: string;
  role: 'owner' | 'guest';
  createdAt: string;
  lastLogin?: string;
  metadata?: {
    displayName?: string;
    email?: string;
  };
}

/**
 * User storage
 */
interface UserStore {
  users: User[];
  version: number;
}

const USERS_FILE = path.join(paths.persona, 'users.json');

/**
 * Load users from file
 */
function loadUsers(): UserStore {
  if (!fs.existsSync(USERS_FILE)) {
    return { users: [], version: 1 };
  }

  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(raw) as UserStore;
  } catch (error) {
    console.error('[users] Failed to load users:', error);
    return { users: [], version: 1 };
  }
}

/**
 * Save users to file
 */
function saveUsers(store: UserStore): void {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (error) {
    console.error('[users] Failed to save users:', error);
    throw error;
  }
}

/**
 * Hash password using bcrypt with per-user salts
 *
 * Uses bcrypt with 12 rounds for secure password hashing.
 * Each password gets a unique salt automatically.
 */
function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

/**
 * Verify password against bcrypt hash
 *
 * Safely compares password with hash using constant-time comparison.
 */
function verifyPassword(password: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(password, hash);
  } catch (error) {
    // Invalid hash format
    console.error('[users] Password verification error:', error);
    return false;
  }
}

/**
 * Initialize user system (create empty users file if needed)
 */
export function initUsers(): void {
  if (!fs.existsSync(USERS_FILE)) {
    const store: UserStore = {
      users: [],
      version: 1,
    };
    saveUsers(store);

    audit({
      level: 'info',
      category: 'system',
      event: 'users_initialized',
      details: { file: USERS_FILE },
      actor: 'system',
    });
  }
}

/**
 * Check if any users exist
 */
export function hasUsers(): boolean {
  const store = loadUsers();
  return store.users.length > 0;
}

/**
 * Check if owner exists
 */
export function hasOwner(): boolean {
  const store = loadUsers();
  return store.users.some((u) => u.role === 'owner');
}

/**
 * Create a new user
 */
export function createUser(
  username: string,
  password: string,
  role: 'owner' | 'guest',
  metadata?: { displayName?: string; email?: string }
): SafeUser {
  const store = loadUsers();

  // Check if username already exists
  if (store.users.some((u) => u.username === username)) {
    throw new Error(`Username '${username}' already exists`);
  }

  // Only allow one owner
  if (role === 'owner' && hasOwner()) {
    throw new Error('Owner account already exists');
  }

  // Validate password strength (basic)
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  const user: User = {
    id: randomUUID(),
    username,
    passwordHash: hashPassword(password),
    role,
    createdAt: new Date().toISOString(),
    metadata,
  };

  store.users.push(user);
  saveUsers(store);

  audit({
    level: 'info',
    category: 'security',
    event: 'user_created',
    details: { userId: user.id, username, role },
    actor: 'system',
  });

  return stripSensitiveFields(user);
}

/**
 * Authenticate user with username and password
 */
export function authenticateUser(
  username: string,
  password: string
): SafeUser | null {
  const store = loadUsers();
  const user = store.users.find((u) => u.username === username);

  if (!user) {
    audit({
      level: 'warn',
      category: 'security',
      event: 'authentication_failed',
      details: { username, reason: 'user_not_found' },
      actor: 'anonymous',
    });
    return null;
  }

  if (!verifyPassword(password, user.passwordHash)) {
    audit({
      level: 'warn',
      category: 'security',
      event: 'authentication_failed',
      details: { username, userId: user.id, reason: 'invalid_password' },
      actor: user.id,
    });
    return null;
  }

  // Update last login
  user.lastLogin = new Date().toISOString();
  saveUsers(store);

  audit({
    level: 'info',
    category: 'security',
    event: 'authentication_success',
    details: { userId: user.id, username, role: user.role },
    actor: user.id,
  });

  return stripSensitiveFields(user);
}

/**
 * Get user by ID
 */
export function getUser(id: string): SafeUser | null {
  const store = loadUsers();
  const user = store.users.find((u) => u.id === id);
  return user ? stripSensitiveFields(user) : null;
}

/**
 * Get user by username
 */
export function getUserByUsername(username: string): SafeUser | null {
  const store = loadUsers();
  const user = store.users.find((u) => u.username === username);
  return user ? stripSensitiveFields(user) : null;
}

/**
 * List all users (without passwords)
 */
export function listUsers(): SafeUser[] {
  const store = loadUsers();
  return store.users.map(stripSensitiveFields);
}

/**
 * Delete user by ID
 */
export function deleteUser(id: string): boolean {
  const store = loadUsers();
  const user = store.users.find((u) => u.id === id);

  if (!user) {
    return false;
  }

  // Cannot delete owner
  if (user.role === 'owner') {
    throw new Error('Cannot delete owner account');
  }

  store.users = store.users.filter((u) => u.id !== id);
  saveUsers(store);

  audit({
    level: 'info',
    category: 'security',
    event: 'user_deleted',
    details: { userId: id, username: user.username },
    actor: 'system',
  });

  return true;
}

/**
 * Update user's last login timestamp
 */
export function updateLastLogin(userId: string): void {
  const store = loadUsers();
  const user = store.users.find((u) => u.id === userId);

  if (user) {
    user.lastLogin = new Date().toISOString();
    saveUsers(store);
  }
}

/**
 * Strip sensitive fields from user object
 */
function stripSensitiveFields(user: User): SafeUser {
  const { passwordHash, ...safe } = user;
  return safe;
}

/**
 * Change user password
 */
export function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string
): boolean {
  const store = loadUsers();
  const user = store.users.find((u) => u.id === userId);

  if (!user) {
    return false;
  }

  if (!verifyPassword(oldPassword, user.passwordHash)) {
    audit({
      level: 'warn',
      category: 'security',
      event: 'password_change_failed',
      details: { userId, reason: 'invalid_old_password' },
      actor: userId,
    });
    return false;
  }

  if (newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  user.passwordHash = hashPassword(newPassword);
  saveUsers(store);

  audit({
    level: 'info',
    category: 'security',
    event: 'password_changed',
    details: { userId },
    actor: userId,
  });

  return true;
}

/**
 * Update user password (without verifying old password)
 * Use this when you've already verified the user's identity via other means
 */
export function updatePassword(userId: string, newPassword: string): void {
  const store = loadUsers();
  const user = store.users.find((u) => u.id === userId);

  if (!user) {
    throw new Error('User not found');
  }

  if (newPassword.length < 4) {
    throw new Error('Password must be at least 4 characters');
  }

  user.passwordHash = hashPassword(newPassword);
  saveUsers(store);

  audit({
    level: 'info',
    category: 'security',
    event: 'password_updated',
    details: { userId },
    actor: userId,
  });
}

/**
 * Verify password for a user by username
 * Returns true if password matches, false otherwise
 */
export function verifyUserPassword(username: string, password: string): boolean {
  const store = loadUsers();
  const user = store.users.find((u) => u.username === username);

  if (!user) {
    return false;
  }

  return verifyPassword(password, user.passwordHash);
}

/**
 * Update username
 */
export function updateUsername(userId: string, newUsername: string): void {
  const store = loadUsers();
  const user = store.users.find((u) => u.id === userId);

  if (!user) {
    throw new Error('User not found');
  }

  // Validate username
  if (!newUsername || newUsername.length < 3 || newUsername.length > 50) {
    throw new Error('Username must be 3-50 characters');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(newUsername)) {
    throw new Error('Username can only contain letters, numbers, underscore, and hyphen');
  }

  // Check if username already exists
  const existing = store.users.find((u) => u.username === newUsername && u.id !== userId);
  if (existing) {
    throw new Error('Username already exists');
  }

  const oldUsername = user.username;
  user.username = newUsername;
  saveUsers(store);

  audit({
    level: 'info',
    category: 'security',
    event: 'username_changed',
    details: { userId, oldUsername, newUsername },
    actor: userId,
  });
}

/**
 * Update user metadata (display name, email)
 */
export function updateUserMetadata(
  userId: string,
  metadata: { displayName?: string; email?: string }
): void {
  const store = loadUsers();
  const user = store.users.find((u) => u.id === userId);

  if (!user) {
    throw new Error('User not found');
  }

  user.metadata = {
    ...user.metadata,
    ...metadata,
  };

  saveUsers(store);

  audit({
    level: 'info',
    category: 'data_change',
    event: 'user_metadata_updated',
    details: { userId, metadata },
    actor: userId,
  });
}
