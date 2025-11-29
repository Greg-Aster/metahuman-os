/**
 * Memory Service Client
 *
 * Provides a clean API for interacting with the memory service worker.
 * Handles worker lifecycle, request/response routing, and fallback to sync mode.
 */

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type {
  MemoryRequest,
  MemoryResponse,
  WritePayload,
  WriteResult,
  ReadPayload,
  ReadResult,
  SearchPayload,
  SearchResult,
  ListPayload,
  ListResult,
} from '../../../brain/services/memory-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Pending request tracker
 */
interface PendingRequest {
  resolve: (response: MemoryResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Memory Service Client
 */
class MemoryServiceClient {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private requestTimeout = 30000; // 30 seconds

  /**
   * Initialize the memory service worker
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    try {
      const workerPath = path.resolve(__dirname, '../../../brain/services/memory-service.js');

      this.worker = new Worker(workerPath, {
        workerData: {},
      });

      this.worker.on('message', (response: MemoryResponse) => {
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(response.id);
          pending.resolve(response);
        }
      });

      this.worker.on('error', (error) => {
        console.error('[memory-service-client] Worker error:', error);
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(error);
        }
        this.pendingRequests.clear();
      });

      this.worker.on('exit', (code) => {
        console.log(`[memory-service-client] Worker exited with code ${code}`);
        this.isInitialized = false;
        this.worker = null;
      });

      this.isInitialized = true;
      console.log('[memory-service-client] Worker initialized');
    } catch (error) {
      console.error('[memory-service-client] Failed to initialize worker:', error);
      this.initPromise = null;
      throw error;
    }
  }

  /**
   * Send a request to the memory service
   */
  private async sendRequest<T>(request: Omit<MemoryRequest, 'id'>): Promise<T> {
    await this.initialize();

    if (!this.worker) {
      throw new Error('Memory service not initialized');
    }

    const id = randomUUID();
    const fullRequest: MemoryRequest = { ...request, id };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Memory service request timed out after ${this.requestTimeout}ms`));
      }, this.requestTimeout);

      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.success) {
            resolve(response.result as T);
          } else {
            reject(new Error(response.error || 'Memory service request failed'));
          }
        },
        reject,
        timeout,
      });

      this.worker!.postMessage(fullRequest);
    });
  }

  /**
   * Write a memory event
   */
  async writeMemory(
    profilePath: string,
    username: string,
    payload: WritePayload
  ): Promise<WriteResult> {
    return this.sendRequest<WriteResult>({
      type: 'write',
      profilePath,
      username,
      payload,
    });
  }

  /**
   * Read a memory file
   */
  async readMemory(
    profilePath: string,
    username: string,
    filePath: string
  ): Promise<ReadResult> {
    return this.sendRequest<ReadResult>({
      type: 'read',
      profilePath,
      username,
      payload: { filePath },
    });
  }

  /**
   * Search memory
   */
  async searchMemory(
    profilePath: string,
    username: string,
    query: string,
    limit?: number
  ): Promise<SearchResult> {
    return this.sendRequest<SearchResult>({
      type: 'search',
      profilePath,
      username,
      payload: { query, limit },
    });
  }

  /**
   * List memory files
   */
  async listMemory(
    profilePath: string,
    username: string,
    category?: string,
    dateRange?: { start: string; end: string }
  ): Promise<ListResult> {
    return this.sendRequest<ListResult>({
      type: 'list',
      profilePath,
      username,
      payload: { category, dateRange },
    });
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return this.isInitialized && this.worker !== null;
  }

  /**
   * Shut down the memory service
   */
  async shutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
      this.initPromise = null;

      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Memory service shut down'));
      }
      this.pendingRequests.clear();
    }
  }
}

// Singleton instance
let memoryServiceClient: MemoryServiceClient | null = null;

/**
 * Get the memory service client singleton
 */
export function getMemoryServiceClient(): MemoryServiceClient {
  if (!memoryServiceClient) {
    memoryServiceClient = new MemoryServiceClient();
  }
  return memoryServiceClient;
}

/**
 * Convenience functions for direct use
 */
export async function writeMemoryAsync(
  profilePath: string,
  username: string,
  content: string,
  eventType: string,
  options?: {
    metadata?: Record<string, any>;
    tags?: string[];
    entities?: string[];
  }
): Promise<WriteResult> {
  const client = getMemoryServiceClient();
  return client.writeMemory(profilePath, username, {
    content,
    eventType,
    metadata: options?.metadata,
    tags: options?.tags,
    entities: options?.entities,
  });
}

export async function readMemoryAsync(
  profilePath: string,
  username: string,
  filePath: string
): Promise<ReadResult> {
  const client = getMemoryServiceClient();
  return client.readMemory(profilePath, username, filePath);
}

export async function searchMemoryAsync(
  profilePath: string,
  username: string,
  query: string,
  limit?: number
): Promise<SearchResult> {
  const client = getMemoryServiceClient();
  return client.searchMemory(profilePath, username, query, limit);
}

// Export types
export type {
  WritePayload,
  WriteResult,
  ReadPayload,
  ReadResult,
  SearchPayload,
  SearchResult,
  ListPayload,
  ListResult,
  MemoryRequest,
  MemoryResponse,
};
