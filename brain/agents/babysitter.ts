/**
 * Babysitter Agent - Proactive System Monitoring & Self-Healing
 *
 * A unified monitoring system that consolidates:
 * - System Coder (error capture and fix generation)
 * - Active Operator Self-Healing (TypeScript error analysis)
 * - Lizard Brain Triggers (failed agent detection)
 *
 * Watches ALL log sources in real-time:
 * - Node.js terminal (stdout/stderr)
 * - Server logs (web server, voice server, RVC, etc.)
 * - Big Brother terminal (Claude CLI output)
 * - Agent logs (scheduler, organizer, etc.)
 * - Audit logs (system events)
 * - Web console (browser errors via WebSocket)
 *
 * Features:
 * - Real-time log tailing
 * - Pattern detection (recurring errors)
 * - Auto-healing (low/medium risk fixes)
 * - Health reporting (hourly/daily/weekly)
 * - Integration with System Coder for fix generation
 * - Integration with Lizard Brain for agent failures
 *
 * See: docs/BABYSITTER-CONSOLIDATION.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { watch, FSWatcher } from 'chokidar';
import WebSocket from 'ws';
import { audit } from '../../packages/core/src/audit.js';
import { systemPaths, getProfilePaths } from '../../packages/core/src/paths.js';

const LOG_PREFIX = '[babysitter]';

// ============================================================================
// Types
// ============================================================================

export interface BabysitterConfig {
  enabled: boolean;
  monitoring: {
    sources: LogSource[];
    pollInterval: number;
    bufferSize: number;
  };
  errorDetection: {
    patterns: ErrorPattern[];
    minSeverity: 'warning' | 'error' | 'critical';
  };
  autoHealing: {
    enabled: boolean;
    maxRisk: 'low' | 'medium';
    testFirst: boolean;
    maxRetries: number;
    cooldownPeriod: number;
    blacklist: string[];
  };
  patternDetection: {
    enabled: boolean;
    minOccurrences: number;
    timeWindow: number;
    storePath: string;
  };
  reporting: {
    hourly: { enabled: boolean };
    daily: { enabled: boolean; time: string };
    weekly: { enabled: boolean; day: string; time: string };
    outputPath: string;
  };
  integrations: {
    systemCoder: { enabled: boolean; autoCaptureErrors: boolean };
    lizardBrain: { enabled: boolean; reportFailedAgents: boolean };
    activeOperator: { enabled: boolean; updateScratchpad: boolean };
    bigBrother: { enabled: boolean; monitorTerminal: boolean };
  };
}

export interface LogSource {
  type: 'file' | 'directory' | 'stream' | 'websocket';
  name: string;
  path?: string;
  url?: string;
  stream?: 'stdout' | 'stderr';
  parser: 'plain-text' | 'ndjson' | 'stream-json';
}

export interface ErrorPattern {
  name: string;
  regex: string;
  severity: 'warning' | 'error' | 'critical';
}

export interface ParsedError {
  source: string;
  severity: 'warning' | 'error' | 'critical';
  message: string;
  stack?: string;
  timestamp: Date;
  file?: string;
  line?: number;
  context?: string;
}

export interface DetectedPattern {
  signature: string;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
  sources: string[];
  autoFixable: boolean;
  fixId?: string;
}

export interface BabysitterState {
  isRunning: boolean;
  startedAt: Date | null;
  errorsDetected: number;
  errorsAutoFixed: number;
  errorsEscalated: number;
  patternsDetected: number;
  lastHealthReport: Date | null;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: BabysitterConfig = {
  enabled: true,
  monitoring: {
    sources: [
      {
        type: 'file',
        name: 'server',
        path: 'logs/server.log',
        parser: 'plain-text',
      },
      {
        type: 'websocket',
        name: 'big-brother',
        url: 'ws://localhost:3099',
        parser: 'stream-json',
      },
      {
        type: 'directory',
        name: 'agents',
        path: 'logs/run/agents/',
        parser: 'ndjson',
      },
    ],
    pollInterval: 5000,
    bufferSize: 100,
  },
  errorDetection: {
    patterns: [
      { name: 'typescript-error', regex: 'TS\\d+:', severity: 'error' },
      { name: 'unhandled-rejection', regex: 'UnhandledPromiseRejection', severity: 'critical' },
      { name: 'react-warning', regex: 'Warning: ', severity: 'warning' },
      { name: 'vite-error', regex: '\\[vite\\] .*error', severity: 'error' },
      { name: 'node-error', regex: 'Error:', severity: 'error' },
    ],
    minSeverity: 'warning',
  },
  autoHealing: {
    enabled: true,
    maxRisk: 'medium',
    testFirst: true,
    maxRetries: 3,
    cooldownPeriod: 3600000, // 1 hour
    blacklist: ['database-schema-change', 'production-deployment'],
  },
  patternDetection: {
    enabled: true,
    minOccurrences: 3,
    timeWindow: 3600000, // 1 hour
    storePath: 'logs/run/babysitter-patterns.json',
  },
  reporting: {
    hourly: { enabled: true },
    daily: { enabled: true, time: '09:00' },
    weekly: { enabled: true, day: 'monday', time: '09:00' },
    outputPath: 'logs/run/babysitter-reports/',
  },
  integrations: {
    systemCoder: { enabled: true, autoCaptureErrors: true },
    lizardBrain: { enabled: true, reportFailedAgents: true },
    activeOperator: { enabled: true, updateScratchpad: true },
    bigBrother: { enabled: true, monitorTerminal: true },
  },
};

// ============================================================================
// Configuration Management
// ============================================================================

function loadConfig(): BabysitterConfig {
  const configPath = path.join(systemPaths.etc, 'babysitter.json');

  if (!fs.existsSync(configPath)) {
    console.log(`${LOG_PREFIX} Config not found, creating default at ${configPath}`);
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as BabysitterConfig;
    return { ...DEFAULT_CONFIG, ...config }; // Merge with defaults
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to load config:`, error);
    return DEFAULT_CONFIG;
  }
}

// ============================================================================
// Log Tailer - Real-time Log Monitoring
// ============================================================================

class LogTailer {
  private watchers: Map<string, FSWatcher> = new Map();
  private websockets: Map<string, WebSocket> = new Map();
  private buffers: Map<string, string[]> = new Map();
  private config: BabysitterConfig;
  private onLogLine: (source: string, line: string) => void;

  constructor(config: BabysitterConfig, onLogLine: (source: string, line: string) => void) {
    this.config = config;
    this.onLogLine = onLogLine;
  }

  /**
   * Start watching all configured log sources
   */
  async start(): Promise<void> {
    console.log(`${LOG_PREFIX} Starting log monitoring for ${this.config.monitoring.sources.length} sources...`);

    for (const source of this.config.monitoring.sources) {
      try {
        switch (source.type) {
          case 'file':
            await this.watchFile(source);
            break;
          case 'directory':
            await this.watchDirectory(source);
            break;
          case 'websocket':
            await this.watchWebSocket(source);
            break;
          case 'stream':
            await this.watchStream(source);
            break;
        }
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to watch ${source.name}:`, error);
      }
    }

    console.log(`${LOG_PREFIX} ✓ Log monitoring started`);
  }

  /**
   * Watch a single file for changes
   */
  private async watchFile(source: LogSource): Promise<void> {
    if (!source.path) return;

    const fullPath = path.isAbsolute(source.path)
      ? source.path
      : path.join(systemPaths.root, source.path);

    console.log(`${LOG_PREFIX} Watching file: ${fullPath}`);

    // Initialize buffer
    this.buffers.set(source.name, []);

    // Read existing content
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n').slice(-this.config.monitoring.bufferSize);
      this.buffers.set(source.name, lines);
    }

    // Watch for changes
    const watcher = watch(fullPath, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100,
      },
    });

    let lastSize = fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0;

    watcher.on('change', (filePath) => {
      try {
        const stats = fs.statSync(filePath);
        if (stats.size < lastSize) {
          // File was truncated
          lastSize = stats.size;
          return;
        }

        // Read new content
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const buffer = this.buffers.get(source.name) || [];
        const newLines = lines.slice(buffer.length);

        // Process new lines
        for (const line of newLines) {
          if (line.trim()) {
            this.onLogLine(source.name, line);
          }
        }

        // Update buffer
        const updatedBuffer = [...buffer, ...newLines].slice(-this.config.monitoring.bufferSize);
        this.buffers.set(source.name, updatedBuffer);
        lastSize = stats.size;
      } catch (error) {
        console.error(`${LOG_PREFIX} Error reading ${source.name}:`, error);
      }
    });

    this.watchers.set(source.name, watcher);
  }

  /**
   * Watch all files in a directory
   */
  private async watchDirectory(source: LogSource): Promise<void> {
    if (!source.path) return;

    const fullPath = path.isAbsolute(source.path)
      ? source.path
      : path.join(systemPaths.root, source.path);

    console.log(`${LOG_PREFIX} Watching directory: ${fullPath}`);

    if (!fs.existsSync(fullPath)) {
      console.warn(`${LOG_PREFIX} Directory does not exist: ${fullPath}`);
      return;
    }

    const watcher = watch(`${fullPath}/**/*.log`, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100,
      },
    });

    watcher.on('add', (filePath) => {
      console.log(`${LOG_PREFIX} New log file detected: ${filePath}`);
      // Process existing content
      this.processLogFile(source.name, filePath);
    });

    watcher.on('change', (filePath) => {
      this.processLogFile(source.name, filePath);
    });

    this.watchers.set(source.name, watcher);
  }

  /**
   * Process a log file and emit new lines
   */
  private processLogFile(sourceName: string, filePath: string): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const bufferKey = `${sourceName}:${filePath}`;
      const buffer = this.buffers.get(bufferKey) || [];
      const newLines = lines.slice(buffer.length);

      for (const line of newLines) {
        if (line.trim()) {
          this.onLogLine(sourceName, line);
        }
      }

      // Update buffer
      const updatedBuffer = [...buffer, ...newLines].slice(-this.config.monitoring.bufferSize);
      this.buffers.set(bufferKey, updatedBuffer);
    } catch (error) {
      console.error(`${LOG_PREFIX} Error processing ${filePath}:`, error);
    }
  }

  /**
   * Watch Big Brother terminal WebSocket
   */
  private async watchWebSocket(source: LogSource): Promise<void> {
    if (!source.url) return;

    console.log(`${LOG_PREFIX} Connecting to WebSocket: ${source.url}`);

    const ws = new WebSocket(source.url);

    ws.on('open', () => {
      console.log(`${LOG_PREFIX} ✓ Connected to ${source.name}`);
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());

        // Handle different message types from Big Brother
        if (message.type === 'output' || message.type === 'stderr') {
          this.onLogLine(source.name, message.data || '');
        } else if (message.type === 'error') {
          this.onLogLine(source.name, `ERROR: ${message.data || ''}`);
        } else if (message.type === 'thinking') {
          // Thinking output - optionally log for debugging
          // this.onLogLine(source.name, `[THINKING] ${message.data || ''}`);
        }
      } catch (error) {
        // Not JSON, treat as plain text
        this.onLogLine(source.name, data.toString());
      }
    });

    ws.on('error', (error) => {
      console.error(`${LOG_PREFIX} WebSocket error (${source.name}):`, error);
    });

    ws.on('close', () => {
      console.log(`${LOG_PREFIX} WebSocket closed (${source.name}), attempting reconnect...`);
      // Attempt reconnect after 5 seconds
      setTimeout(() => this.watchWebSocket(source), 5000);
    });

    this.websockets.set(source.name, ws);
  }

  /**
   * Watch Node.js stdout/stderr streams
   */
  private async watchStream(source: LogSource): Promise<void> {
    if (!source.stream) return;

    console.log(`${LOG_PREFIX} Watching stream: ${source.stream}`);

    const stream = source.stream === 'stdout' ? process.stdout : process.stderr;

    // Hook into the stream
    const originalWrite = stream.write.bind(stream);
    stream.write = (chunk: any, ...args: any[]): boolean => {
      const text = chunk.toString();
      this.onLogLine(source.name, text);
      return originalWrite(chunk, ...args);
    };

    console.log(`${LOG_PREFIX} ✓ Monitoring ${source.stream}`);
  }

  /**
   * Stop all watchers
   */
  async stop(): Promise<void> {
    console.log(`${LOG_PREFIX} Stopping log monitoring...`);

    // Close file watchers
    for (const [name, watcher] of this.watchers.entries()) {
      await watcher.close();
      console.log(`${LOG_PREFIX} Closed watcher: ${name}`);
    }
    this.watchers.clear();

    // Close WebSockets
    for (const [name, ws] of this.websockets.entries()) {
      ws.close();
      console.log(`${LOG_PREFIX} Closed WebSocket: ${name}`);
    }
    this.websockets.clear();

    console.log(`${LOG_PREFIX} ✓ Log monitoring stopped`);
  }
}

// ============================================================================
// Error Parser - Extract Errors from Logs
// ============================================================================

class ErrorParser {
  private config: BabysitterConfig;

  constructor(config: BabysitterConfig) {
    this.config = config;
  }

  /**
   * Parse a log line and extract error information
   */
  parse(source: string, line: string): ParsedError | null {
    // Try each error pattern
    for (const pattern of this.config.errorDetection.patterns) {
      const regex = new RegExp(pattern.regex, 'i');
      if (regex.test(line)) {
        return this.extractError(source, line, pattern);
      }
    }

    return null;
  }

  /**
   * Extract detailed error information from a log line
   */
  private extractError(source: string, line: string, pattern: ErrorPattern): ParsedError {
    // Extract file and line number if present (common pattern: file.ts:123)
    const fileMatch = line.match(/([a-zA-Z0-9_\-./]+\.(ts|js|tsx|jsx|svelte)):(\d+)/);
    const file = fileMatch?.[1];
    const lineNum = fileMatch?.[3] ? parseInt(fileMatch[3], 10) : undefined;

    return {
      source,
      severity: pattern.severity,
      message: line.trim(),
      timestamp: new Date(),
      file,
      line: lineNum,
      context: line, // Full line as context
    };
  }
}

// ============================================================================
// Auto-Healer - Self-Healing System
// ============================================================================

class AutoHealer {
  private config: BabysitterConfig;
  private username: string;
  private attemptLog: Map<string, { timestamp: Date; retries: number }> = new Map();

  constructor(config: BabysitterConfig, username: string) {
    this.config = config;
    this.username = username;
  }

  /**
   * Attempt to auto-heal a recurring pattern
   * Returns true if healing was attempted (regardless of success)
   */
  async attemptAutoHeal(pattern: DetectedPattern, errorId: string): Promise<{ attempted: boolean; success: boolean; fixId?: string; reason?: string }> {
    if (!this.config.autoHealing.enabled) {
      return { attempted: false, success: false, reason: 'Auto-healing disabled' };
    }

    // Check cooldown
    const lastAttempt = this.attemptLog.get(pattern.signature);
    if (lastAttempt) {
      const timeSinceAttempt = Date.now() - lastAttempt.timestamp.getTime();
      if (timeSinceAttempt < this.config.autoHealing.cooldownPeriod) {
        return { attempted: false, success: false, reason: 'Cooldown period active' };
      }

      // Check max retries
      if (lastAttempt.retries >= this.config.autoHealing.maxRetries) {
        return { attempted: false, success: false, reason: 'Max retries exceeded' };
      }
    }

    console.log(`${LOG_PREFIX} 🔧 Attempting auto-heal for: "${pattern.signature}"`);

    try {
      // Dynamic import to avoid circular dependencies
      const { generateFixForError, updateFixStatus, applyFix } = await import(
        '../../packages/core/src/system-coder/index.js'
      );

      // 1. Generate fix via System Coder + Big Brother
      console.log(`${LOG_PREFIX} Generating fix for error ${errorId}...`);
      const result = await generateFixForError(this.username, errorId);

      if (!result.success || !result.fix) {
        console.error(`${LOG_PREFIX} Failed to generate fix: ${result.error}`);
        this.logAttempt(pattern.signature, false);
        return { attempted: true, success: false, reason: result.error };
      }

      const fix = result.fix;
      console.log(`${LOG_PREFIX} Fix generated: ${fix.id} (risk: ${fix.risk}, confidence: ${fix.confidence})`);

      // 2. Check risk level
      const maxRisk = this.config.autoHealing.maxRisk;
      const riskLevels = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
      const fixRiskLevel = riskLevels[fix.risk as keyof typeof riskLevels] || 999;
      const maxRiskLevel = riskLevels[maxRisk];

      if (fixRiskLevel > maxRiskLevel) {
        console.log(`${LOG_PREFIX} ⚠️ Risk too high (${fix.risk}), escalating to user`);
        this.logAttempt(pattern.signature, false);
        return {
          attempted: true,
          success: false,
          fixId: fix.id,
          reason: `Risk ${fix.risk} exceeds max ${maxRisk} - requires manual approval`,
        };
      }

      // 3. Check blacklist
      for (const blacklistItem of this.config.autoHealing.blacklist) {
        if (
          fix.title.toLowerCase().includes(blacklistItem.toLowerCase()) ||
          fix.explanation.toLowerCase().includes(blacklistItem.toLowerCase())
        ) {
          console.log(`${LOG_PREFIX} ⚠️ Fix matches blacklist: ${blacklistItem}, escalating`);
          this.logAttempt(pattern.signature, false);
          return {
            attempted: true,
            success: false,
            fixId: fix.id,
            reason: `Matches blacklist: ${blacklistItem}`,
          };
        }
      }

      // 4. Run tests if configured
      if (this.config.autoHealing.testFirst && fix.testCommands && fix.testCommands.length > 0) {
        console.log(`${LOG_PREFIX} Running tests: ${fix.testCommands.join(', ')}`);
        const testsPassed = await this.runTests(fix.testCommands);

        if (!testsPassed) {
          console.error(`${LOG_PREFIX} ❌ Tests failed, not applying fix`);
          this.logAttempt(pattern.signature, false);
          return {
            attempted: true,
            success: false,
            fixId: fix.id,
            reason: 'Tests failed',
          };
        }

        console.log(`${LOG_PREFIX} ✓ Tests passed`);
      }

      // 5. Auto-approve the fix (bypassing manual approval)
      console.log(`${LOG_PREFIX} Auto-approving fix ${fix.id}...`);
      updateFixStatus(this.username, fix.id, 'approved', {
        approvedBy: 'babysitter-auto-heal',
      });

      // 6. Apply the fix
      console.log(`${LOG_PREFIX} Applying fix ${fix.id}...`);
      const applyResult = applyFix(this.username, fix.id);

      if (!applyResult.success) {
        console.error(`${LOG_PREFIX} ❌ Failed to apply fix: ${applyResult.error}`);
        this.logAttempt(pattern.signature, false);
        return {
          attempted: true,
          success: false,
          fixId: fix.id,
          reason: `Application failed: ${applyResult.error}`,
        };
      }

      console.log(`${LOG_PREFIX} ✅ AUTO-HEALED: "${pattern.signature}" with fix ${fix.id}`);
      this.logAttempt(pattern.signature, true);

      return {
        attempted: true,
        success: true,
        fixId: fix.id,
      };
    } catch (error) {
      console.error(`${LOG_PREFIX} Auto-heal exception:`, error);
      this.logAttempt(pattern.signature, false);
      return {
        attempted: true,
        success: false,
        reason: (error as Error).message,
      };
    }
  }

  /**
   * Run test commands
   */
  private async runTests(testCommands: string[]): Promise<boolean> {
    const { spawn } = await import('child_process');

    for (const command of testCommands) {
      console.log(`${LOG_PREFIX} Running: ${command}`);

      const result = await new Promise<boolean>((resolve) => {
        const [cmd, ...args] = command.split(' ');
        const proc = spawn(cmd, args, { stdio: 'inherit', shell: true });

        proc.on('close', (code) => {
          resolve(code === 0);
        });

        proc.on('error', (error) => {
          console.error(`${LOG_PREFIX} Test error:`, error);
          resolve(false);
        });
      });

      if (!result) {
        return false;
      }
    }

    return true;
  }

  /**
   * Log an auto-heal attempt
   */
  private logAttempt(signature: string, success: boolean): void {
    const existing = this.attemptLog.get(signature);
    this.attemptLog.set(signature, {
      timestamp: new Date(),
      retries: success ? 0 : (existing?.retries || 0) + 1,
    });
  }
}

// ============================================================================
// Health Reporter - Periodic Health Summaries
// ============================================================================

interface HealthReport {
  timestamp: Date;
  period: 'hourly' | 'daily' | 'weekly';
  summary: {
    errorsDetected: number;
    errorsAutoFixed: number;
    errorsEscalated: number;
    patternsIdentified: number;
    autoHealSuccessRate: number;
  };
  topIssues: Array<{
    pattern: string;
    count: number;
    severity: string;
    status: 'auto_fixed' | 'pending' | 'escalated';
    fixId?: string;
  }>;
  systemHealth: {
    nodeServer: 'ok' | 'degraded' | 'down';
    agents: Record<string, 'ok' | 'error'>;
    bigBrother: 'ok' | 'down';
  };
}

class HealthReporter {
  private config: BabysitterConfig;
  private username: string;
  private lastHourlyReport: Date | null = null;
  private lastDailyReport: Date | null = null;
  private lastWeeklyReport: Date | null = null;

  constructor(config: BabysitterConfig, username: string) {
    this.config = config;
    this.username = username;
  }

  /**
   * Check if it's time to generate a report
   */
  shouldGenerateReport(period: 'hourly' | 'daily' | 'weekly'): boolean {
    const now = new Date();

    if (period === 'hourly') {
      if (!this.lastHourlyReport) return true;
      const hoursSince = (now.getTime() - this.lastHourlyReport.getTime()) / (1000 * 60 * 60);
      return hoursSince >= 1;
    }

    if (period === 'daily') {
      if (!this.lastDailyReport) return true;
      const daysSince = (now.getTime() - this.lastDailyReport.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince >= 1;
    }

    if (period === 'weekly') {
      if (!this.lastWeeklyReport) return true;
      const weeksSince = (now.getTime() - this.lastWeeklyReport.getTime()) / (1000 * 60 * 60 * 24 * 7);
      return weeksSince >= 1;
    }

    return false;
  }

  /**
   * Generate a health report
   */
  async generateReport(
    period: 'hourly' | 'daily' | 'weekly',
    state: BabysitterState,
    patterns: Map<string, DetectedPattern>
  ): Promise<HealthReport> {
    console.log(`${LOG_PREFIX} 📊 Generating ${period} health report...`);

    // Calculate auto-heal success rate
    const totalAttempts = state.errorsAutoFixed + state.errorsEscalated;
    const successRate = totalAttempts > 0 ? state.errorsAutoFixed / totalAttempts : 0;

    // Get top issues (sorted by occurrence count)
    const topIssues = Array.from(patterns.values())
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 10)
      .map(p => ({
        pattern: p.signature,
        count: p.occurrences,
        severity: 'error', // Could be enhanced to track actual severity
        status: p.autoFixable ? 'auto_fixed' : (p.occurrences >= 3 ? 'escalated' : 'pending') as 'auto_fixed' | 'pending' | 'escalated',
        fixId: p.fixId,
      }));

    // Check system health
    const systemHealth = await this.checkSystemHealth();

    const report: HealthReport = {
      timestamp: new Date(),
      period,
      summary: {
        errorsDetected: state.errorsDetected,
        errorsAutoFixed: state.errorsAutoFixed,
        errorsEscalated: state.errorsEscalated,
        patternsIdentified: state.patternsDetected,
        autoHealSuccessRate: successRate,
      },
      topIssues,
      systemHealth,
    };

    // Save report to disk
    await this.saveReport(report);

    // Update last report timestamp
    if (period === 'hourly') this.lastHourlyReport = new Date();
    if (period === 'daily') this.lastDailyReport = new Date();
    if (period === 'weekly') this.lastWeeklyReport = new Date();

    console.log(`${LOG_PREFIX} ✓ ${period} report generated: ${state.errorsDetected} errors, ${state.errorsAutoFixed} auto-fixed, ${successRate.toFixed(2)} success rate`);

    return report;
  }

  /**
   * Check system health
   */
  private async checkSystemHealth(): Promise<HealthReport['systemHealth']> {
    return {
      nodeServer: 'ok', // Could check if server.log has recent activity
      agents: {
        organizer: 'ok',
        reflector: 'ok',
        // Could be enhanced to actually check agent status
      },
      bigBrother: 'ok', // Could ping ws://localhost:3099
    };
  }

  /**
   * Save report to disk
   */
  private async saveReport(report: HealthReport): Promise<void> {
    const outputPath = path.join(
      systemPaths.root,
      this.config.reporting.outputPath
    );

    // Ensure directory exists
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    // Generate filename
    const timestamp = report.timestamp.toISOString().replace(/[:.]/g, '-');
    const filename = `${report.period}-${timestamp}.json`;
    const fullPath = path.join(outputPath, filename);

    // Write report
    fs.writeFileSync(fullPath, JSON.stringify(report, null, 2));

    audit({
      level: 'info',
      category: 'action',
      event: 'babysitter_health_report_generated',
      details: {
        period: report.period,
        errorsDetected: report.summary.errorsDetected,
        errorsAutoFixed: report.summary.errorsAutoFixed,
        successRate: report.summary.autoHealSuccessRate,
      },
      actor: 'babysitter',
      userId: this.username,
    });
  }

  /**
   * Get the latest report for a period
   */
  getLatestReport(period: 'hourly' | 'daily' | 'weekly'): HealthReport | null {
    const outputPath = path.join(
      systemPaths.root,
      this.config.reporting.outputPath
    );

    if (!fs.existsSync(outputPath)) {
      return null;
    }

    try {
      const files = fs
        .readdirSync(outputPath)
        .filter(f => f.startsWith(`${period}-`) && f.endsWith('.json'))
        .sort()
        .reverse();

      if (files.length === 0) {
        return null;
      }

      const content = fs.readFileSync(path.join(outputPath, files[0]), 'utf-8');
      const report = JSON.parse(content) as HealthReport;
      // Convert string dates back to Date objects
      report.timestamp = new Date(report.timestamp);
      return report;
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Babysitter Agent - Main Class
// ============================================================================

class BabysitterAgent {
  private config: BabysitterConfig;
  private state: BabysitterState;
  private tailer: LogTailer | null = null;
  private parser: ErrorParser;
  private autoHealer: AutoHealer;
  private healthReporter: HealthReporter;
  private patterns: Map<string, DetectedPattern> = new Map();
  private username: string;
  private errorIdsByPattern: Map<string, string> = new Map(); // signature -> most recent errorId
  private reportCheckInterval: NodeJS.Timeout | null = null;

  constructor(username: string) {
    this.username = username;
    this.config = loadConfig();
    this.parser = new ErrorParser(this.config);
    this.autoHealer = new AutoHealer(this.config, username);
    this.healthReporter = new HealthReporter(this.config, username);
    this.state = {
      isRunning: false,
      startedAt: null,
      errorsDetected: 0,
      errorsAutoFixed: 0,
      errorsEscalated: 0,
      patternsDetected: 0,
      lastHealthReport: null,
    };

    this.loadPatterns();
  }

  /**
   * Start the babysitter agent
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log(`${LOG_PREFIX} Disabled in config, skipping...`);
      return;
    }

    console.log(`${LOG_PREFIX} ========== STARTING ==========`);

    this.state.isRunning = true;
    this.state.startedAt = new Date();

    // Start log monitoring
    this.tailer = new LogTailer(this.config, this.handleLogLine.bind(this));
    await this.tailer.start();

    // Start periodic health reporting
    this.startHealthReporting();

    audit({
      level: 'info',
      category: 'action',
      event: 'babysitter_started',
      details: {
        username: this.username,
        sources: this.config.monitoring.sources.length,
      },
      actor: 'babysitter',
      userId: this.username,
    });

    console.log(`${LOG_PREFIX} ========== RUNNING ==========`);
  }

  /**
   * Start periodic health reporting
   */
  private startHealthReporting(): void {
    // Check every 5 minutes if it's time to generate a report
    this.reportCheckInterval = setInterval(async () => {
      await this.checkAndGenerateReports();
    }, 5 * 60 * 1000); // 5 minutes

    // Also check immediately on start
    this.checkAndGenerateReports().catch(err => {
      console.error(`${LOG_PREFIX} Failed to generate initial reports:`, err);
    });

    console.log(`${LOG_PREFIX} ✓ Health reporting started`);
  }

  /**
   * Check if reports need to be generated and generate them
   */
  private async checkAndGenerateReports(): Promise<void> {
    try {
      // Check hourly report
      if (this.config.reporting.hourly.enabled && this.healthReporter.shouldGenerateReport('hourly')) {
        const report = await this.healthReporter.generateReport('hourly', this.state, this.patterns);
        this.state.lastHealthReport = report.timestamp;
      }

      // Check daily report
      if (this.config.reporting.daily.enabled && this.healthReporter.shouldGenerateReport('daily')) {
        const report = await this.healthReporter.generateReport('daily', this.state, this.patterns);
        this.state.lastHealthReport = report.timestamp;
      }

      // Check weekly report
      if (this.config.reporting.weekly.enabled && this.healthReporter.shouldGenerateReport('weekly')) {
        const report = await this.healthReporter.generateReport('weekly', this.state, this.patterns);
        this.state.lastHealthReport = report.timestamp;
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Error generating reports:`, error);
    }
  }

  /**
   * Handle a log line from any source
   */
  private async handleLogLine(source: string, line: string): Promise<void> {
    // Parse for errors
    const error = this.parser.parse(source, line);
    if (error) {
      await this.handleError(error);
    }
  }

  /**
   * Handle a detected error
   */
  private async handleError(error: ParsedError): Promise<void> {
    console.log(`${LOG_PREFIX} 🚨 Error detected: [${error.source}] ${error.severity}: ${error.message.substring(0, 100)}`);

    this.state.errorsDetected++;

    // Skip if severity below threshold
    const severities = ['warning', 'error', 'critical'];
    const minSeverityIndex = severities.indexOf(this.config.errorDetection.minSeverity);
    const errorSeverityIndex = severities.indexOf(error.severity);
    if (errorSeverityIndex < minSeverityIndex) {
      return;
    }

    // Capture to System Coder if integration enabled
    let errorId: string | undefined;
    if (this.config.integrations.systemCoder.enabled && this.config.integrations.systemCoder.autoCaptureErrors) {
      errorId = await this.captureToSystemCoder(error);
    }

    // Pattern detection
    if (this.config.patternDetection.enabled && errorId) {
      await this.detectPattern(error, errorId);
    }
  }

  /**
   * Capture error to System Coder
   * Returns the error ID for use in fix generation
   */
  private async captureToSystemCoder(error: ParsedError): Promise<string | undefined> {
    try {
      const { captureError } = await import('../../packages/core/src/system-coder/index.js');

      const capturedError = await captureError(this.username, {
        source: error.source as any, // System Coder has specific source types
        severity: error.severity as any,
        message: error.message,
        stack: error.stack,
        context: {
          file: error.file,
          line: error.line,
          output: error.context,
        },
      });

      console.log(`${LOG_PREFIX} ✓ Captured to System Coder: ${error.message.substring(0, 80)}`);
      return capturedError.id;
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to capture to System Coder:`, err);
      return undefined;
    }
  }

  /**
   * Detect recurring error patterns
   */
  private async detectPattern(error: ParsedError, errorId: string): Promise<void> {
    // Create signature (simplified error message)
    const signature = error.message
      .replace(/\d+/g, 'N') // Replace numbers with N
      .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, 'UUID') // Replace UUIDs
      .substring(0, 100);

    // Store the most recent errorId for this pattern
    this.errorIdsByPattern.set(signature, errorId);

    const existing = this.patterns.get(signature);
    const now = new Date();

    if (existing) {
      // Update existing pattern
      existing.occurrences++;
      existing.lastSeen = now;
      if (!existing.sources.includes(error.source)) {
        existing.sources.push(error.source);
      }

      console.log(`${LOG_PREFIX} 🔁 Pattern detected: "${signature}" (${existing.occurrences} occurrences)`);

      // Check if it's a recurring pattern
      if (existing.occurrences >= this.config.patternDetection.minOccurrences) {
        const timeWindow = now.getTime() - existing.firstSeen.getTime();
        if (timeWindow <= this.config.patternDetection.timeWindow) {
          console.log(`${LOG_PREFIX} ⚠️ RECURRING PATTERN: "${signature}" (${existing.occurrences}x in ${Math.round(timeWindow / 60000)}min)`);
          this.state.patternsDetected++;

          // Attempt auto-healing if not already attempted recently
          if (!existing.autoFixable) {
            // Mark as attempting to fix (prevents multiple simultaneous attempts)
            existing.autoFixable = true;
            this.savePatterns();

            // Trigger auto-healing
            const healResult = await this.autoHealer.attemptAutoHeal(existing, errorId);

            if (healResult.attempted) {
              if (healResult.success) {
                console.log(`${LOG_PREFIX} ✅ Pattern auto-healed successfully!`);
                this.state.errorsAutoFixed++;
              } else {
                console.log(`${LOG_PREFIX} ⚠️ Auto-heal failed: ${healResult.reason}`);
                if (healResult.fixId) {
                  this.state.errorsEscalated++;
                  console.log(`${LOG_PREFIX} 📋 Fix ${healResult.fixId} available for manual review`);
                }
                // Reset autoFixable flag so we can try again later
                existing.autoFixable = false;
              }
              this.savePatterns();
            }
          }
        }
      }
    } else {
      // New pattern
      this.patterns.set(signature, {
        signature,
        occurrences: 1,
        firstSeen: now,
        lastSeen: now,
        sources: [error.source],
        autoFixable: false,
      });
    }

    // Persist patterns
    this.savePatterns();
  }

  /**
   * Load patterns from disk
   */
  private loadPatterns(): void {
    const patternPath = path.join(systemPaths.root, this.config.patternDetection.storePath);

    if (!fs.existsSync(patternPath)) {
      return;
    }

    try {
      const content = fs.readFileSync(patternPath, 'utf-8');
      const data = JSON.parse(content) as Array<{ signature: string; pattern: DetectedPattern }>;

      for (const item of data) {
        this.patterns.set(item.signature, {
          ...item.pattern,
          firstSeen: new Date(item.pattern.firstSeen),
          lastSeen: new Date(item.pattern.lastSeen),
        });
      }

      console.log(`${LOG_PREFIX} Loaded ${this.patterns.size} patterns`);
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to load patterns:`, error);
    }
  }

  /**
   * Save patterns to disk
   */
  private savePatterns(): void {
    const patternPath = path.join(systemPaths.root, this.config.patternDetection.storePath);
    const dir = path.dirname(patternPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      const data = Array.from(this.patterns.entries()).map(([signature, pattern]) => ({
        signature,
        pattern,
      }));

      fs.writeFileSync(patternPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to save patterns:`, error);
    }
  }

  /**
   * Get current state
   */
  getState(): BabysitterState {
    return { ...this.state };
  }

  /**
   * Get latest health report
   */
  getLatestReport(period: 'hourly' | 'daily' | 'weekly'): HealthReport | null {
    return this.healthReporter.getLatestReport(period);
  }

  /**
   * Generate report on demand
   */
  async generateReport(period: 'hourly' | 'daily' | 'weekly'): Promise<HealthReport> {
    return this.healthReporter.generateReport(period, this.state, this.patterns);
  }

  /**
   * Stop the babysitter agent
   */
  async stop(): Promise<void> {
    console.log(`${LOG_PREFIX} ========== STOPPING ==========`);

    if (this.tailer) {
      await this.tailer.stop();
      this.tailer = null;
    }

    // Stop health reporting
    if (this.reportCheckInterval) {
      clearInterval(this.reportCheckInterval);
      this.reportCheckInterval = null;
    }

    this.state.isRunning = false;

    audit({
      level: 'info',
      category: 'action',
      event: 'babysitter_stopped',
      details: {
        username: this.username,
        errorsDetected: this.state.errorsDetected,
        patternsDetected: this.state.patternsDetected,
        errorsAutoFixed: this.state.errorsAutoFixed,
        errorsEscalated: this.state.errorsEscalated,
      },
      actor: 'babysitter',
      userId: this.username,
    });

    console.log(`${LOG_PREFIX} ========== STOPPED ==========`);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  // Get username from args or default to 'greggles'
  const username = process.argv[2] || 'greggles';

  console.log(`${LOG_PREFIX} Starting for user: ${username}`);

  const agent = new BabysitterAgent(username);

  // Handle graceful shutdown
  const cleanup = async () => {
    console.log(`${LOG_PREFIX} Received shutdown signal`);
    await agent.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Start the agent
  await agent.start();

  // Keep the process running
  console.log(`${LOG_PREFIX} Press Ctrl+C to stop`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    process.exit(1);
  });
}

export { BabysitterAgent, loadConfig, LogTailer, ErrorParser, AutoHealer, HealthReporter };
export type { HealthReport, BabysitterConfig, BabysitterState, ParsedError, DetectedPattern };
