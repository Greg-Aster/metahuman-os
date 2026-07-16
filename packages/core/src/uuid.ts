/**
 * UUID v4 generation utility
 *
 * Uses native crypto.randomUUID() when available.
 * Falls back to manual generation for legacy embedded runtimes.
 *
 * React Native migration note:
 * The fallback is only needed for legacy Capacitor builds.
 */

import { randomBytes, randomUUID as cryptoRandomUUID } from 'crypto';

// Check if native randomUUID is available
const hasNativeRandomUUID = typeof cryptoRandomUUID === 'function';

/**
 * Generate a UUID v4 string
 * Uses native crypto.randomUUID() when available.
 * Falls back to manual generation for legacy runtime compatibility.
 */
export function generateUUID(): string {
  // Use the native implementation when available.
  if (hasNativeRandomUUID) {
    return cryptoRandomUUID();
  }

  // Fallback for the legacy Capacitor mobile runtime.
  const bytes = randomBytes(16);

  // Set version (4) and variant (8, 9, a, or b) bits per RFC 4122
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx

  const hex = bytes.toString('hex');

  // Format as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join('-');
}
