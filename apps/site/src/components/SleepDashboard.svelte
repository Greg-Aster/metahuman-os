<script lang="ts">
  import { apiFetch } from '../lib/client/api-config'
  import { sleepStatus, type SleepSessionStatus, type SleepStageStatus } from '../lib/stores/sleep-status'

  let notice = ''
  let error = ''
  let running = false

  $: current = $sleepStatus?.currentSession ?? null
  $: stages = current?.stages ?? ($sleepStatus?.configuredStages ?? []).map(stage => ({ ...stage, state: 'pending' as const }))
  $: latest = $sleepStatus?.recentSessions?.[0] ?? null

  function formatTime(value?: string): string {
    return value ? new Date(value).toLocaleString() : '—'
  }

  function duration(session: SleepSessionStatus): string {
    const end = session.completedAt ? Date.parse(session.completedAt) : Date.now()
    const minutes = Math.max(0, Math.round((end - Date.parse(session.startedAt)) / 60_000))
    return minutes < 1 ? '<1 minute' : `${minutes} minute${minutes === 1 ? '' : 's'}`
  }

  function stageDetail(stage: SleepStageStatus): string {
    if (stage.error) return stage.error
    if (stage.state === 'running' && stage.maxAttempts) return `Attempt ${(stage.attempt ?? 0) + 1} of ${stage.maxAttempts}`
    return stage.handler
  }

  async function runNow() {
    running = true
    notice = ''
    error = ''
    try {
      const response = await apiFetch('/api/unified-queue/trigger/sleep-workflow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ args: [] }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not start the Sleep Workflow')
      notice = `Sleep Workflow queued as ${data.taskId}`
    } catch (caught) {
      error = (caught as Error).message
    } finally {
      running = false
    }
  }
</script>

<div class="h-full overflow-y-auto p-4 text-sm">
  <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Sleep</h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Memory housekeeping, desire processing, dreaming, and indexing while awake autonomy is paused.</p>
    </div>
    <button
      class="rounded bg-indigo-600 px-3 py-2 font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={running || Boolean(current) || !$sleepStatus?.config.enabled}
      on:click={runNow}
    >
      {running ? 'Queuing…' : current ? 'Sleep in progress' : 'Run sleep now'}
    </button>
  </div>

  {#if error}<div class="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-red-600 dark:text-red-300">{error}</div>{/if}
  {#if notice}<div class="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-300">{notice}</div>{/if}

  {#if !$sleepStatus}
    <div class="py-12 text-center text-gray-500 dark:text-gray-400">Loading sleep status…</div>
  {:else}
    <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded border border-gray-200 p-3 dark:border-gray-800">
        <div class="text-xs text-gray-500 dark:text-gray-400">System phase</div>
        <div class="mt-1 font-semibold uppercase text-gray-900 dark:text-gray-100">{$sleepStatus.status}</div>
      </div>
      <div class="rounded border border-gray-200 p-3 dark:border-gray-800">
        <div class="text-xs text-gray-500 dark:text-gray-400">Schedule</div>
        <div class="mt-1 font-semibold text-gray-900 dark:text-gray-100">{$sleepStatus.config.window.start}–{$sleepStatus.config.window.end}</div>
      </div>
      <div class="rounded border border-gray-200 p-3 dark:border-gray-800">
        <div class="text-xs text-gray-500 dark:text-gray-400">Idle before sleep</div>
        <div class="mt-1 font-semibold text-gray-900 dark:text-gray-100">{$sleepStatus.config.minIdleMins} minutes</div>
      </div>
      <div class="rounded border border-gray-200 p-3 dark:border-gray-800">
        <div class="text-xs text-gray-500 dark:text-gray-400">Pipeline</div>
        <div class="mt-1 font-semibold text-gray-900 dark:text-gray-100">{stages.length} sequential stages</div>
      </div>
    </div>

    <section class="mb-4 rounded border border-gray-200 dark:border-gray-800">
      <div class="border-b border-gray-200 p-3 dark:border-gray-800">
        <div class="font-semibold text-gray-900 dark:text-gray-100">{current ? 'Current sleep cycle' : 'Sleep pipeline'}</div>
        {#if current}<div class="mt-1 text-xs text-gray-500 dark:text-gray-400">Started {formatTime(current.startedAt)} · {duration(current)}</div>{/if}
      </div>
      <div class="divide-y divide-gray-200 dark:divide-gray-800">
        {#each stages as stage, index}
          <div class="flex items-start gap-3 p-3">
            <div class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold {stage.state === 'completed' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : stage.state === 'running' ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' : stage.state === 'failed' ? 'bg-red-500/15 text-red-700 dark:text-red-300' : 'bg-gray-500/10 text-gray-500'}">{index + 1}</div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap justify-between gap-2">
                <span class="font-medium text-gray-900 dark:text-gray-100">{stage.displayName}</span>
                <span class="text-xs uppercase text-gray-500 dark:text-gray-400">{stage.state}</span>
              </div>
              <div class="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{stageDetail(stage)}</div>
            </div>
          </div>
        {/each}
      </div>
    </section>

    <section class="mb-4 rounded border border-gray-200 p-3 dark:border-gray-800">
      <h3 class="font-semibold text-gray-900 dark:text-gray-100">Latest cycle review</h3>
      {#if latest}
        <div class="mt-2 grid gap-2 text-xs text-gray-600 dark:text-gray-300 sm:grid-cols-4">
          <span>Status: <strong class="uppercase">{latest.state}</strong></span>
          <span>Started: {formatTime(latest.startedAt)}</span>
          <span>Duration: {duration(latest)}</span>
          <span>Problems: {latest.stages.filter(stage => stage.state === 'failed' || stage.state === 'cancelled').length}</span>
        </div>
      {:else}
        <p class="mt-2 text-gray-500 dark:text-gray-400">No completed sleep cycle has been recorded yet.</p>
      {/if}
    </section>

  {/if}
</div>
