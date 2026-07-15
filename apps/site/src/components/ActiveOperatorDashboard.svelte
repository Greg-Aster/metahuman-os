<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface WorkSummary {
    id: string;
    type: string;
    handler: string;
    state: string;
    priority: string;
    source: string;
    createdAt: string;
  }

  interface OperatorStatus {
    mode: 'reactive' | 'semi' | 'full';
    health: string;
    healthMessage?: string;
    isExecuting: boolean;
    consecutiveTasks: number;
    policy: {
      running: boolean;
      evaluationsLastHour: number;
      scheduledAt?: string;
      pauseUntil?: string;
    };
    queue: { length: number; tasks: WorkSummary[] };
  }

  let status: OperatorStatus | null = null;
  let error = '';
  let timer: ReturnType<typeof setInterval> | undefined;

  async function refresh() {
    try {
      const response = await apiFetch('/api/active-operator/status');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load Active Operator status');
      status = data;
      error = '';
    } catch (caught) {
      error = (caught as Error).message;
    }
  }

  onMount(() => {
    void refresh();
    timer = setInterval(refresh, 5_000);
  });
  onDestroy(() => timer && clearInterval(timer));
</script>

<div class="h-full overflow-y-auto p-4 text-sm">
  <div class="mb-4">
    <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Active Operator</h2>
    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Bounded autonomy policy above the single deterministic work coordinator.</p>
  </div>

  {#if error}
    <div class="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-red-600 dark:text-red-300">{error}</div>
  {/if}

  {#if !status}
    <div class="py-12 text-center text-gray-500 dark:text-gray-400">Loading status…</div>
  {:else}
    <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded border border-gray-200 p-3 dark:border-gray-800">
        <div class="text-xs text-gray-500 dark:text-gray-400">Mode</div>
        <div class="mt-1 font-semibold uppercase text-gray-900 dark:text-gray-100">{status.mode}</div>
      </div>
      <div class="rounded border border-gray-200 p-3 dark:border-gray-800">
        <div class="text-xs text-gray-500 dark:text-gray-400">Health</div>
        <div class="mt-1 font-semibold text-gray-900 dark:text-gray-100">{status.health}</div>
      </div>
      <div class="rounded border border-gray-200 p-3 dark:border-gray-800">
        <div class="text-xs text-gray-500 dark:text-gray-400">Active work</div>
        <div class="mt-1 font-semibold text-gray-900 dark:text-gray-100">{status.queue.length}</div>
      </div>
      <div class="rounded border border-gray-200 p-3 dark:border-gray-800">
        <div class="text-xs text-gray-500 dark:text-gray-400">Policy evaluations/hour</div>
        <div class="mt-1 font-semibold text-gray-900 dark:text-gray-100">{status.policy.evaluationsLastHour}</div>
      </div>
    </div>

    {#if status.healthMessage}
      <div class="mb-4 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">{status.healthMessage}</div>
    {/if}

    <section class="rounded border border-gray-200 dark:border-gray-800">
      <div class="border-b border-gray-200 p-3 font-semibold text-gray-900 dark:border-gray-800 dark:text-gray-100">Coordinator work</div>
      {#if status.queue.tasks.length === 0}
        <div class="p-4 text-gray-500 dark:text-gray-400">No active work.</div>
      {:else}
        <div class="divide-y divide-gray-200 dark:divide-gray-800">
          {#each status.queue.tasks as task}
            <div class="p-3">
              <div class="flex justify-between gap-3">
                <span class="font-medium text-gray-900 dark:text-gray-100">{task.type}</span>
                <span class="text-xs text-gray-500 dark:text-gray-400">{task.state}</span>
              </div>
              <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">{task.handler} · {task.priority} · {task.source}</div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>
