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

    // If anonymous, just return capabilities
    if (req.user.role === 'anonymous') {
      return {
        status: 200,
        data: {
          capabilities,
          status: null,
          message: 'Login required to view encryption status',
        },
      };
    }

    // Get user's encryption status
    const status = await getEncryptionStatus(req.user.id);

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
