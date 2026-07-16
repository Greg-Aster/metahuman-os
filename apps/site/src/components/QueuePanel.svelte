<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import { connectionPool, ConnectionPriority, type ConnectionHandle } from '../lib/client/connection-pool';
  import TriggerManagerSummary from './TriggerManagerSummary.svelte';

  interface WorkView {
    id: string;
    type: string;
    handler: string;
    resource: string;
    state: string;
    priority: string;
    source: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    waitingReason?: string;
    wakeAt?: string;
    deadline?: string;
    attempt: number;
    maxAttempts: number;
    cancellationRequestedAt?: string;
    error?: string;
  }

  interface QueueSnapshot {
    lifecycle: string;
    running: boolean;
    paused: boolean;
    degraded: boolean;
    error?: string;
    tasks: WorkView[];
    history: WorkView[];
  }

  let snapshot: QueueSnapshot | null = null;
  let connected = false;
  let error = '';
  let busyAction = '';
  let sourceHandle: ConnectionHandle | null = null;

  function age(timestamp?: string): string {
    if (!timestamp) return '—';
    const elapsed = Math.max(0, Date.now() - Date.parse(timestamp));
    if (elapsed < 60_000) return `${Math.floor(elapsed / 1_000)}s`;
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
    return `${Math.floor(elapsed / 3_600_000)}h`;
  }

  async function mutate(label: string, path: string, init: RequestInit) {
    busyAction = label;
    try {
      const response = await apiFetch(path, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error || `Request failed: ${response.status}`);
      if (data.snapshot) snapshot = data.snapshot;
    } catch (caught) {
      error = (caught as Error).message;
    } finally {
      busyAction = '';
    }
  }

  function cancel(task: WorkView) {
    mutate(`cancel:${task.id}`, `/api/unified-queue/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
  }

  function cancelPending() {
    mutate('cancel-pending', '/api/unified-queue/clear', { method: 'POST', body: '{}' });
  }

  function setPaused(paused: boolean) {
    mutate(paused ? 'resume' : 'pause', '/api/unified-queue/control', {
      method: 'POST',
      body: JSON.stringify({ action: paused ? 'resume' : 'pause' }),
    });
  }

  onMount(() => {
    sourceHandle = connectionPool.request({
      id: 'work-coordinator-panel-stream',
      name: 'Work Coordinator Stream',
      url: '/api/queue-stream',
      priority: ConnectionPriority.MEDIUM,
      viewDependency: 'chat',
      defer: true,
      onOpen: () => { connected = true; error = ''; },
      onClose: () => { connected = false; },
      onError: () => { connected = false; },
      onMessage: event => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'error') error = data.error || 'Coordinator stream failed';
          if (data.snapshot) { snapshot = data.snapshot; error = ''; }
        } catch (caught) {
          error = (caught as Error).message;
        }
      },
    });
  });

  onDestroy(() => sourceHandle?.close());
</script>

<div class="flex h-full flex-col overflow-hidden text-sm">
  <header class="shrink-0 border-b border-black/10 p-3 dark:border-white/10">
    <div class="flex items-center justify-between gap-2">
      <div>
        <div class="font-semibold text-gray-900 dark:text-gray-100">Work Coordinator</div>
        <div class="text-xs text-gray-500 dark:text-gray-400">
          {snapshot?.lifecycle || 'starting'} · {connected ? 'live' : 'reconnecting'}
        </div>
      </div>
      <button
        class="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700"
        disabled={!!busyAction || !snapshot}
        on:click={() => snapshot && setPaused(snapshot.paused)}
      >{snapshot?.paused ? 'Resume' : 'Pause'}</button>
    </div>
    {#if snapshot?.degraded || error}
      <div class="mt-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-300">
        {error || snapshot?.error || 'Coordinator is degraded'}
      </div>
    {/if}
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto p-3">
    <TriggerManagerSummary />
    {#if !snapshot}
      <div class="py-8 text-center text-xs text-gray-500 dark:text-gray-400">Waiting for coordinator state…</div>
    {:else}
      <div class="mb-3 flex items-center justify-between gap-2">
        <span class="text-xs text-gray-500 dark:text-gray-400">{snapshot.tasks.length} active work item(s)</span>
        <button
          class="rounded border border-red-500/40 px-2 py-1 text-xs text-red-600 disabled:opacity-50 dark:text-red-300"
          disabled={!!busyAction || snapshot.tasks.every(task => task.state === 'leased')}
          on:click={cancelPending}
        >Cancel pending</button>
      </div>

      <section class="mb-4 rounded border border-gray-200 dark:border-gray-800">
        <div class="border-b border-gray-200 p-2 text-xs font-semibold dark:border-gray-800">Global order</div>
        {#if snapshot.tasks.length === 0}
          <div class="p-3 text-xs text-gray-500 dark:text-gray-400">No active work.</div>
        {:else}
          <div class="divide-y divide-gray-200 dark:divide-gray-800">
            {#each snapshot.tasks as task}
              <article class="p-2 {task.state === 'leased' ? 'bg-amber-500/10' : ''}">
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0 truncate text-xs font-medium text-gray-900 dark:text-gray-100">
                    {task.type} · {task.priority}
                  </div>
                  <span class="text-[0.7rem] text-gray-500 dark:text-gray-400">{age(task.startedAt || task.createdAt)}</span>
                </div>
                <div class="mt-1 flex flex-wrap gap-1 text-[0.7rem] text-gray-500 dark:text-gray-400">
                  <span class="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">{task.state}</span>
                  <span class="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">{task.handler}</span>
                  <span class="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">{task.resource}</span>
                  {#if task.attempt > 0}<span>attempt {task.attempt + 1}/{task.maxAttempts}</span>{/if}
                </div>
                {#if task.waitingReason}<div class="mt-1 text-xs text-amber-600 dark:text-amber-300">{task.waitingReason}</div>{/if}
                {#if task.cancellationRequestedAt}<div class="mt-1 text-xs text-red-600 dark:text-red-300">Cancellation requested</div>{/if}
                <div class="mt-2 text-right">
                  <button
                    class="rounded border border-red-500/40 px-1.5 py-0.5 text-[0.7rem] text-red-600 dark:text-red-300"
                    disabled={!!busyAction || !!task.cancellationRequestedAt}
                    on:click={() => cancel(task)}
                  >Cancel</button>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>

      <section class="rounded border border-gray-200 dark:border-gray-800">
        <div class="border-b border-gray-200 p-2 text-xs font-semibold dark:border-gray-800">Recent history</div>
        {#if snapshot.history.length === 0}
          <div class="p-3 text-xs text-gray-500 dark:text-gray-400">No terminal history yet.</div>
        {:else}
          <div class="divide-y divide-gray-200 dark:divide-gray-800">
            {#each snapshot.history.slice(0, 20) as task}
              <div class="p-2 text-xs">
                <div class="flex justify-between gap-2">
                  <span class="truncate text-gray-900 dark:text-gray-100">{task.type} · {task.state}</span>
                  <span class="shrink-0 text-gray-500 dark:text-gray-400">{age(task.completedAt)}</span>
                </div>
                <div class="mt-1 truncate text-[0.7rem] text-gray-500 dark:text-gray-400">{task.handler} · {task.resource}</div>
                {#if task.error}<div class="mt-1 text-red-600 dark:text-red-300">{task.error}</div>{/if}
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>
</div>
