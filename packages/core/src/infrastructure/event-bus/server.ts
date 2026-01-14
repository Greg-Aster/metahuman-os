/**
 * Event Bus Server
 *
 * WebSocket server that aggregates events from all MetaHuman services.
 * Features:
 * - Accepts events from publishers (services)
 * - Broadcasts events to subscribers (debug UIs)
 * - Persists events to NDJSON files
 * - HTTP health check endpoint
 */

// ws is CommonJS - use createRequire for tsx compatibility
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ws = require('ws');
const WebSocketServer = ws.Server || ws.WebSocketServer;
const WebSocket = ws;
import type { WebSocketServer as WSServer, WebSocket as WSWebSocket, RawData } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { MetaHumanEvent } from './schema.js';
import { createEvent, EventTypes } from './schema.js';

const LOG_PREFIX = '[event-bus-server]';

interface EventBusServerOptions {
  port?: number;
  logsDir?: string;
}

const DEFAULT_PORT = 3100;

export class EventBusServer {
  private wss: WSServer | null = null;
  private httpServer: http.Server | null = null;
  private subscribers: Set<WSWebSocket> = new Set();
  private logStream: fs.WriteStream | null = null;
  private currentLogDate: string = '';
  private options: EventBusServerOptions;
  private eventCount = 0;
  private startTime: Date = new Date();

  constructor(options: EventBusServerOptions = {}) {
    this.options = options;
  }

  /**
   * Start the event bus server.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = this.options.port ?? DEFAULT_PORT;

      // Create HTTP server for health checks
      this.httpServer = http.createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'healthy',
            uptime: Date.now() - this.startTime.getTime(),
            eventCount: this.eventCount,
            subscribers: this.subscribers.size,
          }));
        } else if (req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('MetaHuman Event Bus Server');
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      // Create WebSocket server
      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on('connection', (ws: WSWebSocket, req: http.IncomingMessage) => {
        const clientAddr = req.socket.remoteAddress || 'unknown';
        console.log(`${LOG_PREFIX} Client connected from ${clientAddr}`);

        // Track subscriber
        this.subscribers.add(ws);

        ws.on('message', (data: RawData) => {
          try {
            const event = JSON.parse(data.toString()) as MetaHumanEvent;
            this.handleEvent(event);
          } catch (error) {
            console.error(`${LOG_PREFIX} Invalid event received:`, error);
          }
        });

        ws.on('close', () => {
          this.subscribers.delete(ws);
          console.log(`${LOG_PREFIX} Client disconnected (${this.subscribers.size} remaining)`);
        });

        ws.on('error', (error: Error) => {
          console.error(`${LOG_PREFIX} WebSocket error:`, error.message);
          this.subscribers.delete(ws);
        });
      });

      this.httpServer.on('error', (error) => {
        console.error(`${LOG_PREFIX} Server error:`, error);
        reject(error);
      });

      this.httpServer.listen(port, () => {
        console.log(`${LOG_PREFIX} ========================================`);
        console.log(`${LOG_PREFIX} Event Bus Server started on port ${port}`);
        console.log(`${LOG_PREFIX} WebSocket: ws://localhost:${port}`);
        console.log(`${LOG_PREFIX} Health: http://localhost:${port}/health`);
        console.log(`${LOG_PREFIX} ========================================`);

        // Emit startup event
        this.handleEvent(createEvent('core', EventTypes.CORE_STARTED, {
          data: { component: 'event-bus', port },
        }));

        resolve();
      });
    });
  }

  /**
   * Handle an incoming event.
   */
  private handleEvent(event: MetaHumanEvent): void {
    this.eventCount++;

    // Persist to NDJSON file
    this.writeToLog(event);

    // Broadcast to all subscribers (debug UIs)
    this.broadcast(event);
  }

  /**
   * Write event to daily NDJSON log file.
   */
  private writeToLog(event: MetaHumanEvent): void {
    const today = new Date().toISOString().split('T')[0];

    // Rotate log file daily
    if (today !== this.currentLogDate) {
      this.rotateLogFile(today);
    }

    if (this.logStream) {
      this.logStream.write(JSON.stringify(event) + '\n');
    }
  }

  /**
   * Rotate to a new log file.
   */
  private rotateLogFile(date: string): void {
    // Close existing stream
    if (this.logStream) {
      this.logStream.end();
    }

    // Determine logs directory
    const logsDir = this.options.logsDir ?? path.join(process.cwd(), 'logs', 'events');

    // Ensure directory exists
    fs.mkdirSync(logsDir, { recursive: true });

    // Create new log file
    const logFile = path.join(logsDir, `${date}.ndjson`);
    this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
    this.currentLogDate = date;

    console.log(`${LOG_PREFIX} Logging to ${logFile}`);

    // Clean up old log files (keep last 7 days)
    this.cleanupOldLogs(logsDir);
  }

  /**
   * Remove log files older than MAX_LOG_DAYS.
   */
  private cleanupOldLogs(logsDir: string): void {
    const MAX_LOG_DAYS = 7;

    try {
      const files = fs.readdirSync(logsDir)
        .filter(f => f.endsWith('.ndjson'))
        .sort()
        .reverse(); // Newest first

      // Keep the most recent MAX_LOG_DAYS files, delete the rest
      const toDelete = files.slice(MAX_LOG_DAYS);

      for (const file of toDelete) {
        const filePath = path.join(logsDir, file);
        try {
          fs.unlinkSync(filePath);
          console.log(`${LOG_PREFIX} Cleaned up old log: ${file}`);
        } catch (err) {
          console.warn(`${LOG_PREFIX} Failed to delete ${file}:`, err);
        }
      }

      if (toDelete.length > 0) {
        console.log(`${LOG_PREFIX} Cleaned up ${toDelete.length} old log file(s)`);
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to cleanup old logs:`, err);
    }
  }

  /**
   * Broadcast event to all connected subscribers.
   */
  private broadcast(event: MetaHumanEvent): void {
    const message = JSON.stringify(event);

    for (const ws of this.subscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message);
        } catch (error) {
          console.error(`${LOG_PREFIX} Failed to broadcast:`, error);
        }
      }
    }
  }

  /**
   * Stop the event bus server.
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Emit shutdown event
      this.handleEvent(createEvent('core', EventTypes.CORE_SHUTDOWN, {
        data: { component: 'event-bus', eventCount: this.eventCount },
      }));

      // Close log stream
      if (this.logStream) {
        this.logStream.end();
        this.logStream = null;
      }

      // Close all WebSocket connections
      for (const ws of this.subscribers) {
        ws.close();
      }
      this.subscribers.clear();

      // Close WebSocket server
      if (this.wss) {
        this.wss.close();
        this.wss = null;
      }

      // Close HTTP server
      if (this.httpServer) {
        this.httpServer.close(() => {
          console.log(`${LOG_PREFIX} Server stopped`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get server statistics.
   */
  getStats(): { eventCount: number; subscribers: number; uptime: number } {
    return {
      eventCount: this.eventCount,
      subscribers: this.subscribers.size,
      uptime: Date.now() - this.startTime.getTime(),
    };
  }
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new EventBusServer();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log(`\n${LOG_PREFIX} Received SIGINT, shutting down...`);
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log(`\n${LOG_PREFIX} Received SIGTERM, shutting down...`);
    await server.stop();
    process.exit(0);
  });

  server.start().catch((error) => {
    console.error(`${LOG_PREFIX} Failed to start server:`, error);
    process.exit(1);
  });
}
