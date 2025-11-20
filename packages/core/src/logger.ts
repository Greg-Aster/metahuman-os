/**
 * Centralized logging with per-module verbosity control
 */
import fs from 'node:fs';
import path from 'node:path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

interface LoggingConfig {
  levels: Record<string, LogLevel>;
}

let config: LoggingConfig | null = null;

function loadConfig(): LoggingConfig {
  if (config) return config;
  
  try {
    const ROOT = process.cwd();
    const configPath = path.join(ROOT, 'etc', 'logging.json');
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config!;
    }
  } catch (error) {
    // Ignore errors, use defaults
  }
  
  // Default: warn for everything
  config = { levels: {} };
  return config;
}

function shouldLog(module: string, level: LogLevel): boolean {
  const cfg = loadConfig();
  const moduleLevel = cfg.levels[module] || 'info';
  
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'none'];
  const moduleLevelIndex = levels.indexOf(moduleLevel);
  const requestedLevelIndex = levels.indexOf(level);
  
  return requestedLevelIndex >= moduleLevelIndex;
}

export function createLogger(module: string) {
  return {
    debug: (...args: any[]) => {
      if (shouldLog(module, 'debug')) {
        console.log(`[${module}]`, ...args);
      }
    },
    info: (...args: any[]) => {
      if (shouldLog(module, 'info')) {
        console.log(`[${module}]`, ...args);
      }
    },
    warn: (...args: any[]) => {
      if (shouldLog(module, 'warn')) {
        console.warn(`[${module}]`, ...args);
      }
    },
    error: (...args: any[]) => {
      if (shouldLog(module, 'error')) {
        console.error(`[${module}]`, ...args);
      }
    },
  };
}
