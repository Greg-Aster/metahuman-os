import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';

export interface RecoveryCodes {
  codes: string[];
  createdAt: string;
  usedCodes: string[];
}

/**
 * Generate 10 random recovery codes
 * Each code is 16 characters (4 groups of 4)
 * Example: ABCD-EFGH-IJKL-MNOP
 */
export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];

  for (let i = 0; i < 10; i++) {
    // Generate 16 random bytes
    const bytes = crypto.randomBytes(8);
    // Convert to uppercase hex and format as XXXX-XXXX-XXXX-XXXX
    const hex = bytes.toString('hex').toUpperCase();
    const formatted = `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
    codes.push(formatted);
  }

  return codes;
}

/**
 * Save recovery codes to user's profile directory
 */
export function saveRecoveryCodes(username: string, codes: string[]): string {
  const profileDir = path.join(paths.root, 'profiles', username);
  const recoveryFile = path.join(profileDir, 'recovery-codes.json');

  // Ensure profile directory exists
  fs.mkdirSync(profileDir, { recursive: true });

  const data: RecoveryCodes = {
    codes,
    createdAt: new Date().toISOString(),
    usedCodes: []
  };

  fs.writeFileSync(recoveryFile, JSON.stringify(data, null, 2));

  return recoveryFile;
}

/**
 * Load recovery codes for a user
 */
export function loadRecoveryCodes(username: string): RecoveryCodes | null {
  const profileDir = path.join(paths.root, 'profiles', username);
  const recoveryFile = path.join(profileDir, 'recovery-codes.json');

  if (!fs.existsSync(recoveryFile)) {
    return null;
  }

  const data = fs.readFileSync(recoveryFile, 'utf-8');
  return JSON.parse(data) as RecoveryCodes;
}

/**
 * Verify a recovery code and mark it as used
 * Returns true if valid and unused, false otherwise
 */
export function verifyRecoveryCode(username: string, code: string): boolean {
  const data = loadRecoveryCodes(username);

  if (!data) {
    return false;
  }

  // Check if code exists and hasn't been used
  const codeIndex = data.codes.indexOf(code.toUpperCase());

  if (codeIndex === -1) {
    return false; // Code doesn't exist
  }

  if (data.usedCodes.includes(code.toUpperCase())) {
    return false; // Code already used
  }

  // Mark code as used
  data.usedCodes.push(code.toUpperCase());

  const profileDir = path.join(paths.root, 'profiles', username);
  const recoveryFile = path.join(profileDir, 'recovery-codes.json');
  fs.writeFileSync(recoveryFile, JSON.stringify(data, null, 2));

  return true;
}

/**
 * Get remaining (unused) recovery codes for a user
 */
export function getRemainingCodes(username: string): string[] {
  const data = loadRecoveryCodes(username);

  if (!data) {
    return [];
  }

  return data.codes.filter(code => !data.usedCodes.includes(code));
}
