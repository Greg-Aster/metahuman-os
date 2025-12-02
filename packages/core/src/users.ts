/**
 * User Management System
 *
 * Handles user accounts, authentication, and role-based access.
 * Stores users in persona/users.json with bcrypt password hashing.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { systemPaths, registerProfileStorageConfigGetter } from './path-builder.js';
import { audit } from './audit.js';
import type { OnboardingState } from './types/onboarding.js';

const BCRYPT_ROUNDS = 12; // Standard secure rounds for bcrypt

/**
 * User account
 */
/**
 * Encryption configuration for profile storage
 *
 * Three encryption modes:
 * - aes256: Per-file encryption using AES-256-GCM (application-level)
 * - luks: Linux native volume encryption (filesystem-level, fast)
 * - veracrypt: Cross-platform volume encryption
 *
 * For volume encryption (luks/veracrypt):
 * - Files are stored plaintext on the mounted volume
 * - Volume must be mounted before access
 * - Encryption is transparent at filesystem level
 *
 * For file encryption (aes256):
 * - Each file encrypted individually with .enc extension
 * - Key derived from password using PBKDF2
 * - Slower but works on any filesystem
 */
export interface ProfileEncryptionConfig {
  /** Encryption type used */
  type: 'none' | 'aes256' | 'luks' | 'veracrypt';

  /** Whether encryption is currently unlocked/mounted */
  unlocked?: boolean;

  /** Timestamp when encryption was enabled */
  encryptedAt?: string;

  // --- Volume encryption fields (luks/veracrypt) ---

  /** Path to encrypted volume/container */
  volumePath?: string;

  /** Mount point when volume is mounted */
  mountPoint?: string;

  /** Device mapper name for LUKS (e.g., 'metahuman-greggles') */
  mapperName?: string;

  // --- File encryption fields (aes256) ---

  /** Whether using login password for encryption (vs separate password) */
  useLoginPassword?: boolean;
}

/**
 * Profile storage configuration
 */
export interface ProfileStorageConfig {
  /** Custom profile directory path (absolute) */
  path: string;
  /** Storage type for UI display */
  type: 'internal' | 'external' | 'encrypted';
  /** Device UUID for external drives (optional) */
  deviceId?: string;
  /** Behavior when external storage unavailable */
  fallbackBehavior?: 'error' | 'readonly';
  /** Encryption configuration (if profile is encrypted) */
  encryption?: ProfileEncryptionConfig;
}

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: 'owner' | 'standard' | 'guest';
  createdAt: string;
  lastLogin?: string;
  metadata?: {
    displayName?: string;
    email?: string;
    onboardingState?: OnboardingState;
    profileVisibility?: 'private' | 'public';
    /** Custom profile storage location */
    profileStorage?: ProfileStorageConfig;
  };
}

/**
 * User without sensitive fields (for API responses)
 */
export interface SafeUser {
  id: string;
  username: string;
  role: 'owner' | 'standard' | 'guest';
  createdAt: string;
  lastLogin?: string;
  metadata?: {
    displayName?: string;
    email?: string;
    onboardingState?: OnboardingState;
    profileVisibility?: 'private' | 'public';
    /** Custom profile storage location */
    profileStorage?: ProfileStorageConfig;
  };
}

/**
 * User storage
 */
interface UserStore {
  users: User[];
  version: number;
}

/**
 * Get the path to the users database file.
 * Uses system-level path since users.json is a global database, not user-specific.
 */
function getUsersFilePath(): string {
  return systemPaths.usersDb;
}

/**
 * Load users from file
 */
function loadUsers(): UserStore {
  const usersFile = getUsersFilePath();
  if (!fs.existsSync(usersFile)) {
    return { users: [], version: 1 };
  }

  try {
    const raw = fs.readFileSync(usersFile, 'utf-8');
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
    fs.writeFileSync(getUsersFilePath(), JSON.stringify(store, null, 2), 'utf-8');
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
  const usersFile = getUsersFilePath();
  if (!fs.existsSync(usersFile)) {
    const store: UserStore = {
      users: [],
      version: 1,
    };
    saveUsers(store);

    audit({
      level: 'info',
      category: 'system',
      event: 'users_initialized',
      details: { file: usersFile },
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
 * Get all users
 */
export function getUsers(): User[] {
  const store = loadUsers();
  return store.users;
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
  role: 'owner' | 'standard' | 'guest',
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
 * Update arbitrary user metadata fields (display name, email, onboarding state, etc.)
 */
export function updateUserMetadata(
  userId: string,
  metadata: Record<string, any>
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

/**
 * List all public profiles (visible to guests)
 */
export function listVisibleProfiles(): SafeUser[] {
  const store = loadUsers();
  return store.users
    .filter((u) => u.metadata?.profileVisibility === 'public')
    .map(stripSensitiveFields);
}

/**
 * Update profile visibility for a user
 */
export function updateProfileVisibility(
  userId: string,
  visibility: 'private' | 'public'
): boolean {
  const store = loadUsers();
  const user = store.users.find((u) => u.id === userId);

  if (!user) {
    return false;
  }

  user.metadata = user.metadata || {};
  user.metadata.profileVisibility = visibility;

  saveUsers(store);

  audit({
    level: 'info',
    category: 'security',
    event: 'profile_visibility_changed',
    details: { userId, username: user.username, visibility },
    actor: userId,
  });

  return true;
}

/**
 * Get user metadata by username (for path resolution)
 *
 * Used by path-builder.ts to check for custom profile paths.
 * Returns undefined if user not found or no metadata.
 *
 * @param username - Username to look up
 * @returns User metadata or undefined
 */
export function getUserMetadataByUsername(
  username: string
): User['metadata'] | undefined {
  const store = loadUsers();
  const user = store.users.find((u) => u.username === username);
  return user?.metadata;
}

/**
 * Get profile storage config for a user
 *
 * Convenience function for path resolution.
 *
 * @param username - Username to look up
 * @returns ProfileStorageConfig or undefined
 */
export function getProfileStorageConfig(
  username: string
): ProfileStorageConfig | undefined {
  const metadata = getUserMetadataByUsername(username);
  return metadata?.profileStorage;
}

/**
 * Update profile storage configuration for a user
 *
 * @param userId - User ID
 * @param config - New storage configuration (or null to reset to default)
 */
export function updateProfileStorage(
  userId: string,
  config: ProfileStorageConfig | null
): void {
  const store = loadUsers();
  const user = store.users.find((u) => u.id === userId);

  if (!user) {
    throw new Error('User not found');
  }

  user.metadata = user.metadata || {};

  if (config === null) {
    delete user.metadata.profileStorage;
  } else {
    user.metadata.profileStorage = config;
  }

  saveUsers(store);

  audit({
    level: 'info',
    category: 'security',
    event: 'profile_storage_changed',
    details: {
      userId,
      username: user.username,
      newPath: config?.path ?? 'default',
      storageType: config?.type ?? 'internal',
    },
    actor: userId,
  });
}

// Register the profile storage config getter with path-builder
// This is dependency injection to avoid circular imports
registerProfileStorageConfigGetter(getProfileStorageConfig);
