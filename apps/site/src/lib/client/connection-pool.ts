/**
 * Connection Pool Manager
 *
 * Solves HTTP/1.1 6-connection-per-origin limit by implementing:
 * - Priority-based allocation (critical streams get slots first)
 * - View-aware lazy loading (only open streams for active views)
 * - Automatic preemption (low-priority streams yield to high-priority)
 * - Queue management for deferred connections
 * - Observable state for reactive components
 *
 * Architecture:
 * Components request connections through the pool manager instead of
 * creating EventSource instances directly. The pool enforces limits,
 * manages priorities, and handles view-based lifecycle.
 */

import { connectionManager } from './connection-manager';

export enum ConnectionPriority {
  CRITICAL = 0, // Must connect immediately (chat response stream)
  HIGH = 1,     // Important for UX (buffer streams for active view)
  MEDIUM = 2,   // Nice to have (TTS queue, proposals)
  LOW = 3,      // Background (audit stream, agent monitor when sidebar collapsed)
}

export interface ConnectionRequest {
  id: string;
  name: string;
  url: string;
  priority: ConnectionPriority;
  viewDependency?: string;
  defer?: boolean;
  onOpen?: (source: EventSource) => void;
  onClose?: () => void;
  onMessage?: (event: MessageEvent) => void;
  onError?: (event: Event) => void;
}

interface PooledConnection {
  id: string;
  name: string;
  priority: ConnectionPriority;
  viewDependency?: string;
  source: EventSource;
  openedAt: number;
  lastActivityAt: number;
  request: ConnectionRequest;
}

export interface PoolStatus {
  active: number;
  max: number;
  queued: number;
  available: number;
  connections: Array<{
    id: string;
    name: string;
    priority: ConnectionPriority;
    openedAt: number;
    lastActivityAt: number;
    state: number;
  }>;
  queue: Array<{
    id: string;
    name: string;
    priority: ConnectionPriority;
    viewDependency?: string;
  }>;
}

export class ConnectionHandle {
  constructor(
    private id: string,
    private pool: ConnectionPoolManager,
    public readonly isDeferred: boolean = false
  ) {}

  close(): void {
    this.pool.close(this.id);
  }

  getStatus(): 'active' | 'queued' | 'closed' {
    return this.pool.getConnectionStatus(this.id);
  }
}

class ConnectionPoolManager {
  private maxConnections = 8; // Keep headroom for chat + buffers + TTS + proposals
  private activeConnections = new Map<string, PooledConnection>();
  private queuedRequests = new Map<string, ConnectionRequest>();
  private listeners = new Set<(status: PoolStatus) => void>();
  private activeView: string = 'chat';
  private enabled = true;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.closeAll());
    }
  }

  request(request: ConnectionRequest): ConnectionHandle {
    if (!this.enabled) {
      console.warn('[pool] Pool disabled, creating connection directly');
      return this.allocateDirect(request);
    }

    if (this.activeConnections.has(request.id)) {
      console.log(`[pool] Connection ${request.name} already exists`);
      return new ConnectionHandle(request.id, this, false);
    }

    if (this.queuedRequests.has(request.id)) {
      console.log(`[pool] Connection ${request.name} already queued`);
      return new ConnectionHandle(request.id, this, true);
    }

    if (request.viewDependency && request.viewDependency !== this.activeView) {
      console.log(`[pool] Deferring ${request.name} - view ${request.viewDependency} not active (current: ${this.activeView})`);
      this.queuedRequests.set(request.id, request);
      this.notifyListeners();
      return new ConnectionHandle(request.id, this, true);
    }

    if (this.activeConnections.size >= this.maxConnections) {
      return this.handlePoolFull(request);
    }

    return this.allocate(request);
  }

  private handlePoolFull(request: ConnectionRequest): ConnectionHandle {
    const victim = this.findPreemptionVictim(request.priority);

    if (victim) {
      console.log(`[pool] Preempting ${victim.name} (priority ${victim.priority}) for ${request.name} (priority ${request.priority})`);
      this.close(victim.id);
      return this.allocate(request);
    }

    if (request.defer !== false) {
      console.log(`[pool] Pool full (${this.activeConnections.size}/${this.maxConnections}), queueing ${request.name}`);
      this.queuedRequests.set(request.id, request);
      this.notifyListeners();
      return new ConnectionHandle(request.id, this, true);
    }

    console.warn(`[pool] CRITICAL non-deferrable request ${request.name} - force allocating`);
    const oldest = this.findOldestConnection();
    if (oldest) {
      console.warn(`[pool] Closing oldest connection: ${oldest.name}`);
      this.close(oldest.id);
    }
    return this.allocate(request);
  }

  private allocate(request: ConnectionRequest): ConnectionHandle {
    console.log(`[pool] Allocating ${request.name} (priority ${request.priority})`);

    const source = new EventSource(request.url);

    const connection: PooledConnection = {
      id: request.id,
      name: request.name,
      priority: request.priority,
      viewDependency: request.viewDependency,
      source,
      openedAt: Date.now(),
      lastActivityAt: Date.now(),
      request,
    };

    source.onopen = () => {
      connection.lastActivityAt = Date.now();
      request.onOpen?.(source);
      this.notifyListeners();
    };

    source.onerror = (event) => {
      connection.lastActivityAt = Date.now();
      request.onError?.(event);
      this.notifyListeners();
    };

    source.onmessage = (event) => {
      connection.lastActivityAt = Date.now();
      request.onMessage?.(event);
    };

    this.activeConnections.set(request.id, connection);

    // Register with global connection manager for monitoring
    connectionManager.register(request.name, request.url, source);

    console.log(`[pool] Allocated ${request.name} (${this.activeConnections.size}/${this.maxConnections})`);
    this.notifyListeners();

    return new ConnectionHandle(request.id, this, false);
  }

  private allocateDirect(request: ConnectionRequest): ConnectionHandle {
    const source = new EventSource(request.url);

    source.onopen = () => request.onOpen?.(source);
    source.onerror = (event) => request.onError?.(event);
    source.onmessage = (event) => request.onMessage?.(event);

    connectionManager.register(request.name, request.url, source);

    return new ConnectionHandle(request.id, this, false);
  }

  close(id: string): void {
    const connection = this.activeConnections.get(id);
    if (connection) {
      console.log(`[pool] Closing ${connection.name}`);
      connection.source.close();
      connection.request.onClose?.();
      this.activeConnections.delete(id);
      this.notifyListeners();
      this.processQueue();
      return;
    }

    const queued = this.queuedRequests.get(id);
    if (queued) {
      console.log(`[pool] Removing queued request ${queued.name}`);
      this.queuedRequests.delete(id);
      this.notifyListeners();
    }
  }

  closeAll(): void {
    console.log(`[pool] Closing all ${this.activeConnections.size} connections`);
    for (const [id] of this.activeConnections) {
      this.close(id);
    }
    this.queuedRequests.clear();
    this.notifyListeners();
  }

  setActiveView(view: string): void {
    if (this.activeView === view) return;

    console.log(`[pool] Active view changed: ${this.activeView} → ${view}`);
    this.activeView = view;

    const toClose: string[] = [];
    for (const [id, conn] of this.activeConnections) {
      if (conn.viewDependency && conn.viewDependency !== view) {
        toClose.push(id);
      }
    }

    for (const id of toClose) {
      this.close(id);
    }

    const toActivate: ConnectionRequest[] = [];
    for (const [id, req] of this.queuedRequests) {
      if (req.viewDependency === view) {
        toActivate.push(req);
        this.queuedRequests.delete(id);
      }
    }

    for (const req of toActivate) {
      this.request(req);
    }

    this.notifyListeners();
  }

  private processQueue(): void {
    if (this.activeConnections.size >= this.maxConnections) {
      return;
    }

    const available = this.maxConnections - this.activeConnections.size;
    const sorted = Array.from(this.queuedRequests.values())
      .filter(req => !req.viewDependency || req.viewDependency === this.activeView)
      .sort((a, b) => a.priority - b.priority);

    const toAllocate = sorted.slice(0, available);

    for (const req of toAllocate) {
      this.queuedRequests.delete(req.id);
      this.allocate(req);
    }
  }

  private findPreemptionVictim(requestPriority: ConnectionPriority): PooledConnection | null {
    let victim: PooledConnection | null = null;
    let lowestPriority = -1;

    for (const conn of this.activeConnections.values()) {
      if (conn.priority > requestPriority && conn.priority > lowestPriority) {
        victim = conn;
        lowestPriority = conn.priority;
      }
    }

    return victim;
  }

  private findOldestConnection(): PooledConnection | null {
    let oldest: PooledConnection | null = null;
    let oldestTime = Infinity;

    for (const conn of this.activeConnections.values()) {
      if (conn.openedAt < oldestTime) {
        oldest = conn;
        oldestTime = conn.openedAt;
      }
    }

    return oldest;
  }

  getConnectionStatus(id: string): 'active' | 'queued' | 'closed' {
    if (this.activeConnections.has(id)) return 'active';
    if (this.queuedRequests.has(id)) return 'queued';
    return 'closed';
  }

  subscribe(callback: (status: PoolStatus) => void): () => void {
    this.listeners.add(callback);
    callback(this.getStatus());
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    this.listeners.forEach(listener => listener(status));
  }

  getStatus(): PoolStatus {
    return {
      active: this.activeConnections.size,
      max: this.maxConnections,
      queued: this.queuedRequests.size,
      available: this.maxConnections - this.activeConnections.size,
      connections: Array.from(this.activeConnections.values()).map(conn => ({
        id: conn.id,
        name: conn.name,
        priority: conn.priority,
        openedAt: conn.openedAt,
        lastActivityAt: conn.lastActivityAt,
        state: conn.source.readyState,
      })),
      queue: Array.from(this.queuedRequests.values()).map(req => ({
        id: req.id,
        name: req.name,
        priority: req.priority,
        viewDependency: req.viewDependency,
      })),
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[pool] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  setMaxConnections(max: number): void {
    if (max < 1 || max > 12) {
      throw new Error('maxConnections must be between 1 and 12');
    }
    this.maxConnections = max;
    console.log(`[pool] Max connections set to ${max}`);
    this.notifyListeners();
  }
}

export const connectionPool = new ConnectionPoolManager();

if (typeof window !== 'undefined') {
  (window as any).__connectionPool = connectionPool;
}
