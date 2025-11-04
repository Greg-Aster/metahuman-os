/**
 * Progress Tracker - Real-time progress monitoring for long-running operations
 *
 * Features:
 * - JSON status file updated in real-time
 * - Stage tracking (dataset, upload, training, download, etc.)
 * - Progress percentages and ETAs
 * - Error state tracking
 * - Heartbeat timestamps to detect hung processes
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';

export interface ProgressStage {
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  progress?: number; // 0-100
  message?: string;
  startTime?: string;
  endTime?: string;
  error?: string;
}

export interface ProgressState {
  operation: string; // e.g., "lora-training-2025-10-28"
  overallStatus: 'starting' | 'running' | 'completed' | 'failed';
  overallProgress: number; // 0-100
  currentStage: string;
  stages: ProgressStage[];
  startTime: string;
  lastHeartbeat: string;
  endTime?: string;
  metadata?: Record<string, any>;
  error?: string;
}

export class ProgressTracker {
  private state: ProgressState;
  private statusFilePath: string;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(operation: string, stages: string[], statusDir?: string) {
    const dir = statusDir || path.join(paths.logs, 'status');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.statusFilePath = path.join(dir, `${operation}.json`);

    const now = new Date().toISOString();
    this.state = {
      operation,
      overallStatus: 'starting',
      overallProgress: 0,
      currentStage: stages[0] || 'unknown',
      stages: stages.map(name => ({
        name,
        status: 'pending',
        progress: 0,
      })),
      startTime: now,
      lastHeartbeat: now,
    };

    this.save();
    this.startHeartbeat();
  }

  private startHeartbeat() {
    // Update heartbeat every 10 seconds
    this.heartbeatInterval = setInterval(() => {
      this.state.lastHeartbeat = new Date().toISOString();
      this.save();
    }, 10000);
  }

  private save() {
    try {
      fs.writeFileSync(this.statusFilePath, JSON.stringify(this.state, null, 2));
    } catch (err) {
      console.error(`[ProgressTracker] Failed to write status file: ${err}`);
    }
  }

  setMetadata(metadata: Record<string, any>) {
    this.state.metadata = { ...this.state.metadata, ...metadata };
    this.save();
  }

  startStage(stageName: string, message?: string) {
    const stage = this.state.stages.find(s => s.name === stageName);
    if (!stage) {
      console.warn(`[ProgressTracker] Stage not found: ${stageName}`);
      return;
    }

    stage.status = 'in_progress';
    stage.progress = 0;
    stage.message = message;
    stage.startTime = new Date().toISOString();

    this.state.currentStage = stageName;
    this.state.overallStatus = 'running';
    this.updateOverallProgress();

    console.log(`[ProgressTracker] 🚀 Stage started: ${stageName}${message ? ` - ${message}` : ''}`);
    this.save();
  }

  updateStage(stageName: string, progress: number, message?: string) {
    const stage = this.state.stages.find(s => s.name === stageName);
    if (!stage) return;

    stage.progress = Math.min(100, Math.max(0, progress));
    if (message) stage.message = message;

    this.updateOverallProgress();

    console.log(`[ProgressTracker] 📊 ${stageName}: ${progress}%${message ? ` - ${message}` : ''}`);
    this.save();
  }

  completeStage(stageName: string, message?: string) {
    const stage = this.state.stages.find(s => s.name === stageName);
    if (!stage) return;

    stage.status = 'completed';
    stage.progress = 100;
    if (message) stage.message = message;
    stage.endTime = new Date().toISOString();

    this.updateOverallProgress();

    console.log(`[ProgressTracker] ✅ Stage completed: ${stageName}${message ? ` - ${message}` : ''}`);
    this.save();
  }

  failStage(stageName: string, error: string) {
    const stage = this.state.stages.find(s => s.name === stageName);
    if (!stage) return;

    stage.status = 'failed';
    stage.error = error;
    stage.endTime = new Date().toISOString();

    this.state.overallStatus = 'failed';
    this.state.error = error;

    console.error(`[ProgressTracker] ❌ Stage failed: ${stageName} - ${error}`);
    this.save();
  }

  skipStage(stageName: string, reason?: string) {
    const stage = this.state.stages.find(s => s.name === stageName);
    if (!stage) return;

    stage.status = 'skipped';
    stage.message = reason;

    console.log(`[ProgressTracker] ⏭️  Stage skipped: ${stageName}${reason ? ` - ${reason}` : ''}`);
    this.save();
  }

  private updateOverallProgress() {
    const completedWeight = this.state.stages.filter(s => s.status === 'completed').length;
    const inProgressStages = this.state.stages.filter(s => s.status === 'in_progress');

    let inProgressWeight = 0;
    for (const stage of inProgressStages) {
      inProgressWeight += (stage.progress || 0) / 100;
    }

    const totalStages = this.state.stages.filter(s => s.status !== 'skipped').length;
    this.state.overallProgress = totalStages > 0
      ? Math.round(((completedWeight + inProgressWeight) / totalStages) * 100)
      : 0;
  }

  complete(message?: string) {
    this.state.overallStatus = 'completed';
    this.state.overallProgress = 100;
    this.state.endTime = new Date().toISOString();
    if (message) this.state.metadata = { ...this.state.metadata, completionMessage: message };

    console.log(`[ProgressTracker] 🎉 Operation completed: ${this.state.operation}`);
    this.save();
    this.stopHeartbeat();
  }

  fail(error: string) {
    this.state.overallStatus = 'failed';
    this.state.error = error;
    this.state.endTime = new Date().toISOString();

    console.error(`[ProgressTracker] 💥 Operation failed: ${this.state.operation} - ${error}`);
    this.save();
    this.stopHeartbeat();
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  getState(): ProgressState {
    return { ...this.state };
  }

  getStatusFilePath(): string {
    return this.statusFilePath;
  }
}

/**
 * Read progress state from file
 */
export function readProgress(operation: string, statusDir?: string): ProgressState | null {
  const dir = statusDir || path.join(paths.logs, 'status');
  const filePath = path.join(dir, `${operation}.json`);

  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`[readProgress] Failed to read ${filePath}: ${err}`);
    return null;
  }
}

/**
 * List all active progress operations
 */
export function listActiveProgress(statusDir?: string): ProgressState[] {
  const dir = statusDir || path.join(paths.logs, 'status');
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const states: ProgressState[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      const state = JSON.parse(content);

      // Only include running or recently completed operations
      if (state.overallStatus === 'running' || state.overallStatus === 'starting') {
        states.push(state);
      } else if (state.endTime) {
        // Include completed/failed operations from last 24 hours
        const endTime = new Date(state.endTime);
        const age = Date.now() - endTime.getTime();
        if (age < 24 * 60 * 60 * 1000) {
          states.push(state);
        }
      }
    } catch (err) {
      console.error(`[listActiveProgress] Failed to parse ${file}: ${err}`);
    }
  }

  return states.sort((a, b) => b.startTime.localeCompare(a.startTime));
}
