/**
 * Connection Manager
 *
 * Tracks and manages all EventSource connections to prevent browser connection limit exhaustion.
 * HTTP/1.1 browsers limit to 6 concurrent connections per origin.
 *
 * Features:
 * - Track all active connections with metadata
 * - Detect connection limit exhaustion
 * - Auto-close idle connections
 * - Notify user when connections are blocking
 * - Provide manual recovery controls
 */

export interface ConnectionInfo {
  id: string;
  name: string;
  url: string;
  source: EventSource;
  openedAt: number;
  lastActivityAt: number;
  state: 'connecting' | 'open' | 'closed' | 'error';
  errorCount: number;
}

const MAX_CONNECTIONS = 6; // HTTP/1.1 limit per origin
const IDLE_TIMEOUT = 30000; // 30 seconds without activity = idle
const STUCK_TIMEOUT = 60000; // 60 seconds in 'connecting' = stuck

class ConnectionManager {
  private connections = new Map<string, ConnectionInfo>();
  private listeners = new Set<(status: ConnectionStatus) => void>();
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Check for stuck connections every 10 seconds
    this.checkInterval = setInterval(() => this.checkConnections(), 10000);
  }

  /**
   * Register a new EventSource connection
   */
  register(name: string, url: string, source: EventSource): string {
    const id = `${name}-${Date.now()}`;
    const info: ConnectionInfo = {
      id,
      name,
      url,
      source,
      openedAt: Date.now(),
      lastActivityAt: Date.now(),
      state: 'connecting',
      errorCount: 0,
    };

    this.connections.set(id, info);
    console.log(`[conn-mgr] Registered: ${name} (${id}) - Total: ${this.connections.size}/${MAX_CONNECTIONS}`);

    // Set up event listeners to track state
    source.onopen = () => {
      const conn = this.connections.get(id);
      if (conn) {
        conn.state = 'open';
        conn.lastActivityAt = Date.now();
        this.notifyListeners();
      }
    };

    source.onerror = () => {
      const conn = this.connections.get(id);
      if (conn) {
        conn.state = 'error';
        conn.errorCount++;
        conn.lastActivityAt = Date.now();
        this.notifyListeners();
      }
    };

    // Wrap onmessage to track activity
    const originalOnMessage = source.onmessage;
    source.onmessage = (event) => {
      const conn = this.connections.get(id);
      if (conn) {
        conn.lastActivityAt = Date.now();
      }
      if (originalOnMessage) {
        originalOnMessage.call(source, event);
      }
    };

    this.notifyListeners();
    return id;
  }

  /**
   * Unregister a connection (called when closed)
   */
  unregister(id: string) {
    const conn = this.connections.get(id);
    if (conn) {
      console.log(`[conn-mgr] Unregistered: ${conn.name} (${id})`);
      this.connections.delete(id);
      this.notifyListeners();
    }
  }

  /**
   * Force close a connection
   */
  close(id: string) {
    const conn = this.connections.get(id);
    if (conn) {
      console.log(`[conn-mgr] Force closing: ${conn.name} (${id})`);
      try {
        conn.source.close();
      } catch (e) {
        console.error(`[conn-mgr] Error closing connection:`, e);
      }
      conn.state = 'closed';
      this.connections.delete(id);
      this.notifyListeners();
    }
  }

  /**
   * Close all connections
   */
  closeAll() {
    console.log(`[conn-mgr] Closing all ${this.connections.size} connections`);
    const ids = Array.from(this.connections.keys());
    ids.forEach(id => this.close(id));
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    const now = Date.now();
    const all = Array.from(this.connections.values());
    const active = all.filter(c => c.state === 'open');
    const connecting = all.filter(c => c.state === 'connecting');
    const stuck = connecting.filter(c => now - c.openedAt > STUCK_TIMEOUT);
    const idle = active.filter(c => now - c.lastActivityAt > IDLE_TIMEOUT);
    const errored = all.filter(c => c.state === 'error');

    const atLimit = this.connections.size >= MAX_CONNECTIONS;
    const nearLimit = this.connections.size >= MAX_CONNECTIONS - 1;

    return {
      total: this.connections.size,
      max: MAX_CONNECTIONS,
      active: active.length,
      connecting: connecting.length,
      stuck: stuck.length,
      idle: idle.length,
      errored: errored.length,
      atLimit,
      nearLimit,
      connections: all,
      stuckConnections: stuck,
      idleConnections: idle,
    };
  }

  /**
   * Check for stuck/idle connections and auto-recover
   */
  private checkConnections() {
    const status = this.getStatus();

    // Close stuck connections (connecting for >60s)
    if (status.stuck > 0) {
      console.warn(`[conn-mgr] Found ${status.stuck} stuck connections, closing...`);
      status.stuckConnections.forEach(conn => {
        console.warn(`[conn-mgr] Stuck connection: ${conn.name} (${conn.id}) - stuck for ${Math.floor((Date.now() - conn.openedAt) / 1000)}s`);
        this.close(conn.id);
      });
    }

    // Close idle connections when at/near limit
    if (status.nearLimit && status.idle > 0) {
      console.warn(`[conn-mgr] At connection limit with ${status.idle} idle connections, closing oldest...`);
      const toClose = status.idleConnections.sort((a, b) => a.lastActivityAt - b.lastActivityAt)[0];
      if (toClose) {
        console.warn(`[conn-mgr] Closing idle connection: ${toClose.name} (${toClose.id}) - idle for ${Math.floor((Date.now() - toClose.lastActivityAt) / 1000)}s`);
        this.close(toClose.id);
      }
    }

    // Warn if at limit
    if (status.atLimit) {
      console.error(`[conn-mgr] ⚠️  CONNECTION LIMIT REACHED (${status.total}/${MAX_CONNECTIONS})`);
      console.error('[conn-mgr] Active connections:', status.connections.map(c => `${c.name} (${c.state})`).join(', '));
      console.error('[conn-mgr] New HTTP requests may hang waiting for a connection slot!');
    }
  }

  /**
   * Subscribe to connection status updates
   */
  subscribe(callback: (status: ConnectionStatus) => void): () => void {
    this.listeners.add(callback);
    // Send initial status
    callback(this.getStatus());
    // Return unsubscribe function
    return () => this.listeners.delete(callback);
  }

  private notifyListeners() {
    const status = this.getStatus();
    this.listeners.forEach(listener => listener(status));
  }

  cleanup() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.closeAll();
  }
}

export interface ConnectionStatus {
  total: number;
  max: number;
  active: number;
  connecting: number;
  stuck: number;
  idle: number;
  errored: number;
  atLimit: boolean;
  nearLimit: boolean;
  connections: ConnectionInfo[];
  stuckConnections: ConnectionInfo[];
  idleConnections: ConnectionInfo[];
}

// Global singleton instance
export const connectionManager = new ConnectionManager();

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    connectionManager.cleanup();
  });
}
