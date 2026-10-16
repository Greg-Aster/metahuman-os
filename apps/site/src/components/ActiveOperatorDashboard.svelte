<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ActiveOperatorSettings from './ActiveOperatorSettings.svelte';
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

  type RobotOperatorChildId = 'robot-autonomy-controller' | 'robot-status' | 'robot-goal-review' | 'boredom-observer' | 'boredom-movement' | 'boredom-reflection';

  interface RobotOperatorChildRuntime {
    id: RobotOperatorChildId;
    enabled: boolean;
    handler: string;
    graph: string;
    lastAdmittedAt?: string;
    lastTaskId?: string;
    lastOutcome?: string;
  }

  interface AutonomyEpisode {
    id: string;
    child: RobotOperatorChildId;
    handler: string;
    state: string;
    source: string;
    createdAt: string;
    completedAt?: string;
    downstreamCount: number;
    outcome: string;
  }

  interface Operation {
    id: string; name: string; description: string; activation: number;
    lastAssessment: { assessedAt: string; reason: string; instruction: string } | null;
    recordedActivity: { id: string; state: string; createdAt: string; completedAt?: string; result?: { executions?: { executionId: string; status: string }[] } }[];
  }
  interface Assessment { assessedAt: string; levels: Record<string, { activation: number }> }
  interface OperatorStatus {
    operations: Operation[];
    assessments: Assessment[];
    mode: 'reactive' | 'semi' | 'full';
    health: string;
    healthMessage?: string;
    isExecuting: boolean;
    queue: { length: number; tasks: WorkSummary[] };
    robotOperator: {
      runtime: {
        updatedAt: string;
        mode: 'reactive' | 'semi' | 'full';
        lifecycle: string;
        reason: string;
        children: Record<RobotOperatorChildId, RobotOperatorChildRuntime>;
      } | null;
      episodes: AutonomyEpisode[];
    };
  }

  let status: OperatorStatus | null = null;
  let error = '';
  let timer: ReturnType<typeof setInterval> | undefined;

  const childLabels: Record<RobotOperatorChildId, string> = {
    'robot-autonomy-controller': 'Autonomy Controller',
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

  function activationPoints(id: string): string {
    const samples = [...(status?.assessments ?? [])].reverse();
    return samples.map((sample, index) => `${samples.length > 1 ? index * 240 / (samples.length - 1) : 0},${60 - (sample.levels[id]?.activation ?? 0) * 0.6}`).join(' ');
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
    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Context-driven activation for self-directed activities.</p>
  </div>

  <ActiveOperatorSettings />

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
        <div class="text-xs text-gray-500 dark:text-gray-400">Scheduling</div>
        <div class="mt-1 font-semibold text-gray-900 dark:text-gray-100">Activation levels</div>
      </div>
    </div>

    {#if status.healthMessage}
      <div class="mb-4 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">{status.healthMessage}</div>
    {/if}

    <section class="mb-4 rounded border border-gray-200 dark:border-gray-800">
      <div class="border-b border-gray-200 p-3 dark:border-gray-800">
        <div class="font-semibold text-gray-900 dark:text-gray-100">Active Operator</div>
        <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Semi Auto requests operations updated to 100%. Full Auto requests the highest returned activation, even below 100%. Reactive is dormant. Levels are selected by the model; requested work and completed results are recorded separately.
        </div>
      </div>
      {#if !status.robotOperator.runtime}
        <div class="p-4 text-gray-500 dark:text-gray-400">No Active Operator runtime state has been published yet.</div>
      {:else}
        <div class="border-b border-gray-200 p-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <span class="font-medium text-gray-800 dark:text-gray-200">{status.robotOperator.runtime.lifecycle}</span>
          · {status.robotOperator.runtime.reason}
        </div>
      {/if}
      <div class="grid gap-3 p-3 md:grid-cols-2">
        {#each status.operations as operation (operation.id)}
          <article class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <div class="flex justify-between gap-3">
              <h3 class="font-semibold">{operation.name}</h3>
              <span class="font-mono text-lg">{operation.activation}%</span>
            </div>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{operation.description}</p>
            <div class="my-3 h-2 overflow-hidden rounded bg-gray-200 dark:bg-gray-800" role="meter" aria-label={`${operation.name} activation`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={operation.activation}>
              <div class="h-full bg-violet-500" style={`width: ${operation.activation}%`}></div>
            </div>
            {#if status.assessments.length}
              <svg viewBox="0 0 240 64" class="h-16 w-full" role="img" aria-label={`${operation.name} recent activation`}>
                <title>Recent assessments, oldest to newest; 0 to 100 percent</title>
                <line x1="0" y1="1" x2="240" y2="1" stroke="currentColor" opacity="0.15" stroke-dasharray="3 3" />
                <polyline points={activationPoints(operation.id)} fill="none" stroke="#8b5cf6" stroke-width="2" />
              </svg>
            {/if}
            <p class="mt-2 text-xs">{operation.lastAssessment?.reason || 'Not yet assessed'}</p>
            {#if operation.lastAssessment}
              <details class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                <summary>Assessment and activity</summary>
                <p class="mt-2">{localTime(operation.lastAssessment.assessedAt)}</p>
                <p class="mt-1 whitespace-pre-wrap">{operation.lastAssessment.instruction}</p>
                {#each operation.recordedActivity as activity}
                  <p class="mt-1">Admission: {activity.state} · {localTime(activity.completedAt || activity.createdAt)}</p>
                  {#each activity.result?.executions ?? [] as execution}
                    <p>Execution: {execution.status}</p>
                  {/each}
                {/each}
              </details>
            {/if}
          </article>
        {/each}
      </div>

      <div class="border-t border-gray-200 p-3 font-medium text-gray-900 dark:border-gray-800 dark:text-gray-100">Recent autonomy activity</div>
      {#if status.robotOperator.episodes.length === 0}
        <div class="border-t border-gray-200 p-4 text-gray-500 dark:border-gray-800 dark:text-gray-400">No autonomy activity recorded.</div>
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
