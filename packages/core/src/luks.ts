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
 * - Polkit setup (run: sudo ./scripts/setup-encryption.sh) OR sudo access
 *
 * Privilege Escalation:
 * - Prefers polkit (pkexec) with metahuman-luks-helper script
 * - Falls back to sudo if polkit not configured
 */

import { execSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { audit } from './audit.js';

/**
 * Path to the polkit helper script
 */
const LUKS_HELPER_PATH = '/usr/local/bin/metahuman-luks-helper';

/**
 * Check if polkit helper is installed
 */
export function isPolkitConfigured(): boolean {
  return fs.existsSync(LUKS_HELPER_PATH);
}

/**
 * Run a privileged LUKS command
 * Uses pkexec with helper if available, falls back to sudo
 */
async function runPrivileged(
  action: string,
  args: string[],
  password?: string
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const usePolkit = isPolkitConfigured();

  return new Promise((resolve) => {
    let proc;

    if (usePolkit) {
      // Use pkexec with our helper script
      proc = spawn('pkexec', [LUKS_HELPER_PATH, action, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      // Fall back to sudo with direct command
      const sudoArgs = getSudoArgsForAction(action, args);
      proc = spawn('sudo', sudoArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        stdout: '',
        stderr: err.message,
      });
    });

    // Send password to stdin if provided
    if (password) {
      proc.stdin.write(password + '\n');
    }
    proc.stdin.end();
  });
}

/**
 * Run a privileged LUKS command synchronously (for info queries)
 * Uses pkexec with helper if available, falls back to sudo
 */
function runPrivilegedSync(
  action: string,
  args: string[]
): { success: boolean; stdout: string; stderr: string } {
  const usePolkit = isPolkitConfigured();

  try {
    let result;
    if (usePolkit) {
      result = spawnSync('pkexec', [LUKS_HELPER_PATH, action, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      const sudoArgs = getSudoArgsForAction(action, args);
      result = spawnSync('sudo', sudoArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    return {
      success: result.status === 0,
      stdout: result.stdout?.toString().trim() || '',
      stderr: result.stderr?.toString().trim() || '',
    };
  } catch (err) {
    return {
      success: false,
      stdout: '',
      stderr: (err as Error).message,
    };
  }
}

/**
 * Convert helper action to sudo args (fallback mode)
 */
function getSudoArgsForAction(action: string, args: string[]): string[] {
  switch (action) {
    case 'open':
      return ['cryptsetup', 'luksOpen', args[0], args[1]];
    case 'close':
      return ['cryptsetup', 'luksClose', args[0]];
    case 'mount':
      return ['mount', `/dev/mapper/${args[0]}`, args[1]];
    case 'unmount':
      return ['umount', args[0]];
    case 'format':
      return [
        'cryptsetup', 'luksFormat',
        '--type', 'luks2',
        '--cipher', 'aes-xts-plain64',
        '--key-size', '512',
        '--hash', 'sha256',
        '--iter-time', '2000',
        '--batch-mode',
        args[0],
      ];
    case 'mkfs':
      return ['mkfs.ext4', '-L', 'metahuman', `/dev/mapper/${args[0]}`];
    case 'uuid':
      return ['cryptsetup', 'luksUUID', args[0]];
    case 'dump':
      return ['cryptsetup', 'luksDump', args[0]];
    case 'chown':
      return ['chown', args[1], args[0]];
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

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
  const result = runPrivilegedSync('uuid', [volumePath]);
  return result.success ? result.stdout || null : null;
}

/**
 * Get detailed info about a LUKS volume
 */
export function getLuksInfo(volumePath: string, mapperName: string): LuksVolumeInfo {
  const mounted = isLuksMounted(mapperName);

  let cipher: string | undefined;
  let keySize: number | undefined;

  const dumpResult = runPrivilegedSync('dump', [volumePath]);
  if (dumpResult.success) {
    const output = dumpResult.stdout;
    const cipherMatch = output.match(/Cipher name:\s+(.+)/);
    const keySizeMatch = output.match(/MK bits:\s+(\d+)/);

    cipher = cipherMatch?.[1]?.trim();
    keySize = keySizeMatch ? parseInt(keySizeMatch[1], 10) : undefined;
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

  const result = await runPrivileged('open', [volumePath, mapperName], password);

  if (result.success) {
    audit({
      level: 'info',
      category: 'security',
      event: 'luks_volume_opened',
      details: { volumePath, mapperName },
      actor: 'system',
    });
    return { success: true };
  }

  const errorMsg = result.stderr;

  if (errorMsg.includes('No key available') || errorMsg.includes('wrong')) {
    return { success: false, error: 'Incorrect password' };
  }
  if (errorMsg.includes('not a valid LUKS')) {
    return { success: false, error: 'Not a valid LUKS volume' };
  }

  return { success: false, error: errorMsg || 'Failed to open LUKS volume' };
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

  const result = await runPrivileged('close', [mapperName]);

  if (result.success) {
    audit({
      level: 'info',
      category: 'security',
      event: 'luks_volume_closed',
      details: { mapperName },
      actor: 'system',
    });
    return { success: true };
  }

  return { success: false, error: result.stderr || 'Failed to close LUKS volume' };
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

  // Mount point creation is handled by helper script or we create it here
  if (!fs.existsSync(mountPoint)) {
    try {
      fs.mkdirSync(mountPoint, { recursive: true });
    } catch {
      // If we can't create it, the privileged helper will do it
    }
  }

  const result = await runPrivileged('mount', [mapperName, mountPoint]);

  if (result.success) {
    audit({
      level: 'info',
      category: 'security',
      event: 'luks_volume_mounted',
      details: { mapperName, mountPoint },
      actor: 'system',
    });
    return { success: true, mountPoint };
  }

  return { success: false, error: result.stderr || 'Failed to mount LUKS volume' };
}

/**
 * Unmount a LUKS volume
 */
export async function unmountLuks(mapperName: string): Promise<LuksResult> {
  if (!isLuksMounted(mapperName)) {
    return { success: true }; // Already unmounted
  }

  const mountPoint = getLuksMountPoint(mapperName);
  if (!mountPoint) {
    return { success: false, error: 'Could not determine mount point' };
  }

  const result = await runPrivileged('unmount', [mountPoint]);

  if (result.success) {
    audit({
      level: 'info',
      category: 'security',
      event: 'luks_volume_unmounted',
      details: { mapperName, mountPoint },
      actor: 'system',
    });
    return { success: true };
  }

  const errorMsg = result.stderr;
  if (errorMsg.includes('target is busy')) {
    return { success: false, error: 'Volume is busy. Close all files and applications using it first.' };
  }
  return { success: false, error: errorMsg || 'Failed to unmount LUKS volume' };
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

    // Format as LUKS2 using privileged helper
    const formatResult = await runPrivileged('format', [filePath], password);
    if (!formatResult.success) {
      throw new Error(formatResult.stderr || 'Failed to format LUKS container');
    }

    onProgress?.('Creating filesystem...');

    // Temporarily open to create filesystem
    const tempMapper = `metahuman-setup-${Date.now()}`;

    await openLuks(filePath, tempMapper, password);

    try {
      const mkfsResult = await runPrivileged('mkfs', [tempMapper]);
      if (!mkfsResult.success) {
        throw new Error(mkfsResult.stderr || 'Failed to create filesystem');
      }
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
 *
 * @param drivePath - Directory to store the .luks container file
 * @param username - Username for the profile
 * @param password - Encryption password
 * @param sizeMB - Container size in megabytes
 * @param options - Optional configuration
 * @param options.mountPoint - Custom mount point (default: /media/metahuman/<username>)
 * @param options.onProgress - Progress callback
 */
export async function createMetaHumanLuksContainer(
  drivePath: string,
  username: string,
  password: string,
  sizeMB: number,
  onProgressOrOptions?: ((message: string) => void) | {
    mountPoint?: string;
    onProgress?: (message: string) => void;
  }
): Promise<{ containerPath: string; mountPoint: string }> {
  // Handle both old signature (onProgress callback) and new signature (options object)
  const options = typeof onProgressOrOptions === 'function'
    ? { onProgress: onProgressOrOptions }
    : onProgressOrOptions || {};

  const containerPath = path.join(drivePath, `metahuman-${username}.luks`);
  const mapperName = `metahuman-${username}`;
  const mountPoint = options.mountPoint || path.join('/media/metahuman', username);

  // Create the container
  const createResult = await createLuksContainer(containerPath, sizeMB, password, options.onProgress);
  if (!createResult.success) {
    throw new Error(createResult.error);
  }

  options.onProgress?.('Opening container...');

  // Open and mount
  const mountResult = await openAndMountLuks(containerPath, mapperName, mountPoint, password);
  if (!mountResult.success) {
    throw new Error(mountResult.error);
  }

  options.onProgress?.('Creating profile structure...');

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

  options.onProgress?.('Container ready!');

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
