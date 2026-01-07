<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface QueuedTask {
    id: string;
    type: string;
    priority: string;
    queuedAt: string;
    payload?: unknown;
    resourceLane?: string;
  }

  interface LaneTask {
    id: string;
    type: string;
    priority: string;
    queuedAt: string;
    resourceLane: string;
    username?: string;
    startedAt?: string;
  }

  interface LaneStatus {
    queued: number;
    running: number;
    maxConcurrent: number;
    canExecute: boolean;
    paused: boolean;
  }

  interface UnifiedQueueStatus {
    running: boolean;
    paused: boolean;
    stats: {
      totalQueued: number;
      totalCompleted: number;
      totalFailed: number;
    };
    tasksByLane: {
      'local-llm': LaneTask[];
      'vector-index': LaneTask[];
      'remote-llm': LaneTask[];
    };
    lanes?: {
      'local-llm': LaneStatus;
      'vector-index': LaneStatus;
      'remote-llm': LaneStatus;
    };
    inFlightRemote: Array<{ taskId: string; provider: string; startedAt: string }>;
    nextTriggers: Array<{ agentId: string; nextRun: string }>;
    lastActivity?: string;
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
  let queueStatus: UnifiedQueueStatus | null = null;
  let loading = true;
  let error = '';
  let actionLoading = false;
  let eventSource: EventSource | null = null;
  let connected = false;

  // Collapsible sections
  let collapsed = {
    lanes: false,
    queue: true,
    scratchpad: true,
    metrics: true,
    config: true,
  };

  // Lane display config
  const laneConfig = {
    'local-llm': { name: 'Local LLM', icon: '🖥️', color: '#3b82f6' },
    'vector-index': { name: 'Vector Index', icon: '🔍', color: '#22c55e' },
    'remote-llm': { name: 'Remote LLM', icon: '☁️', color: '#8b5cf6' },
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
      // Fetch both operator status and unified queue status in parallel
      const [operatorRes, queueRes] = await Promise.all([
        apiFetch('/api/active-operator/status'),
        apiFetch('/api/unified-queue'),
      ]);

      if (!operatorRes.ok) throw new Error('Failed to load operator status');
      status = await operatorRes.json();

      if (queueRes.ok) {
        queueStatus = await queueRes.json();
      }

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

  async function toggleLanePause(laneId: string, currentlyPaused: boolean) {
    try {
      const action = currentlyPaused ? 'resume' : 'pause';
      const res = await apiFetch('/api/queue/lane-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lane: laneId, action }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Lane control failed');
      await loadStatus();
    } catch (e) {
      console.error('Lane control error:', e);
      alert((e as Error).message);
    }
  }

  function isLanePaused(laneId: string): boolean {
    if (!queueStatus?.lanes) return false;
    const laneStatus = queueStatus.lanes[laneId as keyof typeof queueStatus.lanes];
    return laneStatus?.paused || false;
  }

  onMount(() => {
    // Initial load
    loadStatus();

    // Connect to queue event stream
    eventSource = new EventSource('/api/queue-stream');

    eventSource.onopen = () => {
      console.log('[ActiveOperatorDashboard] Connected to queue stream');
      connected = true;
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'error') {
          console.error('[ActiveOperatorDashboard] Stream error:', data.error);
          return;
        }
        if (data.type === 'connected') {
          return;
        }
        // Queue event received - refresh status
        console.log('[ActiveOperatorDashboard] Event received:', data.type);
        loadStatus();
      } catch (e) {
        console.error('[ActiveOperatorDashboard] Failed to parse event:', e);
      }
    };

    eventSource.onerror = () => {
      console.warn('[ActiveOperatorDashboard] Stream connection error');
      connected = false;
    };
  });

  onDestroy(() => {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  });
</script>

<div class="p-4 text-sm">
  {#if loading}
    <div class="p-8 text-center text-gray-500 dark:text-gray-400">Loading Active Operator status...</div>
  {:else if error}
    <div class="p-8 text-center text-red-500">{error}</div>
  {:else if status}
    <!-- Header with Status -->
    <div class="flex justify-between items-center mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2 font-semibold text-lg">
          <span class="w-2.5 h-2.5 rounded-full" style="background-color: {status.enabled ? '#22c55e' : '#6b7280'}"></span>
          <span class={status.enabled ? 'text-green-500' : 'text-gray-500'}>{status.enabled ? 'Active' : 'Passive'}</span>
        </div>
        <div class="px-3 py-1 rounded-full text-xs font-medium" style="background-color: {getHealthColor(status.health)}20; color: {getHealthColor(status.health)}">
          {status.health}
          {#if status.healthMessage}
            <span class="font-normal opacity-80">- {status.healthMessage}</span>
          {/if}
        </div>
      </div>
      <div class="flex gap-2">
        {#if status.enabled}
          <button class="btn-secondary btn-sm" on:click={() => controlOperator('stop')} disabled={actionLoading}>
            Stop
          </button>
          <button class="btn-danger btn-sm" on:click={() => controlOperator('emergency-stop')} disabled={actionLoading}>
            Emergency Stop
          </button>
        {:else}
          <button class="btn-success btn-sm" on:click={() => controlOperator('start')} disabled={actionLoading}>
            Start
          </button>
        {/if}
        <button class="btn-primary btn-sm" on:click={() => controlOperator('reset')} disabled={actionLoading}>
          Reset
        </button>
      </div>
    </div>

    <!-- Current Task -->
    {#if status.isExecuting && status.currentTask}
      <div class="bg-gradient-to-r from-blue-500/10 to-violet-500/10 border border-blue-500/25 rounded-lg p-3 mb-4">
        <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Currently Executing</div>
        <div class="flex items-center gap-2">
          <span class="text-xl">{getTaskIcon(status.currentTask)}</span>
          <span class="font-medium text-gray-900 dark:text-gray-100">{status.currentTask}</span>
          <span class="executing-dot"></span>
        </div>
      </div>
    {/if}

    <!-- Quick Stats -->
    <div class="grid grid-cols-4 gap-3 mb-4">
      <div class="stat-card">
        <div class="stat-value">{status.queue.length}</div>
        <div class="stat-label">Queue</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{status.metrics.totalTasksExecuted}</div>
        <div class="stat-label">Tasks Run</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{status.metrics.successRate}</div>
        <div class="stat-label">Success</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{status.scratchpad.cycleNumber}</div>
        <div class="stat-label">Cycle</div>
      </div>
    </div>

    <!-- Resource Lanes Section -->
    {#if queueStatus}
      <div class="collapsible-section">
        <button class="collapsible-header" on:click={() => collapsed.lanes = !collapsed.lanes}>
          <span>Resource Lanes ({queueStatus.stats?.totalQueued || 0} tasks)</span>
          <span class="collapsible-chevron">{collapsed.lanes ? '▸' : '▾'}</span>
        </button>
        {#if !collapsed.lanes}
          <div class="collapsible-content">
            <div class="grid grid-cols-3 gap-3 max-md:grid-cols-1">
              {#each Object.entries(laneConfig) as [laneId, config]}
                {@const laneTasks = queueStatus.tasksByLane?.[laneId as keyof typeof queueStatus.tasksByLane] || []}
                {@const paused = isLanePaused(laneId)}
                <div class="bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden border-t-[3px] transition-opacity {paused ? 'opacity-60' : ''}" style="border-top-color: {paused ? '#ef4444' : config.color}">
                  <div class="flex items-center gap-2 px-3 py-2 bg-gray-200 dark:bg-gray-700 border-b border-gray-300 dark:border-gray-600">
                    <span class="text-base">{config.icon}</span>
                    <span class="flex-1 font-medium text-sm text-gray-900 dark:text-gray-100">{config.name}</span>
                    {#if paused}
                      <span class="bg-red-500 text-white px-1.5 py-0.5 rounded text-[0.65rem] font-semibold tracking-wide">PAUSED</span>
                    {/if}
                    <span class="text-white px-2 py-0.5 rounded-full text-xs font-semibold" style="background-color: {config.color}">{laneTasks.length}</span>
                    <button
                      class="bg-transparent border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-[0.7rem] cursor-pointer text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-300 dark:hover:bg-gray-600 {paused ? 'text-green-500 border-green-500/40 hover:bg-green-500/20' : ''}"
                      on:click|stopPropagation={() => toggleLanePause(laneId, paused)}
                      title={paused ? 'Resume lane' : 'Pause lane'}
                    >
                      {paused ? '▶' : '⏸'}
                    </button>
                  </div>
                  <div class="p-2 min-h-[80px]">
                    {#if laneTasks.length > 0}
                      {#each laneTasks.slice(0, 5) as task}
                        <div class="flex items-center gap-1.5 px-2 py-1.5 bg-gray-200 dark:bg-gray-700 rounded mb-1.5 text-xs last:mb-0">
                          <span>{getTaskIcon(task.type)}</span>
                          <span class="flex-1 text-gray-900 dark:text-gray-100">{task.type}</span>
                          <span class="text-[0.65rem] uppercase font-medium" style="color: {getPriorityColor(task.priority)}">{task.priority}</span>
                        </div>
                      {/each}
                      {#if laneTasks.length > 5}
                        <div class="text-center text-xs text-gray-500 dark:text-gray-400 italic py-1">+{laneTasks.length - 5} more</div>
                      {/if}
                    {:else}
                      <div class="text-center text-gray-500 dark:text-gray-400 italic p-4 text-sm">Empty</div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
            {#if queueStatus.inFlightRemote?.length > 0}
              <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">In-Flight Remote Tasks</div>
                <div class="flex flex-col gap-1.5">
                  {#each queueStatus.inFlightRemote as remote}
                    <div class="flex items-center gap-3 p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm">
                      <span class="bg-violet-500 text-white px-2 py-0.5 rounded text-xs font-medium">{remote.provider}</span>
                      <span class="text-gray-500 dark:text-gray-400 font-mono text-xs">{remote.taskId.slice(0, 8)}...</span>
                      <span class="ml-auto text-gray-500 dark:text-gray-400 text-xs">{formatTimestamp(remote.startedAt)}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Queue Section (Legacy) -->
    <div class="collapsible-section">
      <button class="collapsible-header" on:click={() => collapsed.queue = !collapsed.queue}>
        <span>Queue Details ({status.queue.length})</span>
        <span class="collapsible-chevron">{collapsed.queue ? '▸' : '▾'}</span>
      </button>
      {#if !collapsed.queue}
        <div class="collapsible-content">
          {#if status.queue.tasks.length > 0}
            <div class="flex flex-col gap-2">
              {#each status.queue.tasks.slice(0, 10) as task}
                <div class="flex items-center gap-2 p-2 bg-gray-100 dark:bg-gray-800 rounded">
                  <span class="text-xl">{getTaskIcon(task.type)}</span>
                  <span class="flex-1 text-gray-900 dark:text-gray-100">{task.type}</span>
                  <span class="text-xs uppercase font-medium" style="color: {getPriorityColor(task.priority)}">{task.priority}</span>
                  <span class="text-xs text-gray-500 dark:text-gray-400">{formatTimestamp(task.queuedAt)}</span>
                </div>
              {/each}
            </div>
            {#if status.queue.length > 10}
              <div class="mt-2 p-2 text-center text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded italic">
                +{status.queue.length - 10} more tasks in queue
              </div>
            {/if}
          {:else}
            <div class="text-center text-gray-500 dark:text-gray-400 italic p-4">Queue is empty</div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Scratchpad Section -->
    <div class="collapsible-section">
      <button class="collapsible-header" on:click={() => collapsed.scratchpad = !collapsed.scratchpad}>
        <span>Scratchpad ({status.scratchpad.entriesCount} entries)</span>
        <span class="collapsible-chevron">{collapsed.scratchpad ? '▸' : '▾'}</span>
      </button>
      {#if !collapsed.scratchpad}
        <div class="collapsible-content">
          {#if status.scratchpad.lastDecision}
            <div class="p-3 bg-gray-100 dark:bg-gray-800 rounded mb-3">
              <strong class="text-gray-900 dark:text-gray-100">Last Decision:</strong> {status.scratchpad.lastDecision}
            </div>
          {/if}
          {#if status.scratchpad.activitySummary}
            <div class="p-3 bg-gray-100 dark:bg-gray-800 rounded mb-3">
              <strong class="text-gray-900 dark:text-gray-100">Activity:</strong> {status.scratchpad.activitySummary}
            </div>
          {/if}
          {#if status.scratchpad.recentEntries.length > 0}
            <div class="flex flex-col gap-2">
              {#each status.scratchpad.recentEntries.slice(0, 10) as entry}
                <div class="grid grid-cols-[70px_1fr_auto] gap-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm border-l-[3px] {entry.type === 'decision' ? 'border-l-violet-500' : entry.type === 'execution' ? 'border-l-green-500' : 'border-l-gray-400'}">
                  <span class="text-gray-500 dark:text-gray-400 text-xs uppercase">{entry.type}</span>
                  <span class="text-gray-900 dark:text-gray-100">{entry.content}</span>
                  <span class="text-gray-500 dark:text-gray-400 text-xs">{formatTimestamp(entry.timestamp)}</span>
                </div>
              {/each}
            </div>
            {#if status.scratchpad.recentEntries.length > 10}
              <div class="mt-2 p-2 text-center text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded italic">
                +{status.scratchpad.recentEntries.length - 10} more entries
              </div>
            {/if}
          {:else}
            <div class="text-center text-gray-500 dark:text-gray-400 italic p-4">No recent activity</div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Metrics Section -->
    <div class="collapsible-section">
      <button class="collapsible-header" on:click={() => collapsed.metrics = !collapsed.metrics}>
        <span>Metrics</span>
        <span class="collapsible-chevron">{collapsed.metrics ? '▸' : '▾'}</span>
      </button>
      {#if !collapsed.metrics}
        <div class="collapsible-content">
          <div class="grid grid-cols-2 gap-3">
            <div class="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-800 rounded">
              <span class="text-gray-500 dark:text-gray-400 text-sm">Avg Duration</span>
              <span class="font-medium text-gray-900 dark:text-gray-100">{formatDuration(status.metrics.averageDurationMs)}</span>
            </div>
            <div class="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-800 rounded">
              <span class="text-gray-500 dark:text-gray-400 text-sm">Tokens/Hour</span>
              <span class="font-medium text-gray-900 dark:text-gray-100">{status.cost.tokensThisHour.toLocaleString()}</span>
            </div>
            {#if status.cost.budgetEnabled}
              <div class="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-800 rounded">
                <span class="text-gray-500 dark:text-gray-400 text-sm">Budget</span>
                <span class="font-medium text-gray-900 dark:text-gray-100">{status.cost.utilization}</span>
              </div>
            {/if}
            <div class="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-800 rounded">
              <span class="text-gray-500 dark:text-gray-400 text-sm">Errors</span>
              <span class="font-medium {status.errors.consecutiveErrors > 0 ? 'text-red-500' : 'text-gray-900 dark:text-gray-100'}">
                {status.errors.consecutiveErrors}
              </span>
            </div>
          </div>
          {#if Object.keys(status.metrics.tasksByType).length > 0}
            <div class="mt-4">
              <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Tasks by Type</div>
              {#each Object.entries(status.metrics.tasksByType) as [type, count]}
                <div class="flex justify-between py-1.5 border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                  <span class="text-gray-900 dark:text-gray-100">{getTaskIcon(type)} {type}</span>
                  <span class="text-gray-500 dark:text-gray-400">{count}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Config Section -->
    <div class="collapsible-section">
      <button class="collapsible-header" on:click={() => collapsed.config = !collapsed.config}>
        <span>Configuration</span>
        <span class="collapsible-chevron">{collapsed.config ? '▸' : '▾'}</span>
      </button>
      {#if !collapsed.config}
        <div class="collapsible-content">
          <div class="grid grid-cols-2 gap-3">
            <div class="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-800 rounded">
              <span class="text-gray-500 dark:text-gray-400 text-sm">Decision Model</span>
              <span class="font-medium text-gray-900 dark:text-gray-100">{status.config.decisionModel}</span>
            </div>
            <div class="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-800 rounded">
              <span class="text-gray-500 dark:text-gray-400 text-sm">Cooldown</span>
              <span class="font-medium text-gray-900 dark:text-gray-100">{status.config.cooldownMs}ms</span>
            </div>
            <div class="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-800 rounded">
              <span class="text-gray-500 dark:text-gray-400 text-sm">Max Consecutive</span>
              <span class="font-medium text-gray-900 dark:text-gray-100">{status.config.maxConsecutiveTasks}</span>
            </div>
            <div class="flex justify-between items-center p-2 bg-gray-100 dark:bg-gray-800 rounded">
              <span class="text-gray-500 dark:text-gray-400 text-sm">Self-Healing</span>
              <span class="font-medium text-gray-900 dark:text-gray-100">{status.config.enableSelfHealing ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>
          <div class="mt-4">
            <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Enabled Tasks</div>
            <div class="flex flex-wrap gap-2">
              {#each status.config.enabledTaskTypes as taskType}
                <span class="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-xs text-gray-900 dark:text-gray-100">{getTaskIcon(taskType)} {taskType}</span>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
