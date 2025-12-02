import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from './path-builder.js';

const activityDir = path.join(systemPaths.logs, 'run');
const activityFile = path.join(activityDir, 'last-activity.json');

export const ACTIVITY_STATE_FILE = activityFile;

export interface SystemActivityState {
  timestamp: number;
  username?: string;
}

export function recordSystemActivity(timestamp: number = Date.now(), username?: string): number {
  try {
    if (!fs.existsSync(activityDir)) {
      fs.mkdirSync(activityDir, { recursive: true });
    }
    const state: SystemActivityState = { timestamp };
    if (username) {
      state.username = username;
    }
    fs.writeFileSync(activityFile, JSON.stringify(state, null, 2));
  } catch (error) {
    console.warn('[system-activity] Failed to record activity:', error);
  }
  return timestamp;
}

export function readSystemActivityTimestamp(): number | null {
  try {
    if (!fs.existsSync(activityFile)) {
      return null;
    }
    const raw = fs.readFileSync(activityFile, 'utf-8');
    const parsed = JSON.parse(raw);
    const ts = parsed?.timestamp;
    if (typeof ts === 'number' && Number.isFinite(ts)) {
      return ts;
    }
    return null;
  } catch (error) {
    console.warn('[system-activity] Failed to read activity state:', error);
    return null;
  }
}

/**
 * Read the last active username from system activity state
 */
export function readLastActiveUsername(): string | null {
  try {
    if (!fs.existsSync(activityFile)) {
      return null;
    }
    const raw = fs.readFileSync(activityFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed?.username || null;
  } catch (error) {
    console.warn('[system-activity] Failed to read last active username:', error);
    return null;
  }
}
