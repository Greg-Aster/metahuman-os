<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { connectionManager, type ConnectionStatus } from '../lib/client/connection-manager';

  let status: ConnectionStatus = {
    total: 0,
    max: 6,
    active: 0,
    connecting: 0,
    stuck: 0,
    idle: 0,
    errored: 0,
    atLimit: false,
    nearLimit: false,
    connections: [],
    stuckConnections: [],
    idleConnections: [],
  };

  let expanded = false;
  let unsubscribe: (() => void) | null = null;

  onMount(() => {
    unsubscribe = connectionManager.subscribe((newStatus) => {
      status = newStatus;
    });
  });

  onDestroy(() => {
    unsubscribe?.();
  });

  function closeConnection(id: string) {
    connectionManager.close(id);
  }

  function closeAll() {
    if (confirm('Close all EventSource connections? This may interrupt real-time updates.')) {
      connectionManager.closeAll();
    }
  }

  // Color coding
  $: statusColor = status.atLimit
    ? 'red'
    : status.nearLimit
      ? 'orange'
      : status.stuck > 0
        ? 'yellow'
        : 'green';

  $: statusEmoji = status.atLimit
    ? '🔴'
    : status.nearLimit
      ? '🟠'
      : status.stuck > 0
        ? '🟡'
        : '🟢';
</script>

<div class="connection-widget" class:warning={status.nearLimit} class:critical={status.atLimit}>
  <button class="status-button" on:click={() => (expanded = !expanded)} title="EventSource Connection Status">
    <span class="emoji">{statusEmoji}</span>
    <span class="counts">{status.total}/{status.max}</span>
    {#if status.stuck > 0}
      <span class="badge stuck">{status.stuck} stuck</span>
    {/if}
    {#if status.idle > 0 && status.nearLimit}
      <span class="badge idle">{status.idle} idle</span>
    {/if}
  </button>

  {#if expanded}
    <div class="status-panel">
      <div class="panel-header">
        <h3>EventSource Connections</h3>
        <button class="close-btn" on:click={() => (expanded = false)}>×</button>
      </div>

      {#if status.atLimit}
        <div class="alert critical">
          <strong>⚠️ CONNECTION LIMIT REACHED</strong>
          <p>All {status.max} connection slots are in use. New HTTP requests will hang!</p>
          <button class="alert-action" on:click={closeAll}>Close All Connections</button>
        </div>
      {:else if status.nearLimit}
        <div class="alert warning">
          <strong>⚠️ NEAR CONNECTION LIMIT</strong>
          <p>Using {status.total} of {status.max} connections. One more will block all requests.</p>
        </div>
      {/if}

      {#if status.stuck > 0}
        <div class="alert warning">
          <strong>🟡 STUCK CONNECTIONS</strong>
          <p>{status.stuck} connection(s) stuck in 'connecting' state for over 60 seconds.</p>
          <p class="hint">These will be auto-closed, or click to close manually.</p>
        </div>
      {/if}

      <div class="stats">
        <div class="stat">
          <span class="stat-label">Active</span>
          <span class="stat-value">{status.active}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Connecting</span>
          <span class="stat-value">{status.connecting}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Idle</span>
          <span class="stat-value">{status.idle}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Errors</span>
          <span class="stat-value">{status.errored}</span>
        </div>
      </div>

      <div class="connection-list">
        <h4>Active Connections</h4>
        {#if status.connections.length === 0}
          <div class="empty">No active connections</div>
        {:else}
          {#each status.connections as conn}
            <div class="connection-item" class:stuck={conn.state === 'connecting' && Date.now() - conn.openedAt > 60000} class:error={conn.state === 'error'}>
              <div class="conn-info">
                <div class="conn-name">{conn.name}</div>
                <div class="conn-meta">
                  <span class="conn-state" class:state-open={conn.state === 'open'} class:state-connecting={conn.state === 'connecting'} class:state-error={conn.state === 'error'}>
                    {conn.state}
                  </span>
                  <span class="conn-time">
                    {Math.floor((Date.now() - conn.openedAt) / 1000)}s
                  </span>
                  {#if conn.state === 'open'}
                    <span class="conn-activity" title="Last activity">
                      {Math.floor((Date.now() - conn.lastActivityAt) / 1000)}s idle
                    </span>
                  {/if}
                </div>
              </div>
              <button class="close-conn-btn" on:click={() => closeConnection(conn.id)} title="Close this connection">×</button>
            </div>
          {/each}
        {/if}
      </div>

      <div class="panel-footer">
        <button class="footer-btn" on:click={closeAll}>Close All</button>
        <span class="footer-note">HTTP/1.1 limit: {status.max} connections per origin</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .connection-widget {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .status-button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: rgba(30, 30, 30, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: white;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    backdrop-filter: blur(10px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    transition: all 0.2s;
  }

  .status-button:hover {
    background: rgba(40, 40, 40, 0.95);
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  }

  .connection-widget.warning .status-button {
    border-color: rgba(255, 165, 0, 0.5);
    box-shadow: 0 0 20px rgba(255, 165, 0, 0.3);
  }

  .connection-widget.critical .status-button {
    border-color: rgba(255, 0, 0, 0.5);
    box-shadow: 0 0 20px rgba(255, 0, 0, 0.3);
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  .emoji {
    font-size: 18px;
    line-height: 1;
  }

  .counts {
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 13px;
  }

  .badge {
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .badge.stuck {
    background: rgba(255, 200, 0, 0.2);
    color: #ffc800;
    border: 1px solid rgba(255, 200, 0, 0.3);
  }

  .badge.idle {
    background: rgba(100, 150, 255, 0.2);
    color: #6496ff;
    border: 1px solid rgba(100, 150, 255, 0.3);
  }

  .status-panel {
    position: absolute;
    bottom: 60px;
    right: 0;
    width: 450px;
    max-height: 600px;
    background: rgba(20, 20, 20, 0.98);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    backdrop-filter: blur(20px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .panel-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: white;
  }

  .close-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    font-size: 28px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .alert {
    margin: 16px 20px;
    padding: 12px 16px;
    border-radius: 8px;
    border-left: 4px solid;
  }

  .alert.critical {
    background: rgba(255, 0, 0, 0.1);
    border-left-color: #ff0000;
  }

  .alert.warning {
    background: rgba(255, 165, 0, 0.1);
    border-left-color: #ffa500;
  }

  .alert strong {
    display: block;
    margin-bottom: 6px;
    font-size: 13px;
    color: white;
  }

  .alert p {
    margin: 0 0 8px 0;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.8);
    line-height: 1.5;
  }

  .alert p.hint {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
    margin-bottom: 0;
  }

  .alert-action {
    margin-top: 8px;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    color: white;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .alert-action:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .stat-label {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .stat-value {
    font-size: 20px;
    font-weight: 700;
    color: white;
    font-family: 'SF Mono', Monaco, monospace;
  }

  .connection-list {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }

  .connection-list h4 {
    margin: 0 0 12px 0;
    font-size: 13px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .empty {
    padding: 20px;
    text-align: center;
    color: rgba(255, 255, 255, 0.4);
    font-size: 13px;
  }

  .connection-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    margin-bottom: 8px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    transition: all 0.2s;
  }

  .connection-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .connection-item.stuck {
    border-color: rgba(255, 200, 0, 0.4);
    background: rgba(255, 200, 0, 0.1);
  }

  .connection-item.error {
    border-color: rgba(255, 0, 0, 0.4);
    background: rgba(255, 0, 0, 0.1);
  }

  .conn-info {
    flex: 1;
  }

  .conn-name {
    font-size: 13px;
    font-weight: 500;
    color: white;
    margin-bottom: 4px;
  }

  .conn-meta {
    display: flex;
    gap: 10px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
    font-family: 'SF Mono', Monaco, monospace;
  }

  .conn-state {
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
  }

  .conn-state.state-open {
    background: rgba(0, 255, 0, 0.2);
    color: #00ff00;
  }

  .conn-state.state-connecting {
    background: rgba(255, 200, 0, 0.2);
    color: #ffc800;
  }

  .conn-state.state-error {
    background: rgba(255, 0, 0, 0.2);
    color: #ff0000;
  }

  .close-conn-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    padding: 4px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }

  .close-conn-btn:hover {
    background: rgba(255, 0, 0, 0.2);
    color: #ff0000;
  }

  .panel-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
  }

  .footer-btn {
    padding: 6px 14px;
    background: rgba(255, 0, 0, 0.1);
    border: 1px solid rgba(255, 0, 0, 0.3);
    border-radius: 6px;
    color: #ff6b6b;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .footer-btn:hover {
    background: rgba(255, 0, 0, 0.2);
  }

  .footer-note {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
  }

  /* Scrollbar styling */
  .connection-list::-webkit-scrollbar {
    width: 6px;
  }

  .connection-list::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 3px;
  }

  .connection-list::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
  }

  .connection-list::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
</style>
