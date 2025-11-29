/**
 * External Storage Detection Module
 *
 * Detects and monitors external storage devices (USB drives, network mounts).
 * Used for profile location management.
 *
 * Linux-specific implementation using:
 * - /proc/mounts for mounted filesystems
 * - lsblk for device information
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Detected storage device
 */
export interface StorageDevice {
  /** Unique identifier (UUID or device path) */
  id: string;
  /** Current mount point */
  path: string;
  /** Storage type */
  type: 'internal' | 'usb' | 'network' | 'encrypted' | 'unknown';
  /** User-friendly label */
  label?: string;
  /** Filesystem type (ext4, ntfs, etc.) */
  fsType?: string;
  /** Whether currently mounted */
  mounted: boolean;
  /** Whether writable */
  writable: boolean;
  /** Available space in bytes */
  freeSpace?: number;
  /** Total space in bytes */
  totalSpace?: number;
}

/**
 * Storage change event
 */
export interface StorageEvent {
  type: 'mounted' | 'unmounted';
  device: StorageDevice;
  timestamp: string;
}

/**
 * Mount entry from /proc/mounts
 */
interface MountEntry {
  device: string;
  mountPoint: string;
  fsType: string;
  options: string;
}

/**
 * Parse /proc/mounts to get mounted filesystems
 */
function parseProcMounts(): MountEntry[] {
  try {
    const content = fs.readFileSync('/proc/mounts', 'utf-8');
    const entries: MountEntry[] = [];

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;

      const parts = line.split(' ');
      if (parts.length >= 4) {
        entries.push({
          device: parts[0],
          mountPoint: parts[1].replace(/\\040/g, ' '), // Handle spaces
          fsType: parts[2],
          options: parts[3],
        });
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Get block device information using lsblk
 */
function getLsblkInfo(): Map<string, any> {
  const deviceInfo = new Map<string, any>();

  try {
    const output = execSync(
      'lsblk -J -o NAME,UUID,MOUNTPOINT,FSTYPE,TYPE,SIZE,FSAVAIL,LABEL,HOTPLUG 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000 }
    );

    const data = JSON.parse(output);

    function processDevice(device: any, parentHotplug = false) {
      const info = {
        uuid: device.uuid,
        mountpoint: device.mountpoint,
        fsType: device.fstype,
        type: device.type,
        size: device.size,
        fsAvail: device.fsavail,
        label: device.label,
        hotplug: device.hotplug === '1' || device.hotplug === true || parentHotplug,
      };

      if (device.mountpoint) {
        deviceInfo.set(device.mountpoint, info);
      }
      if (device.name) {
        deviceInfo.set(`/dev/${device.name}`, info);
      }

      // Process children (partitions)
      if (device.children) {
        for (const child of device.children) {
          processDevice(child, info.hotplug);
        }
      }
    }

    if (data.blockdevices) {
      for (const device of data.blockdevices) {
        processDevice(device);
      }
    }
  } catch {
    // lsblk not available or failed
  }

  return deviceInfo;
}

/**
 * Determine storage type from mount info
 */
function determineStorageType(
  mount: MountEntry,
  lsblkInfo: Map<string, any>
): StorageDevice['type'] {
  const deviceInfo = lsblkInfo.get(mount.mountPoint) || lsblkInfo.get(mount.device);

  // Check for network filesystems
  const networkFs = ['nfs', 'nfs4', 'cifs', 'smbfs', 'sshfs', 'fuse.sshfs'];
  if (networkFs.includes(mount.fsType)) {
    return 'network';
  }

  // Check for encrypted filesystems
  if (
    mount.fsType === 'crypto_LUKS' ||
    mount.device.includes('dm-') ||
    mount.device.includes('/mapper/')
  ) {
    return 'encrypted';
  }

  // Check for USB/removable devices
  if (deviceInfo?.hotplug) {
    return 'usb';
  }

  // Check by mount point
  const usbPaths = ['/media/', '/mnt/', '/run/media/'];
  if (usbPaths.some((p) => mount.mountPoint.startsWith(p))) {
    return 'usb';
  }

  // System paths are internal
  const systemPaths = ['/', '/home', '/boot', '/var', '/usr'];
  if (systemPaths.includes(mount.mountPoint)) {
    return 'internal';
  }

  return 'unknown';
}

/**
 * Parse size string (e.g., "1.8T", "500G") to bytes
 */
function parseSizeToBytes(sizeStr?: string): number | undefined {
  if (!sizeStr) return undefined;

  const match = sizeStr.match(/^([\d.]+)([KMGTP]?)$/i);
  if (!match) return undefined;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  const multipliers: Record<string, number> = {
    '': 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
  };

  return Math.floor(value * (multipliers[unit] || 1));
}

/**
 * Check if a path is writable
 */
function isPathWritable(mountPath: string): boolean {
  try {
    fs.accessSync(mountPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect all available storage devices
 *
 * @returns Array of detected storage devices
 */
export async function detectStorageDevices(): Promise<StorageDevice[]> {
  const mounts = parseProcMounts();
  const lsblkInfo = getLsblkInfo();
  const devices: StorageDevice[] = [];

  // Filter for real filesystems (skip virtual/system filesystems)
  const virtualFs = [
    'proc', 'sysfs', 'devtmpfs', 'devpts', 'tmpfs', 'securityfs',
    'cgroup', 'cgroup2', 'pstore', 'bpf', 'tracefs', 'debugfs',
    'hugetlbfs', 'mqueue', 'configfs', 'fusectl', 'efivarfs',
    'autofs', 'overlay', 'squashfs', 'nsfs',
  ];

  for (const mount of mounts) {
    if (virtualFs.includes(mount.fsType)) continue;
    if (mount.mountPoint.startsWith('/snap/')) continue;

    const deviceInfo = lsblkInfo.get(mount.mountPoint) || lsblkInfo.get(mount.device);
    const storageType = determineStorageType(mount, lsblkInfo);

    // Skip system internals for selection (but could still show them)
    if (mount.mountPoint === '/' || mount.mountPoint === '/boot') continue;

    const device: StorageDevice = {
      id: deviceInfo?.uuid || mount.device,
      path: mount.mountPoint,
      type: storageType,
      label: deviceInfo?.label || path.basename(mount.mountPoint),
      fsType: mount.fsType,
      mounted: true,
      writable: isPathWritable(mount.mountPoint),
      freeSpace: parseSizeToBytes(deviceInfo?.fsAvail),
      totalSpace: parseSizeToBytes(deviceInfo?.size),
    };

    devices.push(device);
  }

  // Sort: USB/external first, then by path
  devices.sort((a, b) => {
    const typeOrder = { usb: 0, network: 1, encrypted: 2, internal: 3, unknown: 4 };
    const aOrder = typeOrder[a.type] ?? 4;
    const bOrder = typeOrder[b.type] ?? 4;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.path.localeCompare(b.path);
  });

  return devices;
}

/**
 * Check if a specific path is on external storage
 *
 * @param targetPath - Path to check
 * @returns true if path is on external/removable storage
 */
export function isExternalStorage(targetPath: string): boolean {
  const normalized = path.resolve(targetPath);
  const mounts = parseProcMounts();
  const lsblkInfo = getLsblkInfo();

  // Find the mount that contains this path
  let bestMatch: MountEntry | null = null;
  let bestMatchLen = 0;

  for (const mount of mounts) {
    if (
      normalized.startsWith(mount.mountPoint) &&
      mount.mountPoint.length > bestMatchLen
    ) {
      bestMatch = mount;
      bestMatchLen = mount.mountPoint.length;
    }
  }

  if (!bestMatch) return false;

  const storageType = determineStorageType(bestMatch, lsblkInfo);
  return storageType === 'usb' || storageType === 'network';
}

/**
 * Get storage device info for a specific path
 *
 * @param targetPath - Path to get info for
 * @returns Storage device info or null if not found
 */
export function getStorageInfo(targetPath: string): StorageDevice | null {
  const normalized = path.resolve(targetPath);
  const mounts = parseProcMounts();
  const lsblkInfo = getLsblkInfo();

  // Find the mount that contains this path
  let bestMatch: MountEntry | null = null;
  let bestMatchLen = 0;

  for (const mount of mounts) {
    if (
      normalized.startsWith(mount.mountPoint) &&
      mount.mountPoint.length > bestMatchLen
    ) {
      bestMatch = mount;
      bestMatchLen = mount.mountPoint.length;
    }
  }

  if (!bestMatch) return null;

  const deviceInfo = lsblkInfo.get(bestMatch.mountPoint) || lsblkInfo.get(bestMatch.device);
  const storageType = determineStorageType(bestMatch, lsblkInfo);

  return {
    id: deviceInfo?.uuid || bestMatch.device,
    path: bestMatch.mountPoint,
    type: storageType,
    label: deviceInfo?.label || path.basename(bestMatch.mountPoint),
    fsType: bestMatch.fsType,
    mounted: true,
    writable: isPathWritable(bestMatch.mountPoint),
    freeSpace: parseSizeToBytes(deviceInfo?.fsAvail),
    totalSpace: parseSizeToBytes(deviceInfo?.size),
  };
}

/**
 * Check if a storage device is currently mounted and accessible
 *
 * @param deviceId - Device UUID or path
 * @returns true if device is mounted and accessible
 */
export function isDeviceMounted(deviceId: string): boolean {
  const lsblkInfo = getLsblkInfo();

  // Check by UUID
  for (const [, info] of lsblkInfo) {
    if (info.uuid === deviceId && info.mountpoint) {
      try {
        fs.accessSync(info.mountpoint, fs.constants.F_OK);
        return true;
      } catch {
        return false;
      }
    }
  }

  // Check by path
  try {
    fs.accessSync(deviceId, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format bytes to human-readable string
 *
 * @param bytes - Number of bytes
 * @returns Human-readable string (e.g., "1.5 GB")
 */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return 'Unknown';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
