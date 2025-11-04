import { audit } from './audit';

export function initGlobalLogger(actor: string) {
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

  console.log = (...args: any[]) => {
    originalConsoleLog.apply(console, args);
    audit({
      level: 'info',
      category: 'action',
      event: formatArgs(args),
      actor,
    });
  };

  console.info = (...args: any[]) => {
    originalConsoleInfo.apply(console, args);
    audit({
      level: 'info',
      category: 'action',
      event: formatArgs(args),
      actor,
    });
  };

  console.warn = (...args: any[]) => {
    originalConsoleWarn.apply(console, args);
    audit({
      level: 'warn',
      category: 'action',
      event: formatArgs(args),
      actor,
    });
  };

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
