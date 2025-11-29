import { audit } from './audit';

/**
 * Initialize global logger that captures console output.
 *
 * By default, only warn/error are written to audit log to prevent bloat.
 * console.log and console.info go to stdout only unless auditAll is true.
 *
 * @param actor - The actor name for audit entries
 * @param auditAll - If true, also audit info-level logs (default: false)
 */
export function initGlobalLogger(actor: string, auditAll = false) {
  const originalConsoleLog = console.log;
  const originalConsoleInfo = console.info;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  const formatArgs = (args: any[]) => {
    return args.map(arg => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }).join(' ');
  };

  // console.log - only write to stdout (not audit) unless auditAll is true
  console.log = (...args: any[]) => {
    originalConsoleLog.apply(console, args);
    if (auditAll) {
      audit({
        level: 'info',
        category: 'action',
        event: formatArgs(args),
        actor,
      });
    }
  };

  // console.info - only write to stdout (not audit) unless auditAll is true
  console.info = (...args: any[]) => {
    originalConsoleInfo.apply(console, args);
    if (auditAll) {
      audit({
        level: 'info',
        category: 'action',
        event: formatArgs(args),
        actor,
      });
    }
  };

  // console.warn - always write to audit (important)
  console.warn = (...args: any[]) => {
    originalConsoleWarn.apply(console, args);
    audit({
      level: 'warn',
      category: 'action',
      event: formatArgs(args),
      actor,
    });
  };

  // console.error - always write to audit (important)
  console.error = (...args: any[]) => {
    originalConsoleError.apply(console, args);
    audit({
      level: 'error',
      category: 'action',
      event: formatArgs(args),
      actor,
    });
  };
}
