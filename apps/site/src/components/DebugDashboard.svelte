<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface MetaHumanEvent {
    timestamp: string;
    source: string;
    event: string;
    requestId?: string;
    sessionId?: string;
    userId?: string;
    level?: 'debug' | 'info' | 'warn' | 'error';
    durationMs?: number;
    data?: Record<string, unknown>;
  }

  let events: MetaHumanEvent[] = [];
  let ws: WebSocket | null = null;
  let connected = false;
  let autoScroll = true;
  let eventsContainer: HTMLDivElement;

  // Filters
  let filterSource = '';
  let filterLevel = '';
  let filterRequestId = '';
  let filterText = '';

  // Stats
  let eventCount = 0;
  let errorCount = 0;
  let lastEventTime: string | null = null;

  $: filteredEvents = events.filter(e => {
    if (filterSource && e.source !== filterSource) return false;
    if (filterLevel && e.level !== filterLevel) return false;
    if (filterRequestId && e.requestId !== filterRequestId) return false;
    if (filterText) {
      const text = JSON.stringify(e).toLowerCase();
      if (!text.includes(filterText.toLowerCase())) return false;
    }
    return true;
  });

  $: sources = [...new Set(events.map(e => e.source))];
  $: requestIds = [...new Set(events.filter(e => e.requestId).map(e => e.requestId!))];

  function connect() {
    ws = new WebSocket('ws://localhost:3100');

    ws.onopen = () => {
      connected = true;
      console.log('[DebugDashboard] Connected to event bus');
    };

    ws.onmessage = (event) => {
      try {
        const e = JSON.parse(event.data) as MetaHumanEvent;
        events = [...events.slice(-999), e]; // Keep last 1000 events
        eventCount++;
        if (e.level === 'error') errorCount++;
        lastEventTime = e.timestamp;

        // Auto-scroll to bottom
        if (autoScroll && eventsContainer) {
          setTimeout(() => {
            eventsContainer.scrollTop = eventsContainer.scrollHeight;
          }, 10);
        }
      } catch (err) {
        console.error('[DebugDashboard] Invalid event:', err);
      }
    };

    ws.onclose = () => {
      connected = false;
      console.log('[DebugDashboard] Disconnected from event bus');
      // Reconnect after 3 seconds
      setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error('[DebugDashboard] WebSocket error:', err);
    };
  }

  function clearEvents() {
    events = [];
    eventCount = 0;
    errorCount = 0;
    lastEventTime = null;
  }

  function formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  function getLevelClass(level?: string): string {
    switch (level) {
      case 'error': return 'level-error';
      case 'warn': return 'level-warn';
      case 'debug': return 'level-debug';
      default: return 'level-info';
    }
  }

  function getSourceClass(source: string): string {
    const classes: Record<string, string> = {
      'core': 'source-core',
      'graph': 'source-graph',
      'audit': 'source-audit',
      'big-brother': 'source-bigbrother',
      'agents': 'source-agents',
      'memory': 'source-memory',
    };
    return classes[source] || 'source-default';
  }

  onMount(() => {
    connect();
  });

  onDestroy(() => {
    if (ws) {
      ws.close();
    }
  });
</script>

<div class="debug-dashboard">
  <header class="dashboard-header">
    <h1>Debug Console</h1>
    <div class="connection-status" class:connected>
      {connected ? 'Connected' : 'Disconnected'}
    </div>
  </header>

  <div class="stats-bar">
    <div class="stat">
      <span class="stat-label">Events</span>
      <span class="stat-value">{eventCount}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Errors</span>
      <span class="stat-value error-count">{errorCount}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Last Event</span>
      <span class="stat-value">{lastEventTime ? formatTime(lastEventTime) : '--'}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Sources</span>
      <span class="stat-value">{sources.length}</span>
    </div>
  </div>

  <div class="filters-bar">
    <select bind:value={filterSource}>
      <option value="">All Sources</option>
      {#each sources as source}
        <option value={source}>{source}</option>
      {/each}
    </select>

    <select bind:value={filterLevel}>
      <option value="">All Levels</option>
      <option value="debug">Debug</option>
      <option value="info">Info</option>
      <option value="warn">Warn</option>
      <option value="error">Error</option>
    </select>

    <select bind:value={filterRequestId}>
      <option value="">All Requests</option>
      {#each requestIds.slice(-20) as reqId}
        <option value={reqId}>{reqId}</option>
      {/each}
    </select>

    <input
      type="text"
      placeholder="Search events..."
      bind:value={filterText}
    />

    <label class="auto-scroll-toggle">
      <input type="checkbox" bind:checked={autoScroll} />
      Auto-scroll
    </label>

    <button class="clear-btn" on:click={clearEvents}>Clear</button>
  </div>

  <div class="events-container" bind:this={eventsContainer}>
    {#each filteredEvents as event (event.timestamp + event.event)}
      <div class="event-row {getLevelClass(event.level)}">
        <span class="event-time">{formatTime(event.timestamp)}</span>
        <span class="event-source {getSourceClass(event.source)}">{event.source}</span>
        <span class="event-type">{event.event}</span>
        {#if event.requestId}
          <span class="event-request-id">{event.requestId}</span>
        {/if}
        {#if event.durationMs}
          <span class="event-duration">{event.durationMs}ms</span>
        {/if}
        {#if event.data}
          <details class="event-data">
            <summary>data</summary>
            <pre>{JSON.stringify(event.data, null, 2)}</pre>
          </details>
        {/if}
      </div>
    {/each}

    {#if filteredEvents.length === 0}
      <div class="empty-state">
        {#if connected}
          Waiting for events...
        {:else}
          Connecting to event bus on port 3100...
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .debug-dashboard {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0d1117;
    color: #c9d1d9;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
  }

  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: #161b22;
    border-bottom: 1px solid #30363d;
  }

  .dashboard-header h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .connection-status {
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 12px;
    background: #f85149;
    color: #fff;
  }

  .connection-status.connected {
    background: #238636;
  }

  .stats-bar {
    display: flex;
    gap: 24px;
    padding: 12px 16px;
    background: #161b22;
    border-bottom: 1px solid #30363d;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .stat-label {
    font-size: 11px;
    color: #8b949e;
    text-transform: uppercase;
  }

  .stat-value {
    font-size: 16px;
    font-weight: 600;
  }

  .stat-value.error-count {
    color: #f85149;
  }

  .filters-bar {
    display: flex;
    gap: 8px;
    padding: 8px 16px;
    background: #0d1117;
    border-bottom: 1px solid #30363d;
    flex-wrap: wrap;
  }

  .filters-bar select,
  .filters-bar input[type="text"] {
    padding: 6px 10px;
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #c9d1d9;
    font-size: 12px;
  }

  .filters-bar input[type="text"] {
    flex: 1;
    min-width: 200px;
  }

  .auto-scroll-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #8b949e;
    cursor: pointer;
  }

  .clear-btn {
    padding: 6px 12px;
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #c9d1d9;
    font-size: 12px;
    cursor: pointer;
  }

  .clear-btn:hover {
    background: #30363d;
  }

  .events-container {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .event-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 6px 16px;
    border-bottom: 1px solid #21262d;
    font-size: 12px;
    line-height: 1.4;
  }

  .event-row:hover {
    background: #161b22;
  }

  .event-time {
    color: #8b949e;
    min-width: 80px;
  }

  .event-source {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    min-width: 80px;
    text-align: center;
  }

  .source-core { background: #1f6feb; color: #fff; }
  .source-graph { background: #8957e5; color: #fff; }
  .source-audit { background: #388bfd; color: #fff; }
  .source-bigbrother { background: #f85149; color: #fff; }
  .source-agents { background: #3fb950; color: #fff; }
  .source-memory { background: #d29922; color: #fff; }
  .source-default { background: #30363d; color: #c9d1d9; }

  .event-type {
    color: #58a6ff;
    flex: 1;
  }

  .event-request-id {
    color: #8b949e;
    font-size: 10px;
    background: #21262d;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .event-duration {
    color: #d29922;
    font-size: 10px;
  }

  .event-data {
    margin-left: auto;
  }

  .event-data summary {
    cursor: pointer;
    color: #8b949e;
    font-size: 10px;
  }

  .event-data pre {
    margin: 8px 0 0 0;
    padding: 8px;
    background: #21262d;
    border-radius: 4px;
    font-size: 11px;
    max-width: 400px;
    overflow-x: auto;
  }

  .level-error {
    background: rgba(248, 81, 73, 0.1);
    border-left: 3px solid #f85149;
  }

  .level-warn {
    background: rgba(210, 153, 34, 0.1);
    border-left: 3px solid #d29922;
  }

  .level-debug {
    opacity: 0.7;
  }

  .level-info {
    /* default styling */
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: #8b949e;
    font-size: 14px;
  }
</style>
