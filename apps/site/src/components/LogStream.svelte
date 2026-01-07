<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { clearAuditStreamTrigger } from '../stores/clear-events';
  import { apiFetch } from '../lib/client/api-config';

  interface LogEntry {
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    category: string;
    event: string;
    actor: string;
    details?: any;
  }

  let logs: LogEntry[] = [];
  let connectionStatus = 'Ready';
  let logContainer: HTMLDivElement;
  let autoScroll = true;
  let bottomSentinel: HTMLDivElement;
  let observer: IntersectionObserver | null = null;
  let isLoading = false;
  let lastLoadTime: string | null = null;

  const MAX_LOGS = 500;

  let contextMenu: { x: number; y: number; log?: LogEntry } | null = null;
  let levelFilter: 'all' | 'error' | 'warn' | 'info' = 'all';

  $: if (logs.length > 0 && autoScroll && bottomSentinel) {
    requestAnimationFrame(() => {
      bottomSentinel?.scrollIntoView({ block: 'end', inline: 'nearest' });
    });
  }

  async function loadLogs() {
    if (isLoading) return;
    isLoading = true;
    connectionStatus = 'Loading...';

    try {
      const today = new Date().toISOString().slice(0, 10);
      const response = await apiFetch(`/api/audit?date=${today}`);
      if (!response.ok) throw new Error('Failed to fetch audit logs');

      const data = await response.json();
      logs = (data.entries || []).slice(-MAX_LOGS);
      lastLoadTime = new Date().toLocaleTimeString();
      connectionStatus = `Loaded ${logs.length} entries`;
    } catch (error) {
      console.error('[LogStream] Failed to load audit logs:', error);
      connectionStatus = 'Failed to load';
    } finally {
      isLoading = false;
    }
  }

  function handleVisibilityChange() {
    if (!document.hidden) {
      console.log('[LogStream] Tab visible, refreshing audit logs');
      void loadLogs();
    }
  }

  onMount(() => {
    if (logContainer && bottomSentinel) {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          autoScroll = entry.isIntersecting;
        },
        { root: logContainer, threshold: 0.99 }
      );
      observer.observe(bottomSentinel);
    }

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    void loadLogs();
  });

  onDestroy(() => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  function getLevelColor(level: LogEntry['level']) {
    switch (level) {
      case 'info': return 'text-blue-400';
      case 'warn': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      default: return 'text-gray-400';
    }
  }

  type StageStatus = 'idle' | 'in_progress' | 'completed' | 'failed'

  function latestLog(names: string[]): LogEntry | null {
    for (let i = logs.length - 1; i >= 0; i--) {
      if (names.includes(logs[i].event)) return logs[i]
    }
    return null
  }

  function stageStatus(start: string[], done: string[], fail: string[]): StageStatus {
    const s = latestLog(start)
    const d = latestLog(done)
    const f = latestLog(fail)
    const ts = s ? new Date(s.timestamp).getTime() : -1
    const td = d ? new Date(d.timestamp).getTime() : -1
    const tf = f ? new Date(f.timestamp).getTime() : -1
    const latest = Math.max(ts, td, tf)
    if (latest === -1) return 'idle'
    if (latest === tf) return 'failed'
    if (latest === td) return 'completed'
    return 'in_progress'
  }

  $: loraStages = {
    builder: stageStatus(['adapter_builder_started','lora_orchestration_started'], ['adapter_builder_completed','lora_dataset_ready'], ['adapter_builder_failed','lora_dataset_failed']),
    approval: stageStatus(['lora_dataset_ready'], ['lora_dataset_auto_approve','lora_dataset_approved'], ['lora_dataset_auto_reject']),
    training: stageStatus(['lora_training_started','adapter_training_queued'], ['lora_training_completed'], ['lora_training_failed']),
    evaluation: stageStatus(['adapter_evaluation_started','adapter_evaluation_queued'], ['adapter_evaluation_completed'], ['adapter_evaluation_failed']),
    activation: stageStatus(['adapter_activation_requested'], ['lora_adapter_activated','adapter_activated'], []),
  }

  export function clear() {
    logs = [];
  }

  $: if ($clearAuditStreamTrigger > 0) {
    clear();
  }

  function copyLogMessage(log: LogEntry) {
    const msg = `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.event || log.message || 'Unknown'} (${log.actor} via ${log.category})`;
    navigator.clipboard.writeText(msg);
  }

  function copyLogJSON(log: LogEntry) {
    navigator.clipboard.writeText(JSON.stringify(log, null, 2));
  }

  function copyAllLogs() {
    const allText = filteredLogs.map(l =>
      `[${new Date(l.timestamp).toLocaleTimeString()}] ${l.event || l.message || 'Unknown'} (${l.actor} via ${l.category})`
    ).join('\n');
    navigator.clipboard.writeText(allText);
  }

  function saveAsJSON(data: any, filename: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function showContextMenu(e: MouseEvent, log?: LogEntry) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, log };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function handleContextAction(action: string) {
    if (!contextMenu) return;
    const { log } = contextMenu;

    switch (action) {
      case 'copy-message':
        if (log) copyLogMessage(log);
        break;
      case 'copy-all':
        copyAllLogs();
        break;
      case 'save-json':
        if (log) saveAsJSON(log, `audit-log-${Date.now()}.json`);
        break;
      case 'save-all-json':
        saveAsJSON(filteredLogs, `audit-all-${Date.now()}.json`);
        break;
      case 'clear':
        clear();
        break;
    }
    closeContextMenu();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && contextMenu) {
      closeContextMenu();
    }
  }

  $: filteredLogs = logs.filter(log => {
    if (levelFilter === 'all') return true;
    if (levelFilter === 'error') return log.level === 'error';
    if (levelFilter === 'warn') return log.level === 'warn';
    if (levelFilter === 'info') return log.level === 'info';
    return true;
  });
</script>

<div class="h-full flex flex-col bg-black font-mono text-[10px]" on:click={closeContextMenu}>
  <!-- Header -->
  <div class="p-2 border-b border-gray-700">
    <div class="flex justify-between items-center mb-2">
      <h3 class="font-semibold text-white text-sm">Audit Log</h3>
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-400">{connectionStatus}</span>
        {#if lastLoadTime}
          <span class="text-xs text-gray-500">@ {lastLoadTime}</span>
        {/if}
        <span class="text-xs text-gray-400">·</span>
        <span class="text-xs text-gray-400">{filteredLogs.length}</span>
      </div>
    </div>

    <!-- Filter Pills -->
    <div class="flex gap-1 flex-wrap">
      <button class="filter-pill {levelFilter === 'all' ? 'active' : ''}" on:click={() => levelFilter = 'all'}>All</button>
      <button class="filter-pill error {levelFilter === 'error' ? 'active' : ''}" on:click={() => levelFilter = levelFilter === 'error' ? 'all' : 'error'}>Err</button>
      <button class="filter-pill warn {levelFilter === 'warn' ? 'active' : ''}" on:click={() => levelFilter = levelFilter === 'warn' ? 'all' : 'warn'}>Warn</button>
      <button class="filter-pill info {levelFilter === 'info' ? 'active' : ''}" on:click={() => levelFilter = levelFilter === 'info' ? 'all' : 'info'}>Info</button>
      <div class="flex-1"></div>
      <button class="filter-pill" on:click={loadLogs} disabled={isLoading} title="Refresh audit logs">{isLoading ? '...' : 'Refresh'}</button>
      <button class="filter-pill" on:click={clear} title="Clear all messages">Clear</button>
    </div>
  </div>

  <!-- Live Pipeline Overview -->
  <div class="px-3 py-2 border-b border-gray-800 text-xs text-gray-300 flex items-center gap-3 flex-wrap">
    <div class="inline-flex items-center gap-1.5"><span class="status-dot {loraStages.builder}"></span> Builder</div>
    <span class="text-gray-600">→</span>
    <div class="inline-flex items-center gap-1.5"><span class="status-dot {loraStages.approval}"></span> Approval</div>
    <span class="text-gray-600">→</span>
    <div class="inline-flex items-center gap-1.5"><span class="status-dot {loraStages.training}"></span> Training</div>
    <span class="text-gray-600">→</span>
    <div class="inline-flex items-center gap-1.5"><span class="status-dot {loraStages.evaluation}"></span> Eval</div>
    <span class="text-gray-600">→</span>
    <div class="inline-flex items-center gap-1.5"><span class="status-dot {loraStages.activation}"></span> Activate</div>
  </div>

  <!-- Log Output -->
  <div bind:this={logContainer} class="flex-1 overflow-y-auto p-4 min-h-0">
    {#if filteredLogs.length === 0}
      <div class="text-gray-500">
        {isLoading ? 'Loading audit entries...' : (levelFilter === 'all' ? 'No audit entries for today. Click Refresh to reload.' : 'No matching messages')}
      </div>
    {/if}
    {#each filteredLogs as log}
      <div
        class="mb-2 hover:bg-gray-900 cursor-context-menu px-2 py-1 rounded"
        on:contextmenu={(e) => showContextMenu(e, log)}
      >
        <span class="text-gray-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
        <span class="font-bold mx-2 {getLevelColor(log.level)}">{log.event || log.message || 'Unknown'}</span>
        <span class="text-gray-400">({log.actor} via {log.category})</span>
        {#if log.details || log.metadata}
          <pre class="text-[9px] text-gray-500 mt-1 ml-4 whitespace-pre-wrap break-words overflow-x-auto opacity-70">{JSON.stringify(log.details || log.metadata, null, 2)}</pre>
        {/if}
      </div>
    {/each}
    <div bind:this={bottomSentinel} class="h-px"></div>
  </div>
</div>

<!-- Context Menu -->
{#if contextMenu}
  <div class="context-menu-backdrop" on:click={closeContextMenu} on:contextmenu|preventDefault={closeContextMenu}></div>
  <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;" on:click|stopPropagation>
    <button class="context-menu-item" on:click={() => handleContextAction('copy-message')}>📋 Copy Message</button>
    <button class="context-menu-item" on:click={() => handleContextAction('copy-all')}>📋 Copy All Messages</button>
    <button class="context-menu-item" on:click={() => handleContextAction('save-json')}>💾 Save Message as JSON</button>
    <button class="context-menu-item" on:click={() => handleContextAction('save-all-json')}>💾 Save All as JSON</button>
    <div class="context-menu-divider"></div>
    <button class="context-menu-item" on:click={() => handleContextAction('clear')}>🗑️ Clear Messages</button>
  </div>
{/if}
