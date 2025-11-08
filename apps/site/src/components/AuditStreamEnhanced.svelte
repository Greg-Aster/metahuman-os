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

  onDestroy(() => {
    eventSource?.close();
    observer?.disconnect();
    observer = null;
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

<div class="audit-stream-container h-full flex flex-col bg-white dark:bg-gray-900">
  <!-- Header -->
  <div class="p-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
    <h3 class="font-semibold text-gray-900 dark:text-white">Audit Stream (Grouped)</h3>
    <div class="flex items-center gap-2">
      <div class="w-2 h-2 rounded-full {connectionStatus === 'Connected' ? 'bg-green-500' : 'bg-yellow-500'}"></div>
      <span class="text-xs text-gray-500 dark:text-gray-400">{connectionStatus}</span>
      <span class="text-xs text-gray-500 dark:text-gray-400">·</span>
      <span class="text-xs text-gray-500 dark:text-gray-400">{filteredGroups.length} groups</span>
    </div>
  </div>

  <!-- Filters & Search -->
  <div class="p-3 border-b border-gray-200 dark:border-gray-700 flex gap-2 flex-wrap items-center">
    <input
      type="text"
      bind:value={searchQuery}
      placeholder="Search tasks..."
      class="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white flex-1 min-w-[150px]"
    />
    <select
      bind:value={selectedCategory}
      class="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
    >
      <option value="all">All Categories</option>
      <option value="system">System</option>
      <option value="decision">Decision</option>
      <option value="action">Action</option>
      <option value="security">Security</option>
      <option value="data">Data</option>
    </select>
    <select
      bind:value={selectedLevel}
      class="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
    >
      <option value="all">All Levels</option>
      <option value="info">Info</option>
      <option value="warn">Warn</option>
      <option value="error">Error</option>
      <option value="critical">Critical</option>
    </select>
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
          <div class="flex items-center gap-2">
            <button
              class="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              on:click|stopPropagation={() => openDetail(group)}
            >
              JSON
            </button>
            <span class="text-gray-400 dark:text-gray-600">
              {group.expanded ? '▼' : '▶'}
            </span>
          </div>
        </button>

        <!-- Expanded Events -->
        {#if group.expanded}
          <div transition:slide={{ duration: 200 }} class="bg-gray-50 dark:bg-gray-800/50 px-4 py-3 space-y-2">
            {#each group.events as event}
              <div class="text-xs border-l-2 border-gray-300 dark:border-gray-600 pl-3 py-1">
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
                    <pre class="mt-1 text-[10px] bg-gray-100 dark:bg-gray-900 p-2 rounded overflow-x-auto text-gray-700 dark:text-gray-300">{JSON.stringify(event.details, null, 2)}</pre>
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
    font-size: 0.875rem;
  }
</style>
