<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface AgentMetrics {
    name: string;
    status: 'running' | 'stopped' | 'error';
    pid?: number;
    uptime?: number;
    lastActivity?: string;
    metrics: {
      totalRuns: number;
      successfulRuns: number;
      failedRuns: number;
      lastRun?: string;
      lastError?: string;
      recentActivity: {
        last5m: number;
        last1h: number;
        today: number;
      };
      successRate: {
        last5m: number;
        last1h: number;
        overall: number;
      };
    };
    errors: string[];
  }

  interface ProcessingStatus {
    processed: number;
    total: number;
    processedPercentage: number;
  }

  export let compact = false; // Compact mode for sidebar

  let agents: AgentMetrics[] = [];
  let processing: ProcessingStatus | null = null;
  let connected = false;
  let eventSource: EventSource | null = null;

  function formatUptime(seconds: number | undefined): string {
    if (!seconds) return 'N/A';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  function formatTimestamp(timestamp: string | undefined): string {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  }

  function isAgentActive(agent: AgentMetrics): boolean {
    // Consider active if running and had activity in last 5 minutes
    if (agent.status !== 'running') return false;
    if (!agent.lastActivity) return false;

    const lastActivity = new Date(agent.lastActivity).getTime();
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    return lastActivity > fiveMinutesAgo;
  }

  function getActivitySparkline(agent: AgentMetrics): number[] {
    // Create a simple sparkline from recent activity data
    // Returns normalized values for the last 12 5-minute windows (1 hour)
    const metrics = agent.metrics.recentActivity;

    // Estimate distribution across time windows
    const last5m = metrics.last5m;
    const last1h = metrics.last1h;

    // Create 12 buckets (5-minute intervals over 1 hour)
    const buckets = new Array(12).fill(0);

    // Simplified: put all last5m activity in the most recent bucket
    buckets[11] = last5m;

    // Distribute remaining activity across older buckets
    const remaining = last1h - last5m;
    if (remaining > 0) {
      // Spread with decay (more recent = more activity)
      for (let i = 10; i >= 0; i--) {
        const decay = (11 - i) / 11;
        buckets[i] = Math.floor(remaining * decay / 11);
      }
    }

    return buckets;
  }

  function isService(agentName: string): boolean {
    // Services end with -service and are managed by `mh start`
    return agentName.endsWith('-service');
  }

  async function runAgent(agentName: string) {
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName }),
      });
      const data = await res.json();
      if (!data.success) {
        console.error('Failed to start agent:', data.message);
      }
    } catch (err) {
      console.error('Failed to run agent:', err);
    }
  }

  onMount(() => {
    // Connect to SSE stream
    eventSource = new EventSource('/api/monitor/stream');

    eventSource.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
          connected = true;
        } else if (data.type === 'metrics') {
          agents = data.agents || [];
          processing = data.processing || null;
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    });

    eventSource.addEventListener('error', () => {
      connected = false;
      console.warn('SSE connection error, will retry...');
    });
  });

  onDestroy(() => {
    if (eventSource) {
      eventSource.close();
    }
  });
</script>

<div class="agent-monitor" class:compact>
  <!-- Connection Status -->
  <div class="connection-status" class:connected>
    <span class="status-dot"></span>
    <span class="status-text">{connected ? 'Live' : 'Connecting...'}</span>
  </div>

  <!-- Processing Status -->
  {#if processing}
    <div class="processing-status">
      <div class="status-header">Memory Processing</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: {processing.processedPercentage}%" />
      </div>
      <div class="status-text">
        {processing.processed} / {processing.total} processed ({processing.processedPercentage}%)
      </div>
    </div>
  {/if}

  <!-- Agent List -->
  {#if agents.length === 0}
    <div class="empty">No agents available</div>
  {:else}
    <div class="agent-list">
      {#each agents as agent}
        <div class="agent-card" class:running={agent.status === 'running'} class:error={agent.status === 'error'} class:active={isAgentActive(agent)}>
          <!-- Header -->
          <div class="agent-header">
            <div class="agent-title">
              <span class="status-indicator" class:running={agent.status === 'running'} class:error={agent.status === 'error'} class:active={isAgentActive(agent)}></span>
              <span class="agent-name">{agent.name}</span>
              {#if agent.status === 'running'}
                <span class="status-badge" class:active={isAgentActive(agent)}>
                  {isAgentActive(agent) ? 'ACTIVE' : 'IDLE'}
                </span>
              {:else if agent.status === 'error'}
                <span class="status-badge error">ERROR</span>
              {:else}
                <span class="status-badge stopped">STOPPED</span>
              {/if}
            </div>
            {#if agent.status !== 'running'}
              {#if isService(agent.name)}
                <span class="service-note">Use 'mh start'</span>
              {:else}
                <button class="run-btn" on:click={() => runAgent(agent.name)}>
                  Run
                </button>
              {/if}
            {/if}
          </div>

          <!-- Status Info -->
          {#if !compact}
            <div class="agent-info">
              <div class="info-row">
                <span class="info-label">Status:</span>
                <span class="info-value status-{agent.status}">{agent.status}</span>
              </div>
              {#if agent.pid}
                <div class="info-row">
                  <span class="info-label">PID:</span>
                  <span class="info-value">{agent.pid}</span>
                </div>
              {/if}
              {#if agent.uptime}
                <div class="info-row">
                  <span class="info-label">Uptime:</span>
                  <span class="info-value">{formatUptime(agent.uptime)}</span>
                </div>
              {/if}
              <div class="info-row">
                <span class="info-label">Last Activity:</span>
                <span class="info-value">{formatTimestamp(agent.lastActivity)}</span>
              </div>
            </div>
          {/if}

          <!-- Activity Graph -->
          {#if !compact}
            {@const sparkline = getActivitySparkline(agent)}
            {@const maxValue = Math.max(...sparkline, 1)}
            <div class="activity-graph">
              <div class="graph-header">
                <span class="graph-title">Activity (last hour)</span>
                <span class="graph-label">{agent.metrics.recentActivity.last1h} runs</span>
              </div>
              <div class="sparkline">
                {#each sparkline as value, i}
                  <div
                    class="bar"
                    class:active={i === sparkline.length - 1 && value > 0}
                    style="height: {value > 0 ? (value / maxValue) * 100 : 2}%"
                    title="{value} runs ({60 - (11 - i) * 5}m ago)"
                  ></div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Metrics -->
          {#if isService(agent.name)}
            <div class="agent-stats">
              <div class="stat">
                <span class="stat-label">Triggers (5m):</span>
                <span class="stat-value">{agent.metrics.recentActivity.last5m}</span>
              </div>
              <div class="stat">
                <span class="stat-label">Triggers (1h):</span>
                <span class="stat-value">{agent.metrics.recentActivity.last1h}</span>
              </div>
              <div class="stat">
                <span class="stat-label">Today:</span>
                <span class="stat-value">{agent.metrics.recentActivity.today}</span>
              </div>
            </div>
          {:else}
            <div class="agent-stats">
              <div class="stat">
                <span class="stat-label">Total:</span>
                <span class="stat-value">{agent.metrics.totalRuns}</span>
              </div>
              <div class="stat">
                <span class="stat-label">Success:</span>
                <span class="stat-value success">{agent.metrics.successfulRuns}</span>
              </div>
              <div class="stat">
                <span class="stat-label">Failed:</span>
                <span class="stat-value error">{agent.metrics.failedRuns}</span>
              </div>
              <div class="stat">
                <span class="stat-label">Rate:</span>
                <span class="stat-value">{agent.metrics.successRate.overall}%</span>
              </div>
            </div>
          {/if}

          {#if !compact && agent.metrics.recentActivity.last5m > 0}
            <div class="recent-activity">
              Recent: {agent.metrics.recentActivity.last5m} (5m) · {agent.metrics.recentActivity.last1h} (1h)
            </div>
          {/if}

          {#if !compact && agent.errors.length > 0}
            <div class="error-list">
              <div class="error-header">Recent Errors:</div>
              {#each agent.errors as error}
                <div class="error-item">{error}</div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .agent-monitor {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    height: 100%;
  }

  .agent-monitor.compact {
    gap: 0.75rem;
  }

  /* Connection Status */
  .connection-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    background: rgba(0, 0, 0, 0.05);
    font-size: 0.75rem;
    font-weight: 500;
  }

  :global(.dark) .connection-status {
    background: rgba(255, 255, 255, 0.05);
  }

  .status-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: rgb(156 163 175);
  }

  .connection-status.connected .status-dot {
    background: rgb(34 197 94);
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .status-text {
    color: rgb(107 114 128);
  }

  :global(.dark) .status-text {
    color: rgb(156 163 175);
  }

  .connection-status.connected .status-text {
    color: rgb(34 197 94);
  }

  :global(.dark) .connection-status.connected .status-text {
    color: rgb(134 239 172);
  }

  /* Processing Status */
  .processing-status {
    padding: 0.75rem;
    border-radius: 0.5rem;
    background: rgba(124, 58, 237, 0.05);
    border: 1px solid rgba(124, 58, 237, 0.2);
  }

  :global(.dark) .processing-status {
    background: rgba(167, 139, 250, 0.05);
    border-color: rgba(167, 139, 250, 0.2);
  }

  .status-header {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgb(124 58 237);
    margin-bottom: 0.5rem;
  }

  :global(.dark) .status-header {
    color: rgb(167 139 250);
  }

  .progress-bar {
    height: 0.5rem;
    background: rgba(0, 0, 0, 0.1);
    border-radius: 9999px;
    overflow: hidden;
    margin-bottom: 0.5rem;
  }

  :global(.dark) .progress-bar {
    background: rgba(255, 255, 255, 0.1);
  }

  .progress-fill {
    height: 100%;
    background: rgb(124 58 237);
    transition: width 0.3s;
  }

  :global(.dark) .progress-fill {
    background: rgb(167 139 250);
  }

  .status-text {
    font-size: 0.75rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .status-text {
    color: rgb(156 163 175);
  }

  /* Agent List */
  .empty {
    padding: 2rem 1rem;
    text-align: center;
    color: rgb(107 114 128);
    font-size: 0.875rem;
  }

  :global(.dark) .empty {
    color: rgb(156 163 175);
  }

  .agent-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    overflow-y: auto;
  }

  .agent-card {
    padding: 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(0, 0, 0, 0.1);
    background: rgba(255, 255, 255, 0.5);
    transition: all 0.2s;
  }

  :global(.dark) .agent-card {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
  }

  .agent-card.running {
    border-color: rgba(34, 197, 94, 0.3);
    background: rgba(34, 197, 94, 0.05);
  }

  :global(.dark) .agent-card.running {
    border-color: rgba(134, 239, 172, 0.3);
    background: rgba(134, 239, 172, 0.05);
  }

  .agent-card.error {
    border-color: rgba(239, 68, 68, 0.3);
    background: rgba(239, 68, 68, 0.05);
  }

  :global(.dark) .agent-card.error {
    border-color: rgba(252, 165, 165, 0.3);
    background: rgba(252, 165, 165, 0.05);
  }

  .agent-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .agent-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
  }

  .status-indicator {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: rgb(156 163 175);
    flex-shrink: 0;
  }

  .status-indicator.running {
    background: rgb(34 197 94);
  }

  .status-indicator.active {
    background: rgb(34 197 94);
    animation: pulse-bright 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  .status-indicator.error {
    background: rgb(239 68 68);
  }

  @keyframes pulse-bright {
    0%, 100% {
      opacity: 1;
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7);
    }
    50% {
      opacity: 1;
      box-shadow: 0 0 0 4px rgba(34, 197, 94, 0);
    }
  }

  .status-badge {
    padding: 0.125rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    background: rgb(229 231 235);
    color: rgb(75 85 99);
    flex-shrink: 0;
  }

  :global(.dark) .status-badge {
    background: rgb(55 65 81);
    color: rgb(156 163 175);
  }

  .status-badge.active {
    background: rgb(34 197 94);
    color: white;
  }

  :global(.dark) .status-badge.active {
    background: rgb(22 163 74);
    color: white;
  }

  .status-badge.error {
    background: rgb(239 68 68);
    color: white;
  }

  :global(.dark) .status-badge.error {
    background: rgb(220 38 38);
    color: white;
  }

  .status-badge.stopped {
    background: rgb(209 213 219);
    color: rgb(107 114 128);
  }

  :global(.dark) .status-badge.stopped {
    background: rgb(55 65 81);
    color: rgb(156 163 175);
  }

  .agent-name {
    font-weight: 600;
    font-size: 0.875rem;
    color: rgb(17 24 39);
  }

  :global(.dark) .agent-name {
    color: rgb(243 244 246);
  }

  .run-btn {
    padding: 0.25rem 0.75rem;
    border: none;
    border-radius: 0.375rem;
    background: rgb(124 58 237);
    color: white;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .run-btn:hover {
    background: rgb(109 40 217);
  }

  :global(.dark) .run-btn {
    background: rgb(167 139 250);
    color: rgb(17 24 39);
  }

  :global(.dark) .run-btn:hover {
    background: rgb(196 181 253);
  }

  .service-note {
    padding: 0.25rem 0.75rem;
    border-radius: 0.375rem;
    background: rgba(0, 0, 0, 0.05);
    color: rgb(107 114 128);
    font-size: 0.7rem;
    font-weight: 500;
    font-family: monospace;
  }

  :global(.dark) .service-note {
    background: rgba(255, 255, 255, 0.05);
    color: rgb(156 163 175);
  }

  /* Agent Info */
  .agent-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
    padding: 0.5rem;
    background: rgba(0, 0, 0, 0.03);
    border-radius: 0.375rem;
  }

  :global(.dark) .agent-info {
    background: rgba(255, 255, 255, 0.03);
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
  }

  .info-label {
    color: rgb(107 114 128);
    font-weight: 500;
  }

  :global(.dark) .info-label {
    color: rgb(156 163 175);
  }

  .info-value {
    color: rgb(17 24 39);
    font-weight: 600;
  }

  :global(.dark) .info-value {
    color: rgb(243 244 246);
  }

  .info-value.status-running {
    color: rgb(34 197 94);
  }

  :global(.dark) .info-value.status-running {
    color: rgb(134 239 172);
  }

  .info-value.status-error {
    color: rgb(239 68 68);
  }

  :global(.dark) .info-value.status-error {
    color: rgb(252 165 165);
  }

  /* Agent Stats */
  .agent-stats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }

  .stat {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
  }

  .stat-label {
    color: rgb(107 114 128);
  }

  :global(.dark) .stat-label {
    color: rgb(156 163 175);
  }

  .stat-value {
    font-weight: 600;
    color: rgb(17 24 39);
  }

  :global(.dark) .stat-value {
    color: rgb(243 244 246);
  }

  .stat-value.success {
    color: rgb(22 163 74);
  }

  :global(.dark) .stat-value.success {
    color: rgb(134 239 172);
  }

  .stat-value.error {
    color: rgb(220 38 38);
  }

  :global(.dark) .stat-value.error {
    color: rgb(252 165 165);
  }

  /* Activity Graph */
  .activity-graph {
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.02);
    border-radius: 0.375rem;
    border: 1px solid rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .activity-graph {
    background: rgba(255, 255, 255, 0.02);
    border-color: rgba(255, 255, 255, 0.05);
  }

  .graph-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .graph-title {
    font-size: 0.7rem;
    font-weight: 600;
    color: rgb(107 114 128);
  }

  :global(.dark) .graph-title {
    color: rgb(156 163 175);
  }

  .graph-label {
    font-size: 0.7rem;
    font-weight: 500;
    color: rgb(124 58 237);
  }

  :global(.dark) .graph-label {
    color: rgb(167 139 250);
  }

  .sparkline {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 40px;
    width: 100%;
  }

  .sparkline .bar {
    flex: 1;
    min-height: 2px;
    background: rgb(209 213 219);
    border-radius: 2px 2px 0 0;
    transition: all 0.3s;
  }

  :global(.dark) .sparkline .bar {
    background: rgb(75 85 99);
  }

  .sparkline .bar:hover {
    background: rgb(124 58 237);
  }

  :global(.dark) .sparkline .bar:hover {
    background: rgb(167 139 250);
  }

  .sparkline .bar.active {
    background: rgb(34 197 94);
    animation: bar-pulse 2s ease-in-out infinite;
  }

  :global(.dark) .sparkline .bar.active {
    background: rgb(34 197 94);
  }

  @keyframes bar-pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  /* Recent Activity */
  .recent-activity {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
    font-size: 0.7rem;
    color: rgb(107 114 128);
  }

  :global(.dark) .recent-activity {
    border-top-color: rgba(255, 255, 255, 0.1);
    color: rgb(156 163 175);
  }

  /* Error List */
  .error-list {
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: rgba(239, 68, 68, 0.05);
    border-radius: 0.375rem;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  :global(.dark) .error-list {
    background: rgba(252, 165, 165, 0.05);
    border-color: rgba(252, 165, 165, 0.2);
  }

  .error-header {
    font-size: 0.7rem;
    font-weight: 600;
    color: rgb(220 38 38);
    margin-bottom: 0.25rem;
  }

  :global(.dark) .error-header {
    color: rgb(252 165 165);
  }

  .error-item {
    font-size: 0.7rem;
    color: rgb(107 114 128);
    margin-top: 0.25rem;
    padding-left: 0.5rem;
    border-left: 2px solid rgba(239, 68, 68, 0.3);
  }

  :global(.dark) .error-item {
    color: rgb(156 163 175);
    border-left-color: rgba(252, 165, 165, 0.3);
  }
</style>
