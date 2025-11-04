import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import svelte from '@astrojs/svelte';
import voiceWebSocket from './src/integrations/voice-websocket.ts';
import fs from 'fs';
import path from 'path';

// Load logging config
const loggingConfigPath = path.join(process.cwd(), '../../etc/logging.json');
let loggingConfig = { level: 'info', suppressPatterns: ['/api/approvals', '/api/status', '/api/monitor'] };
if (fs.existsSync(loggingConfigPath)) {
  try {
    loggingConfig = JSON.parse(fs.readFileSync(loggingConfigPath, 'utf-8'));
  } catch (e) {
    console.warn('Failed to load logging config, using defaults');
  }
}

// Custom request logger middleware
const requestLogger = () => {
  return {
    name: 'request-logger',
    hooks: {
      'astro:server:setup': ({ server }) => {
        const originalMiddleware = server.middlewares.use.bind(server.middlewares);
        server.middlewares.use = function(fn) {
          if (typeof fn === 'function' && fn.name === 'viteHtmlFallbackMiddleware') {
            // Wrap the middleware to add custom logging
            const wrappedFn = (req, res, next) => {
              const start = Date.now();
              const originalEnd = res.end;

              res.end = function(...args) {
                const duration = Date.now() - start;
                const shouldSuppress = loggingConfig.suppressPatterns?.some(pattern =>
                  req.url?.includes(pattern)
                );

                // Only log if not suppressed, or if it's a slow request
                const isSlow = loggingConfig.logSlowRequests && duration > (loggingConfig.slowRequestThresholdMs || 1000);
                if (!shouldSuppress || isSlow) {
                  const method = req.method || 'GET';
                  const url = req.url || '/';
                  const status = res.statusCode;
                  const logLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

                  if (isSlow) {
                    console.warn(`[SLOW] ${method} ${url} - ${status} (${duration}ms)`);
                  } else if (logLevel !== 'info' || loggingConfig.level === 'debug') {
                    console.log(`[${status}] ${method} ${url} ${duration}ms`);
                  }
                }

                return originalEnd.apply(res, args);
              };

              return fn(req, res, next);
            };
            return originalMiddleware(wrappedFn);
          }
          return originalMiddleware(fn);
        };
      }
    }
  };
};

export default defineConfig({
  integrations: [
    tailwind({ applyBaseStyles: true }),
    svelte(),
    voiceWebSocket(),
    requestLogger()
  ],
  server: {
    host: true,
  },
  output: 'server',
  vite: {
    logLevel: process.env.LOG_LEVEL === 'debug' ? 'info' : 'warn',
    server: {
      middlewareMode: true
    }
  }
});
