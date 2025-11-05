/**
 * Cloudflare Tunnel Management
 *
 * Manages the Cloudflare tunnel process lifecycle and configuration.
 */

import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { paths } from './paths.js';

const CLOUDFLARE_CONFIG_PATH = path.join(paths.root, 'etc', 'cloudflare.json');
const TUNNEL_PID_FILE = path.join(paths.logs, 'run', 'cloudflare-tunnel.pid');

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
      // Check if process is actually running
      try {
        process.kill(pid, 0); // Signal 0 checks if process exists
        return true;
      } catch {
        // Process doesn't exist, clean up stale PID file
        fs.unlinkSync(TUNNEL_PID_FILE);
      }
    }
  } catch (error) {
    console.error('[cloudflare] Error checking tunnel status:', error);
  }

  // Fallback: Check if any cloudflared tunnel process is running
  try {
    const { execSync } = require('child_process');
    execSync('pgrep -f "cloudflared tunnel"', { stdio: 'ignore' });
    return true;
  } catch {
    // No tunnel process found
  }

  return false;
}

/**
 * Start the Cloudflare tunnel
 */
export function startTunnel(): boolean {
  if (!isCloudflaredInstalled()) {
    console.error('[cloudflare] cloudflared is not installed');
    return false;
  }

  if (isTunnelRunning()) {
    console.log('[cloudflare] Tunnel is already running');
    return true;
  }

  const config = loadCloudflareConfig();
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
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`[cloudflare] Stopped tunnel (PID ${pid})`);
      } catch (error) {
        console.error(`[cloudflare] Failed to kill process ${pid}:`, error);
      }
      fs.unlinkSync(TUNNEL_PID_FILE);
    }

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
} {
  const config = loadCloudflareConfig();
  const running = isTunnelRunning();

  let pid: number | undefined;
  if (running) {
    // Try PID file first
    if (fs.existsSync(TUNNEL_PID_FILE)) {
      pid = parseInt(fs.readFileSync(TUNNEL_PID_FILE, 'utf8').trim());
    } else {
      // Fallback: Get PID from running process
      try {
        const { execSync } = require('child_process');
        const output = execSync('pgrep -f "cloudflared tunnel run"', { encoding: 'utf8' });
        const pids = output.trim().split('\n').filter(Boolean);
        if (pids.length > 0) {
          pid = parseInt(pids[0]);
        }
      } catch {
        // Couldn't get PID
      }
    }
  }

  return {
    installed: isCloudflaredInstalled(),
    running,
    enabled: config.enabled,
    hostname: config.hostname,
    pid,
  };
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
