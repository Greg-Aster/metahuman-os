/**
 * Event Bus Client
 *
 * WebSocket client for publishing events to the event bus.
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Event queue for offline buffering
 * - Singleton instance for easy import
 */

// ws is CommonJS - use default import for bundler compatibility
import ws from 'ws';
const WebSocket = ws;
import type { MetaHumanEvent, EventSource } from './schema.js';
import { createEvent } from './schema.js';

const LOG_PREFIX = '[event-bus-client]';

interface EventBusClientOptions {
  url?: string;
  maxQueueSize?: number;
  reconnectBaseDelay?: number;
  reconnectMaxDelay?: number;
}

const DEFAULT_OPTIONS: Required<EventBusClientOptions> = {
  url: 'ws://localhost:3100',
  maxQueueSize: 1000,
  reconnectBaseDelay: 1000,
  reconnectMaxDelay: 30000,
};

export class EventBusClient {
  private ws: WebSocket | null = null;
  private options: Required<EventBusClientOptions>;
  private eventQueue: MetaHumanEvent[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;
  private isShuttingDown = false;

  constructor(options: EventBusClientOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Connect to the event bus server.
   * Safe to call multiple times - will not create duplicate connections.
   */
  connect(): void {
    if (this.isConnecting || this.isShuttingDown) {
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.isConnecting = true;

    try {
      this.ws = new WebSocket(this.options.url);

      this.ws.on('open', () => {
        console.log(`${LOG_PREFIX} Connected to event bus at ${this.options.url}`);
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.flushQueue();
      });

      this.ws.on('close', () => {
        this.isConnecting = false;
        if (!this.isShuttingDown) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (error) => {
        // Only log if not a connection refused error (server not running)
        if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED') {
          console.error(`${LOG_PREFIX} WebSocket error:`, error.message);
        }
        this.isConnecting = false;
      });
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to create WebSocket:`, error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (this.isShuttingDown || this.reconnectTimer) {
      return;
    }

    const delay = Math.min(
      this.options.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts),
      this.options.reconnectMaxDelay
    );

    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Publish an event to the event bus.
   * If not connected, events are queued and sent when connection is restored.
   */
  publish(event: MetaHumanEvent): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(event));
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to send event:`, error);
        this.queueEvent(event);
      }
    } else {
      this.queueEvent(event);
      // Try to connect if not already connected
      this.connect();
    }
  }

  /**
   * Convenience method to create and publish an event.
   */
  emit(
    source: EventSource,
    eventType: string,
    data?: Record<string, unknown>,
    options?: Partial<Omit<MetaHumanEvent, 'timestamp' | 'source' | 'event' | 'data'>>
  ): void {
    // Auto-connect on first emit if not connected
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
    }

    const event = createEvent(source, eventType, {
      data,
      ...options,
    });
    this.publish(event);
  }

  /**
   * Queue an event for later sending.
   */
  private queueEvent(event: MetaHumanEvent): void {
    if (this.eventQueue.length >= this.options.maxQueueSize) {
      // Drop oldest events when queue is full
      this.eventQueue.shift();
    }
    this.eventQueue.push(event);
  }

  /**
   * Flush queued events to the server.
   */
  private flushQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const eventsToSend = [...this.eventQueue];
    this.eventQueue = [];

    for (const event of eventsToSend) {
      try {
        this.ws.send(JSON.stringify(event));
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to flush event:`, error);
        this.eventQueue.push(event);
        break;
      }
    }

    if (eventsToSend.length > 0) {
      console.log(`${LOG_PREFIX} Flushed ${eventsToSend.length - this.eventQueue.length} queued events`);
    }
  }

  /**
   * Check if connected to the event bus.
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get the number of queued events.
   */
  getQueueSize(): number {
    return this.eventQueue.length;
  }

  /**
   * Disconnect from the event bus.
   */
  disconnect(): void {
    this.isShuttingDown = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Singleton instance for easy import
let instance: EventBusClient | null = null;

/**
 * Get or create the singleton event bus client.
 * Automatically connects on first call.
 */
export function getEventBus(options?: EventBusClientOptions): EventBusClient {
  if (!instance) {
    instance = new EventBusClient(options);
    // Don't auto-connect - let the server start first
  }
  return instance;
}

/**
 * Singleton event bus for easy import.
 * Usage: import { eventBus } from './event-bus/client.js';
 *        eventBus.emit('core', 'core.started', { version: '1.0.0' });
 */
export const eventBus = getEventBus();

// Install cleanup handlers to ensure the event bus disconnects on process exit
// This prevents Node.js from hanging when CLI commands finish
if (typeof process !== 'undefined') {
  const cleanup = () => {
    if (instance) {
      instance.disconnect();
    }
  };

  // Handle normal exit
  process.on('beforeExit', cleanup);

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  // Handle SIGTERM
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
}
