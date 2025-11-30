/**
 * Storage Devices API
 *
 * GET: List available storage devices for profile location
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser } from '@metahuman/core';
import {
  detectStorageDevices,
  formatBytes,
  isExternalStorage,
} from '@metahuman/core/external-storage';

/**
 * GET /api/profile-path/devices
 *
 * List available storage devices
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

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
      suggestedPath: `${device.path}/metahuman-profiles/${user.username}`,
    }));

    return new Response(
      JSON.stringify({
        devices: formattedDevices,
        count: formattedDevices.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    if ((error as Error).message?.includes('Not authenticated')) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw error;
  }
};
