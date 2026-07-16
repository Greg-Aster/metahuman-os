<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { openTriggerManagerSettings } from '../stores/navigation';
  import { autonomyModeDefinition } from '../lib/client/active-operator-modes';
  import {
    reloadTriggerConfig,
    runTriggerNow,
    setTriggerAdmissionPaused,
    triggerManagerConnection,
    triggerManagerError,
    triggerManagerSnapshot,
    useTriggerManager,
    type TriggerView,
  } from '../lib/stores/trigger-manager';

  let release: (() => void) | undefined;
  let clock: ReturnType<typeof setInterval> | undefined;
  let now = Date.now();
  let offsetMs = 0;
  let anchoredServerTime = '';
  let busy = '';

  $: if ($triggerManagerSnapshot?.serverTime && $triggerManagerSnapshot.serverTime !== anchoredServerTime) {
    anchoredServerTime = $triggerManagerSnapshot.serverTime;
    offsetMs = Date.parse(anchoredServerTime) - Date.now();
  }
  $: mode = autonomyModeDefinition($triggerManagerSnapshot?.autonomyMode || 'reactive');
  $: timeline = ($triggerManagerSnapshot?.triggers || []).filter(trigger => trigger.enabled && trigger.nextRun).slice(0, 12);
  $: health = [
    ...($triggerManagerSnapshot?.healthFindings || []),
    ...($triggerManagerConnection !== 'live' ? [`State stream is ${$triggerManagerConnection}.`] : []),
    ...($triggerManagerError ? [$triggerManagerError] : []),
  ];

  function absolute(timestamp?: string): string {
    if (!timestamp || !$triggerManagerSnapshot) return '—';
    return new Intl.DateTimeFormat(undefined, {
      timeZone: $triggerManagerSnapshot.timezone,
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(new Date(timestamp));
  }

  function countdown(timestamp?: string): string {
    if (!timestamp) return '—';
    const remaining = Date.parse(timestamp) - (now + offsetMs);
    if (remaining <= 0) return 'due now';
    const seconds = Math.ceil(remaining / 1_000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3_600) return `${Math.ceil(seconds / 60)}m`;
    return `${Math.ceil(seconds / 3_600)}h`;
  }

  function timing(trigger: TriggerView): string {
    if (trigger.type === 'interval') return `Every ${trigger.interval}s`;
    if (trigger.type === 'activity') return `After ${trigger.inactivityThreshold}s inactivity`;
    if (trigger.type === 'time-of-day') return `Daily ${trigger.schedule} ${$triggerManagerSnapshot?.timezone || ''}`;
    if (trigger.type === 'event') {
      const threshold = trigger.eventCountThreshold && trigger.eventCountThreshold > 1
        ? ` every ${trigger.eventCountThreshold} matches`
        : '';
      const idle = trigger.idleResetSeconds ? ` · baseline after ${trigger.idleResetSeconds}s idle` : '';
      return `Event ${trigger.eventPattern}${threshold}${idle}`;
    }
    return 'Manual only';
  }

  function suppression(trigger: TriggerView): string {
    if (!trigger.enabled) return 'Disabled in configuration';
    if (!trigger.handlerRegistered) return `Handler ${trigger.handler} is not registered`;
    if (!trigger.sourceResolvable) return 'Executable source cannot be resolved';
    if ($triggerManagerSnapshot?.admissionPaused) return 'Trigger admissions are paused';
    if (!trigger.eligibleInCurrentMode) return `Not admitted in ${mode.label} mode`;
    return trigger.lastSuppressionReason || 'Eligible';
  }

  async function action(name: string, fn: () => Promise<unknown>) {
    if (busy) return;
    busy = name;
    try {
      await fn();
    } catch (error) {
      alert((error as Error).message);
    } finally {
      busy = '';
    }
  }

  function runNow(trigger: TriggerView) {
    if (!confirm(`Queue one ${trigger.displayName} run through the Work Coordinator?`)) return;
    void action(`run:${trigger.id}`, () => runTriggerNow(trigger.id));
  }

  onMount(() => {
    release = useTriggerManager();
    clock = setInterval(() => now = Date.now(), 1_000);
  });
  onDestroy(() => {
    release?.();
    if (clock) clearInterval(clock);
  });
</script>

<div class="h-full overflow-y-auto p-4 text-sm">
  <header class="mb-4 rounded border border-gray-200 p-4 dark:border-gray-800">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Trigger Manager</h2>
        <p class="mt-1 text-gray-500 dark:text-gray-400">Configured clocks and event admissions feeding the single Work Coordinator.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="rounded border px-3 py-2 text-xs dark:border-gray-700" on:click={openTriggerManagerSettings}>Settings</button>
        <button class="rounded border px-3 py-2 text-xs dark:border-gray-700" disabled={!!busy} on:click={() => action('reload', reloadTriggerConfig)}>Reload config</button>
        <button class="rounded border border-violet-500 px-3 py-2 text-xs text-violet-700 dark:text-violet-300" disabled={!$triggerManagerSnapshot || !!busy} on:click={() => $triggerManagerSnapshot && action('pause', () => setTriggerAdmissionPaused(!$triggerManagerSnapshot!.admissionPaused))}>
          {$triggerManagerSnapshot?.admissionPaused ? 'Resume admissions' : 'Pause admissions'}
        </button>
      </div>
    </div>

    {#if $triggerManagerSnapshot}
      <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div><div class="text-xs text-gray-500">Lifecycle</div><div class="font-semibold capitalize">{$triggerManagerSnapshot.lifecycle}</div></div>
        <div><div class="text-xs text-gray-500">Operator mode</div><div class="font-semibold">{mode.label}</div></div>
        <div><div class="text-xs text-gray-500">Admission</div><div class="font-semibold">{$triggerManagerSnapshot.admissionPaused ? 'Paused' : $triggerManagerSnapshot.admissionEnabled ? 'Enabled' : 'Suppressed'}</div></div>
        <div><div class="text-xs text-gray-500">Server clock</div><div class="font-semibold">{absolute(new Date(now + offsetMs).toISOString())}</div></div>
        <div><div class="text-xs text-gray-500">Timezone</div><div class="font-semibold">{$triggerManagerSnapshot.timezone}</div></div>
        <div><div class="text-xs text-gray-500">Config</div><div class="font-semibold">r{$triggerManagerSnapshot.config.runtimeRevision ?? '—'} · {$triggerManagerSnapshot.config.scope}</div><div class="text-xs text-gray-500">{$triggerManagerConnection}</div></div>
      </div>
    {/if}
  </header>

  {#if !$triggerManagerSnapshot}
    <div class="py-12 text-center text-gray-500">Waiting for authoritative Trigger Manager state…</div>
  {:else}
    <section class="mb-4 rounded border border-gray-200 dark:border-gray-800">
      <div class="border-b border-gray-200 p-3 font-semibold dark:border-gray-800">Next trigger timeline</div>
      {#if timeline.length === 0}
        <div class="p-4 text-gray-500">No enabled trigger currently has a scheduled due time.</div>
      {:else}
        <div class="divide-y divide-gray-200 dark:divide-gray-800">
          {#each timeline as trigger}
            <div class="grid gap-2 p-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1fr)_7rem_10rem]">
              <div><div class="font-medium">{trigger.displayName}</div><div class="text-xs text-gray-500">{trigger.type} · {timing(trigger)}</div></div>
              <div><div>{absolute(trigger.nextRun)}</div><div class="text-xs text-gray-500">{countdown(trigger.nextRun)} until due</div></div>
              <div class="text-xs"><span class="rounded px-2 py-1 {trigger.eligibleInCurrentMode ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}">{trigger.eligibleInCurrentMode ? 'eligible' : 'suppressed'}</span></div>
              <div class="text-xs text-gray-500">Will queue {trigger.handler}</div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class="mb-4 rounded border border-gray-200 dark:border-gray-800">
      <div class="border-b border-gray-200 p-3 font-semibold dark:border-gray-800">Configured finite work</div>
      <div class="grid gap-3 p-3 lg:grid-cols-2">
        {#each $triggerManagerSnapshot.triggers.filter(trigger => trigger.lifecycle !== 'service') as trigger}
          <article class="rounded border border-gray-200 p-3 dark:border-gray-800">
            <div class="flex items-start justify-between gap-3">
              <div><div class="font-semibold">{trigger.displayName}</div><div class="mt-1 text-xs text-gray-500">{trigger.lifecycle} · {timing(trigger)}</div></div>
              <button class="rounded border px-2 py-1 text-xs disabled:opacity-50 dark:border-gray-700" disabled={!trigger.enabled || !!busy || !trigger.handlerRegistered || !trigger.sourceResolvable} on:click={() => runNow(trigger)}>Run now</button>
            </div>
            <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div><span class="text-gray-500">Last due:</span> {absolute(trigger.lastDueAt)}</div>
              <div><span class="text-gray-500">Last admitted:</span> {absolute(trigger.lastAdmittedAt)}</div>
              <div><span class="text-gray-500">Latest work:</span> {trigger.lastTaskId ? `${trigger.lastTaskId.slice(0, 8)} · ${trigger.lastTaskState || trigger.lastOutcome || 'unknown'}` : 'none'}</div>
              <div><span class="text-gray-500">Totals:</span> {trigger.runCount} runs · {trigger.errorCount} errors · {trigger.suppressionCount} suppressed</div>
            </div>
            <div class="mt-3 rounded bg-gray-100 p-2 text-xs dark:bg-gray-900"><span class="font-medium">Admission explanation:</span> {suppression(trigger)}</div>
          </article>
        {/each}
      </div>
    </section>

    <div class="grid gap-4 lg:grid-cols-2">
      <section class="rounded border border-gray-200 dark:border-gray-800">
        <div class="border-b border-gray-200 p-3 font-semibold dark:border-gray-800">Recent admissions</div>
        {#if $triggerManagerSnapshot.recentAdmissions.length === 0}
          <div class="p-4 text-gray-500">No Trigger Manager admissions in this runtime.</div>
        {:else}
          <div class="divide-y divide-gray-200 dark:divide-gray-800">
            {#each $triggerManagerSnapshot.recentAdmissions as admission}
              <div class="p-3 text-xs"><div class="font-medium">{admission.triggerId} → {admission.taskId}</div><div class="mt-1 text-gray-500">due → admitted → {admission.state || admission.outcome || 'queued'} · {absolute(admission.admittedAt)}</div></div>
            {/each}
          </div>
        {/if}
      </section>
      <section class="rounded border border-gray-200 dark:border-gray-800">
        <div class="border-b border-gray-200 p-3 font-semibold dark:border-gray-800">Health findings</div>
        {#if health.length === 0}
          <div class="p-4 text-emerald-700 dark:text-emerald-300">No trigger handler, source, revision, clock, or stream findings.</div>
        {:else}
          <ul class="list-disc space-y-2 p-4 pl-8 text-amber-700 dark:text-amber-300">{#each health as finding}<li>{finding}</li>{/each}</ul>
        {/if}
      </section>
    </div>
  {/if}
</div>
