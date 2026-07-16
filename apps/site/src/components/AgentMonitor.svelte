<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import { connectionPool, ConnectionPriority, type ConnectionHandle } from '../lib/client/connection-pool';

  type AgentKind = 'service' | 'scheduled' | 'manual' | 'connection' | 'one-shot';
  type AgentStatus = 'running' | 'stopped' | 'error';
  type AgentVariableType = 'text' | 'number' | 'port' | 'url' | 'select' | 'multiselect' | 'toggle' | 'secretRef' | 'readonly';
  type AgentVariableApplyMode = 'live' | 'restart' | 'nextBoot' | 'readonly';

  interface AgentLog {
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    agent: string;
  }

  interface AgentError {
    timestamp: string;
    agent: string;
    message: string;
    source?: string;
    pid?: number;
    exitCode?: number | null;
    stderr?: string;
    stdout?: string;
  }

  interface AgentMetrics {
    agent: string;
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
  }

  interface AgentVariable {
    key: string;
    label: string;
    type: AgentVariableType;
    value: string | number | boolean | string[] | null;
    applyMode: AgentVariableApplyMode;
    writable: boolean;
    description?: string;
    options?: string[];
  }

  interface AgentDescriptor {
    id: string;
    name: string;
    description: string;
    kind: AgentKind;
    startable: boolean;
    bootEligible: boolean;
    variables: AgentVariable[];
  }

  interface AgentCard {
    name: string;
    displayName: string;
    description: string;
    kind: AgentKind;
    status: AgentStatus;
    pid?: number;
    uptime?: number;
    startedAt?: string;
    lastActivity?: string;
    metrics: AgentMetrics;
    errors: string[];
  }

  interface AgentDataPanel {
    agentId: string;
    displayName: string;
    description: string;
    kind: AgentKind;
    lifecycle: AgentStatus;
    pid?: number;
    uptime?: number;
    readiness: 'ready' | 'not-ready' | 'failed' | 'unknown';
    dependencyHealth: 'ok' | 'configured' | 'connecting' | 'missing' | 'unavailable' | 'failed' | 'unknown';
    latestTask?: string;
    variables: AgentVariable[];
    logs: AgentLog[];
    errors: AgentError[];
  }

  let connected = false;
  let eventSourceHandle: ConnectionHandle | null = null;
  let runningAgents: AgentCard[] = [];
  let recentCompletions: AgentCard[] = [];
  let recentFailures: AgentCard[] = [];
  let startableAgents: AgentDescriptor[] = [];
  let agentData: Record<string, AgentDataPanel> = {};
  let selectedAgentName = '';
  let selectedStartAgent = '';
  let startingAgent = '';
  let controllingAgent = '';
  let refreshing = false;
  let savingField = '';
  let fieldDrafts: Record<string, string | number | boolean | string[] | null> = {};
  let bulkAction: 'stop' | 'restart' | null = null;
  let feedback: { type: 'success' | 'error' | 'info'; text: string } | null = null;
  let feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  $: visibleAgents = runningAgents;
  $: selectedAgent = selectedAgentName ? agentData[selectedAgentName] : undefined;
  $: selectedAgentStartable = Boolean(selectedAgent && startableAgents.some(agent => agent.id === selectedAgent.agentId));
  $: if (!selectedAgentName) {
    selectedAgentName = visibleAgents[0]?.name || recentFailures[0]?.name || recentCompletions[0]?.name || startableAgents[0]?.id || '';
  }
  $: if (!selectedStartAgent || !startableAgents.some(agent => agent.id === selectedStartAgent)) {
    selectedStartAgent = startableAgents[0]?.id || '';
  }

  function showFeedback(type: 'success' | 'error' | 'info', text: string) {
    feedback = { type, text };
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    feedbackTimeout = setTimeout(() => {
      feedback = null;
    }, 4500);
  }

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

  function formatUptime(seconds?: number): string {
    if (!seconds) return '0m';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function fieldKey(agentId: string, key: string): string {
    return `${agentId}.${key}`;
  }

  function draftValue(agentId: string, variable: AgentVariable) {
    const key = fieldKey(agentId, variable.key);
    return fieldDrafts[key] ?? variable.value ?? '';
  }

  function setDraftValue(agentId: string, variable: AgentVariable, value: string | number | boolean | string[] | null) {
    fieldDrafts = {
      ...fieldDrafts,
      [fieldKey(agentId, variable.key)]: value,
    };
  }

  function applyModeLabel(mode: AgentVariableApplyMode): string {
    if (mode === 'live') return 'Live';
    if (mode === 'restart') return 'Restart';
    if (mode === 'nextBoot') return 'Next boot';
    return 'Read only';
  }

  function liveLabelClass(): string {
    return connected ? 'text-green-500 dark:text-green-300' : 'text-gray-500 dark:text-gray-400';
  }

  function feedbackClass(): string {
    if (!feedback) return '';
    if (feedback.type === 'success') return 'bg-green-600 text-white border-green-600';
    if (feedback.type === 'error') return 'bg-red-600 text-white border-red-600';
    return 'bg-blue-600 text-white border-blue-600';
  }

  function lifecycleClass(lifecycle: AgentStatus): string {
    if (lifecycle === 'running') return 'bg-green-600 text-white';
    if (lifecycle === 'error') return 'bg-red-600 text-white';
    return 'bg-gray-200 dark:bg-gray-800';
  }

  function readinessClass(readiness: AgentDataPanel['readiness']): string {
    if (readiness === 'ready') return 'bg-green-600 text-white';
    if (readiness === 'failed') return 'bg-red-600 text-white';
    if (readiness === 'not-ready') return 'bg-amber-500 text-gray-950';
    return 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-200';
  }

  function readinessDot(readiness?: AgentDataPanel['readiness']): string {
    if (readiness === 'ready') return 'bg-green-500';
    if (readiness === 'failed') return 'bg-red-500';
    if (readiness === 'not-ready') return 'bg-amber-500';
    return 'bg-gray-400';
  }

  function logLineClass(level: AgentLog['level']): string {
    return level === 'error' ? 'text-red-600 dark:text-red-300' : '';
  }

  function errorSourceLabel(error: AgentError): string {
    const parts = [
      error.source,
      error.exitCode !== undefined && error.exitCode !== null ? `exit ${error.exitCode}` : undefined,
      error.pid ? `pid ${error.pid}` : undefined,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' / ') : 'error';
  }

  function initializeDrafts(data: Record<string, AgentDataPanel>) {
    const next = { ...fieldDrafts };
    for (const panel of Object.values(data)) {
      for (const variable of panel.variables) {
        const key = fieldKey(panel.agentId, variable.key);
        if (next[key] === undefined) {
          next[key] = variable.value;
        }
      }
    }
    fieldDrafts = next;
  }

  function applyPayload(data: any) {
    runningAgents = data.runningAgents || data.agents || [];
    recentCompletions = data.recentCompletions || [];
    recentFailures = data.recentFailures || [];
    startableAgents = data.startableAgents || [];
    agentData = data.agentData || {};
    initializeDrafts(agentData);
  }

  async function refreshSnapshot() {
    const res = await apiFetch('/api/monitor');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to refresh Agent Monitor');
    applyPayload(data);
  }

  async function refreshNow() {
    refreshing = true;
    try {
      await refreshSnapshot();
    } catch (err) {
      showFeedback('error', err instanceof Error ? err.message : 'Monitor refresh failed');
    } finally {
      refreshing = false;
    }
  }

  async function runAgent(agentName = selectedStartAgent) {
    if (!agentName) return;
    startingAgent = agentName;
    showFeedback('info', `Starting ${agentName}...`);
    const controller = new AbortController();
    const requestTimeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await apiFetch('/api/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentName }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || data.message || 'Failed to run agent');
      }
      selectedAgentName = agentName;
      await refreshSnapshot();
      showFeedback('success', data.taskId
        ? `${agentName} queued as ${data.taskId}`
        : data.pid
          ? `${agentName} started with PID ${data.pid}`
          : `${agentName} start requested`);
    } catch (err) {
      const message = err instanceof DOMException && err.name === 'AbortError'
        ? 'Start request timed out. Monitor refresh will continue; retry when the process state settles.'
        : err instanceof Error ? err.message : 'Agent start failed';
      showFeedback('error', message);
      await refreshSnapshot().catch(() => {});
    } finally {
      clearTimeout(requestTimeout);
      startingAgent = '';
    }
  }

  async function controlAgent(action: 'stop' | 'restart' | 'clear-failure', agentName: string) {
    controllingAgent = agentName;
    try {
      const res = await apiFetch('/api/agents/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, agent: agentName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.message || data.error || `Failed to ${action} ${agentName}`);
      }
      await refreshSnapshot();
      showFeedback('success', data.message || `${agentName} ${action} complete`);
    } catch (err) {
      showFeedback('error', err instanceof Error ? err.message : `Failed to ${action} agent`);
      await refreshSnapshot().catch(() => {});
    } finally {
      controllingAgent = '';
    }
  }

  async function saveVariable(panel: AgentDataPanel, variable: AgentVariable) {
    if (!variable.writable) return;
    const key = fieldKey(panel.agentId, variable.key);
    savingField = key;

    try {
      const res = await apiFetch('/api/monitor/agent-variable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: panel.agentId,
          key: variable.key,
          value: draftValue(panel.agentId, variable),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || 'Failed to save variable');
      }
      if (data.agentData) {
        agentData = {
          ...agentData,
          [panel.agentId]: data.agentData,
        };
        initializeDrafts(agentData);
      }
      showFeedback('success', `${variable.label} saved (${applyModeLabel(variable.applyMode)})`);
    } catch (err) {
      showFeedback('error', err instanceof Error ? err.message : 'Variable save failed');
    } finally {
      savingField = '';
    }
  }

  async function handleBulkAction(action: 'stop-all' | 'restart-core') {
    bulkAction = action === 'stop-all' ? 'stop' : 'restart';

    try {
      const res = await apiFetch('/api/agents/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.success === false) throw new Error(result.message || 'Bulk action failed');
      await refreshSnapshot();
      showFeedback('success', result.message || `${action === 'stop-all' ? 'Stopped' : 'Restarted'} successfully`);
    } catch (err) {
      showFeedback('error', err instanceof Error ? err.message : 'Action failed');
      await refreshSnapshot().catch(() => {});
    } finally {
      bulkAction = null;
    }
  }

  onMount(async () => {
    eventSourceHandle = connectionPool.request({
      id: 'agent-monitor-stream',
      name: 'Agent Monitor Stream',
      url: '/api/monitor/stream',
      priority: ConnectionPriority.MEDIUM,
      viewDependency: 'chat',
      defer: true,
      onOpen: () => {
        connected = true;
      },
      onClose: () => {
        connected = false;
      },
      onMessage: (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connected') {
            connected = true;
          } else if (data.type === 'snapshot' || data.type === 'metrics') {
            applyPayload(data);
          }
        } catch (err) {
          console.error('[AgentMonitor] Failed to parse SSE event:', err, 'Event data:', event.data);
        }
      },
      onError: () => {
        connected = false;
        void refreshSnapshot().catch(() => {});
      },
    });

    try {
      await refreshSnapshot();
    } catch {
      // The SSE connection will surface live state when available.
    }
  });

  onDestroy(() => {
    eventSourceHandle?.close();
    eventSourceHandle = null;
    if (feedbackTimeout) {
      clearTimeout(feedbackTimeout);
    }
  });
</script>

<div class="flex h-full min-h-0 flex-col gap-3 text-gray-900 dark:text-gray-100">
    <div class="shrink-0 border-b border-gray-200 pb-3 dark:border-gray-800">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm font-semibold">Services & Agents</div>
          <div class="mt-1 flex flex-wrap items-center gap-2 text-[0.7rem] text-gray-500 dark:text-gray-400">
            <span class="inline-flex items-center gap-1.5">
              <span class={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'}`}></span>
              {connected ? 'Live stream' : 'Connecting'}
            </span>
            <span>{visibleAgents.length} active</span>
            {#if recentCompletions.length > 0}
              <span>{recentCompletions.length} completed</span>
            {/if}
            {#if recentFailures.length > 0}
              <span class="text-red-600 dark:text-red-300">{recentFailures.length} failed</span>
            {/if}
          </div>
        </div>
        <div class="flex shrink-0 gap-1.5">
          <button
            class="rounded border border-gray-300 px-2 py-1 text-[0.68rem] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
            disabled={refreshing}
            on:click={refreshNow}
            title="Refresh service, connection, and agent state now"
          >
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
          <button
            class="rounded border border-gray-300 px-2 py-1 text-[0.68rem] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
            disabled={bulkAction === 'restart'}
            on:click={() => handleBulkAction('restart-core')}
            title="Restart configured startup agents"
          >
            {bulkAction === 'restart' ? 'Restarting' : 'Restart Boot Agents'}
          </button>
        </div>
      </div>

      <div class="mt-3">
        <div class="mb-1 text-[0.68rem] font-semibold uppercase text-gray-500 dark:text-gray-400">Start Agent</div>
        <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <select
          bind:value={selectedStartAgent}
          class="min-w-0 rounded border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
          disabled={startableAgents.length === 0}
          aria-label="Startable agent"
        >
          {#if startableAgents.length === 0}
            <option value="">No agents available</option>
          {:else}
            {#each startableAgents as agent}
              <option value={agent.id}>{agent.name}</option>
            {/each}
          {/if}
        </select>
        <button
          class="rounded bg-gray-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-100 dark:text-gray-950"
          disabled={!selectedStartAgent || Boolean(startingAgent)}
          on:click={() => runAgent()}
        >
          {startingAgent ? 'Starting' : 'Start'}
        </button>
        </div>
      </div>

      {#if feedback}
        <div class={`mt-2 rounded border px-2 py-1.5 text-xs ${feedbackClass()}`}>
          {feedback.text}
        </div>
      {/if}
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pr-1">
      <section class="space-y-2">
        <div class="flex items-center justify-between">
          <h3 class="m-0 text-[0.68rem] font-semibold uppercase text-gray-500 dark:text-gray-400">Active Services & Agents</h3>
          <span class="text-[0.68rem] text-gray-500 dark:text-gray-400">{visibleAgents.length}</span>
        </div>

        {#if visibleAgents.length === 0}
          <button
            class="w-full rounded border border-dashed border-gray-300 px-3 py-4 text-left text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
            on:click={() => selectedAgentName = selectedStartAgent}
          >
            No agents are running. Use Start to launch an available agent.
          </button>
        {:else}
          <div class="space-y-1.5">
            {#each visibleAgents as agent}
              {@const readiness = agentData[agent.name]?.readiness}
              <button
                class={`w-full rounded border px-2.5 py-2 text-left transition ${selectedAgentName === agent.name ? 'border-gray-900 bg-gray-100 dark:border-gray-100 dark:bg-gray-900' : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900'}`}
                on:click={() => selectedAgentName = agent.name}
              >
                <div class="flex items-center gap-2">
                  <span class={`h-2.5 w-2.5 rounded-full ${readinessDot(readiness)}`}></span>
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">{agent.displayName}</span>
                  <span class="shrink-0 font-mono text-[0.68rem] text-gray-500 dark:text-gray-400">{agent.pid ?? (agent.kind === 'connection' ? 'connection' : 'integrated')}</span>
                </div>
                <div class="mt-1 flex items-center justify-between gap-2 text-[0.68rem] text-gray-500 dark:text-gray-400">
                  <span class="truncate">{agent.kind}</span>
                  <span>{agent.pid ? formatUptime(agent.uptime) : readiness ?? 'unknown'}</span>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </section>

      {#if recentCompletions.length > 0}
        <section class="mt-4 space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="m-0 text-[0.68rem] font-semibold uppercase text-gray-500 dark:text-gray-400">Completed One-Shot Runs</h3>
            <span class="text-[0.68rem] text-gray-500 dark:text-gray-400">{recentCompletions.length}</span>
          </div>
          <div class="space-y-1.5">
            {#each recentCompletions as agent}
              <button
                class={`w-full rounded border px-2.5 py-2 text-left transition ${selectedAgentName === agent.name ? 'border-emerald-600 bg-emerald-50 dark:border-emerald-400 dark:bg-emerald-950/30' : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900'}`}
                on:click={() => selectedAgentName = agent.name}
              >
                <div class="flex items-center gap-2">
                  <span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">{agent.displayName}</span>
                  <span class="shrink-0 text-[0.68rem] font-semibold uppercase text-emerald-700 dark:text-emerald-300">completed</span>
                </div>
                <div class="mt-1 flex items-center justify-between gap-2 text-[0.68rem] text-gray-500 dark:text-gray-400">
                  <span>{agent.metrics.successfulRuns} successful run{agent.metrics.successfulRuns === 1 ? '' : 's'} today</span>
                  <span>{formatTimestamp(agent.lastActivity || agent.metrics.lastRun)}</span>
                </div>
              </button>
            {/each}
          </div>
        </section>
      {/if}

      {#if recentFailures.length > 0}
        <section class="mt-4 space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="m-0 text-[0.68rem] font-semibold uppercase text-red-700 dark:text-red-300">Failures</h3>
            <span class="text-[0.68rem] text-red-700 dark:text-red-300">{recentFailures.length}</span>
          </div>
          <div class="space-y-1.5">
            {#each recentFailures as agent}
              <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                <button
                  class={`min-w-0 rounded border px-2.5 py-2 text-left transition ${selectedAgentName === agent.name ? 'border-red-500 bg-red-50 dark:bg-red-950/30' : 'border-red-200 bg-red-50/60 hover:bg-red-50 dark:border-red-900/60 dark:bg-red-950/20'}`}
                  on:click={() => selectedAgentName = agent.name}
                >
                  <div class="flex items-center gap-2">
                    <span class="h-2.5 w-2.5 rounded-full bg-red-500"></span>
                    <span class="min-w-0 flex-1 truncate text-sm font-medium">{agent.displayName}</span>
                    <span class="shrink-0 text-[0.68rem] font-semibold uppercase text-red-700 dark:text-red-300">error</span>
                  </div>
                  <div class="mt-1 truncate text-[0.68rem] text-red-700 dark:text-red-300">{agent.metrics.lastError || 'Start failed'}</div>
                </button>
                <button
                  class="rounded border border-red-300 px-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950/30"
                  disabled={Boolean(startingAgent) || controllingAgent === agent.name}
                  on:click={() => runAgent(agent.name)}
                  title={`Retry ${agent.displayName}`}
                >
                  {startingAgent === agent.name ? 'Starting' : 'Retry'}
                </button>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <section class="mt-4 space-y-2">
        <div class="flex items-center justify-between">
          <h3 class="m-0 text-[0.68rem] font-semibold uppercase text-gray-500 dark:text-gray-400">Agent Data</h3>
          {#if selectedAgent}
            <span class={`rounded px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase ${selectedAgent.kind === 'connection' ? readinessClass(selectedAgent.readiness) : lifecycleClass(selectedAgent.lifecycle)}`}>{selectedAgent.kind === 'connection' ? selectedAgent.readiness : selectedAgent.lifecycle}</span>
          {/if}
        </div>

        {#if !selectedAgent}
          <div class="rounded border border-gray-200 px-3 py-4 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            Select a running, failed, or startable agent to inspect variables and output.
          </div>
        {:else}
          <div class="space-y-3 rounded border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
            <div>
              <div class="truncate text-sm font-semibold">{selectedAgent.displayName}</div>
              <div class="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{selectedAgent.description}</div>
            </div>

            <div class="flex flex-wrap gap-2">
              {#if selectedAgent.lifecycle === 'running' && selectedAgentStartable}
                <button
                  class="rounded border border-gray-300 px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700"
                  disabled={Boolean(controllingAgent) || Boolean(startingAgent)}
                  on:click={() => controlAgent('stop', selectedAgent.agentId)}
                >
                  {controllingAgent === selectedAgent.agentId ? 'Stopping' : 'Stop'}
                </button>
                <button
                  class="rounded bg-gray-900 px-2 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-100 dark:text-gray-950"
                  disabled={Boolean(controllingAgent) || Boolean(startingAgent)}
                  on:click={() => controlAgent('restart', selectedAgent.agentId)}
                >
                  {controllingAgent === selectedAgent.agentId ? 'Restarting' : 'Restart'}
                </button>
              {:else if selectedAgentStartable}
                <button
                  class="rounded bg-gray-900 px-2 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-100 dark:text-gray-950"
                  disabled={Boolean(startingAgent) || Boolean(controllingAgent)}
                  on:click={() => runAgent(selectedAgent.agentId)}
                >
                  {startingAgent === selectedAgent.agentId ? 'Starting' : selectedAgent.lifecycle === 'error' ? 'Retry' : 'Start'}
                </button>
              {/if}
              {#if selectedAgent.lifecycle === 'error'}
                <button
                  class="rounded border border-gray-300 px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700"
                  disabled={Boolean(controllingAgent) || Boolean(startingAgent)}
                  on:click={() => controlAgent('clear-failure', selectedAgent.agentId)}
                >
                  Dismiss Failure
                </button>
              {/if}
            </div>

            <div class="grid grid-cols-3 gap-2 text-xs">
              <div class="rounded bg-gray-50 p-2 dark:bg-gray-900">
                <div class="text-[0.62rem] uppercase text-gray-500 dark:text-gray-400">Runtime</div>
                <div class="mt-0.5 font-mono">{selectedAgent.pid ?? (selectedAgent.kind === 'connection' ? 'server' : 'none')}</div>
              </div>
              <div class="rounded bg-gray-50 p-2 dark:bg-gray-900">
                <div class="text-[0.62rem] uppercase text-gray-500 dark:text-gray-400">Ready</div>
                <div class="mt-0.5">{selectedAgent.readiness}</div>
              </div>
              <div class="rounded bg-gray-50 p-2 dark:bg-gray-900">
                <div class="text-[0.62rem] uppercase text-gray-500 dark:text-gray-400">Dependency</div>
                <div class="mt-0.5">{selectedAgent.dependencyHealth}</div>
              </div>
            </div>

            {#if selectedAgent.latestTask}
              <div class="rounded bg-gray-50 px-2 py-2 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                {selectedAgent.latestTask}
              </div>
            {/if}

            {#if selectedAgent.variables.length > 0}
              <div class="space-y-2">
                <div class="text-[0.68rem] font-semibold uppercase text-gray-500 dark:text-gray-400">Variables</div>
                {#each selectedAgent.variables as variable}
                  {@const key = fieldKey(selectedAgent.agentId, variable.key)}
                  {#if variable.writable}
                    <div class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                      <label class="min-w-0">
                        <span class="block truncate text-[0.7rem] font-medium text-gray-600 dark:text-gray-300">{variable.label}</span>
                        {#if variable.type === 'toggle'}
                          <input
                            type="checkbox"
                            checked={Boolean(draftValue(selectedAgent.agentId, variable))}
                            on:change={(event) => setDraftValue(selectedAgent.agentId, variable, event.currentTarget.checked)}
                            class="mt-1 h-4 w-4 accent-gray-900 dark:accent-gray-100"
                          />
                        {:else}
                          <input
                            type={variable.type === 'number' || variable.type === 'port' ? 'number' : variable.type === 'url' ? 'url' : 'text'}
                            value={String(draftValue(selectedAgent.agentId, variable) ?? '')}
                            on:input={(event) => setDraftValue(selectedAgent.agentId, variable, variable.type === 'number' || variable.type === 'port' ? Number(event.currentTarget.value) : event.currentTarget.value)}
                            class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                          />
                        {/if}
                        <span class="mt-1 block text-[0.62rem] text-gray-500 dark:text-gray-500">{applyModeLabel(variable.applyMode)}</span>
                      </label>
                      <button
                        class="rounded border border-gray-300 px-2 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700"
                        disabled={savingField === key}
                        on:click={() => selectedAgent && saveVariable(selectedAgent, variable)}
                      >
                        {savingField === key ? 'Saving' : 'Save'}
                      </button>
                    </div>
                  {:else}
                    <div class="min-w-0">
                      <span class="block truncate text-[0.7rem] font-medium text-gray-600 dark:text-gray-300">{variable.label}</span>
                      <span class="mt-1 block min-h-8 break-words rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200">{String(variable.value ?? '')}</span>
                      <span class="mt-1 block text-[0.62rem] text-gray-500 dark:text-gray-500">{applyModeLabel(variable.applyMode)}</span>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}

            {#if selectedAgent.errors.length > 0}
              <div class="rounded border border-red-200 bg-red-50 p-2 dark:border-red-900/60 dark:bg-red-950/20">
                <div class="text-[0.68rem] font-semibold uppercase text-red-700 dark:text-red-300">Latest Error</div>
                {#each selectedAgent.errors.slice(-1) as latestError}
                  <div class="mt-1 text-xs font-medium text-red-800 dark:text-red-200">{latestError.message}</div>
                  {#if latestError.stderr}
                    <pre class="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded bg-white/70 p-2 font-mono text-[0.65rem] text-red-700 dark:bg-black/20 dark:text-red-200">{latestError.stderr}</pre>
                  {/if}
                {/each}
              </div>
            {/if}

            <div>
              <div class="mb-1 flex items-center justify-between text-[0.68rem] font-semibold uppercase text-gray-500 dark:text-gray-400">
                <span>Task Log</span>
                <span>{selectedAgent.logs.length}</span>
              </div>
              {#if selectedAgent.logs.length === 0}
                <div class="rounded bg-gray-50 px-2 py-2 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">No task output recorded today.</div>
              {:else}
                <div class="max-h-36 overflow-y-auto rounded bg-gray-50 px-2 py-1 font-mono text-[0.65rem] leading-relaxed dark:bg-gray-900">
                  {#each selectedAgent.logs.slice(-12) as log}
                    <div class={`border-b border-gray-200 py-1 last:border-b-0 dark:border-gray-800 ${logLineClass(log.level)}`}>
                      <span class="text-gray-500">{formatTimestamp(log.timestamp)}</span>
                      <span>{log.message}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </section>
    </div>
</div>
