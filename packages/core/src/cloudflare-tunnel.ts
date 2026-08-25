/**
 * Cloudflare Tunnel Management
 *
 * Manages the Cloudflare tunnel process lifecycle and configuration.
 */

import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { systemPaths } from './path-builder.js';
import {
  activateTunnelExposure,
  deactivateTunnelExposure,
  getTunnelExposureState,
  type TunnelExposureState,
} from './cloudflare-exposure.js';

const CLOUDFLARE_CONFIG_PATH = path.join(systemPaths.etc, 'cloudflare.json');
const TUNNEL_PID_FILE = path.join(systemPaths.logs, 'run', 'cloudflare-tunnel.pid');

interface CloudflareConfig {
  enabled: boolean;
  tunnelName: string;
  hostname: string;
  autoStart: boolean;
}

let tunnelProcess: ChildProcess | null = null;

/**
 * Load Cloudflare tunnel configuration
 */
export function loadCloudflareConfig(): CloudflareConfig {
  const defaultConfig: CloudflareConfig = {
    enabled: false,
    tunnelName: 'metahuman',
    hostname: '',
    autoStart: true,
  };

  try {
    if (fs.existsSync(CLOUDFLARE_CONFIG_PATH)) {
      const data = fs.readFileSync(CLOUDFLARE_CONFIG_PATH, 'utf8');
      return { ...defaultConfig, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('[cloudflare] Failed to load config:', error);
  }

  return defaultConfig;
}

/**
 * Save Cloudflare tunnel configuration
 */
export function saveCloudflareConfig(config: Partial<CloudflareConfig>): void {
  try {
    const current = loadCloudflareConfig();
    const updated = { ...current, ...config };
    fs.writeFileSync(CLOUDFLARE_CONFIG_PATH, JSON.stringify(updated, null, 2));
  } catch (error) {
    console.error('[cloudflare] Failed to save config:', error);
    throw error;
  }
}

/**
 * Check if cloudflared is installed
 */
export function isCloudflaredInstalled(): boolean {
  // Check common installation paths directly with fs
  const paths = [
    '/usr/local/bin/cloudflared',
    '/usr/bin/cloudflared',
    '/opt/homebrew/bin/cloudflared', // macOS Homebrew
  ];

  for (const binPath of paths) {
    if (fs.existsSync(binPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if tunnel is currently running
 */
export function isTunnelRunning(): boolean {
  if (tunnelProcess && !tunnelProcess.killed) {
    return true;
  }

  // Check PID file
  try {
    if (fs.existsSync(TUNNEL_PID_FILE)) {
      const pid = parseInt(fs.readFileSync(TUNNEL_PID_FILE, 'utf8').trim());
      if (isOwnedTunnelProcess(pid)) {
        return true;
      }
      fs.unlinkSync(TUNNEL_PID_FILE);
    }
  } catch (error) {
    console.error('[cloudflare] Error checking tunnel status:', error);
  }

  return false;
}

function isOwnedTunnelProcess(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }

  if (process.platform === 'linux') {
    try {
      const command = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      return command.some(part => part.endsWith('/cloudflared') || part === 'cloudflared')
        && command.includes('tunnel')
        && command.includes('run');
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Start the Cloudflare tunnel
 */
export function startTunnel(): boolean {
  if (!isCloudflaredInstalled()) {
    console.error('[cloudflare] cloudflared is not installed');
    return false;
  }

  const config = loadCloudflareConfig();

  if (isTunnelRunning()) {
    activateTunnelExposure(config.hostname);
    console.log('[cloudflare] Tunnel is already running');
    return true;
  }

  if (!config.enabled) {
    console.log('[cloudflare] Tunnel is disabled in config');
    return false;
  }

  try {
    console.log(`[cloudflare] Starting tunnel: ${config.tunnelName}`);

    tunnelProcess = spawn('cloudflared', ['tunnel', 'run', config.tunnelName], {
      detached: true,
      stdio: 'ignore',
    });

    if (tunnelProcess.pid) {
      fs.writeFileSync(TUNNEL_PID_FILE, tunnelProcess.pid.toString());
      tunnelProcess.unref(); // Allow parent to exit independently
      activateTunnelExposure(config.hostname);

      console.log(`[cloudflare] Tunnel started with PID ${tunnelProcess.pid}`);
      console.log(`[cloudflare] Public URL: https://${config.hostname}`);
      return true;
    }
  } catch (error) {
    console.error('[cloudflare] Failed to start tunnel:', error);
  }

  return false;
}

/**
 * Stop the Cloudflare tunnel
 */
export function stopTunnel(): boolean {
  try {
    if (tunnelProcess && !tunnelProcess.killed) {
      tunnelProcess.kill();
      tunnelProcess = null;
    }

    // Also kill process from PID file
    if (fs.existsSync(TUNNEL_PID_FILE)) {
      const pid = parseInt(fs.readFileSync(TUNNEL_PID_FILE, 'utf8').trim());
      if (isOwnedTunnelProcess(pid)) {
        try {
          process.kill(pid, 'SIGTERM');
          console.log(`[cloudflare] Stopped tunnel (PID ${pid})`);
        } catch (error) {
          console.error(`[cloudflare] Failed to kill process ${pid}:`, error);
        }
      }
      fs.unlinkSync(TUNNEL_PID_FILE);
    }

    deactivateTunnelExposure();
    return true;
  } catch (error) {
    console.error('[cloudflare] Error stopping tunnel:', error);
    return false;
  }
}

/**
 * Restart the tunnel
 */
export function restartTunnel(): boolean {
  stopTunnel();
  return startTunnel();
}

/**
 * Get tunnel status
 */
export function getTunnelStatus(): {
  installed: boolean;
  running: boolean;
  enabled: boolean;
  hostname: string;
  pid?: number;
  exposure: TunnelExposureState;
} {
  const config = loadCloudflareConfig();
  const running = isTunnelRunning();

  let pid: number | undefined;
  if (running) {
    // Try PID file first
    if (fs.existsSync(TUNNEL_PID_FILE)) {
      pid = parseInt(fs.readFileSync(TUNNEL_PID_FILE, 'utf8').trim());
    }
  }

  return {
    installed: isCloudflaredInstalled(),
    running,
    enabled: config.enabled,
    hostname: config.hostname,
    pid,
    exposure: getTunnelExposureState(
      config.hostname ? {
        hostname: config.hostname,
        origin: `https://${config.hostname}`,
      } : undefined,
    ),
  };
}

export function syncTunnelExposure(enabled: boolean): TunnelExposureState {
  const config = loadCloudflareConfig();
  if (enabled || isTunnelRunning()) {
    return activateTunnelExposure(config.hostname);
  }
  return deactivateTunnelExposure();
}

/**
 * Auto-start tunnel if enabled in config
 * Call this from the dev server startup
 */
export function autoStartTunnel(): void {
  const config = loadCloudflareConfig();

  if (config.enabled && config.autoStart) {
    console.log('[cloudflare] Auto-starting tunnel...');
    startTunnel();
  }
}
