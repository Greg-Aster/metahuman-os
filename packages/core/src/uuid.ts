/**
 * UUID v4 generation utility
 * Provides a polyfill for crypto.randomUUID() which is not available in Node.js 12
 * (nodejs-mobile uses Node.js v12.19.0)
 */

import { randomBytes } from 'crypto';

/**
 * Generate a UUID v4 string
 * Compatible with Node.js 12+ (uses randomBytes instead of randomUUID)
 */
export function generateUUID(): string {
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
