<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { clearAuditStreamTrigger } from '../stores/clear-events';

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

  // Limit for log rotation to prevent unbounded growth
  const MAX_LOGS = 500;

  // Context menu state
  let contextMenu: { x: number; y: number; log?: LogEntry } | null = null;

  // Level filter
  let levelFilter: 'all' | 'error' | 'warn' | 'info' = 'all';

  // Auto-scroll to bottom
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
      const response = await fetch(`/api/audit?date=${today}`);
      if (!response.ok) throw new Error('Failed to fetch audit logs');

      const data = await response.json();
      // Take only the most recent MAX_LOGS entries
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

    // Load logs on mount
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

  // Live pipeline status from stream
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

  // Export clear function for external access
  export function clear() {
    logs = [];
  }

  // Subscribe to clear trigger from other components
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
        if (log) {
          copyLogMessage(log);
        }
        break;
      case 'copy-all':
        copyAllLogs();
        break;
      case 'save-json':
        if (log) {
          saveAsJSON(log, `audit-log-${Date.now()}.json`);
        }
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

  // Close context menu on ESC key
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && contextMenu) {
      closeContextMenu();
    }
  }

  // Filtered logs based on level
  $: filteredLogs = logs.filter(log => {
    if (levelFilter === 'all') return true;
    if (levelFilter === 'error') return log.level === 'error';
    if (levelFilter === 'warn') return log.level === 'warn';
    if (levelFilter === 'info') return log.level === 'info';
    return true;
  });
</script>

<div class="log-stream-container h-full flex flex-col bg-black font-mono text-[10px]" on:click={closeContextMenu}>
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
      <button
        class="filter-pill {levelFilter === 'all' ? 'active' : ''}"
        on:click={() => levelFilter = 'all'}
      >
        All
      </button>
      <button
        class="filter-pill error {levelFilter === 'error' ? 'active' : ''}"
        on:click={() => levelFilter = levelFilter === 'error' ? 'all' : 'error'}
      >
        Err
      </button>
      <button
        class="filter-pill warn {levelFilter === 'warn' ? 'active' : ''}"
        on:click={() => levelFilter = levelFilter === 'warn' ? 'all' : 'warn'}
      >
        Warn
      </button>
      <button
        class="filter-pill info {levelFilter === 'info' ? 'active' : ''}"
        on:click={() => levelFilter = levelFilter === 'info' ? 'all' : 'info'}
      >
        Info
      </button>
      <div class="flex-1"></div>
      <button
        class="filter-pill"
        on:click={loadLogs}
        disabled={isLoading}
        title="Refresh audit logs"
      >
        {isLoading ? '...' : 'Refresh'}
      </button>
      <button
        class="filter-pill"
        on:click={clear}
        title="Clear all messages"
      >
        Clear
      </button>
    </div>
  </div>

  <!-- Live Pipeline Overview (minimal) -->
  <div class="px-3 py-2 border-b border-gray-800 text-xs text-gray-300 flex items-center gap-3 flex-wrap">
    <div class="stage"><span class={"dot " + loraStages.builder}></span> Builder</div>
    <span>→</span>
    <div class="stage"><span class={"dot " + loraStages.approval}></span> Approval</div>
    <span>→</span>
    <div class="stage"><span class={"dot " + loraStages.training}></span> Training</div>
    <span>→</span>
    <div class="stage"><span class={"dot " + loraStages.evaluation}></span> Eval</div>
    <span>→</span>
    <div class="stage"><span class={"dot " + loraStages.activation}></span> Activate</div>
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
        class="log-entry mb-2 hover:bg-gray-900 cursor-context-menu px-2 py-1 rounded"
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
    <div bind:this={bottomSentinel} style="height: 1px;"></div>
  </div>
</div>

<!-- Context Menu -->
{#if contextMenu}
  <!-- Backdrop to capture clicks outside -->
  <div
    class="context-menu-backdrop"
    on:click={closeContextMenu}
    on:contextmenu|preventDefault={closeContextMenu}
  ></div>
  <div
    class="context-menu"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    on:click|stopPropagation
  >
    <button class="context-menu-item" on:click={() => handleContextAction('copy-message')}>
      📋 Copy Message
    </button>
    <button class="context-menu-item" on:click={() => handleContextAction('copy-all')}>
      📋 Copy All Messages
    </button>
    <button class="context-menu-item" on:click={() => handleContextAction('save-json')}>
      💾 Save Message as JSON
    </button>
    <button class="context-menu-item" on:click={() => handleContextAction('save-all-json')}>
      💾 Save All as JSON
    </button>
    <div class="context-menu-divider"></div>
    <button class="context-menu-item" on:click={() => handleContextAction('clear')}>
      🗑️ Clear Messages
    </button>
  </div>
{/if}

<style>
  .stage { display: inline-flex; align-items: center; gap: 0.35rem; }
  .dot { width: 8px; height: 8px; border-radius: 999px; background: #6b7280; position: relative; }
  .dot.in_progress { background: #3b82f6; }
  .dot.in_progress::after { content: ''; position: absolute; inset: -3px; border-radius: 999px; border: 1px solid rgba(59,130,246,0.35); animation: pulse 1s infinite ease-in-out; }
  .dot.completed { background: #22c55e; }
  .dot.failed { background: #ef4444; }
  .dot.idle { background: #6b7280; }
  @keyframes pulse { 0% { transform: scale(0.9); opacity: 0.8 } 50% { transform: scale(1.1); opacity: 0.3 } 100% { transform: scale(0.9); opacity: 0.8 } }

  /* Filter Pills */
  .filter-pill {
    padding: 0.25rem 0.5rem;
    font-size: 0.7rem;
    border-radius: 0.25rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: transparent;
    color: rgb(156 163 175);
    cursor: pointer;
    transition: all 0.2s;
  }

  .filter-pill:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .filter-pill.active {
    background: rgb(167 139 250);
    color: rgb(17 24 39);
    border-color: rgb(167 139 250);
  }

  .filter-pill.error.active {
    background: rgb(220 38 38);
    border-color: rgb(220 38 38);
    color: white;
  }

  .filter-pill.warn.active {
    background: rgb(234 179 8);
    border-color: rgb(234 179 8);
    color: rgb(17 24 39);
  }

  .filter-pill.info.active {
    background: rgb(37 99 235);
    border-color: rgb(37 99 235);
    color: white;
  }

  /* Context Menu */
  .context-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9998;
    background: transparent;
  }

  .context-menu {
    position: fixed;
    z-index: 9999;
    background: rgb(31 41 55);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 0.375rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    padding: 0.25rem;
    min-width: 180px;
  }

  .context-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    border: none;
    background: transparent;
    color: rgb(243 244 246);
    cursor: pointer;
    border-radius: 0.25rem;
    transition: background 0.15s;
  }

  .context-menu-item:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .context-menu-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
    margin: 0.25rem 0;
  }
</style>
