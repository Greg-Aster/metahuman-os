import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from './path-builder.js';

const activityDir = path.join(systemPaths.logs, 'run');
const activityFile = path.join(activityDir, 'last-activity.json');

export const ACTIVITY_STATE_FILE = activityFile;

export function recordSystemActivity(timestamp: number = Date.now()): number {
  try {
    if (!fs.existsSync(activityDir)) {
      fs.mkdirSync(activityDir, { recursive: true });
    }
    fs.writeFileSync(activityFile, JSON.stringify({ timestamp }, null, 2));
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
