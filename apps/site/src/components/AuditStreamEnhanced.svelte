<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { clearAuditStreamTrigger } from '../stores/clear-events';

  interface AuditEvent {
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'critical';
    category: string;
    event: string;
    actor: string;
    details?: any;
  }

  interface TaskGroup {
    id: string;
    taskId: string;
    summary: string;
    status: 'in_progress' | 'completed' | 'failed';
    category: string;
    level: 'info' | 'warn' | 'error' | 'critical';
    events: AuditEvent[];
    firstTimestamp: string;
    lastTimestamp: string;
    count: number;
    expanded: boolean;
  }

  let groups: TaskGroup[] = [];
  let connectionStatus = 'Connecting...';
  let logContainer: HTMLDivElement;
  let autoScroll = true;
  let bottomSentinel: HTMLDivElement;
  let observer: IntersectionObserver | null = null;
  let eventSource: EventSource | null = null;
  let selectedGroup: TaskGroup | null = null;
  let showDetailDrawer = false;

  // Filters
  let selectedCategory: string = 'all';
  let selectedLevel: string = 'all';
  let searchQuery: string = '';

  // Context menu state
  let contextMenu: { x: number; y: number; group?: TaskGroup; event?: AuditEvent } | null = null;

  // Limit for group rotation to prevent unbounded growth
  const MAX_GROUPS = 200;

  // Normalize incoming event to standard shape
  function normalizeEvent(rawEvent: any): AuditEvent {
    return {
      timestamp: rawEvent.timestamp || new Date().toISOString(),
      level: rawEvent.level || 'info',
      category: rawEvent.category || 'system',
      event: rawEvent.event || rawEvent.message || 'unknown',
      actor: rawEvent.actor || 'system',
      details: rawEvent.details || rawEvent.metadata || rawEvent.data,
    };
  }

  // Generate task ID for grouping
  function getTaskId(event: AuditEvent): string {
    // Try to extract task ID from details
    if (event.details?.taskId) return event.details.taskId;
    if (event.details?.conversationId) return event.details.conversationId;
    if (event.details?.sessionId) return event.details.sessionId;
    if (event.details?.agentId) return event.details.agentId;

    // Fallback: group by event name + actor
    return `${event.event}_${event.actor}`;
  }

  // Generate human-readable summary for a group
  function generateSummary(events: AuditEvent[]): string {
    if (events.length === 0) return 'Empty group';

    const first = events[0];
    const last = events[events.length - 1];

    // Extract meaningful context
    const skill = first.details?.skill || first.details?.toolName;
    const mode = first.details?.mode || first.details?.cognitiveMode;
    const user = first.details?.username || first.details?.userId;

    // Build summary based on event type
    if (first.event.includes('react_') || first.event.includes('operator')) {
      return skill ? `Operator: ${skill}` : 'Operator task';
    }
    if (first.event.includes('lora') || first.event.includes('adapter')) {
      return `LoRA: ${first.event.replace(/_/g, ' ')}`;
    }
    if (first.event.includes('agent')) {
      const agentName = first.details?.agent || first.actor;
      return `Agent: ${agentName}`;
    }
    if (first.event.includes('memory') || first.event.includes('context')) {
      return mode ? `Memory (${mode})` : 'Memory operation';
    }

    // Default: event name
    return first.event.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  // Determine group status from events
  function determineStatus(events: AuditEvent[]): 'in_progress' | 'completed' | 'failed' {
    const last = events[events.length - 1];

    // Check for failure indicators
    if (last.level === 'error' || last.level === 'critical') return 'failed';
    if (last.event.includes('failed') || last.event.includes('error')) return 'failed';

    // Check for completion indicators
    if (last.event.includes('completed') || last.event.includes('finished') || last.event.includes('success')) {
      return 'completed';
    }

    // Default to in_progress
    return 'in_progress';
  }

  // Add event to groups (core grouping logic)
  function addEvent(event: AuditEvent) {
    const taskId = getTaskId(event);
    const existingGroup = groups.find(g => g.taskId === taskId);

    if (existingGroup) {
      // Update existing group
      existingGroup.events.push(event);
      existingGroup.lastTimestamp = event.timestamp;
      existingGroup.count = existingGroup.events.length;
      existingGroup.status = determineStatus(existingGroup.events);
      existingGroup.level = Math.max(
        existingGroup.level === 'critical' ? 4 : existingGroup.level === 'error' ? 3 : existingGroup.level === 'warn' ? 2 : 1,
        event.level === 'critical' ? 4 : event.level === 'error' ? 3 : event.level === 'warn' ? 2 : 1
      ) === 4 ? 'critical' : Math.max(
        existingGroup.level === 'critical' ? 4 : existingGroup.level === 'error' ? 3 : existingGroup.level === 'warn' ? 2 : 1,
        event.level === 'critical' ? 4 : event.level === 'error' ? 3 : event.level === 'warn' ? 2 : 1
      ) === 3 ? 'error' : Math.max(
        existingGroup.level === 'critical' ? 4 : existingGroup.level === 'error' ? 3 : existingGroup.level === 'warn' ? 2 : 1,
        event.level === 'critical' ? 4 : event.level === 'error' ? 3 : event.level === 'warn' ? 2 : 1
      ) === 2 ? 'warn' : 'info';

      // Move to end (most recent first when reversed)
      groups = [...groups.filter(g => g.taskId !== taskId), existingGroup];
    } else {
      // Create new group
      const newGroup: TaskGroup = {
        id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        taskId,
        summary: generateSummary([event]),
        status: determineStatus([event]),
        category: event.category,
        level: event.level,
        events: [event],
        firstTimestamp: event.timestamp,
        lastTimestamp: event.timestamp,
        count: 1,
        expanded: false,
      };

      groups = [...groups, newGroup];
    }

    // Rotate groups if too many
    if (groups.length > MAX_GROUPS) {
      groups = groups.slice(-MAX_GROUPS);
    }
  }

  // Event source setup
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

    eventSource = new EventSource('/api/stream');

    eventSource.onopen = () => {
      connectionStatus = 'Connected';
    };

    eventSource.onmessage = (event) => {
      try {
        const rawEvent = JSON.parse(event.data);
        if (rawEvent.type === 'connected') {
          addEvent(normalizeEvent({
            timestamp: new Date().toISOString(),
            level: 'info',
            category: 'system',
            event: 'stream_connected',
            actor: 'system'
          }));
        } else {
          addEvent(normalizeEvent(rawEvent));
        }
      } catch (e) {
        console.error('Failed to parse audit event:', e);
      }
    };

    eventSource.onerror = () => {
      connectionStatus = 'Disconnected. Reconnecting...';
    };
  });

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onDestroy(() => {
    eventSource?.close();
    observer?.disconnect();
    observer = null;
    window.removeEventListener('keydown', handleKeyDown);
  });

  // Helper functions
  function getLevelColor(level: string) {
    switch (level) {
      case 'info': return 'text-blue-600 dark:text-blue-400';
      case 'warn': return 'text-yellow-600 dark:text-yellow-400';
      case 'error': return 'text-red-600 dark:text-red-400';
      case 'critical': return 'text-red-800 dark:text-red-300 font-bold';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  }

  function getCategoryColor(category: string) {
    switch (category) {
      case 'system': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200';
      case 'decision': return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200';
      case 'action': return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200';
      case 'security': return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200';
      case 'data': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case 'completed': return '✓';
      case 'failed': return '✗';
      case 'in_progress': return '⟳';
      default: return '○';
    }
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'completed': return 'text-green-600 dark:text-green-400';
      case 'failed': return 'text-red-600 dark:text-red-400';
      case 'in_progress': return 'text-blue-600 dark:text-blue-400';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  }

  function toggleExpand(group: TaskGroup) {
    group.expanded = !group.expanded;
    groups = [...groups]; // Trigger reactivity
  }

  function openDetail(group: TaskGroup) {
    selectedGroup = group;
    showDetailDrawer = true;
  }

  function closeDetail() {
    showDetailDrawer = false;
  }

  function copyJSON(group: TaskGroup) {
    navigator.clipboard.writeText(JSON.stringify(group.events, null, 2));
    alert('Copied to clipboard!');
  }

  function copyEvent(event: AuditEvent) {
    navigator.clipboard.writeText(JSON.stringify(event, null, 2));
  }

  function copyEventMessage(event: AuditEvent) {
    const msg = `[${new Date(event.timestamp).toLocaleTimeString()}] ${event.event} by ${event.actor}`;
    navigator.clipboard.writeText(msg);
  }

  function copyAllGroups() {
    const allText = filteredGroups.map(g =>
      g.events.map(e => `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.event} by ${e.actor}`).join('\n')
    ).join('\n---\n');
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

  function showContextMenu(e: MouseEvent, group?: TaskGroup, event?: AuditEvent) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, group, event };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function handleContextAction(action: string) {
    if (!contextMenu) return;

    const { group, event } = contextMenu;

    switch (action) {
      case 'copy-message':
        if (event) {
          copyEventMessage(event);
        } else if (group) {
          const text = group.events.map(e => `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.event} by ${e.actor}`).join('\n');
          navigator.clipboard.writeText(text);
        }
        break;
      case 'copy-all':
        copyAllGroups();
        break;
      case 'save-json':
        if (event) {
          saveAsJSON(event, `audit-event-${Date.now()}.json`);
        } else if (group) {
          saveAsJSON(group.events, `audit-group-${Date.now()}.json`);
        }
        break;
      case 'save-all-json':
        saveAsJSON(filteredGroups.flatMap(g => g.events), `audit-all-${Date.now()}.json`);
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

  // Filtered groups
  $: filteredGroups = groups.filter(g => {
    if (selectedCategory !== 'all' && g.category !== selectedCategory) return false;
    if (selectedLevel !== 'all' && g.level !== selectedLevel) return false;
    if (searchQuery && !g.summary.toLowerCase().includes(searchQuery.toLowerCase()) && !g.taskId.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  // Clear handler
  export function clear() {
    groups = [];
  }

  $: if ($clearAuditStreamTrigger > 0) {
    clear();
  }

  // Auto-scroll to bottom
  $: if (groups.length > 0 && autoScroll && bottomSentinel) {
    requestAnimationFrame(() => {
      bottomSentinel?.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'smooth' });
    });
  }
</script>

<div class="audit-stream-container h-full flex flex-col bg-white dark:bg-gray-900" on:click={closeContextMenu}>
  <!-- Header -->
  <div class="p-2 border-b border-gray-200 dark:border-gray-700">
    <div class="flex justify-between items-center mb-2">
      <h3 class="font-semibold text-gray-900 dark:text-white text-sm">Audit Stream</h3>
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full {connectionStatus === 'Connected' ? 'bg-green-500' : 'bg-yellow-500'}"></div>
        <span class="text-xs text-gray-500 dark:text-gray-400">{connectionStatus}</span>
        <span class="text-xs text-gray-500 dark:text-gray-400">·</span>
        <span class="text-xs text-gray-500 dark:text-gray-400">{filteredGroups.length}</span>
      </div>
    </div>

    <!-- Filter Pills -->
    <div class="flex gap-1 flex-wrap">
      <button
        class="filter-pill {selectedLevel === 'all' ? 'active' : ''}"
        on:click={() => selectedLevel = 'all'}
      >
        All
      </button>
      <button
        class="filter-pill error {selectedLevel === 'error' || selectedLevel === 'critical' ? 'active' : ''}"
        on:click={() => selectedLevel = selectedLevel === 'error' ? 'all' : 'error'}
      >
        Err
      </button>
      <button
        class="filter-pill warn {selectedLevel === 'warn' ? 'active' : ''}"
        on:click={() => selectedLevel = selectedLevel === 'warn' ? 'all' : 'warn'}
      >
        Warn
      </button>
      <button
        class="filter-pill info {selectedLevel === 'info' ? 'active' : ''}"
        on:click={() => selectedLevel = selectedLevel === 'info' ? 'all' : 'info'}
      >
        Info
      </button>
      <div class="flex-1"></div>
      <button
        class="filter-pill"
        on:click={clear}
        title="Clear all messages"
      >
        Clear
      </button>
    </div>
  </div>

  <!-- Groups List -->
  <div bind:this={logContainer} class="flex-1 overflow-y-auto min-h-0">
    {#if filteredGroups.length === 0}
      <div class="p-6 text-center text-gray-500 dark:text-gray-400 text-sm">
        {searchQuery || selectedCategory !== 'all' || selectedLevel !== 'all' ? 'No matching events' : 'Awaiting real-time system events...'}
      </div>
    {/if}

    {#each filteredGroups.slice().reverse() as group (group.id)}
      <div class="border-b border-gray-200 dark:border-gray-700">
        <!-- Group Summary -->
        <button
          class="w-full px-4 py-3 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
          on:click={() => toggleExpand(group)}
          on:contextmenu={(e) => showContextMenu(e, group)}
        >
          <span class="mt-0.5 {getStatusColor(group.status)} text-lg">
            {getStatusIcon(group.status)}
          </span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs px-2 py-0.5 rounded-full font-semibold {getCategoryColor(group.category)}">
                {group.category}
              </span>
              <span class="text-xs {getLevelColor(group.level)}">
                {group.level.toUpperCase()}
              </span>
              {#if group.count > 1}
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  {group.count} events
                </span>
              {/if}
            </div>
            <div class="font-medium text-sm text-gray-900 dark:text-white truncate">
              {group.summary}
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {new Date(group.lastTimestamp).toLocaleTimeString()}
            </div>
          </div>
          <div class="flex items-center">
            <span class="text-gray-400 dark:text-gray-600">
              {group.expanded ? '▼' : '▶'}
            </span>
          </div>
        </button>

        <!-- Expanded Events -->
        {#if group.expanded}
          <div transition:slide={{ duration: 200 }} class="bg-gray-50 dark:bg-gray-800/50 px-4 py-3 space-y-2">
            {#each group.events as event}
              <div
                class="text-[10px] border-l-2 border-gray-300 dark:border-gray-600 pl-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-700/50 cursor-context-menu"
                on:contextmenu={(e) => showContextMenu(e, group, event)}
              >
                <div class="flex items-center gap-2 mb-1">
                  <span class="font-mono text-gray-500 dark:text-gray-400">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                  <span class="{getLevelColor(event.level)}">
                    {event.event}
                  </span>
                  <span class="text-gray-500 dark:text-gray-400">
                    by {event.actor}
                  </span>
                </div>
                {#if event.details}
                  <details class="mt-1">
                    <summary class="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400">
                      Details
                    </summary>
                    <pre class="mt-1 text-[9px] bg-gray-100 dark:bg-gray-900 p-2 rounded overflow-x-auto text-gray-700 dark:text-gray-300">{JSON.stringify(event.details, null, 2)}</pre>
                  </details>
                {/if}
              </div>
            {/each}
          </div>
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

<!-- Detail Drawer (Modal) -->
{#if showDetailDrawer && selectedGroup}
  <div
    class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    on:click={closeDetail}
  >
    <div
      class="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-4xl w-full max-h-[80vh] flex flex-col"
      on:click|stopPropagation
    >
      <!-- Drawer Header -->
      <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
        <h3 class="font-semibold text-gray-900 dark:text-white">Task Details: {selectedGroup.summary}</h3>
        <div class="flex items-center gap-2">
          <button
            class="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            on:click={() => copyJSON(selectedGroup)}
          >
            Copy JSON
          </button>
          <button
            class="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            on:click={closeDetail}
          >
            ✕
          </button>
        </div>
      </div>

      <!-- Drawer Content -->
      <div class="flex-1 overflow-y-auto p-4">
        <pre class="text-xs font-mono bg-gray-100 dark:bg-gray-900 p-4 rounded overflow-x-auto text-gray-800 dark:text-gray-200">{JSON.stringify(selectedGroup.events, null, 2)}</pre>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Minimal custom styles - using Tailwind mostly */
  .audit-stream-container {
    font-size: 0.75rem;
  }

  /* Filter Pills */
  .filter-pill {
    padding: 0.25rem 0.5rem;
    font-size: 0.7rem;
    border-radius: 0.25rem;
    border: 1px solid rgba(0, 0, 0, 0.1);
    background: transparent;
    color: rgb(107 114 128);
    cursor: pointer;
    transition: all 0.2s;
  }

  :global(.dark) .filter-pill {
    border-color: rgba(255, 255, 255, 0.1);
    color: rgb(156 163 175);
  }

  .filter-pill:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .filter-pill:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .filter-pill.active {
    background: rgb(124 58 237);
    color: white;
    border-color: rgb(124 58 237);
  }

  :global(.dark) .filter-pill.active {
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
    color: white;
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
    background: white;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 0.375rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 0.25rem;
    min-width: 180px;
  }

  :global(.dark) .context-menu {
    background: rgb(31 41 55);
    border-color: rgba(255, 255, 255, 0.15);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  }

  .context-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    border: none;
    background: transparent;
    color: rgb(17 24 39);
    cursor: pointer;
    border-radius: 0.25rem;
    transition: background 0.15s;
  }

  :global(.dark) .context-menu-item {
    color: rgb(243 244 246);
  }

  .context-menu-item:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .context-menu-item:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .context-menu-divider {
    height: 1px;
    background: rgba(0, 0, 0, 0.1);
    margin: 0.25rem 0;
  }

  :global(.dark) .context-menu-divider {
    background: rgba(255, 255, 255, 0.1);
  }
</style>
