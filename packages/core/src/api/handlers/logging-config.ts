/**
 * Logging Config API Handlers
 *
 * Unified handlers for HTTP logging configuration.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { systemPaths } from '../../paths.js';

interface LoggingConfig {
  level: string;
  levels: Record<string, number>;
  suppressPatterns: string[];
  logSlowRequests: boolean;
  slowRequestThresholdMs: number;
  console: {
    enabled: boolean;
    colorize: boolean;
    timestamp: boolean;
  };
  file?: {
    enabled: boolean;
    path: string;
  };
}

const DEFAULT_CONFIG: LoggingConfig = {
  level: 'info',
  levels: { error: 0, warn: 1, info: 2, debug: 3 },
  suppressPatterns: [
    '/api/approvals',
    '/api/status',
    '/api/monitor',
    '/api/sleep-status',
    '/api/activity-ping',
  ],
  logSlowRequests: true,
  slowRequestThresholdMs: 1000,
  console: { enabled: true, colorize: true, timestamp: true },
};

function getConfigPath(): string {
  return path.join(systemPaths.etc, 'logging.json');
}

/**
 * GET /api/logging-config - Get current logging configuration
 */
export async function handleGetLoggingConfig(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const configPath = getConfigPath();

    if (!fs.existsSync(configPath)) {
      // Return template defaults if no config exists
      return successResponse(DEFAULT_CONFIG);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return successResponse(config);
  } catch (error) {
    console.error('[logging-config] GET error:', error);
    return { status: 500, error: 'Failed to read logging config' };
  }
}

/**
 * POST /api/logging-config - Update logging configuration
 */
export async function handleSetLoggingConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;

  try {
    const configPath = getConfigPath();

    // Load existing config or use defaults
    let config: LoggingConfig = {
      ...DEFAULT_CONFIG,
      file: { enabled: false, path: 'logs/http.log' },
    };

    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    // Merge updates
    const updates = body || {};
    config = {
      ...config,
      ...updates,
      console: {
        ...config.console,
        ...(updates.console || {}),
      },
    };

    // Ensure directory exists
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    return successResponse({ success: true, config });
  } catch (error) {
    console.error('[logging-config] POST error:', error);
    return { status: 500, error: 'Failed to save logging config' };
  }
}
