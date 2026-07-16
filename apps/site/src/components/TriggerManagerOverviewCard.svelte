<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { openTriggerManagerDashboard } from '../stores/navigation';
  import { autonomyModeDefinition } from '../lib/client/active-operator-modes';
  import { triggerManagerSnapshot, useTriggerManager } from '../lib/stores/trigger-manager';

  let release: (() => void) | undefined;
  $: next = $triggerManagerSnapshot?.triggers.find(trigger => trigger.enabled && trigger.nextRun);
  $: mode = autonomyModeDefinition($triggerManagerSnapshot?.autonomyMode || 'reactive');
  onMount(() => release = useTriggerManager());
  onDestroy(() => release?.());

  function absolute(timestamp?: string): string {
    if (!timestamp || !$triggerManagerSnapshot) return 'No scheduled trigger';
    return new Intl.DateTimeFormat(undefined, {
      timeZone: $triggerManagerSnapshot.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  }
</script>

<button class="card w-full p-5 text-left" on:click={openTriggerManagerDashboard}>
  <div class="flex items-start justify-between gap-3">
    <div>
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">⏱️ Trigger Manager</h3>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Live producer state above the Work Coordinator</p>
    </div>
    <span class="rounded bg-violet-500/10 px-2 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">{mode.badge} · {mode.label}</span>
  </div>
  <div class="mt-4 grid gap-3 sm:grid-cols-3">
    <div><div class="text-xs text-gray-500">Lifecycle</div><div class="font-semibold capitalize">{$triggerManagerSnapshot?.lifecycle || 'starting'}</div></div>
    <div><div class="text-xs text-gray-500">Admission</div><div class="font-semibold">{$triggerManagerSnapshot?.admissionPaused ? 'Paused' : $triggerManagerSnapshot?.admissionEnabled ? 'Enabled' : 'Suppressed'}</div></div>
    <div><div class="text-xs text-gray-500">Next due</div><div class="font-semibold">{next?.displayName || 'None'}</div><div class="text-xs text-gray-500">{absolute(next?.nextRun)}</div></div>
  </div>
</button>
