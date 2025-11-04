import fs from 'fs';
import path from 'path';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogConfig {
  level: LogLevel;
  levels: Record<LogLevel, number>;
  suppressPatterns?: string[];
  console?: {
    enabled: boolean;
    colorize: boolean;
    timestamp: boolean;
  };
}

class Logger {
  private config: LogConfig;
  private levelValues: Record<LogLevel, number>;

  constructor() {
    this.config = this.loadConfig();
    this.levelValues = this.config.levels;
  }

  private loadConfig(): LogConfig {
    const configPath = path.join(process.cwd(), '../../etc/logging.json');
    const defaultConfig: LogConfig = {
      level: 'info',
      levels: { error: 0, warn: 1, info: 2, debug: 3 },
      suppressPatterns: [],
      console: { enabled: true, colorize: true, timestamp: true }
    };

    try {
      if (fs.existsSync(configPath)) {
        const loaded = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return { ...defaultConfig, ...loaded };
      }
    } catch (e) {
      console.warn('Failed to load logging config, using defaults');
    }

    return defaultConfig;
  }

  private shouldLog(level: LogLevel): boolean {
    const currentLevel = this.levelValues[this.config.level];
    const messageLevel = this.levelValues[level];
    return messageLevel <= currentLevel;
  }

  private formatMessage(level: LogLevel, message: string, context?: Record<string, any>): string {
    const parts: string[] = [];

    if (this.config.console?.timestamp) {
      const now = new Date();
      const time = now.toLocaleTimeString('en-US', { hour12: false });
      parts.push(`[${time}]`);
    }

    const levelTag = level.toUpperCase().padEnd(5);
    if (this.config.console?.colorize) {
      const colors = {
        error: '\x1b[31m',   // Red
        warn: '\x1b[33m',    // Yellow
        info: '\x1b[36m',    // Cyan
        debug: '\x1b[90m'    // Gray
      };
      const reset = '\x1b[0m';
      parts.push(`${colors[level]}[${levelTag}]${reset}`);
    } else {
      parts.push(`[${levelTag}]`);
    }

    parts.push(message);

    if (context && Object.keys(context).length > 0) {
      parts.push(JSON.stringify(context, null, 2));
    }

    return parts.join(' ');
  }

  error(message: string, context?: Record<string, any>): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, context));
    }
  }

  warn(message: string, context?: Record<string, any>): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  info(message: string, context?: Record<string, any>): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, context));
    }
  }

  debug(message: string, context?: Record<string, any>): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, context));
    }
  }

  // Helper for API routes
  logRequest(method: string, path: string, status: number, duration: number): void {
    // Check if this path should be suppressed
    if (this.config.suppressPatterns?.some(pattern => path.includes(pattern))) {
      return;
    }

    const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    const message = `${method} ${path} - ${status} (${duration}ms)`;

    if (level === 'error' || level === 'warn') {
      this[level](message);
    } else if (this.config.level === 'debug') {
      this.debug(message);
    }
  }
}

// Export singleton instance
export const logger = new Logger();
