/**
 * Encryption Handler
 *
 * Handles encryption status and capabilities
 * Supports LUKS, VeraCrypt, and AES-256 encryption
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { audit } from '../../audit.js';
import { 
  getEncryptionCapabilities,
  getEncryptionStatus,
  setupEncryption,
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

export async function handleSetupEncryption(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { type, password, volumePath, volumeSizeMB, useLoginPassword } = req.body ?? {};

    if (!type || !['aes256', 'luks', 'veracrypt'].includes(type)) {
      return {
        status: 400,
        data: {
          success: false,
          error: 'Invalid encryption type. Must be: aes256, luks, or veracrypt',
        },
      };
    }

    if (!password || password.length < 6) {
      return {
        status: 400,
        data: {
          success: false,
          error: 'Password must be at least 6 characters',
        },
      };
    }

    const capabilities = getEncryptionCapabilities();

    if (type === 'luks' && !capabilities.luks.available) {
      return {
        status: 400,
        data: {
          success: false,
          error: 'LUKS not available. Install cryptsetup: sudo apt install cryptsetup',
        },
      };
    }

    if (type === 'veracrypt' && !capabilities.veracrypt.available) {
      return {
        status: 400,
        data: {
          success: false,
          error: 'VeraCrypt not installed. Visit: https://veracrypt.fr',
        },
      };
    }

    if ((type === 'luks' || type === 'veracrypt') && !volumePath) {
      return {
        status: 400,
        data: {
          success: false,
          error: 'volumePath required for volume encryption',
        },
      };
    }

    const userId = req.user.id || req.user.userId;
    const result = await setupEncryption(userId, type, password, {
      volumePath,
      volumeSizeMB: volumeSizeMB || 2048,
      useLoginPassword,
    });

    if (result.success) {
      audit({
        level: 'info',
        category: 'security',
        event: 'encryption_setup_api',
        details: {
          userId,
          username: req.user.username,
          type,
          volumePath: volumePath || null,
        },
        actor: userId,
      });
    }

    return {
      status: result.success ? 200 : 400,
      data: result,
    };
  } catch (error) {
    return {
      status: 500,
      data: {
        success: false,
        error: (error as Error).message,
      },
    };
  }
}
