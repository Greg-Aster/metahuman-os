/**
 * Encryption Handler
 *
 * Handles encryption status and capabilities
 * Supports LUKS, VeraCrypt, and AES-256 encryption
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { 
  getEncryptionCapabilities,
  getEncryptionStatus
} from '../../encryption-manager.js';

/**
 * GET /api/encryption
 *
 * Get encryption status and available capabilities
 */
export async function handleGetEncryption(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    // Get available encryption capabilities
    const capabilities = getEncryptionCapabilities();

    // All users are now authenticated (no anonymous access)
    // Get user's encryption status
    const status = await getEncryptionStatus(req.user.userId);

    return {
      status: 200,
      data: {
        capabilities,
        status,
      },
    };
  } catch (error) {
    console.error('[encryption] Error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
