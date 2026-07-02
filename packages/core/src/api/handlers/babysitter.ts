import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';

type BabysitterPatternRecord = {
  signature?: string;
  pattern: {
    occurrences: number;
    firstSeen?: string;
    lastSeen?: string;
    sources?: unknown;
    autoFixable?: boolean;
    fixId?: string;
  };
};

const patternsPath = path.join(systemPaths.root, 'logs/run/babysitter-patterns.json');
const reportsPath = path.join(systemPaths.root, 'logs/run/babysitter-reports');

function jsonResponse(data: unknown, status = 200): UnifiedResponse {
  return { status, data };
}

function readPatternsLenient(): BabysitterPatternRecord[] {
  if (!fs.existsSync(patternsPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(patternsPath, 'utf-8');
    return JSON.parse(content) as BabysitterPatternRecord[];
  } catch {
    return [];
  }
}

function checkIfBabysitterIsRunning(): boolean {
  try {
    if (!fs.existsSync(patternsPath)) {
      return false;
    }

    const stats = fs.statSync(patternsPath);
    const lastModified = stats.mtime.getTime();
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);

    return lastModified > fiveMinutesAgo;
  } catch {
    return false;
  }
}

export async function handleGetBabysitterStatus(): Promise<UnifiedResponse> {
  try {
    const patterns = readPatternsLenient();
    const totalPatterns = patterns.length;
    const totalOccurrences = patterns.reduce(
      (sum, item) => sum + (item.pattern?.occurrences || 0),
      0
    );
    const autoFixedPatterns = patterns.filter((item) => item.pattern?.autoFixable).length;

    return jsonResponse({
      isRunning: checkIfBabysitterIsRunning(),
      patterns: {
        total: totalPatterns,
        autoFixed: autoFixedPatterns,
        pending: totalPatterns - autoFixedPatterns,
      },
      errors: {
        totalDetected: totalOccurrences,
      },
      lastUpdate: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[babysitter-status] Error:', error);
    return jsonResponse({ error: 'Failed to get babysitter status' }, 500);
  }
}

export async function handleGetBabysitterPatterns(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!fs.existsSync(patternsPath)) {
      return jsonResponse({ patterns: [], message: 'No patterns detected yet' });
    }

    const content = fs.readFileSync(patternsPath, 'utf-8');
    const data = JSON.parse(content) as BabysitterPatternRecord[];

    const patterns = data.map((item) => ({
      signature: item.signature,
      occurrences: item.pattern.occurrences,
      firstSeen: item.pattern.firstSeen,
      lastSeen: item.pattern.lastSeen,
      sources: item.pattern.sources,
      autoFixable: item.pattern.autoFixable,
      fixId: item.pattern.fixId,
    }));

    patterns.sort((a, b) => b.occurrences - a.occurrences);

    const limit = Number.parseInt(req.query?.limit || '50', 10);
    const limitedPatterns = patterns.slice(0, limit);

    return jsonResponse({
      patterns: limitedPatterns,
      total: patterns.length,
    });
  } catch (error) {
    console.error('[babysitter-patterns] Error:', error);
    return jsonResponse({ error: 'Failed to get babysitter patterns' }, 500);
  }
}

export async function handleGetBabysitterReports(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const period = req.query?.period || 'hourly';

    if (!['hourly', 'daily', 'weekly'].includes(period)) {
      return jsonResponse({ error: 'Invalid period. Must be hourly, daily, or weekly' }, 400);
    }

    if (!fs.existsSync(reportsPath)) {
      return jsonResponse({ reports: [], message: 'No reports available yet' });
    }

    const files = fs
      .readdirSync(reportsPath)
      .filter((file) => file.startsWith(`${period}-`) && file.endsWith('.json'))
      .sort()
      .reverse();

    const limit = Number.parseInt(req.query?.limit || '10', 10);
    const reports = [];

    for (const file of files.slice(0, limit)) {
      try {
        const content = fs.readFileSync(path.join(reportsPath, file), 'utf-8');
        reports.push(JSON.parse(content));
      } catch {
        // Skip malformed files.
      }
    }

    return jsonResponse({ period, reports, total: files.length });
  } catch (error) {
    console.error('[babysitter-reports] Error:', error);
    return jsonResponse({ error: 'Failed to get babysitter reports' }, 500);
  }
}
