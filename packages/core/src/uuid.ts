/**
 * UUID v4 generation utility
 *
 * Uses native crypto.randomUUID() when available (Node.js 14.17+, 16.7+, 18+)
 * Falls back to manual generation for older Node.js versions (e.g., nodejs-mobile-cordova on Node 12)
 *
 * React Native migration note:
 * nodejs-mobile-react-native uses Node.js 18, which has native randomUUID()
 * The fallback is only needed for legacy Capacitor builds
 */

import { randomBytes, randomUUID as cryptoRandomUUID } from 'crypto';

// Check if native randomUUID is available
const hasNativeRandomUUID = typeof cryptoRandomUUID === 'function';

/**
 * Generate a UUID v4 string
 * Uses native crypto.randomUUID() when available (Node.js 18+)
 * Falls back to manual generation for Node.js 12 compatibility
 */
export function generateUUID(): string {
  // Use native implementation when available (Node.js 14.17+, 16.7+, 18+)
  if (hasNativeRandomUUID) {
    return cryptoRandomUUID();
  }

  // Fallback for Node.js 12 (legacy Capacitor mobile)
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
