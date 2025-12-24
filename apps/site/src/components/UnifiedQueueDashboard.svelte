<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface QueuedTask {
    id: string;
    type: string;
    priority: string;
    queuedAt: string;
    resourceLane: string;
    payload?: unknown;
  }

  interface LaneStatus {
    running: number;
    queued: number;
    completed: number;
    failed: number;
    currentTask?: QueuedTask;
  }

  interface TriggerInfo {
    id: string;
    type: string;
    enabled: boolean;
    priority: string;
    lastRun?: string;
    nextRun?: string;
    runCount: number;
    errorCount: number;
    interval?: number;
    schedule?: string;
  }

  interface QueueStatus {
    success: boolean;
    running: boolean;
    paused: boolean;
    stats: {
      total: number;
      byPriority: Record<string, number>;
      byLane: Record<string, number>;
      completed: number;
      failed: number;
    };
    lanes: Record<string, LaneStatus>;
    tasksByLane: {
      'local-llm': QueuedTask[];
      'vector-index': QueuedTask[];
      'remote-llm': QueuedTask[];
    };
    inFlightRemote: Array<{
      taskId: string;
      provider: string;
      startedAt: string;
    }>;
    nextTriggers: Array<{ agentId: string; nextRun: string }>;
    lastActivity?: string;
  }

  interface TriggerStatus {
    success: boolean;
    triggers: TriggerInfo[];
    nextTriggers: Array<{ agentId: string; nextRun: string }>;
  }

  let status: QueueStatus | null = null;
  let triggers: TriggerStatus | null = null;
  let loading = true;
  let error = '';
  let actionLoading = false;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  // Collapsible sections
  let showTriggers = false;
  let showRemoteInFlight = true;

  const LANE_LABELS: Record<string, { name: string; icon: string; color: string; description: string }> = {
    'local-llm': {
      name: 'Local LLM',
      icon: '🖥️',
      color: '#8b5cf6',
      description: 'vLLM, Ollama (GPU)',
    },
    'vector-index': {
      name: 'Vector Index',
      icon: '🔍',
      color: '#22c55e',
      description: 'Embeddings (CPU)',
    },
    'remote-llm': {
      name: 'Remote LLM',
      icon: '☁️',
      color: '#3b82f6',
      description: 'RunPod, Claude CLI',
    },
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

  function formatFutureTimestamp(ts: string): string {
    const date = new Date(ts);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (diff < 0) return 'Overdue';
    if (minutes < 1) return 'Now';
    if (minutes < 60) return `in ${minutes}m`;
    if (hours < 24) return `in ${hours}h`;
    return date.toLocaleDateString();
  }

  function getTaskIcon(type: string): string {
    const icons: Record<string, string> = {
      user_message: '💬',
      memory_curate: '📝',
      index_build: '🔍',
      semantic_search: '🔎',
      reflect: '🪞',
      curiosity: '🤔',
      inner_curiosity: '💭',
      dream: '💤',
      desire_generate: '🌟',
      desire_execute: '🎯',
      psychoanalyze: '🧠',
      code_analyze: '🔧',
      big_brother_escalation: '👁️',
      runpod_inference: '☁️',
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

  async function loadStatus() {
    try {
      const [queueRes, triggerRes] = await Promise.all([
        apiFetch('/api/unified-queue'),
        apiFetch('/api/unified-queue/triggers'),
      ]);

      if (!queueRes.ok) throw new Error('Failed to load queue status');
      status = await queueRes.json();

      if (triggerRes.ok) {
        triggers = await triggerRes.json();
      }

      loading = false;
    } catch (e) {
      error = (e as Error).message;
      loading = false;
    }
  }

  async function controlQueue(action: string) {
    actionLoading = true;
    try {
      const res = await apiFetch('/api/unified-queue/control', {
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

  async function triggerAgent(agentId: string) {
    actionLoading = true;
    try {
      const res = await apiFetch(`/api/unified-queue/trigger/${agentId}`, {
        method: 'POST',
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Trigger failed');
      await loadStatus();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      actionLoading = false;
    }
  }

  onMount(() => {
    loadStatus();
    pollInterval = setInterval(loadStatus, 3000); // Poll every 3 seconds
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });
</script>

<div class="queue-dashboard">
  {#if loading}
    <div class="loading">Loading Unified Queue status...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if status}
    <!-- Header with Status -->
    <div class="status-header">
      <div class="status-main">
        <div class="running-indicator" class:active={status.running} class:paused={status.paused}>
          <span class="status-dot"></span>
          <span class="status-text">
            {#if status.paused}
              Paused
            {:else if status.running}
              Running
            {:else}
              Stopped
            {/if}
          </span>
        </div>
        <div class="queue-stats">
          <span class="stat-badge">{status.stats.total} queued</span>
          <span class="stat-badge success">{status.stats.completed} completed</span>
          {#if status.stats.failed > 0}
            <span class="stat-badge error">{status.stats.failed} failed</span>
          {/if}
        </div>
      </div>
      <div class="controls">
        {#if status.running}
          {#if status.paused}
            <button class="control-btn resume" on:click={() => controlQueue('resume')} disabled={actionLoading}>
              Resume
            </button>
          {:else}
            <button class="control-btn pause" on:click={() => controlQueue('pause')} disabled={actionLoading}>
              Pause
            </button>
          {/if}
          <button class="control-btn stop" on:click={() => controlQueue('stop')} disabled={actionLoading}>
            Stop
          </button>
        {:else}
          <button class="control-btn start" on:click={() => controlQueue('start')} disabled={actionLoading}>
            Start
          </button>
        {/if}
      </div>
    </div>

    <!-- Lane Columns -->
    <div class="lane-columns">
      {#each Object.entries(LANE_LABELS) as [laneId, lane]}
        {@const laneStatus = status.lanes[laneId]}
        {@const tasks = status.tasksByLane[laneId as keyof typeof status.tasksByLane] || []}
        <div class="lane-column" style="--lane-color: {lane.color}">
          <div class="lane-header">
            <div class="lane-title">
              <span class="lane-icon">{lane.icon}</span>
              <span class="lane-name">{lane.name}</span>
            </div>
            <div class="lane-desc">{lane.description}</div>
            <div class="lane-stats">
              <span class="lane-stat" class:active={laneStatus?.running > 0}>
                {laneStatus?.running || 0} running
              </span>
              <span class="lane-stat">{tasks.length} queued</span>
            </div>
          </div>

          <div class="lane-content">
            {#if laneStatus?.currentTask}
              <div class="current-task">
                <div class="current-label">Currently Executing</div>
                <div class="task-card executing">
                  <span class="task-icon">{getTaskIcon(laneStatus.currentTask.type)}</span>
                  <span class="task-type">{laneStatus.currentTask.type}</span>
                  <span class="executing-indicator"></span>
                </div>
              </div>
            {/if}

            <div class="task-list">
              {#if tasks.length > 0}
                {#each tasks.slice(0, 8) as task}
                  <div class="task-card">
                    <span class="task-icon">{getTaskIcon(task.type)}</span>
                    <div class="task-details">
                      <span class="task-type">{task.type}</span>
                      <span class="task-meta">
                        <span class="task-priority" style="color: {getPriorityColor(task.priority)}">{task.priority}</span>
                        <span class="task-time">{formatTimestamp(task.queuedAt)}</span>
                      </span>
                    </div>
                  </div>
                {/each}
                {#if tasks.length > 8}
                  <div class="overflow-indicator">+{tasks.length - 8} more</div>
                {/if}
              {:else if !laneStatus?.currentTask}
                <div class="empty-lane">No tasks</div>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>

    <!-- In-Flight Remote Tasks -->
    {#if status.inFlightRemote.length > 0}
      <div class="section">
        <button class="section-header" on:click={() => showRemoteInFlight = !showRemoteInFlight}>
          <span>In-Flight Remote ({status.inFlightRemote.length})</span>
          <span class="chevron">{showRemoteInFlight ? '▾' : '▸'}</span>
        </button>
        {#if showRemoteInFlight}
          <div class="section-content">
            <div class="remote-list">
              {#each status.inFlightRemote as remote}
                <div class="remote-item">
                  <span class="remote-provider">{remote.provider}</span>
                  <span class="remote-task">{remote.taskId.slice(0, 8)}...</span>
                  <span class="remote-time">{formatTimestamp(remote.startedAt)}</span>
                  <span class="in-flight-indicator"></span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Triggers Section -->
    {#if triggers && triggers.triggers.length > 0}
      <div class="section">
        <button class="section-header" on:click={() => showTriggers = !showTriggers}>
          <span>Triggers ({triggers.triggers.length})</span>
          <span class="chevron">{showTriggers ? '▾' : '▸'}</span>
        </button>
        {#if showTriggers}
          <div class="section-content">
            <div class="trigger-list">
              {#each triggers.triggers as trigger}
                <div class="trigger-item" class:disabled={!trigger.enabled}>
                  <div class="trigger-info">
                    <span class="trigger-id">{trigger.id}</span>
                    <span class="trigger-type">{trigger.type}</span>
                    {#if trigger.nextRun}
                      <span class="trigger-next">{formatFutureTimestamp(trigger.nextRun)}</span>
                    {/if}
                  </div>
                  <div class="trigger-stats">
                    <span class="trigger-runs">{trigger.runCount} runs</span>
                    {#if trigger.errorCount > 0}
                      <span class="trigger-errors">{trigger.errorCount} errors</span>
                    {/if}
                  </div>
                  <button
                    class="trigger-btn"
                    on:click={() => triggerAgent(trigger.id)}
                    disabled={actionLoading || !trigger.enabled}
                  >
                    Trigger
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Next Scheduled -->
    {#if status.nextTriggers && status.nextTriggers.length > 0}
      <div class="next-scheduled">
        <span class="next-label">Next:</span>
        {#each status.nextTriggers.slice(0, 3) as next}
          <span class="next-item">
            {next.agentId} {formatFutureTimestamp(next.nextRun)}
          </span>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .queue-dashboard {
    padding: 1rem;
    font-size: 0.9rem;
    height: 100%;
    overflow-y: auto;
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

  .running-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    font-size: 1.1rem;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #6b7280;
  }

  .running-indicator.active .status-dot {
    background: #22c55e;
  }

  .running-indicator.paused .status-dot {
    background: #eab308;
  }

  .running-indicator.active .status-text {
    color: #22c55e;
  }

  .running-indicator.paused .status-text {
    color: #eab308;
  }

  .queue-stats {
    display: flex;
    gap: 0.5rem;
  }

  .stat-badge {
    padding: 0.25rem 0.5rem;
    background: var(--bg-secondary, #1f2937);
    border-radius: 0.25rem;
    font-size: 0.8rem;
  }

  .stat-badge.success {
    color: #22c55e;
  }

  .stat-badge.error {
    color: #ef4444;
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

  .control-btn.start, .control-btn.resume {
    background: #22c55e;
    color: white;
  }

  .control-btn.start:hover:not(:disabled), .control-btn.resume:hover:not(:disabled) {
    background: #16a34a;
  }

  .control-btn.pause {
    background: #eab308;
    color: white;
  }

  .control-btn.pause:hover:not(:disabled) {
    background: #ca8a04;
  }

  .control-btn.stop {
    background: #6b7280;
    color: white;
  }

  .control-btn.stop:hover:not(:disabled) {
    background: #4b5563;
  }

  /* Lane Columns */
  .lane-columns {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    margin-bottom: 1rem;
  }

  @media (max-width: 900px) {
    .lane-columns {
      grid-template-columns: 1fr;
    }
  }

  .lane-column {
    background: var(--bg-secondary, #1f2937);
    border-radius: 0.5rem;
    border: 1px solid var(--border-color, #374151);
    border-top: 3px solid var(--lane-color);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 300px;
  }

  .lane-header {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border-color, #374151);
    background: var(--bg-primary, #111827);
  }

  .lane-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .lane-icon {
    font-size: 1.2rem;
  }

  .lane-name {
    color: var(--lane-color);
  }

  .lane-desc {
    font-size: 0.75rem;
    color: var(--text-muted, #9ca3af);
    margin-bottom: 0.5rem;
  }

  .lane-stats {
    display: flex;
    gap: 0.75rem;
    font-size: 0.8rem;
  }

  .lane-stat {
    color: var(--text-muted, #9ca3af);
  }

  .lane-stat.active {
    color: #22c55e;
  }

  .lane-content {
    flex: 1;
    padding: 0.75rem;
    overflow-y: auto;
  }

  .current-task {
    margin-bottom: 0.75rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px dashed var(--border-color, #374151);
  }

  .current-label {
    font-size: 0.7rem;
    color: var(--text-muted, #9ca3af);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.5rem;
  }

  .task-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .task-card {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--bg-primary, #111827);
    border-radius: 0.375rem;
    border: 1px solid var(--border-color, #374151);
  }

  .task-card.executing {
    border-color: var(--lane-color);
    background: linear-gradient(135deg, var(--bg-primary, #111827), color-mix(in srgb, var(--lane-color) 10%, transparent));
  }

  .task-icon {
    font-size: 1rem;
  }

  .task-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .task-type {
    font-size: 0.85rem;
  }

  .task-meta {
    display: flex;
    gap: 0.5rem;
    font-size: 0.75rem;
  }

  .task-priority {
    font-weight: 500;
    text-transform: uppercase;
  }

  .task-time {
    color: var(--text-muted, #9ca3af);
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

  .empty-lane {
    color: var(--text-muted, #9ca3af);
    font-style: italic;
    text-align: center;
    padding: 2rem 1rem;
  }

  .overflow-indicator {
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-muted, #9ca3af);
    font-style: italic;
    padding: 0.5rem;
  }

  /* Sections */
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

  /* Remote In-Flight */
  .remote-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .remote-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem;
    background: var(--bg-secondary, #1f2937);
    border-radius: 0.375rem;
  }

  .remote-provider {
    font-weight: 500;
    color: #3b82f6;
  }

  .remote-task {
    color: var(--text-muted, #9ca3af);
    font-family: monospace;
    font-size: 0.85rem;
  }

  .remote-time {
    margin-left: auto;
    font-size: 0.8rem;
    color: var(--text-muted, #9ca3af);
  }

  .in-flight-indicator {
    width: 6px;
    height: 6px;
    background: #3b82f6;
    border-radius: 50%;
    animation: pulse 1.5s infinite;
  }

  /* Triggers */
  .trigger-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .trigger-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-secondary, #1f2937);
    border-radius: 0.375rem;
  }

  .trigger-item.disabled {
    opacity: 0.5;
  }

  .trigger-info {
    flex: 1;
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  .trigger-id {
    font-weight: 500;
  }

  .trigger-type {
    font-size: 0.8rem;
    color: var(--text-muted, #9ca3af);
    padding: 0.125rem 0.375rem;
    background: var(--bg-primary, #111827);
    border-radius: 0.25rem;
  }

  .trigger-next {
    font-size: 0.8rem;
    color: #22c55e;
  }

  .trigger-stats {
    display: flex;
    gap: 0.75rem;
    font-size: 0.8rem;
    color: var(--text-muted, #9ca3af);
  }

  .trigger-errors {
    color: #ef4444;
  }

  .trigger-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.8rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 0.25rem;
    cursor: pointer;
  }

  .trigger-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .trigger-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Next Scheduled */
  .next-scheduled {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg-secondary, #1f2937);
    border-radius: 0.375rem;
    font-size: 0.85rem;
  }

  .next-label {
    color: var(--text-muted, #9ca3af);
  }

  .next-item {
    color: var(--text-primary, #f3f4f6);
  }
</style>
