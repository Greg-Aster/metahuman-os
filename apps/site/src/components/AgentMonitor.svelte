<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { sleepStatus } from '../lib/stores/sleep-status';

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
        overall: number;
        recent: number;
      };
    };
    errors: string[];
  }

  export let compact = false;

  let agents: AgentMetrics[] = [];
  let connected = false;
  let eventSource: EventSource | null = null;
  let expandedAgents: Set<string> = new Set();
  let bulkAction: 'stop' | 'restart' | null = null;
  let bulkFeedback: { type: 'success' | 'error'; text: string } | null = null;
  let feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  function formatTimestamp(ts?: string): string {
    if (!ts) return 'Never';
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  }

  function formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  async function runAgent(agentName: string) {
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName }),
      });
      if (!res.ok) throw new Error('Failed to run agent');
    } catch (err) {
      console.error('Error running agent:', err);
    }
  }

  function isAgentActive(agent: AgentMetrics): boolean {
    if (agent.status !== 'running') return false;
    if (!agent.lastActivity) return false;

    const lastActivity = new Date(agent.lastActivity).getTime();
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    return lastActivity > fiveMinutesAgo;
  }

  function sortAgentsByActivity(agentList: AgentMetrics[]): AgentMetrics[] {
    return [...agentList].sort((a, b) => {
      const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;

      if (bTime !== aTime) return bTime - aTime;
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (b.status === 'running' && a.status !== 'running') return 1;
      return a.name.localeCompare(b.name);
    });
  }

  function getActivitySparkline(agent: AgentMetrics): number[] {
    const metrics = agent.metrics.recentActivity;
    const last5m = metrics.last5m;
    const last1h = metrics.last1h;
    const buckets = new Array(12).fill(0);
    if (last5m > 0) buckets[11] = last5m;
    const remaining = last1h - last5m;
    if (remaining > 0) {
      const perBucket = remaining / 11;
      for (let i = 0; i < 11; i++) {
        buckets[i] = Math.ceil(perBucket * (1 - i * 0.1));
      }
    }
    return buckets;
  }

  function isService(agentName: string): boolean {
    // Only scheduler-service, boredom-service, and sleep-service are persistent services
    // managed by './bin/mh start'. Other agents (even if ending in -service like curiosity-service)
    // are scheduler-managed interval agents that CAN be manually triggered.
    const persistentServices = ['scheduler-service', 'boredom-service', 'sleep-service'];
    return persistentServices.includes(agentName);
  }

  const agentInfo: Record<string, { description: string; purpose: string }> = {
    'organizer': {
      description: 'Memory Enrichment Agent',
      purpose: 'Scans episodic memories and uses LLM to extract tags, entities, and metadata. Processes all users sequentially with isolated context.'
    },
    'reflector': {
      description: 'Contemplative Reflection Agent',
      purpose: 'Generates thoughtful reflections by building chains of associated memories. Considers entire lifetime of memories using weighted selection.'
    },
    'dreamer': {
      description: 'Dream Generation Agent',
      purpose: 'Creates surreal dream narratives from lifetime memory fragments using reflective exponential decay weighting. Runs during sleep hours.'
    },
    'boredom-service': {
      description: 'Mind Wandering Service',
      purpose: 'Triggers the reflector agent at configurable intervals based on boredom level. Manages reflection frequency.'
    },
    'sleep-service': {
      description: 'Nightly Pipeline Orchestrator',
      purpose: 'Orchestrates overnight processing: dream generation, audio transcription, and LoRA adapter training during idle sleep hours.'
    },
    'ingestor': {
      description: 'File Ingestion Agent',
      purpose: 'Converts raw files from memory/inbox into episodic memories. Chunks long content and archives processed files.'
    },
    'scheduler-service': {
      description: 'Agent Scheduler',
      purpose: 'Manages scheduled execution of autonomous agents based on time intervals and system conditions.'
    },
    'curator': {
      description: 'Memory Curator',
      purpose: 'Prepares and organizes memory context for conversations by selecting relevant memories and formatting them for LLM.'
    },
    'summarizer': {
      description: 'Memory Summarizer',
      purpose: 'Creates concise summaries of long conversations and memory sequences for efficient context management.'
    },
    'transcriber': {
      description: 'Audio Transcription Agent',
      purpose: 'Converts audio recordings to text using speech-to-text models. Processes audio backlog during overnight pipeline.'
    },
    'curiosity-service': {
      description: 'Curiosity Question Generator',
      purpose: 'Asks thoughtful questions during idle periods based on recent memories. Expires old unanswered questions after 7 days. Controlled by per-user curiosity.json config.'
    },
    'curiosity-answer-watcher': {
      description: 'Curiosity Answer Detector',
      purpose: 'Watches for episodic events with answerTo metadata and marks corresponding questions as answered. Runs every 5 minutes.'
    },
    'curiosity-researcher': {
      description: 'Curiosity Research Agent',
      purpose: 'Performs deeper research on curiosity questions by sampling related memories and running semantic searches. Processes one question per cycle (hourly).'
    }
  };

  function getAgentDescription(agentName: string): string {
    return agentInfo[agentName]?.description || 'Autonomous Agent';
  }

  function getAgentPurpose(agentName: string): string {
    return agentInfo[agentName]?.purpose || 'Performs automated background tasks for the MetaHuman OS system.';
  }

  function toggleExpand(agentName: string) {
    if (expandedAgents.has(agentName)) {
      expandedAgents.delete(agentName);
    } else {
      expandedAgents.add(agentName);
    }
    expandedAgents = expandedAgents;
  }

  async function handleBulkAction(action: 'stop-all' | 'restart-core') {
    bulkAction = action === 'stop-all' ? 'stop' : 'restart';
    bulkFeedback = null;

    try {
      const res = await fetch('/api/agents/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) throw new Error('Bulk action failed');

      const result = await res.json();
      bulkFeedback = {
        type: 'success',
        text: result.message || `${action === 'stop-all' ? 'Stopped' : 'Restarted'} successfully`,
      };
    } catch (err) {
      bulkFeedback = {
        type: 'error',
        text: err instanceof Error ? err.message : 'Action failed',
      };
    } finally {
      bulkAction = null;
      if (feedbackTimeout) clearTimeout(feedbackTimeout);
      feedbackTimeout = setTimeout(() => {
        bulkFeedback = null;
      }, 3000);
    }
  }

  onMount(() => {
    eventSource = new EventSource('/api/monitor/stream');

    eventSource.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
          connected = true;
        } else if (data.type === 'metrics') {
          agents = sortAgentsByActivity(data.agents || []);
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    });

    eventSource.addEventListener('error', () => {
      connected = false;
    });
  });

  onDestroy(() => {
    if (eventSource) {
      eventSource.close();
    }
    if (feedbackTimeout) {
      clearTimeout(feedbackTimeout);
    }
  });
</script>

<div class="agent-monitor-container" class:compact>
  <!-- Compact Header -->
  <div class="agent-monitor-header">
    <div class="flex items-center gap-1.5 text-[0.7rem] font-medium">
      <span class="agent-status-dot" class:connected></span>
      <span class="text-gray-500 dark:text-gray-400" class:text-green-500={connected} class:dark:text-green-300={connected}>
        {connected ? 'Live' : 'Connecting...'}
      </span>
    </div>

    {#if $sleepStatus}
      <div class="flex items-center gap-1.5 text-[0.7rem] font-medium px-2 py-1 rounded-md bg-black/[0.03] dark:bg-white/[0.03]">
        <span class="text-sm leading-none">{$sleepStatus.status === 'awake' ? '☀️' : $sleepStatus.status === 'sleeping' ? '😴' : '🌙'}</span>
        <span class="text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {$sleepStatus.status === 'awake' ? 'Awake' : $sleepStatus.status === 'sleeping' ? 'Sleeping' : 'Dreaming'}
        </span>
      </div>
    {/if}

    <div class="flex gap-1.5 ml-auto">
      <button
        class="px-2 py-1 rounded-md border text-[0.7rem] font-semibold cursor-pointer transition-all whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
        class:border-red-600={!bulkAction}
        class:bg-red-600={!bulkAction}
        class:text-white={!bulkAction}
        class:hover:bg-red-700={!bulkAction}
        disabled={bulkAction === 'stop'}
        on:click={() => handleBulkAction('stop-all')}
        title="Stop All Services"
      >
        {bulkAction === 'stop' ? 'Stopping…' : 'Stop All'}
      </button>
      <button
        class="px-2 py-1 rounded-md border border-blue-600/40 bg-blue-600/8 text-blue-700 dark:bg-blue-600/15 dark:text-blue-300 text-[0.7rem] font-semibold cursor-pointer transition-all whitespace-nowrap hover:bg-blue-600/15 disabled:opacity-60 disabled:cursor-not-allowed"
        disabled={bulkAction === 'restart'}
        on:click={() => handleBulkAction('restart-core')}
        title="Restart Core Services"
      >
        {bulkAction === 'restart' ? 'Restarting…' : 'Restart'}
      </button>
    </div>
  </div>

  {#if bulkFeedback}
    <div
      class="text-[0.7rem] px-2 py-1.5 rounded-md transition-all"
      class:bg-green-600={bulkFeedback.type === 'success'}
      class:text-white={bulkFeedback.type === 'success'}
      class:bg-red-600={bulkFeedback.type === 'error'}
    >
      {bulkFeedback.text}
    </div>
  {/if}

  <!-- Agent List -->
  {#if agents.length === 0}
    <div class="py-8 px-4 text-center text-gray-500 dark:text-gray-400 text-sm">
      No agents available
    </div>
  {:else}
    <div class="flex flex-col gap-3 overflow-y-auto">
      {#each agents as agent}
        {@const isExpanded = expandedAgents.has(agent.name)}
        <div class="agent-card" class:running={agent.status === 'running'} class:error={agent.status === 'error'} class:active={isAgentActive(agent)}>
          <!-- Corner Expand Toggle -->
          <button
            class="agent-expand-toggle"
            class:running={agent.status === 'running'}
            class:error={agent.status === 'error'}
            class:active={isAgentActive(agent)}
            on:click={() => toggleExpand(agent.name)}
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            <svg
              class="w-3 h-3 transition-transform duration-200"
              class:rotate-180={isExpanded}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 16 16"
            >
              <path d="M4 6l4 4 4-4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <!-- Header -->
          <div class="flex justify-between items-center mb-2 pr-8">
            <div class="flex items-center gap-2 flex-1">
              <span class="text-sm font-semibold">{agent.name}</span>

              <!-- Unified Status/Action Button -->
              {#if isService(agent.name)}
                <span
                  class="agent-action-btn"
                  class:running={agent.status === 'running'}
                  class:error={agent.status === 'error'}
                  class:active={isAgentActive(agent)}
                  title="Service (managed by 'mh start')"
                >
                  {agent.status === 'error' ? '⚠' : agent.status === 'running' ? (isAgentActive(agent) ? '●' : '⏸') : '○'}
                </span>
              {:else}
                <button
                  class="agent-action-btn"
                  class:running={agent.status === 'running'}
                  class:error={agent.status === 'error'}
                  class:active={isAgentActive(agent)}
                  on:click={() => runAgent(agent.name)}
                  title={agent.status === 'error' ? 'Error - click to retry' : agent.status === 'running' ? 'Running - click to stop' : 'Stopped - click to start'}
                >
                  {agent.status === 'error' ? '⚠' : agent.status === 'running' ? (isAgentActive(agent) ? '⏹' : '⏸') : '▶'}
                </button>
              {/if}
            </div>
          </div>

          <!-- Expanded Details -->
          {#if isExpanded}
            <div class="text-xs font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wide mb-2 py-1">
              {getAgentDescription(agent.name)}
            </div>

            <div class="text-xs leading-relaxed text-gray-500 dark:text-gray-400 px-3 py-2 mb-3 rounded-md border-l-2 border-violet-600/30 dark:border-violet-400/40 bg-black/[0.02] dark:bg-white/[0.02]">
              {getAgentPurpose(agent.name)}
            </div>

            {#if !compact}
              <div class="flex flex-col gap-1 mb-2 p-2 rounded-md bg-black/[0.03] dark:bg-white/[0.03]">
                <div class="flex justify-between text-xs">
                  <span class="text-gray-500 dark:text-gray-400 font-medium">Status:</span>
                  <span
                    class="font-semibold"
                    class:text-green-600={agent.status === 'running'}
                    class:dark:text-green-300={agent.status === 'running'}
                    class:text-red-600={agent.status === 'error'}
                    class:dark:text-red-300={agent.status === 'error'}
                  >
                    {agent.status}
                  </span>
                </div>
                {#if agent.pid}
                  <div class="flex justify-between text-xs">
                    <span class="text-gray-500 dark:text-gray-400 font-medium">PID:</span>
                    <span class="font-semibold text-gray-900 dark:text-gray-100">{agent.pid}</span>
                  </div>
                {/if}
                {#if agent.uptime}
                  <div class="flex justify-between text-xs">
                    <span class="text-gray-500 dark:text-gray-400 font-medium">Uptime:</span>
                    <span class="font-semibold text-gray-900 dark:text-gray-100">{formatUptime(agent.uptime)}</span>
                  </div>
                {/if}
                <div class="flex justify-between text-xs">
                  <span class="text-gray-500 dark:text-gray-400 font-medium">Last Activity:</span>
                  <span class="font-semibold text-gray-900 dark:text-gray-100">{formatTimestamp(agent.lastActivity)}</span>
                </div>
              </div>
            {/if}

            {#if !compact}
              {@const sparkline = getActivitySparkline(agent)}
              {@const maxValue = Math.max(...sparkline, 1)}
              <div class="mt-3 p-3 rounded-md border bg-black/[0.02] dark:bg-white/[0.02] border-black/[0.05] dark:border-white/[0.05]">
                <div class="flex justify-between items-center mb-2">
                  <span class="text-[0.7rem] font-semibold text-gray-500 dark:text-gray-400">Activity (last hour)</span>
                  <span class="text-[0.7rem] font-medium text-violet-600 dark:text-violet-400">{agent.metrics.recentActivity.last1h} runs</span>
                </div>
                <div class="agent-sparkline">
                  {#each sparkline as value, i}
                    <div
                      class="agent-sparkline-bar"
                      class:active={i === sparkline.length - 1 && value > 0}
                      style="height: {value > 0 ? (value / maxValue) * 100 : 2}%"
                      title="{value} runs ({60 - (11 - i) * 5}m ago)"
                    ></div>
                  {/each}
                </div>
              </div>
            {/if}

            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="flex justify-between">
                <span class="text-gray-500 dark:text-gray-400">Recent (5m):</span>
                <span class="font-semibold text-gray-900 dark:text-gray-100">{agent.metrics.recentActivity.last5m} {isService(agent.name) ? 'triggers' : 'runs'}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-500 dark:text-gray-400">Last Hour:</span>
                <span class="font-semibold text-gray-900 dark:text-gray-100">{agent.metrics.recentActivity.last1h} {isService(agent.name) ? 'triggers' : 'runs'}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-500 dark:text-gray-400">Today:</span>
                <span class="font-semibold text-gray-900 dark:text-gray-100">{agent.metrics.recentActivity.today} {isService(agent.name) ? 'triggers' : 'runs'}</span>
              </div>
              {#if !isService(agent.name) && agent.metrics.totalRuns > 0}
                <div class="flex justify-between">
                  <span class="text-gray-500 dark:text-gray-400">Lifetime:</span>
                  <span class="font-semibold text-gray-900 dark:text-gray-100">{agent.metrics.totalRuns} runs</span>
                </div>
              {/if}
            </div>

            {#if !isService(agent.name) && agent.metrics.failedRuns > 0}
              <div class="flex items-center gap-2 mt-3 px-3 py-2 rounded-md border text-[0.7rem] bg-yellow-600/8 border-yellow-600/25 dark:bg-yellow-600/12 dark:border-yellow-600/35">
                <span class="text-sm leading-none">⚠️</span>
                <span class="flex-1 text-yellow-800 dark:text-yellow-200">
                  {agent.metrics.failedRuns} failed run{agent.metrics.failedRuns === 1 ? '' : 's'} out of {agent.metrics.totalRuns} total
                  ({agent.metrics.successRate.overall}% success rate)
                </span>
              </div>
            {/if}

            {#if !compact && agent.errors.length > 0}
              <div class="mt-2 p-2 rounded-md border bg-red-600/5 border-red-600/20 dark:bg-red-600/10 dark:border-red-600/25">
                <div class="text-[0.7rem] font-semibold text-red-700 dark:text-red-300 mb-1">Recent Errors:</div>
                {#each agent.errors as error}
                  <div class="text-[0.7rem] text-gray-500 dark:text-gray-400 mt-1 pl-2 border-l-2 border-red-600/30 dark:border-red-400/30">
                    {error}
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
