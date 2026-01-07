/**
 * Big Brother Terminal - Simple Interface
 *
 * Spawns Claude Code in the existing terminal system and sends commands to it.
 * Uses ttyd which is already part of the terminal infrastructure.
 */

import { spawn, execSync } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import { audit } from './audit.js';

const REPO_ROOT = process.env.METAHUMAN_ROOT || '/home/greggles/metahuman';
const LOG_DIR = path.join(REPO_ROOT, 'logs/run');
const TTYD_BIN = path.join(REPO_ROOT, 'bin/ttyd');
const BIG_BROTHER_PORT = 3099;

// ============================================================================
// Types
// ============================================================================

export interface TerminalSessionState {
  isRunning: boolean;
  port: number;
  pid: number | null;
  claudeReady: boolean;
  lastActivity: Date | null;
  promptQueue: string[];
}

export interface TerminalOutputEvent {
  type: 'output' | 'prompt_sent' | 'ready' | 'error';
  content: string;
  timestamp: Date;
}

// ============================================================================
// Simple Terminal Manager
// ============================================================================

class BigBrotherTerminalManager extends EventEmitter {
  private pid: number | null = null;
  private isStarting = false;
  private outputWs: WebSocket | null = null;
  private outputBuffer: string = '';
  private fileWatcher: fs.FSWatcher | null = null;
  private lastFileSize: number = 0;
  private outputLogPath: string = path.join(LOG_DIR, 'big-brother-output.log');

  getState(): TerminalSessionState {
    return {
      isRunning: this.isTerminalRunning(),
      port: BIG_BROTHER_PORT,
      pid: this.pid,
      claudeReady: this.isTerminalRunning(),
      lastActivity: null,
      promptQueue: [],
    };
  }

  isReady(): boolean {
    return this.isTerminalRunning();
  }

  private isTerminalRunning(): boolean {
    try {
      // Check if something is listening on port 3099
      execSync(`ss -tlnp 2>/dev/null | grep -q ":${BIG_BROTHER_PORT} "`, {
        encoding: 'utf-8',
        timeout: 2000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start file-based output capture (reads from script log file)
   * This works even when browser has the WebSocket connection
   */
  private startFileOutputCapture(): void {
    if (this.fileWatcher) {
      return; // Already watching
    }

    console.log('[big-brother-terminal] Starting file-based output capture...');

    // Initialize file size tracking
    try {
      const stats = fs.statSync(this.outputLogPath);
      this.lastFileSize = stats.size;
    } catch {
      this.lastFileSize = 0;
    }

    // Watch for file changes
    this.fileWatcher = fs.watch(this.outputLogPath, (eventType) => {
      if (eventType === 'change') {
        this.readNewOutput();
      }
    });

    // Also poll every 500ms in case watch events are missed
    const pollInterval = setInterval(() => {
      if (!this.fileWatcher) {
        clearInterval(pollInterval);
        return;
      }
      this.readNewOutput();
    }, 500);

    console.log('[big-brother-terminal] File output capture started');
  }

  /**
   * Read new output from the log file since last read
   */
  private readNewOutput(): void {
    try {
      const stats = fs.statSync(this.outputLogPath);
      if (stats.size > this.lastFileSize) {
        // Read only the new bytes
        const fd = fs.openSync(this.outputLogPath, 'r');
        const bytesToRead = stats.size - this.lastFileSize;
        const buffer = Buffer.alloc(bytesToRead);
        fs.readSync(fd, buffer, 0, bytesToRead, this.lastFileSize);
        fs.closeSync(fd);

        const content = buffer.toString('utf-8');
        this.lastFileSize = stats.size;

        if (content.length > 0) {
          this.outputBuffer += content;

          // Emit output event for listeners (claude-code-backend)
          this.emit('output', {
            type: 'output',
            content: content,
            timestamp: new Date(),
          });

          console.log(`[big-brother-terminal] File capture: ${content.length} bytes`);
        }
      }
    } catch (error) {
      // File may not exist yet, ignore
    }
  }

  /**
   * Stop file-based output capture
   */
  private stopFileOutputCapture(): void {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
      console.log('[big-brother-terminal] File output capture stopped');
    }
  }

  /**
   * Ensure output capture WebSocket is connected
   */
  private ensureOutputCapture(): void {
    // Start file-based capture (works regardless of browser connection)
    this.startFileOutputCapture();

    // Also try WebSocket for redundancy
    if (this.outputWs && this.outputWs.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    console.log('[big-brother-terminal] Connecting output capture WebSocket...');

    this.outputWs = new WebSocket(`ws://localhost:${BIG_BROTHER_PORT}/ws`);

    this.outputWs.on('open', () => {
      console.log('[big-brother-terminal] Output capture connected');
    });

    this.outputWs.on('message', (data: Buffer) => {
      // ttyd protocol: first byte is message type
      // 0 = terminal output, 1 = title, 2 = preferences
      const typeCode = data[0];
      const content = data.slice(1).toString('utf-8');

      if (typeCode === 0) {
        // Terminal output
        this.outputBuffer += content;

        // Emit output event for listeners (claude-code-backend)
        this.emit('output', {
          type: 'output',
          content: content,
          timestamp: new Date(),
        });
      }
    });

    this.outputWs.on('close', () => {
      console.log('[big-brother-terminal] Output capture disconnected');
      this.outputWs = null;
    });

    this.outputWs.on('error', (err) => {
      console.error('[big-brother-terminal] Output capture error:', err.message);
      this.outputWs = null;
    });
  }

  async start(): Promise<boolean> {
    if (this.isStarting) {
      // Wait for existing start to complete
      await new Promise(resolve => setTimeout(resolve, 3000));
      return this.isTerminalRunning();
    }

    if (this.isTerminalRunning()) {
      console.log('[big-brother-terminal] Terminal already running');
      return true;
    }

    this.isStarting = true;

    try {
      // Ensure log directory exists
      if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
      }

      const logFile = path.join(LOG_DIR, 'big-brother-terminal.log');
      const outputLogFile = path.join(LOG_DIR, 'big-brother-output.log');

      // Clear output log before starting (for fresh capture)
      fs.writeFileSync(outputLogFile, '');

      console.log(`[big-brother-terminal] Starting ttyd with Claude on port ${BIG_BROTHER_PORT}...`);
      console.log(`[big-brother-terminal] Output capture file: ${outputLogFile}`);

      // Use 'script' command to capture terminal output to a file
      // The -q flag suppresses "Script started" messages
      // The -f flag flushes output immediately
      // This allows backend to read output even when browser owns the WebSocket
      const claudeCmd = `script -q -f "${outputLogFile}" -c "IS_SANDBOX=1 claude --dangerously-skip-permissions"`;

      const process = spawn(TTYD_BIN, [
        '--port', BIG_BROTHER_PORT.toString(),
        '--writable',
        '--cwd', REPO_ROOT,
        'bash', '-c', claudeCmd,
      ], {
        detached: true,
        stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
        env: { ...global.process.env, IS_SANDBOX: '1' },
      });

      process.unref();
      this.pid = process.pid || null;

      // Wait for it to start
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (this.isTerminalRunning()) {
          console.log('[big-brother-terminal] Terminal started successfully');
          audit({
            level: 'info',
            category: 'action',
            event: 'big_brother_terminal_started',
            details: { port: BIG_BROTHER_PORT, pid: this.pid },
            actor: 'big-brother-terminal',
          });
          this.emit('ready', { port: BIG_BROTHER_PORT, url: `http://localhost:${BIG_BROTHER_PORT}` });
          return true;
        }
      }

      console.error('[big-brother-terminal] Timeout waiting for terminal to start');
      return false;
    } catch (error) {
      console.error('[big-brother-terminal] Failed to start:', error);
      return false;
    } finally {
      this.isStarting = false;
    }
  }

  async sendPrompt(prompt: string): Promise<boolean> {
    // Ensure terminal is running
    if (!this.isTerminalRunning()) {
      console.log('[big-brother-terminal] Terminal not running, starting...');
      const started = await this.start();
      if (!started) {
        console.error('[big-brother-terminal] Failed to start terminal');
        return false;
      }
      // Give Claude time to initialize
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Ensure output capture is connected BEFORE sending
    this.ensureOutputCapture();

    // Wait for output capture to connect
    await new Promise(resolve => setTimeout(resolve, 500));

    // Clear buffer before new prompt
    this.outputBuffer = '';

    return new Promise((resolve) => {
      try {
        console.log(`[big-brother-terminal] Sending prompt (${prompt.length} chars)...`);

        // Use the existing output capture connection if available, or create a new one
        if (this.outputWs && this.outputWs.readyState === WebSocket.OPEN) {
          // Send via existing connection
          // ttyd protocol: type byte 0 = input to terminal
          const inputMsg = Buffer.concat([Buffer.from([0]), Buffer.from(prompt + '\n')]);
          this.outputWs.send(inputMsg);
          console.log('[big-brother-terminal] Prompt sent via output capture connection');

          audit({
            level: 'info',
            category: 'action',
            event: 'big_brother_prompt_sent',
            details: { promptLength: prompt.length },
            actor: 'big-brother-terminal',
          });

          this.emit('output', {
            type: 'prompt_sent',
            content: prompt,
            timestamp: new Date(),
          });

          resolve(true);
        } else {
          // Fallback: create a temporary connection
          console.log('[big-brother-terminal] Output capture not ready, using temp connection');
          const ws = new WebSocket(`ws://localhost:${BIG_BROTHER_PORT}/ws`);

          const timeout = setTimeout(() => {
            ws.close();
            console.error('[big-brother-terminal] WebSocket timeout');
            resolve(false);
          }, 5000);

          ws.on('open', () => {
            clearTimeout(timeout);
            // ttyd protocol: type byte 0 = input to terminal
            const inputMsg = Buffer.concat([Buffer.from([0]), Buffer.from(prompt + '\n')]);
            ws.send(inputMsg);
            console.log('[big-brother-terminal] Prompt sent via temp connection');

            audit({
              level: 'info',
              category: 'action',
              event: 'big_brother_prompt_sent',
              details: { promptLength: prompt.length },
              actor: 'big-brother-terminal',
            });

            this.emit('output', {
              type: 'prompt_sent',
              content: prompt,
              timestamp: new Date(),
            });

            // Keep temp connection open to receive output
            // It will be closed when output capture takes over or on error
            resolve(true);
          });

          ws.on('message', (data: Buffer) => {
            // Also capture output from temp connection
            const typeCode = data[0];
            const content = data.slice(1).toString('utf-8');

            if (typeCode === 0) {
              this.outputBuffer += content;
              this.emit('output', {
                type: 'output',
                content: content,
                timestamp: new Date(),
              });
            }
          });

          ws.on('error', (error) => {
            clearTimeout(timeout);
            console.error('[big-brother-terminal] WebSocket error:', error);
            resolve(false);
          });
        }
      } catch (error) {
        console.error('[big-brother-terminal] Error sending prompt:', error);
        resolve(false);
      }
    });
  }

  async stop(): Promise<void> {
    try {
      // Stop file output capture
      this.stopFileOutputCapture();

      execSync(`pkill -f "ttyd.*--port ${BIG_BROTHER_PORT}" 2>/dev/null || true`);
      this.pid = null;
      audit({
        level: 'info',
        category: 'action',
        event: 'big_brother_terminal_stopped',
        details: {},
        actor: 'big-brother-terminal',
      });
    } catch {
      // Ignore
    }
  }

  getRecentOutput(): string {
    return this.outputBuffer;
  }

  clearOutputBuffer(): void {
    this.outputBuffer = '';
  }
}

// ============================================================================
// Singleton and Exports
// ============================================================================

export const bigBrotherTerminal = new BigBrotherTerminalManager();

export function isTmuxAvailable(): boolean {
  return true;
}

export async function ensureBigBrotherTerminal(): Promise<boolean> {
  return bigBrotherTerminal.start();
}

export async function sendToBigBrother(prompt: string): Promise<boolean> {
  return bigBrotherTerminal.sendPrompt(prompt);
}

export function isBigBrotherReady(): boolean {
  return bigBrotherTerminal.isReady();
}

export async function stopBigBrother(): Promise<void> {
  return bigBrotherTerminal.stop();
}

export function getBigBrotherState(): TerminalSessionState {
  return bigBrotherTerminal.getState();
}

export function onBigBrotherOutput(callback: (event: TerminalOutputEvent) => void): () => void {
  bigBrotherTerminal.on('output', callback);
  return () => bigBrotherTerminal.off('output', callback);
}

export function onBigBrotherReady(callback: (info: { port: number; url: string }) => void): () => void {
  bigBrotherTerminal.on('ready', callback);
  return () => bigBrotherTerminal.off('ready', callback);
}
