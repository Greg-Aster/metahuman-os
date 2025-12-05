/**
 * Request Queue System
 *
 * Redis-based request queuing for scaling server deployments.
 * Handles concurrent request limits, priority routing, and load balancing.
 *
 * NOTE: Full Redis implementation pending. This provides the interface.
 */

// ============================================================================
// Types
// ============================================================================

export type RequestPriority = 'high' | 'normal' | 'low' | 'batch';

export interface QueuedRequest {
  id: string;
  priority: RequestPriority;
  messages: Array<{ role: string; content: string }>;
  options: Record<string, unknown>;
  userId?: string;
  createdAt: number;
  timeout: number;
}

export interface QueueConfig {
  /** Redis connection URL */
  redisUrl: string;
  /** Key prefix for queue keys */
  keyPrefix?: string;
  /** Maximum concurrent requests (default: 3) */
  maxConcurrent?: number;
  /** Default request timeout in ms (default: 60000) */
  defaultTimeout?: number;
}

export interface QueueStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  avgWaitTimeMs: number;
  avgProcessTimeMs: number;
}

// ============================================================================
// In-Memory Queue (Development/Testing)
// ============================================================================

/**
 * Simple in-memory queue for development/testing
 * Use RedisQueue for production deployments
 */
export class InMemoryQueue {
  private queue: QueuedRequest[] = [];
  private processing: Map<string, QueuedRequest> = new Map();
  private maxConcurrent: number;
  private defaultTimeout: number;

  constructor(config: Partial<QueueConfig> = {}) {
    this.maxConcurrent = config.maxConcurrent ?? 3;
    this.defaultTimeout = config.defaultTimeout ?? 60000;
  }

  /**
   * Add a request to the queue
   */
  async enqueue(request: Omit<QueuedRequest, 'id' | 'createdAt'>): Promise<string> {
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const queuedRequest: QueuedRequest = {
      ...request,
      id,
      createdAt: Date.now(),
      timeout: request.timeout ?? this.defaultTimeout,
    };

    // Insert based on priority
    const priorityOrder: RequestPriority[] = ['high', 'normal', 'low', 'batch'];
    const requestPriorityIdx = priorityOrder.indexOf(request.priority);

    let insertIdx = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      const queuedPriorityIdx = priorityOrder.indexOf(this.queue[i].priority);
      if (requestPriorityIdx < queuedPriorityIdx) {
        insertIdx = i;
        break;
      }
    }

    this.queue.splice(insertIdx, 0, queuedRequest);
    console.log(`[queue] Enqueued ${id} (priority: ${request.priority}, position: ${insertIdx + 1}/${this.queue.length + this.processing.size})`);

    return id;
  }

  /**
   * Get next request to process (if under concurrency limit)
   */
  async dequeue(): Promise<QueuedRequest | null> {
    if (this.processing.size >= this.maxConcurrent) {
      return null;
    }

    const request = this.queue.shift();
    if (!request) {
      return null;
    }

    this.processing.set(request.id, request);
    return request;
  }

  /**
   * Mark a request as completed
   */
  async complete(id: string): Promise<void> {
    this.processing.delete(id);
    console.log(`[queue] Completed ${id}`);
  }

  /**
   * Mark a request as failed
   */
  async fail(id: string, error: string): Promise<void> {
    this.processing.delete(id);
    console.log(`[queue] Failed ${id}: ${error}`);
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueStats> {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      completed: 0, // Would need persistent tracking
      failed: 0,
      avgWaitTimeMs: 0,
      avgProcessTimeMs: 0,
    };
  }

  /**
   * Check if queue can accept new requests
   */
  canAcceptRequest(): boolean {
    return this.queue.length < 100; // Arbitrary limit for in-memory
  }

  /**
   * Get position in queue for a request
   */
  getPosition(id: string): number {
    const idx = this.queue.findIndex(r => r.id === id);
    if (idx >= 0) return idx + 1;
    if (this.processing.has(id)) return 0; // Currently processing
    return -1; // Not found
  }
}

// ============================================================================
// Redis Queue (Production)
// ============================================================================

/**
 * Redis-based queue for production deployments
 * Provides persistence, distributed coordination, and better scalability
 *
 * NOTE: Requires ioredis dependency. Not implemented yet.
 */
export class RedisQueue {
  constructor(_config: QueueConfig) {
    throw new Error('RedisQueue not yet implemented. Use InMemoryQueue for development or implement Redis integration.');
  }
}

// ============================================================================
// Factory
// ============================================================================

export type QueueType = 'memory' | 'redis';

export function createQueue(type: QueueType, config: Partial<QueueConfig> = {}): InMemoryQueue {
  if (type === 'redis') {
    console.warn('[queue] Redis queue not yet implemented, falling back to in-memory');
  }
  return new InMemoryQueue(config);
}
