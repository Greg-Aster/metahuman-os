/**
 * LUKS (Linux Unified Key Setup) Volume Encryption
 *
 * Native Linux disk encryption using dm-crypt kernel module.
 * Provides transparent filesystem-level encryption - files are
 * stored plaintext on the mounted volume.
 *
 * Benefits over per-file encryption:
 * - Faster I/O (encryption at block level)
 * - No file extension changes
 * - Filesystem metadata also encrypted
 * - Native Linux integration
 *
 * Requirements:
 * - cryptsetup package (sudo apt install cryptsetup)
 * - Root/sudo access for mount operations
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { audit } from './audit.js';

export interface LuksResult {
  success: boolean;
  error?: string;
  mountPoint?: string;
}

export interface LuksStatus {
  installed: boolean;
  version?: string;
}

export interface LuksVolumeInfo {
  volumePath: string;
  mapperName: string;
  mounted: boolean;
  mountPoint?: string;
  uuid?: string;
  cipher?: string;
  keySize?: number;
}

/**
 * Check if LUKS tools (cryptsetup) are available
 */
export function checkLuks(): LuksStatus {
  try {
    const version = execSync('cryptsetup --version', { encoding: 'utf-8' }).trim();
    const match = version.match(/cryptsetup\s+(\d+\.\d+\.?\d*)/i);
    return {
      installed: true,
      version: match?.[1],
    };
  } catch {
    return { installed: false };
  }
}

/**
 * Check if a LUKS volume is currently open (mapped)
 */
export function isLuksOpen(mapperName: string): boolean {
  const mapperPath = `/dev/mapper/${mapperName}`;
  return fs.existsSync(mapperPath);
}

/**
 * Check if a LUKS device is mounted
 */
export function isLuksMounted(mapperName: string): boolean {
  if (!isLuksOpen(mapperName)) {
    return false;
  }

  try {
    const mapperPath = `/dev/mapper/${mapperName}`;
    execSync(`findmnt -n ${mapperPath}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get mount point for a LUKS volume
 */
export function getLuksMountPoint(mapperName: string): string | null {
  try {
    const mapperPath = `/dev/mapper/${mapperName}`;
    const output = execSync(`findmnt -n -o TARGET ${mapperPath}`, { encoding: 'utf-8' });
    return output.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get UUID of a LUKS container
 */
export function getLuksUUID(volumePath: string): string | null {
  try {
    const output = execSync(`sudo cryptsetup luksUUID ${volumePath}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return output.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get detailed info about a LUKS volume
 */
export function getLuksInfo(volumePath: string, mapperName: string): LuksVolumeInfo {
  const mounted = isLuksMounted(mapperName);

  let cipher: string | undefined;
  let keySize: number | undefined;

  try {
    const output = execSync(`sudo cryptsetup luksDump ${volumePath}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const cipherMatch = output.match(/Cipher name:\s+(.+)/);
    const keySizeMatch = output.match(/MK bits:\s+(\d+)/);

    cipher = cipherMatch?.[1]?.trim();
    keySize = keySizeMatch ? parseInt(keySizeMatch[1], 10) : undefined;
  } catch {
    // Ignore errors from luksDump
  }

  return {
    volumePath,
    mapperName,
    mounted,
    mountPoint: mounted ? getLuksMountPoint(mapperName) || undefined : undefined,
    uuid: getLuksUUID(volumePath) || undefined,
    cipher,
    keySize,
  };
}

/**
 * Open (decrypt) a LUKS volume without mounting
 */
export async function openLuks(
  volumePath: string,
  mapperName: string,
  password: string
): Promise<LuksResult> {
  const status = checkLuks();
  if (!status.installed) {
    return { success: false, error: 'cryptsetup not installed. Install with: sudo apt install cryptsetup' };
  }

  if (isLuksOpen(mapperName)) {
    return { success: true }; // Already open
  }

  if (!fs.existsSync(volumePath)) {
    return { success: false, error: `Volume not found: ${volumePath}` };
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('sudo', ['cryptsetup', 'luksOpen', volumePath, mapperName], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `cryptsetup exited with code ${code}`));
        }
      });

      proc.on('error', (err) => reject(err));

      proc.stdin.write(password + '\n');
      proc.stdin.end();
    });

    audit({
      level: 'info',
      category: 'security',
      event: 'luks_volume_opened',
      details: { volumePath, mapperName },
      actor: 'system',
    });

    return { success: true };
  } catch (err) {
    const errorMsg = (err as Error).message;

    if (errorMsg.includes('No key available') || errorMsg.includes('wrong')) {
      return { success: false, error: 'Incorrect password' };
    }
    if (errorMsg.includes('not a valid LUKS')) {
      return { success: false, error: 'Not a valid LUKS volume' };
    }

    return { success: false, error: errorMsg };
  }
}

/**
 * Close a LUKS volume (remove mapping)
 */
export async function closeLuks(mapperName: string): Promise<LuksResult> {
  if (!isLuksOpen(mapperName)) {
    return { success: true }; // Already closed
  }

  // Check if mounted first
  if (isLuksMounted(mapperName)) {
    const mountPoint = getLuksMountPoint(mapperName);
    return {
      success: false,
      error: `Volume is still mounted at ${mountPoint}. Unmount first.`
    };
  }

  try {
    execSync(`sudo cryptsetup luksClose ${mapperName}`, { stdio: 'pipe' });

    audit({
      level: 'info',
      category: 'security',
      event: 'luks_volume_closed',
      details: { mapperName },
      actor: 'system',
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Mount an opened LUKS volume
 */
export async function mountLuks(
  mapperName: string,
  mountPoint: string
): Promise<LuksResult> {
  if (!isLuksOpen(mapperName)) {
    return { success: false, error: 'LUKS volume not opened. Call openLuks first.' };
  }

  if (isLuksMounted(mapperName)) {
    const existingMount = getLuksMountPoint(mapperName);
    if (existingMount === mountPoint) {
      return { success: true, mountPoint };
    }
    return { success: false, error: `Already mounted at ${existingMount}` };
  }

  // Ensure mount point exists
  if (!fs.existsSync(mountPoint)) {
    try {
      fs.mkdirSync(mountPoint, { recursive: true });
    } catch (err) {
      return { success: false, error: `Cannot create mount point: ${(err as Error).message}` };
    }
  }

  const mapperPath = `/dev/mapper/${mapperName}`;

  try {
    execSync(`sudo mount ${mapperPath} ${mountPoint}`, { stdio: 'pipe' });

    audit({
      level: 'info',
      category: 'security',
      event: 'luks_volume_mounted',
      details: { mapperName, mountPoint },
      actor: 'system',
    });

    return { success: true, mountPoint };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Unmount a LUKS volume
 */
export async function unmountLuks(mapperName: string): Promise<LuksResult> {
  if (!isLuksMounted(mapperName)) {
    return { success: true }; // Already unmounted
  }

  const mountPoint = getLuksMountPoint(mapperName);

  try {
    execSync(`sudo umount ${mountPoint}`, { stdio: 'pipe' });

    audit({
      level: 'info',
      category: 'security',
      event: 'luks_volume_unmounted',
      details: { mapperName, mountPoint },
      actor: 'system',
    });

    return { success: true };
  } catch (err) {
    const errorMsg = (err as Error).message;
    if (errorMsg.includes('target is busy')) {
      return { success: false, error: 'Volume is busy. Close all files and applications using it first.' };
    }
    return { success: false, error: errorMsg };
  }
}

/**
 * Open and mount a LUKS volume in one operation
 */
export async function openAndMountLuks(
  volumePath: string,
  mapperName: string,
  mountPoint: string,
  password: string
): Promise<LuksResult> {
  // Open the volume
  const openResult = await openLuks(volumePath, mapperName, password);
  if (!openResult.success) {
    return openResult;
  }

  // Mount it
  const mountResult = await mountLuks(mapperName, mountPoint);
  if (!mountResult.success) {
    // Try to close if mount failed
    await closeLuks(mapperName);
    return mountResult;
  }

  return { success: true, mountPoint };
}

/**
 * Unmount and close a LUKS volume in one operation
 */
export async function unmountAndCloseLuks(mapperName: string): Promise<LuksResult> {
  // Unmount first
  const unmountResult = await unmountLuks(mapperName);
  if (!unmountResult.success) {
    return unmountResult;
  }

  // Close the volume
  return await closeLuks(mapperName);
}

/**
 * Create a new LUKS encrypted container file
 *
 * @param filePath - Path for the new container file
 * @param sizeMB - Size in megabytes
 * @param password - Encryption password
 */
export async function createLuksContainer(
  filePath: string,
  sizeMB: number,
  password: string,
  onProgress?: (message: string) => void
): Promise<LuksResult> {
  const status = checkLuks();
  if (!status.installed) {
    return { success: false, error: 'cryptsetup not installed' };
  }

  if (fs.existsSync(filePath)) {
    return { success: false, error: 'File already exists' };
  }

  try {
    onProgress?.('Creating sparse file...');

    // Create sparse file for efficient storage
    execSync(`dd if=/dev/zero of="${filePath}" bs=1M count=0 seek=${sizeMB} 2>/dev/null`, { stdio: 'pipe' });

    onProgress?.('Formatting as LUKS2...');

    // Format as LUKS2 with AES-256-XTS (most secure and performant)
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        'sudo',
        [
          'cryptsetup', 'luksFormat',
          '--type', 'luks2',
          '--cipher', 'aes-xts-plain64',
          '--key-size', '512', // 256-bit AES with XTS requires 512-bit key
          '--hash', 'sha256',
          '--iter-time', '2000', // 2 seconds of PBKDF2
          '--batch-mode',
          filePath,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `luksFormat exited with code ${code}`));
        }
      });

      proc.stdin.write(password + '\n');
      proc.stdin.end();
    });

    onProgress?.('Creating filesystem...');

    // Temporarily open to create filesystem
    const tempMapper = `metahuman-setup-${Date.now()}`;

    await openLuks(filePath, tempMapper, password);

    try {
      execSync(`sudo mkfs.ext4 -L metahuman /dev/mapper/${tempMapper}`, { stdio: 'pipe' });
    } finally {
      await closeLuks(tempMapper);
    }

    audit({
      level: 'info',
      category: 'security',
      event: 'luks_container_created',
      details: { filePath, sizeMB },
      actor: 'system',
    });

    onProgress?.('Container ready!');
    return { success: true };
  } catch (err) {
    // Clean up on failure
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Ignore cleanup errors
      }
    }
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Create a MetaHuman-ready LUKS container with profile structure
 */
export async function createMetaHumanLuksContainer(
  drivePath: string,
  username: string,
  password: string,
  sizeMB: number,
  onProgress?: (message: string) => void
): Promise<{ containerPath: string; mountPoint: string }> {
  const containerPath = path.join(drivePath, `metahuman-${username}.luks`);
  const mapperName = `metahuman-${username}`;
  const mountPoint = path.join('/media/metahuman', username);

  // Create the container
  const createResult = await createLuksContainer(containerPath, sizeMB, password, onProgress);
  if (!createResult.success) {
    throw new Error(createResult.error);
  }

  onProgress?.('Opening container...');

  // Open and mount
  const mountResult = await openAndMountLuks(containerPath, mapperName, mountPoint, password);
  if (!mountResult.success) {
    throw new Error(mountResult.error);
  }

  onProgress?.('Creating profile structure...');

  // Create standard MetaHuman profile directories
  const dirs = [
    'persona',
    'memory/episodic',
    'memory/semantic',
    'memory/tasks/active',
    'memory/tasks/completed',
    'memory/inbox',
    'memory/index',
    'logs/audit',
    'etc',
    'out',
  ];

  for (const dir of dirs) {
    const fullPath = path.join(mountPoint, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  // Create marker file
  const markerPath = path.join(mountPoint, '.metahuman-profile');
  fs.writeFileSync(markerPath, JSON.stringify({
    version: 1,
    username,
    createdAt: new Date().toISOString(),
    encryption: 'luks',
    containerPath,
    mapperName,
  }, null, 2));

  onProgress?.('Container ready!');

  return { containerPath, mountPoint };
}

/**
 * LUKS container file extension
 */
export const LUKS_EXTENSION = '.luks';

/**
 * Check if a mount point contains a MetaHuman profile
 */
export function isMetaHumanLuksContainer(mountPoint: string): boolean {
  const markerPath = path.join(mountPoint, '.metahuman-profile');
  if (!fs.existsSync(markerPath)) {
    return false;
  }

  try {
    const info = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    return info.encryption === 'luks';
  } catch {
    return false;
  }
}
