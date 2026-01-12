/**
 * API: Get Babysitter Status
 *
 * Returns current status, statistics, and state of the Babysitter agent.
 */

import type { APIRoute } from 'astro';
import * as fs from 'fs';
import * as path from 'path';
import { systemPaths } from '@metahuman/core';

export const GET: APIRoute = async () => {
  try {
    // Read pattern file to get current patterns
    const patternPath = path.join(systemPaths.root, 'logs/run/babysitter-patterns.json');
    let patterns: any[] = [];

    if (fs.existsSync(patternPath)) {
      try {
        const content = fs.readFileSync(patternPath, 'utf-8');
        patterns = JSON.parse(content);
      } catch {
        // Ignore parse errors
      }
    }

    // Calculate stats from patterns
    const totalPatterns = patterns.length;
    const totalOccurrences = patterns.reduce((sum, p) => sum + (p.pattern?.occurrences || 0), 0);
    const autoFixedPatterns = patterns.filter(p => p.pattern?.autoFixable).length;

    // Check if babysitter is running
    const isRunning = checkIfBabysitterIsRunning();

    const status = {
      isRunning,
      patterns: {
        total: totalPatterns,
        autoFixed: autoFixedPatterns,
        pending: totalPatterns - autoFixedPatterns,
      },
      errors: {
        totalDetected: totalOccurrences,
        // These would come from the running agent's state
        // For now, we'll use pattern data as a proxy
      },
      lastUpdate: new Date().toISOString(),
    };

    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[babysitter-status] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to get babysitter status' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * Check if babysitter is running by looking for recent pattern updates
 */
function checkIfBabysitterIsRunning(): boolean {
  try {
    const patternPath = path.join(systemPaths.root, 'logs/run/babysitter-patterns.json');
    if (!fs.existsSync(patternPath)) {
      return false;
    }

    const stats = fs.statSync(patternPath);
    const lastModified = stats.mtime.getTime();
    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);

    // If patterns file was modified in last 5 minutes, babysitter is likely running
    return lastModified > fiveMinutesAgo;
  } catch {
    return false;
  }
}
