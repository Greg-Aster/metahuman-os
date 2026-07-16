<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { openTriggerManagerDashboard } from '../stores/navigation';
  import {
    setTriggerAdmissionPaused,
    triggerManagerConnection,
    triggerManagerError,
    triggerManagerSnapshot,
    useTriggerManager,
  } from '../lib/stores/trigger-manager';
  import { autonomyModeDefinition } from '../lib/client/active-operator-modes';

  let now = Date.now();
  let offsetMs = 0;
  let anchoredServerTime = '';
  let release: (() => void) | undefined;
  let clock: ReturnType<typeof setInterval> | undefined;
  let busy = false;

  $: if ($triggerManagerSnapshot?.serverTime && $triggerManagerSnapshot.serverTime !== anchoredServerTime) {
    anchoredServerTime = $triggerManagerSnapshot.serverTime;
    offsetMs = Date.parse(anchoredServerTime) - Date.now();
  }
  $: nextTriggers = ($triggerManagerSnapshot?.triggers || [])
    .filter(trigger => trigger.enabled && trigger.nextRun)
    .slice(0, 3);
  $: latest = $triggerManagerSnapshot?.recentAdmissions?.[0];
  $: mode = autonomyModeDefinition($triggerManagerSnapshot?.autonomyMode || 'reactive');

  function until(timestamp?: string): string {
    if (!timestamp) return 'not scheduled';
    const remaining = Date.parse(timestamp) - (now + offsetMs);
    if (remaining <= 0) return 'due now';
    if (remaining < 60_000) return `in ${Math.ceil(remaining / 1_000)}s`;
    if (remaining < 3_600_000) return `in ${Math.ceil(remaining / 60_000)}m`;
    return `in ${Math.ceil(remaining / 3_600_000)}h`;
  }

  async function toggleAdmission() {
    if (!$triggerManagerSnapshot || busy) return;
    busy = true;
    try {
      await setTriggerAdmissionPaused(!$triggerManagerSnapshot.admissionPaused);
    } catch (error) {
      alert((error as Error).message);
    } finally {
      busy = false;
    }
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

<section class="mb-3 rounded border border-violet-500/30 bg-violet-500/5 p-2 text-xs">
  <div class="flex items-start justify-between gap-2">
    <button class="min-w-0 text-left" on:click={openTriggerManagerDashboard} title="Open the full Trigger Manager dashboard">
      <div class="font-semibold text-gray-900 dark:text-gray-100">Trigger Manager</div>
      <div class="mt-0.5 text-[0.7rem] text-gray-500 dark:text-gray-400">
        {$triggerManagerSnapshot?.lifecycle || 'starting'} · {mode.label} · {$triggerManagerConnection}
      </div>
    </button>
    <button
      class="rounded border border-gray-300 px-2 py-1 text-[0.7rem] disabled:opacity-50 dark:border-gray-700"
      disabled={!$triggerManagerSnapshot || busy}
      on:click={toggleAdmission}
    >{$triggerManagerSnapshot?.admissionPaused ? 'Resume admission' : 'Pause admission'}</button>
  </div>

  {#if $triggerManagerError}
    <div class="mt-2 text-red-600 dark:text-red-300">{$triggerManagerError}</div>
  {:else if $triggerManagerSnapshot}
    <div class="mt-2 rounded bg-white/70 p-2 dark:bg-black/20">
      <div class="font-medium text-gray-900 dark:text-gray-100">
        {$triggerManagerSnapshot.admissionPaused
          ? 'Timer admissions paused'
          : $triggerManagerSnapshot.autonomyMode === 'reactive'
            ? 'Clock visible; proactive work suppressed'
            : 'Eligible timer admissions enabled'}
      </div>
      <div class="mt-1 text-[0.7rem] text-gray-500 dark:text-gray-400">Timezone: {$triggerManagerSnapshot.timezone}</div>
    </div>

    <div class="mt-2 space-y-1">
      {#if nextTriggers.length === 0}
        <div class="text-gray-500 dark:text-gray-400">No enabled trigger has a scheduled due time.</div>
      {:else}
        {#each nextTriggers as trigger}
          <div class="flex justify-between gap-2">
            <span class="truncate text-gray-800 dark:text-gray-200">{trigger.displayName}</span>
            <span class="shrink-0 {trigger.eligibleInCurrentMode ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}">
              {until(trigger.nextRun)}{trigger.eligibleInCurrentMode ? '' : ' · suppressed'}
            </span>
          </div>
        {/each}
      {/if}
    </div>

    {#if latest}
      <div class="mt-2 border-t border-gray-200 pt-2 text-[0.7rem] text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Latest admission: {latest.triggerId} → {latest.taskId.slice(0, 8)} · {latest.state || latest.outcome || 'queued'}
      </div>
    {/if}
  {/if}
</section>
