/**
 * VeraCrypt Integration Module
 *
 * Provides cross-platform encrypted container support using VeraCrypt.
 * This offers an alternative to application-level encryption with:
 * - Industry-standard encryption (AES, Serpent, Twofish)
 * - Cross-platform support (Windows, macOS, Linux)
 * - Hidden volumes for plausible deniability
 * - Hardware-accelerated encryption
 *
 * Usage:
 * 1. User creates a VeraCrypt container on their external drive
 * 2. Container is mounted when accessing profile
 * 3. Profile data stored inside the mounted container
 * 4. Container unmounted when done
 */

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * VeraCrypt installation status
 */
export interface VeraCryptStatus {
  installed: boolean;
  version?: string;
  executable?: string;
  platform: NodeJS.Platform;
}

/**
 * VeraCrypt container info
 */
export interface VeraCryptContainer {
  path: string;
  size: number; // bytes
  sizeFormatted: string;
  mounted: boolean;
  mountPoint?: string;
  createdAt?: string;
}

/**
 * Container creation options
 */
export interface CreateContainerOptions {
  path: string;
  size: number; // bytes
  password: string;
  encryption?: 'AES' | 'AES-Twofish' | 'AES-Twofish-Serpent' | 'Serpent' | 'Twofish';
  hash?: 'SHA-512' | 'SHA-256' | 'Whirlpool' | 'Streebog';
  filesystem?: 'FAT' | 'exFAT' | 'NTFS' | 'Ext4';
}

/**
 * Mount options
 */
export interface MountOptions {
  containerPath: string;
  password: string;
  mountPoint?: string; // Auto-assigned if not provided
  readOnly?: boolean;
}

// Platform-specific VeraCrypt paths
const VERACRYPT_PATHS: Record<NodeJS.Platform, string[]> = {
  linux: [
    '/usr/bin/veracrypt',
    '/usr/local/bin/veracrypt',
    '/snap/bin/veracrypt',
  ],
  darwin: [
    '/Applications/VeraCrypt.app/Contents/MacOS/VeraCrypt',
    '/usr/local/bin/veracrypt',
  ],
  win32: [
    'C:\\Program Files\\VeraCrypt\\VeraCrypt.exe',
    'C:\\Program Files (x86)\\VeraCrypt\\VeraCrypt.exe',
  ],
  aix: [],
  android: [],
  freebsd: ['/usr/local/bin/veracrypt'],
  haiku: [],
  openbsd: ['/usr/local/bin/veracrypt'],
  sunos: [],
  cygwin: [],
  netbsd: [],
};

// Mount point base directories
const MOUNT_BASES: Record<NodeJS.Platform, string> = {
  linux: '/media/veracrypt',
  darwin: '/Volumes',
  win32: '', // Windows uses drive letters
  aix: '/mnt',
  android: '/mnt',
  freebsd: '/mnt',
  haiku: '/mnt',
  openbsd: '/mnt',
  sunos: '/mnt',
  cygwin: '/mnt',
  netbsd: '/mnt',
};

/**
 * Find VeraCrypt executable
 */
function findVeraCrypt(): string | null {
  const platform = os.platform();
  const paths = VERACRYPT_PATHS[platform] || [];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Try to find in PATH
  try {
    const which = platform === 'win32' ? 'where' : 'which';
    const result = execSync(`${which} veracrypt`, { encoding: 'utf8' }).trim();
    if (result && fs.existsSync(result.split('\n')[0])) {
      return result.split('\n')[0];
    }
  } catch {
    // Not found in PATH
  }

  return null;
}

/**
 * Get VeraCrypt version
 */
function getVeraCryptVersion(executable: string): string | undefined {
  try {
    const result = execSync(`"${executable}" --version`, {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    // Parse version from output like "VeraCrypt 1.25.9"
    const match = result.match(/VeraCrypt\s+(\d+\.\d+\.?\d*)/i);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Check if VeraCrypt is installed
 */
export function checkVeraCrypt(): VeraCryptStatus {
  const executable = findVeraCrypt();
  const platform = os.platform();

  if (!executable) {
    return {
      installed: false,
      platform,
    };
  }

  return {
    installed: true,
    executable,
    version: getVeraCryptVersion(executable),
    platform,
  };
}

/**
 * Get installation instructions for the current platform
 */
export function getInstallInstructions(): string {
  const platform = os.platform();

  switch (platform) {
    case 'linux':
      return `Install VeraCrypt on Linux:

1. Download from: https://www.veracrypt.fr/en/Downloads.html
2. Or use your package manager:

   # Ubuntu/Debian:
   sudo add-apt-repository ppa:unit193/encryption
   sudo apt update
   sudo apt install veracrypt

   # Fedora:
   sudo dnf install veracrypt

   # Arch Linux:
   yay -S veracrypt`;

    case 'darwin':
      return `Install VeraCrypt on macOS:

1. Download from: https://www.veracrypt.fr/en/Downloads.html
2. Or use Homebrew:
   brew install --cask veracrypt

Note: You may need to allow the kernel extension in System Preferences > Security & Privacy`;

    case 'win32':
      return `Install VeraCrypt on Windows:

1. Download from: https://www.veracrypt.fr/en/Downloads.html
2. Run the installer and follow the prompts
3. Restart your computer if prompted`;

    default:
      return `Download VeraCrypt from: https://www.veracrypt.fr/en/Downloads.html`;
  }
}

/**
 * Create a new VeraCrypt container
 */
export async function createContainer(options: CreateContainerOptions): Promise<void> {
  const status = checkVeraCrypt();
  if (!status.installed || !status.executable) {
    throw new Error('VeraCrypt is not installed');
  }

  const {
    path: containerPath,
    size,
    password,
    encryption = 'AES',
    hash = 'SHA-512',
    filesystem = 'exFAT',
  } = options;

  // Ensure parent directory exists
  const parentDir = path.dirname(containerPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Build VeraCrypt command
  const args = [
    '--text',
    '--create', containerPath,
    '--size', size.toString(),
    '--password', password,
    '--encryption', encryption,
    '--hash', hash,
    '--filesystem', filesystem,
    '--volume-type', 'normal',
    '--pim', '0',
    '--keyfiles', '',
    '--random-source', '/dev/urandom',
    '--non-interactive',
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(status.executable!, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`VeraCrypt container creation failed: ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run VeraCrypt: ${err.message}`));
    });
  });
}

/**
 * Mount a VeraCrypt container
 */
export async function mountContainer(options: MountOptions): Promise<string> {
  const status = checkVeraCrypt();
  if (!status.installed || !status.executable) {
    throw new Error('VeraCrypt is not installed');
  }

  const { containerPath, password, readOnly = false } = options;
  let { mountPoint } = options;

  // Generate mount point if not provided
  if (!mountPoint) {
    const platform = os.platform();
    const base = MOUNT_BASES[platform] || '/mnt';

    if (platform === 'win32') {
      // Windows: find available drive letter
      const usedLetters = new Set(
        execSync('wmic logicaldisk get caption', { encoding: 'utf8' })
          .split('\n')
          .map(line => line.trim().charAt(0).toUpperCase())
          .filter(letter => /^[A-Z]$/.test(letter))
      );

      for (let i = 25; i >= 0; i--) { // Z to A
        const letter = String.fromCharCode(65 + i);
        if (!usedLetters.has(letter)) {
          mountPoint = `${letter}:`;
          break;
        }
      }

      if (!mountPoint) {
        throw new Error('No available drive letters');
      }
    } else {
      // Unix: create mount point directory
      const containerName = path.basename(containerPath, path.extname(containerPath));
      mountPoint = path.join(base, `metahuman-${containerName}-${Date.now()}`);

      if (!fs.existsSync(mountPoint)) {
        fs.mkdirSync(mountPoint, { recursive: true });
      }
    }
  }

  // Build mount command
  const args = [
    '--text',
    '--mount', containerPath,
    '--password', password,
    '--pim', '0',
    '--keyfiles', '',
    '--protect-hidden', 'no',
    '--non-interactive',
  ];

  if (os.platform() === 'win32') {
    args.push('--drive', mountPoint);
  } else {
    args.push(mountPoint);
  }

  if (readOnly) {
    args.push('--read-only');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(status.executable!, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(mountPoint!);
      } else {
        reject(new Error(`Failed to mount container: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run VeraCrypt: ${err.message}`));
    });
  });
}

/**
 * Unmount a VeraCrypt container
 */
export async function unmountContainer(mountPointOrPath: string): Promise<void> {
  const status = checkVeraCrypt();
  if (!status.installed || !status.executable) {
    throw new Error('VeraCrypt is not installed');
  }

  const args = [
    '--text',
    '--dismount', mountPointOrPath,
    '--non-interactive',
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(status.executable!, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Failed to unmount container: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run VeraCrypt: ${err.message}`));
    });
  });
}

/**
 * List mounted VeraCrypt volumes
 */
export async function listMountedVolumes(): Promise<Array<{
  slot: number;
  containerPath: string;
  mountPoint: string;
  size: number;
}>> {
  const status = checkVeraCrypt();
  if (!status.installed || !status.executable) {
    return [];
  }

  return new Promise((resolve) => {
    const args = ['--text', '--list', '--non-interactive'];

    const proc = spawn(status.executable!, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', () => {
      const volumes: Array<{
        slot: number;
        containerPath: string;
        mountPoint: string;
        size: number;
      }> = [];

      // Parse output - format varies by platform
      const lines = stdout.split('\n').filter(line => line.trim());
      for (const line of lines) {
        // Try to parse slot info
        const match = line.match(/(\d+):\s+(.+?)\s+(.+?)\s+(\d+)/);
        if (match) {
          volumes.push({
            slot: parseInt(match[1], 10),
            containerPath: match[2],
            mountPoint: match[3],
            size: parseInt(match[4], 10),
          });
        }
      }

      resolve(volumes);
    });

    proc.on('error', () => {
      resolve([]);
    });
  });
}

/**
 * Check if a specific container is mounted
 */
export async function isContainerMounted(containerPath: string): Promise<{
  mounted: boolean;
  mountPoint?: string;
}> {
  const volumes = await listMountedVolumes();
  const normalizedPath = path.normalize(containerPath);

  for (const vol of volumes) {
    if (path.normalize(vol.containerPath) === normalizedPath) {
      return {
        mounted: true,
        mountPoint: vol.mountPoint,
      };
    }
  }

  return { mounted: false };
}

/**
 * Get container info
 */
export function getContainerInfo(containerPath: string): VeraCryptContainer | null {
  if (!fs.existsSync(containerPath)) {
    return null;
  }

  const stats = fs.statSync(containerPath);

  return {
    path: containerPath,
    size: stats.size,
    sizeFormatted: formatBytes(stats.size),
    mounted: false, // Will be updated by caller
    createdAt: stats.birthtime.toISOString(),
  };
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Recommended container sizes
 */
export const RECOMMENDED_SIZES = {
  small: {
    bytes: 500 * 1024 * 1024, // 500 MB
    label: '500 MB',
    description: 'Basic profile with limited memories',
  },
  medium: {
    bytes: 2 * 1024 * 1024 * 1024, // 2 GB
    label: '2 GB',
    description: 'Standard profile with moderate memory storage',
  },
  large: {
    bytes: 10 * 1024 * 1024 * 1024, // 10 GB
    label: '10 GB',
    description: 'Extended profile with voice training data',
  },
  custom: {
    bytes: 0,
    label: 'Custom',
    description: 'Specify your own size',
  },
};

/**
 * VeraCrypt container file extension
 */
export const CONTAINER_EXTENSION = '.vc';

/**
 * Create a MetaHuman-ready VeraCrypt container
 * Sets up the container with proper structure for profile storage
 */
export async function createMetaHumanContainer(
  drivePath: string,
  username: string,
  password: string,
  sizeBytes: number,
  onProgress?: (message: string) => void
): Promise<{ containerPath: string; mountPoint: string }> {
  onProgress?.('Checking VeraCrypt installation...');
  const status = checkVeraCrypt();
  if (!status.installed) {
    throw new Error('VeraCrypt is not installed. ' + getInstallInstructions());
  }

  // Create container path
  const containerPath = path.join(drivePath, `metahuman-${username}${CONTAINER_EXTENSION}`);

  onProgress?.('Creating encrypted container...');
  await createContainer({
    path: containerPath,
    size: sizeBytes,
    password,
    encryption: 'AES',
    hash: 'SHA-512',
    filesystem: os.platform() === 'win32' ? 'NTFS' : 'exFAT',
  });

  onProgress?.('Mounting container...');
  const mountPoint = await mountContainer({
    containerPath,
    password,
  });

  onProgress?.('Creating profile directory structure...');
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

  // Create marker file to identify as MetaHuman container
  const markerPath = path.join(mountPoint, '.metahuman-profile');
  fs.writeFileSync(markerPath, JSON.stringify({
    version: 1,
    username,
    createdAt: new Date().toISOString(),
    encryption: 'veracrypt',
  }, null, 2));

  onProgress?.('Container ready!');

  return { containerPath, mountPoint };
}

/**
 * Check if a mount point contains a MetaHuman profile
 */
export function isMetaHumanContainer(mountPoint: string): boolean {
  const markerPath = path.join(mountPoint, '.metahuman-profile');
  return fs.existsSync(markerPath);
}

/**
 * Get MetaHuman profile info from container
 */
export function getContainerProfileInfo(mountPoint: string): {
  username?: string;
  createdAt?: string;
  encryption: string;
} | null {
  const markerPath = path.join(mountPoint, '.metahuman-profile');
  if (!fs.existsSync(markerPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    return null;
  }
}
