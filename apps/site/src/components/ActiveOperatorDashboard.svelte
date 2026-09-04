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

  type RobotOperatorChildId = 'robot-status' | 'robot-goal-review' | 'boredom-observer' | 'boredom-movement' | 'boredom-reflection';

  interface RobotOperatorChildRuntime {
    id: RobotOperatorChildId;
    enabled: boolean;
    handler: string;
    graph: string;
    nextRunAt?: string;
    lastAdmittedAt?: string;
    lastTaskId?: string;
    lastOutcome?: string;
  }

  interface BoredomEpisode {
    id: string;
    child: Extract<RobotOperatorChildId, `boredom-${string}`>;
    handler: string;
    state: string;
    source: string;
    createdAt: string;
    completedAt?: string;
    downstreamCount: number;
    outcome: string;
  }

  interface OperatorStatus {
    mode: 'reactive' | 'semi' | 'full';
    health: string;
    healthMessage?: string;
    isExecuting: boolean;
    config: { cooldownMs: number };
    queue: { length: number; tasks: WorkSummary[] };
    robotOperator: {
      runtime: {
        updatedAt: string;
        mode: 'reactive' | 'semi' | 'full';
        lifecycle: string;
        reason: string;
        fullCooldownMs?: number;
        children: Record<RobotOperatorChildId, RobotOperatorChildRuntime>;
      } | null;
      episodes: BoredomEpisode[];
    };
  }

  let status: OperatorStatus | null = null;
  let error = '';
  let timer: ReturnType<typeof setInterval> | undefined;

  const childOrder: RobotOperatorChildId[] = ['robot-status', 'robot-goal-review', 'boredom-observer', 'boredom-movement', 'boredom-reflection'];
  const childLabels: Record<RobotOperatorChildId, string> = {
    'robot-status': 'Robot Status',
    'robot-goal-review': 'Robot Goal Review',
    'boredom-observer': 'Boredom Observer',
    'boredom-movement': 'Boredom Movement',
    'boredom-reflection': 'Boredom Reflection',
  };

  function localTime(value?: string): string {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }

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
    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Robot autonomy admission above the single deterministic work coordinator.</p>
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
        <div class="text-xs text-gray-500 dark:text-gray-400">Full-mode cooldown</div>
        <div class="mt-1 font-semibold text-gray-900 dark:text-gray-100">{Math.round(status.config.cooldownMs / 1000)}s</div>
      </div>
    </div>

    {#if status.healthMessage}
      <div class="mb-4 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">{status.healthMessage}</div>
    {/if}

    <section class="mb-4 rounded border border-gray-200 dark:border-gray-800">
      <div class="border-b border-gray-200 p-3 dark:border-gray-800">
        <div class="font-semibold text-gray-900 dark:text-gray-100">Robot Operator</div>
        <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Robot-side workflow scheduler. Every child and Robot Autonomy Executor run once and end; later work begins as a new scheduled workflow.
        </div>
      </div>
      {#if !status.robotOperator.runtime}
        <div class="p-4 text-gray-500 dark:text-gray-400">No Robot Operator runtime state has been published yet.</div>
      {:else}
        <div class="border-b border-gray-200 p-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <span class="font-medium text-gray-800 dark:text-gray-200">{status.robotOperator.runtime.lifecycle}</span>
          · {status.robotOperator.runtime.reason}
          {#if status.robotOperator.runtime.mode === 'full' && status.robotOperator.runtime.fullCooldownMs}
            · next episode begins after completion plus a {Math.round(status.robotOperator.runtime.fullCooldownMs / 1000)}s cooldown
          {:else if status.robotOperator.runtime.mode === 'semi'}
            · independent idle timers
          {/if}
        </div>
        <div class="grid gap-0 divide-y divide-gray-200 dark:divide-gray-800 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {#each childOrder as childId}
            {@const child = status.robotOperator.runtime.children[childId]}
            <div class="p-3">
              <div class="flex items-center justify-between gap-2">
                <span class="font-medium text-gray-900 dark:text-gray-100">{childLabels[childId]}</span>
                <span class={child.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}>
                  {child.enabled ? 'enabled' : 'disabled'}
                </span>
              </div>
              <div class="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                <div>Graph: {child.graph}</div>
                <div>Next: {localTime(child.nextRunAt)}</div>
                <div>Last admitted: {localTime(child.lastAdmittedAt)}</div>
                <div>Outcome: {child.lastOutcome || '—'}</div>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="border-t border-gray-200 p-3 font-medium text-gray-900 dark:border-gray-800 dark:text-gray-100">Recent boredom episodes</div>
      {#if status.robotOperator.episodes.length === 0}
        <div class="border-t border-gray-200 p-4 text-gray-500 dark:border-gray-800 dark:text-gray-400">No boredom episodes recorded.</div>
      {:else}
        <div class="divide-y divide-gray-200 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {#each status.robotOperator.episodes as episode}
            <div class="p-3">
              <div class="flex justify-between gap-3">
                <span class="font-medium text-gray-900 dark:text-gray-100">{childLabels[episode.child] || episode.child}</span>
                <span class="text-xs text-gray-500 dark:text-gray-400">{episode.state}</span>
              </div>
              <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {localTime(episode.createdAt)} · {episode.source} · {episode.downstreamCount} downstream · {episode.outcome}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

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
