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
  let eventSource: EventSource | null = null;
  let connected = false;

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
    // Initial load
    loadStatus();

    // Connect to queue event stream
    eventSource = new EventSource('/api/queue-stream');

    eventSource.onopen = () => {
      console.log('[UnifiedQueueDashboard] Connected to queue stream');
      connected = true;
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'error') {
          console.error('[UnifiedQueueDashboard] Stream error:', data.error);
          return;
        }
        if (data.type === 'connected') {
          return;
        }
        // Queue event received - refresh status
        console.log('[UnifiedQueueDashboard] Event received:', data.type);
        loadStatus();
      } catch (e) {
        console.error('[UnifiedQueueDashboard] Failed to parse event:', e);
      }
    };

    eventSource.onerror = () => {
      console.warn('[UnifiedQueueDashboard] Stream connection error');
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

<div class="p-4 text-sm h-full overflow-y-auto">
  {#if loading}
    <div class="p-8 text-center text-gray-500 dark:text-gray-400">Loading Unified Queue status...</div>
  {:else if error}
    <div class="p-8 text-center text-red-500">{error}</div>
  {:else if status}
    <!-- Header with Status -->
    <div class="flex justify-between items-center mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2 font-semibold text-lg">
          <span class="w-2.5 h-2.5 rounded-full {status.paused ? 'bg-yellow-500' : status.running ? 'bg-green-500' : 'bg-gray-500'}"></span>
          <span class="{status.paused ? 'text-yellow-500' : status.running ? 'text-green-500' : ''}">
            {#if status.paused}
              Paused
            {:else if status.running}
              Running
            {:else}
              Stopped
            {/if}
          </span>
        </div>
        <div class="flex gap-2">
          <span class="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs">{status.stats.total} queued</span>
          <span class="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs text-green-500">{status.stats.completed} completed</span>
          {#if status.stats.failed > 0}
            <span class="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs text-red-500">{status.stats.failed} failed</span>
          {/if}
        </div>
      </div>
      <div class="flex gap-2">
        {#if status.running}
          {#if status.paused}
            <button class="px-3 py-1.5 rounded-md text-sm cursor-pointer transition-all bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlQueue('resume')} disabled={actionLoading}>
              Resume
            </button>
          {:else}
            <button class="px-3 py-1.5 rounded-md text-sm cursor-pointer transition-all bg-yellow-500 text-white hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlQueue('pause')} disabled={actionLoading}>
              Pause
            </button>
          {/if}
          <button class="px-3 py-1.5 rounded-md text-sm cursor-pointer transition-all bg-gray-500 text-white hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlQueue('stop')} disabled={actionLoading}>
            Stop
          </button>
        {:else}
          <button class="px-3 py-1.5 rounded-md text-sm cursor-pointer transition-all bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed" on:click={() => controlQueue('start')} disabled={actionLoading}>
            Start
          </button>
        {/if}
      </div>
    </div>

    <!-- Lane Columns -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
      {#each Object.entries(LANE_LABELS) as [laneId, lane]}
        {@const laneStatus = status.lanes[laneId]}
        {@const tasks = status.tasksByLane[laneId as keyof typeof status.tasksByLane] || []}
        <div class="bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col min-h-[300px]" style="border-top: 3px solid {lane.color}">
          <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <div class="flex items-center gap-2 font-semibold mb-1">
              <span class="text-xl">{lane.icon}</span>
              <span style="color: {lane.color}">{lane.name}</span>
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mb-2">{lane.description}</div>
            <div class="flex gap-3 text-xs">
              <span class="{laneStatus?.running > 0 ? 'text-green-500' : 'text-gray-500 dark:text-gray-400'}">
                {laneStatus?.running || 0} running
              </span>
              <span class="text-gray-500 dark:text-gray-400">{tasks.length} queued</span>
            </div>
          </div>

          <div class="flex-1 p-3 overflow-y-auto">
            {#if laneStatus?.currentTask}
              <div class="mb-3 pb-3 border-b border-dashed border-gray-300 dark:border-gray-600">
                <div class="text-[0.7rem] text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Currently Executing</div>
                <div class="flex items-center gap-2 p-2 bg-white dark:bg-gray-900 rounded-md border-2" style="border-color: {lane.color}; background: linear-gradient(135deg, transparent, {lane.color}10)">
                  <span class="text-base">{getTaskIcon(laneStatus.currentTask.type)}</span>
                  <span class="text-sm">{laneStatus.currentTask.type}</span>
                  <span class="w-2 h-2 bg-green-500 rounded-full animate-pulse ml-auto"></span>
                </div>
              </div>
            {/if}

            <div class="flex flex-col gap-2">
              {#if tasks.length > 0}
                {#each tasks.slice(0, 8) as task}
                  <div class="flex items-center gap-2 p-2 bg-white dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700">
                    <span class="text-base">{getTaskIcon(task.type)}</span>
                    <div class="flex-1 flex flex-col gap-0.5">
                      <span class="text-sm">{task.type}</span>
                      <span class="flex gap-2 text-xs">
                        <span class="font-medium uppercase" style="color: {getPriorityColor(task.priority)}">{task.priority}</span>
                        <span class="text-gray-500 dark:text-gray-400">{formatTimestamp(task.queuedAt)}</span>
                      </span>
                    </div>
                  </div>
                {/each}
                {#if tasks.length > 8}
                  <div class="text-center text-xs text-gray-500 dark:text-gray-400 italic p-2">+{tasks.length - 8} more</div>
                {/if}
              {:else if !laneStatus?.currentTask}
                <div class="text-gray-500 dark:text-gray-400 italic text-center py-8 px-4">No tasks</div>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>

    <!-- In-Flight Remote Tasks -->
    {#if status.inFlightRemote.length > 0}
      <div class="mb-2 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <button class="w-full flex justify-between items-center px-4 py-3 bg-gray-100 dark:bg-gray-800 border-none text-gray-900 dark:text-gray-100 cursor-pointer text-sm font-medium text-left hover:bg-gray-200 dark:hover:bg-gray-700" on:click={() => showRemoteInFlight = !showRemoteInFlight}>
          <span>In-Flight Remote ({status.inFlightRemote.length})</span>
          <span class="text-gray-500 dark:text-gray-400">{showRemoteInFlight ? '▾' : '▸'}</span>
        </button>
        {#if showRemoteInFlight}
          <div class="p-4 bg-white dark:bg-gray-900">
            <div class="flex flex-col gap-2">
              {#each status.inFlightRemote as remote}
                <div class="flex items-center gap-4 p-2 bg-gray-100 dark:bg-gray-800 rounded-md">
                  <span class="font-medium text-blue-500">{remote.provider}</span>
                  <span class="text-gray-500 dark:text-gray-400 font-mono text-sm">{remote.taskId.slice(0, 8)}...</span>
                  <span class="ml-auto text-xs text-gray-500 dark:text-gray-400">{formatTimestamp(remote.startedAt)}</span>
                  <span class="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Triggers Section -->
    {#if triggers && triggers.triggers.length > 0}
      <div class="mb-2 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <button class="w-full flex justify-between items-center px-4 py-3 bg-gray-100 dark:bg-gray-800 border-none text-gray-900 dark:text-gray-100 cursor-pointer text-sm font-medium text-left hover:bg-gray-200 dark:hover:bg-gray-700" on:click={() => showTriggers = !showTriggers}>
          <span>Triggers ({triggers.triggers.length})</span>
          <span class="text-gray-500 dark:text-gray-400">{showTriggers ? '▾' : '▸'}</span>
        </button>
        {#if showTriggers}
          <div class="p-4 bg-white dark:bg-gray-900">
            <div class="flex flex-col gap-2">
              {#each triggers.triggers as trigger}
                <div class="flex items-center gap-4 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-md {!trigger.enabled ? 'opacity-50' : ''}">
                  <div class="flex-1 flex gap-3 items-center">
                    <span class="font-medium">{trigger.id}</span>
                    <span class="text-xs text-gray-500 dark:text-gray-400 px-1.5 py-0.5 bg-white dark:bg-gray-900 rounded">{trigger.type}</span>
                    {#if trigger.nextRun}
                      <span class="text-xs text-green-500">{formatFutureTimestamp(trigger.nextRun)}</span>
                    {/if}
                  </div>
                  <div class="flex gap-3 text-xs text-gray-500 dark:text-gray-400">
                    <span>{trigger.runCount} runs</span>
                    {#if trigger.errorCount > 0}
                      <span class="text-red-500">{trigger.errorCount} errors</span>
                    {/if}
                  </div>
                  <button
                    class="px-2 py-1 text-xs bg-blue-500 text-white border-none rounded cursor-pointer hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
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
      <div class="flex items-center gap-3 px-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-md text-sm">
        <span class="text-gray-500 dark:text-gray-400">Next:</span>
        {#each status.nextTriggers.slice(0, 3) as next}
          <span class="text-gray-900 dark:text-gray-100">
            {next.agentId} {formatFutureTimestamp(next.nextRun)}
          </span>
        {/each}
      </div>
    {/if}
  {/if}
</div>

