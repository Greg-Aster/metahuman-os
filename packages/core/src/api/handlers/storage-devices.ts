/**
 * Storage Devices Handler
 *
 * Lists available storage devices for profile location
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import {
  detectStorageDevices,
  formatBytes,
  isExternalStorage,
} from '../../external-storage.js';

/**
 * GET /api/profile-path/devices
 *
 * List available storage devices
 * Requires authentication
 */
export async function handleListStorageDevices(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return {
      status: 401,
      error: 'Not authenticated',
    };
  }

  try {
    const devices = await detectStorageDevices();

    // Format devices for API response
    const formattedDevices = devices.map((device) => ({
      id: device.id,
      path: device.path,
      type: device.type,
      label: device.label || device.path,
      fsType: device.fsType,
      mounted: device.mounted,
      writable: device.writable,
      freeSpace: device.freeSpace,
      freeSpaceFormatted: formatBytes(device.freeSpace),
      totalSpace: device.totalSpace,
      totalSpaceFormatted: formatBytes(device.totalSpace),
      isExternal: isExternalStorage(device.path),
      // Suggested profile path on this device
      suggestedPath: `${device.path}/metahuman-profiles/${req.user.username}`,
    }));

    return {
      status: 200,
      data: {
        devices: formattedDevices,
        count: formattedDevices.length,
      },
    };
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}