/**
 * System Coder API - Status
 * GET /api/system-coder/status
 *
 * Get system coder health status for the status widget indicator.
 */

import type { APIRoute } from 'astro';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getUserOrAnonymous,
  getErrorStats,
  getProfilePaths,
  ROOT,
} from '@metahuman/core';

type HealthStatus = 'green' | 'yellow' | 'red' | 'unknown';

interface SystemCoderStatus {
  enabled: boolean;
  health: HealthStatus;
  stats: {
    errorsNew: number;
    errorsTotal: number;
    fixesPending: number;
    fixesApplied: number;
  };
  lastMaintenanceRun?: string;
  config?: any;
}

function loadConfig(): any {
  const configPath = path.join(ROOT, 'etc', 'system-coder.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return { enabled: false };
}

function calculateHealth(
  errorsNew: number,
  fixesPending: number,
  config: any
): HealthStatus {
  const thresholds = config.healthThresholds || {
    green: { maxNewErrors: 0, maxPendingFixes: 5 },
    yellow: { maxNewErrors: 5, maxPendingFixes: 15 },
    red: { errorCountAbove: 5, pendingFixesAbove: 15 },
  };

  // Check if red
  if (
    errorsNew > (thresholds.red?.errorCountAbove ?? 5) ||
    fixesPending > (thresholds.red?.pendingFixesAbove ?? 15)
  ) {
    return 'red';
  }

  // Check if yellow
  if (
    errorsNew > (thresholds.green?.maxNewErrors ?? 0) ||
    fixesPending > (thresholds.green?.maxPendingFixes ?? 5)
  ) {
    return 'yellow';
  }

  return 'green';
}

function countFixesPending(username: string): number {
  try {
    const profilePaths = getProfilePaths(username);
    const fixesDir = path.join(profilePaths.state, 'system-coder', 'fixes');
    if (!fs.existsSync(fixesDir)) return 0;

    const files = fs.readdirSync(fixesDir).filter((f) => f.endsWith('.json'));
    let pending = 0;

    for (const file of files) {
      try {
        const content = JSON.parse(
          fs.readFileSync(path.join(fixesDir, file), 'utf-8')
        );
        if (content.status === 'pending') pending++;
      } catch {
        // Skip malformed files
      }
    }

    return pending;
  } catch {
    return 0;
  }
}

function countFixesApplied(username: string): number {
  try {
    const profilePaths = getProfilePaths(username);
    const fixesDir = path.join(profilePaths.state, 'system-coder', 'fixes');
    if (!fs.existsSync(fixesDir)) return 0;

    const files = fs.readdirSync(fixesDir).filter((f) => f.endsWith('.json'));
    let applied = 0;

    for (const file of files) {
      try {
        const content = JSON.parse(
          fs.readFileSync(path.join(fixesDir, file), 'utf-8')
        );
        if (content.status === 'applied') applied++;
      } catch {
        // Skip malformed files
      }
    }

    return applied;
  } catch {
    return 0;
  }
}

function getLastMaintenanceRun(username: string): string | undefined {
  try {
    const profilePaths = getProfilePaths(username);
    const maintenanceDir = path.join(
      profilePaths.state,
      'system-coder',
      'maintenance'
    );
    if (!fs.existsSync(maintenanceDir)) return undefined;

    const files = fs.readdirSync(maintenanceDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) return undefined;

    // Sort by filename (date-based) and get the latest
    files.sort((a, b) => b.localeCompare(a));
    const latestFile = files[0];

    const content = JSON.parse(
      fs.readFileSync(path.join(maintenanceDir, latestFile), 'utf-8')
    );
    return content.timestamp;
  } catch {
    return undefined;
  }
}

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    const config = loadConfig();

    if (user.role === 'anonymous') {
      // Return basic status for anonymous users
      return new Response(
        JSON.stringify({
          enabled: config.enabled,
          health: 'unknown',
          stats: {
            errorsNew: 0,
            errorsTotal: 0,
            fixesPending: 0,
            fixesApplied: 0,
          },
        } as SystemCoderStatus),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get error stats
    const errorStats = getErrorStats(user.username);
    const errorsNew = errorStats.byStatus?.new || 0;
    const errorsTotal = errorStats.total;

    // Get fix stats
    const fixesPending = countFixesPending(user.username);
    const fixesApplied = countFixesApplied(user.username);

    // Calculate health status
    const health = calculateHealth(errorsNew, fixesPending, config);

    // Get last maintenance run
    const lastMaintenanceRun = getLastMaintenanceRun(user.username);

    const status: SystemCoderStatus = {
      enabled: config.enabled,
      health,
      stats: {
        errorsNew,
        errorsTotal,
        fixesPending,
        fixesApplied,
      },
      lastMaintenanceRun,
    };

    return new Response(JSON.stringify(status), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, max-age=0',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        enabled: false,
        health: 'unknown',
        error: (error as Error).message,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
