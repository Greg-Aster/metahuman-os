<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface QueuedTask {
    id: string;
    type: string;
    priority: string;
    queuedAt: string;
    payload?: unknown;
  }

  interface ScratchpadEntry {
    timestamp: string;
    type: 'decision' | 'execution' | 'observation' | 'thought';
    content: string;
  }

  interface OperatorStatus {
    enabled: boolean;
    mode: string;
    isExecuting: boolean;
    currentTask: string | null;
    health: string;
    healthMessage?: string;
    queue: {
      length: number;
      tasks: QueuedTask[];
      hasUserMessages: boolean;
    };
    metrics: {
      totalTasksExecuted: number;
      tasksByType: Record<string, number>;
      successRate: string;
      averageDurationMs: number;
      startedAt: string;
    };
    cost: {
      tokensThisHour: number;
      budgetEnabled: boolean;
      budgetLimit: number;
      utilization: string;
    };
    errors: {
      consecutiveErrors: number;
      isPaused: boolean;
      lastError?: string;
    };
    scratchpad: {
      cycleNumber: number;
      entriesCount: number;
      recentEntries: ScratchpadEntry[];
      lastDecision: string | null;
      activitySummary: string | null;
    };
    config: {
      decisionModel: string;
      cooldownMs: number;
      maxConsecutiveTasks: number;
      enabledTaskTypes: string[];
      enableSelfHealing: boolean;
      energyBudget: { enabled: boolean; tokensPerHour: number };
    };
  }

  let status: OperatorStatus | null = null;
  let loading = true;
  let error = '';
  let actionLoading = false;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  // Collapsible sections
  let collapsed = {
    queue: false,
    scratchpad: true,
    metrics: true,
    config: true,
  };

  function formatTimestamp(ts: string): string {
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  function getTaskIcon(type: string): string {
    const icons: Record<string, string> = {
      user_message: '💬',
      memory_curate: '📝',
      index_build: '🔍',
      reflect: '🪞',
      curiosity: '🤔',
      inner_curiosity: '💭',
      dream: '💤',
      desire_generate: '🌟',
      desire_execute: '🎯',
      psychoanalyze: '🧠',
      code_analyze: '🔧',
    };
    return icons[type] || '📋';
  }

  function getPriorityColor(priority: string): string {
    const colors: Record<string, string> = {
      critical: '#ef4444',
      high: '#f97316',
      normal: '#3b82f6',
      low: '#6b7280',
      background: '#9ca3af',
    };
    return colors[priority] || '#6b7280';
  }

  function getHealthColor(health: string): string {
    switch (health) {
      case 'healthy': return '#22c55e';
      case 'degraded': return '#f97316';
      case 'paused': return '#eab308';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  }

  async function loadStatus() {
    try {
      const res = await apiFetch('/api/active-operator/status');
      if (!res.ok) throw new Error('Failed to load status');
      status = await res.json();
      loading = false;
    } catch (e) {
      error = (e as Error).message;
      loading = false;
    }
  }

  async function controlOperator(action: string) {
    actionLoading = true;
    try {
      const res = await apiFetch('/api/active-operator/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Action failed');
      await loadStatus();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      actionLoading = false;
    }
  }

  onMount(() => {
    loadStatus();
    pollInterval = setInterval(loadStatus, 5000); // Poll every 5 seconds
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });
</script>

<div class="operator-dashboard">
  {#if loading}
    <div class="loading">Loading Active Operator status...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if status}
    <!-- Header with Status -->
    <div class="status-header">
      <div class="status-main">
        <div class="mode-indicator" class:active={status.enabled} class:passive={!status.enabled}>
          <span class="mode-dot" style="background-color: {status.enabled ? '#22c55e' : '#6b7280'}"></span>
          <span class="mode-text">{status.enabled ? 'Active' : 'Passive'}</span>
        </div>
        <div class="health-badge" style="background-color: {getHealthColor(status.health)}20; color: {getHealthColor(status.health)}">
          {status.health}
          {#if status.healthMessage}
            <span class="health-detail">- {status.healthMessage}</span>
          {/if}
        </div>
      </div>
      <div class="controls">
        {#if status.enabled}
          <button class="control-btn stop" on:click={() => controlOperator('stop')} disabled={actionLoading}>
            Stop
          </button>
          <button class="control-btn emergency" on:click={() => controlOperator('emergency-stop')} disabled={actionLoading}>
            Emergency Stop
          </button>
        {:else}
          <button class="control-btn start" on:click={() => controlOperator('start')} disabled={actionLoading}>
            Start
          </button>
        {/if}
        <button class="control-btn reset" on:click={() => controlOperator('reset')} disabled={actionLoading}>
          Reset
        </button>
      </div>
    </div>

    <!-- Current Task -->
    {#if status.isExecuting && status.currentTask}
      <div class="current-task">
        <div class="section-label">Currently Executing</div>
        <div class="task-info">
          <span class="task-icon">{getTaskIcon(status.currentTask)}</span>
          <span class="task-name">{status.currentTask}</span>
          <span class="executing-indicator"></span>
        </div>
      </div>
    {/if}

    <!-- Quick Stats -->
    <div class="quick-stats">
      <div class="stat">
        <div class="stat-value">{status.queue.length}</div>
        <div class="stat-label">Queue</div>
      </div>
      <div class="stat">
        <div class="stat-value">{status.metrics.totalTasksExecuted}</div>
        <div class="stat-label">Tasks Run</div>
      </div>
      <div class="stat">
        <div class="stat-value">{status.metrics.successRate}</div>
        <div class="stat-label">Success</div>
      </div>
      <div class="stat">
        <div class="stat-value">{status.scratchpad.cycleNumber}</div>
        <div class="stat-label">Cycle</div>
      </div>
    </div>

    <!-- Queue Section -->
    <div class="section">
      <button class="section-header" on:click={() => collapsed.queue = !collapsed.queue}>
        <span>Queue ({status.queue.length})</span>
        <span class="chevron">{collapsed.queue ? '▸' : '▾'}</span>
      </button>
      {#if !collapsed.queue}
        <div class="section-content">
          {#if status.queue.tasks.length > 0}
            <div class="queue-list">
              {#each status.queue.tasks as task}
                <div class="queue-item">
                  <span class="task-icon">{getTaskIcon(task.type)}</span>
                  <span class="task-type">{task.type}</span>
                  <span class="task-priority" style="color: {getPriorityColor(task.priority)}">{task.priority}</span>
                  <span class="task-time">{formatTimestamp(task.queuedAt)}</span>
                </div>
              {/each}
            </div>
          {:else}
            <div class="empty-message">Queue is empty</div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Scratchpad Section -->
    <div class="section">
      <button class="section-header" on:click={() => collapsed.scratchpad = !collapsed.scratchpad}>
        <span>Scratchpad ({status.scratchpad.entriesCount} entries)</span>
        <span class="chevron">{collapsed.scratchpad ? '▸' : '▾'}</span>
      </button>
      {#if !collapsed.scratchpad}
        <div class="section-content">
          {#if status.scratchpad.lastDecision}
            <div class="last-decision">
              <strong>Last Decision:</strong> {status.scratchpad.lastDecision}
            </div>
          {/if}
          {#if status.scratchpad.activitySummary}
            <div class="activity-summary">
              <strong>Activity:</strong> {status.scratchpad.activitySummary}
            </div>
          {/if}
          {#if status.scratchpad.recentEntries.length > 0}
            <div class="scratchpad-entries">
              {#each status.scratchpad.recentEntries as entry}
                <div class="scratchpad-entry" class:decision={entry.type === 'decision'} class:execution={entry.type === 'execution'}>
                  <span class="entry-type">{entry.type}</span>
                  <span class="entry-content">{entry.content}</span>
                  <span class="entry-time">{formatTimestamp(entry.timestamp)}</span>
                </div>
              {/each}
            </div>
          {:else}
            <div class="empty-message">No recent activity</div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Metrics Section -->
    <div class="section">
      <button class="section-header" on:click={() => collapsed.metrics = !collapsed.metrics}>
        <span>Metrics</span>
        <span class="chevron">{collapsed.metrics ? '▸' : '▾'}</span>
      </button>
      {#if !collapsed.metrics}
        <div class="section-content">
          <div class="metrics-grid">
            <div class="metric">
              <span class="metric-label">Avg Duration</span>
              <span class="metric-value">{formatDuration(status.metrics.averageDurationMs)}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Tokens/Hour</span>
              <span class="metric-value">{status.cost.tokensThisHour.toLocaleString()}</span>
            </div>
            {#if status.cost.budgetEnabled}
              <div class="metric">
                <span class="metric-label">Budget</span>
                <span class="metric-value">{status.cost.utilization}</span>
              </div>
            {/if}
            <div class="metric">
              <span class="metric-label">Errors</span>
              <span class="metric-value" class:error={status.errors.consecutiveErrors > 0}>
                {status.errors.consecutiveErrors}
              </span>
            </div>
          </div>
          {#if Object.keys(status.metrics.tasksByType).length > 0}
            <div class="tasks-by-type">
              <div class="subsection-label">Tasks by Type</div>
              {#each Object.entries(status.metrics.tasksByType) as [type, count]}
                <div class="type-count">
                  <span>{getTaskIcon(type)} {type}</span>
                  <span>{count}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Config Section -->
    <div class="section">
      <button class="section-header" on:click={() => collapsed.config = !collapsed.config}>
        <span>Configuration</span>
        <span class="chevron">{collapsed.config ? '▸' : '▾'}</span>
      </button>
      {#if !collapsed.config}
        <div class="section-content">
          <div class="config-grid">
            <div class="config-item">
              <span class="config-label">Decision Model</span>
              <span class="config-value">{status.config.decisionModel}</span>
            </div>
            <div class="config-item">
              <span class="config-label">Cooldown</span>
              <span class="config-value">{status.config.cooldownMs}ms</span>
            </div>
            <div class="config-item">
              <span class="config-label">Max Consecutive</span>
              <span class="config-value">{status.config.maxConsecutiveTasks}</span>
            </div>
            <div class="config-item">
              <span class="config-label">Self-Healing</span>
              <span class="config-value">{status.config.enableSelfHealing ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>
          <div class="enabled-tasks">
            <div class="subsection-label">Enabled Tasks</div>
            <div class="task-chips">
              {#each status.config.enabledTaskTypes as taskType}
                <span class="task-chip">{getTaskIcon(taskType)} {taskType}</span>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .operator-dashboard {
    padding: 1rem;
    font-size: 0.9rem;
  }

  .loading, .error {
    padding: 2rem;
    text-align: center;
    color: var(--text-muted, #6b7280);
  }

  .error {
    color: #ef4444;
  }

  .status-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border-color, #374151);
  }

  .status-main {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .mode-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    font-size: 1.1rem;
  }

  .mode-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .mode-indicator.active .mode-text {
    color: #22c55e;
  }

  .mode-indicator.passive .mode-text {
    color: #6b7280;
  }

  .health-badge {
    padding: 0.25rem 0.75rem;
    border-radius: 1rem;
    font-size: 0.8rem;
    font-weight: 500;
  }

  .health-detail {
    font-weight: 400;
    opacity: 0.8;
  }

  .controls {
    display: flex;
    gap: 0.5rem;
  }

  .control-btn {
    padding: 0.4rem 0.8rem;
    border: none;
    border-radius: 0.375rem;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .control-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .control-btn.start {
    background: #22c55e;
    color: white;
  }

  .control-btn.start:hover:not(:disabled) {
    background: #16a34a;
  }

  .control-btn.stop {
    background: #6b7280;
    color: white;
  }

  .control-btn.stop:hover:not(:disabled) {
    background: #4b5563;
  }

  .control-btn.emergency {
    background: #ef4444;
    color: white;
  }

  .control-btn.emergency:hover:not(:disabled) {
    background: #dc2626;
  }

  .control-btn.reset {
    background: #3b82f6;
    color: white;
  }

  .control-btn.reset:hover:not(:disabled) {
    background: #2563eb;
  }

  .current-task {
    background: linear-gradient(135deg, #3b82f620, #8b5cf620);
    border: 1px solid #3b82f640;
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
  }

  .section-label {
    font-size: 0.75rem;
    color: var(--text-muted, #9ca3af);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.5rem;
  }

  .task-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .task-icon {
    font-size: 1.2rem;
  }

  .task-name {
    font-weight: 500;
  }

  .executing-indicator {
    width: 8px;
    height: 8px;
    background: #22c55e;
    border-radius: 50%;
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.2); }
  }

  .quick-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .stat {
    background: var(--bg-secondary, #1f2937);
    border-radius: 0.5rem;
    padding: 0.75rem;
    text-align: center;
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary, #f3f4f6);
  }

  .stat-label {
    font-size: 0.75rem;
    color: var(--text-muted, #9ca3af);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .section {
    margin-bottom: 0.5rem;
    border: 1px solid var(--border-color, #374151);
    border-radius: 0.5rem;
    overflow: hidden;
  }

  .section-header {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: var(--bg-secondary, #1f2937);
    border: none;
    color: var(--text-primary, #f3f4f6);
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    text-align: left;
  }

  .section-header:hover {
    background: var(--bg-hover, #374151);
  }

  .chevron {
    color: var(--text-muted, #9ca3af);
  }

  .section-content {
    padding: 1rem;
    background: var(--bg-primary, #111827);
  }

  .queue-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .queue-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--bg-secondary, #1f2937);
    border-radius: 0.375rem;
  }

  .task-type {
    flex: 1;
  }

  .task-priority {
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: uppercase;
  }

  .task-time {
    font-size: 0.75rem;
    color: var(--text-muted, #9ca3af);
  }

  .empty-message {
    color: var(--text-muted, #9ca3af);
    font-style: italic;
    text-align: center;
    padding: 1rem;
  }

  .last-decision, .activity-summary {
    padding: 0.75rem;
    background: var(--bg-secondary, #1f2937);
    border-radius: 0.375rem;
    margin-bottom: 0.75rem;
  }

  .scratchpad-entries {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .scratchpad-entry {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--bg-secondary, #1f2937);
    border-radius: 0.375rem;
    font-size: 0.85rem;
  }

  .scratchpad-entry.decision {
    border-left: 3px solid #8b5cf6;
  }

  .scratchpad-entry.execution {
    border-left: 3px solid #22c55e;
  }

  .entry-type {
    color: var(--text-muted, #9ca3af);
    font-size: 0.75rem;
    text-transform: uppercase;
    width: 70px;
  }

  .entry-content {
    color: var(--text-primary, #f3f4f6);
  }

  .entry-time {
    color: var(--text-muted, #9ca3af);
    font-size: 0.75rem;
  }

  .metrics-grid, .config-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
  }

  .metric, .config-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem;
    background: var(--bg-secondary, #1f2937);
    border-radius: 0.375rem;
  }

  .metric-label, .config-label {
    color: var(--text-muted, #9ca3af);
    font-size: 0.85rem;
  }

  .metric-value, .config-value {
    font-weight: 500;
  }

  .metric-value.error {
    color: #ef4444;
  }

  .subsection-label {
    font-size: 0.75rem;
    color: var(--text-muted, #9ca3af);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 1rem 0 0.5rem;
  }

  .tasks-by-type {
    margin-top: 0.5rem;
  }

  .type-count {
    display: flex;
    justify-content: space-between;
    padding: 0.375rem 0;
    border-bottom: 1px solid var(--border-color, #374151);
  }

  .type-count:last-child {
    border-bottom: none;
  }

  .enabled-tasks {
    margin-top: 0.5rem;
  }

  .task-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .task-chip {
    padding: 0.25rem 0.5rem;
    background: var(--bg-secondary, #1f2937);
    border-radius: 1rem;
    font-size: 0.8rem;
  }
</style>
