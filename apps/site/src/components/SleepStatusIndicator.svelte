<script lang="ts">
  import { sleepStatus, type SleepStatus } from '../lib/stores/sleep-status'

  const statusLabels: Record<SleepStatus['status'], string> = {
    awake: 'Awake',
    sleeping: 'Sleeping',
    dreaming: 'Dreaming',
  }

  const statusIcons: Record<SleepStatus['status'], string> = {
    awake: '☀️',
    sleeping: '😴',
    dreaming: '🌙',
  }

  const statusStyles: Record<SleepStatus['status'], string> = {
    awake: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
    sleeping: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100',
    dreaming: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
  }

  $: currentStatus = $sleepStatus?.status ?? 'awake'
  $: label = $sleepStatus ? statusLabels[currentStatus] : 'Loading…'
  $: icon = $sleepStatus ? statusIcons[currentStatus] : '⏳'
  $: styleClass = $sleepStatus ? statusStyles[currentStatus] : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
  $: subtitle = $sleepStatus?.learningsFile
    ? `Latest learnings: ${$sleepStatus.learningsFile}`
    : 'Nightly learnings will appear after the next sleep cycle.'
</script>

<div class="sleep-status-card space-y-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900">
  <div class="flex items-center justify-between">
    <span class="text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Sleep Cycle</span>
    <span class="text-xs text-gray-400 dark:text-gray-500">
      {$sleepStatus ? new Date($sleepStatus.lastChecked).toLocaleTimeString() : '—'}
    </span>
  </div>
  <div class={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${styleClass}`}>
    <div class="flex items-center gap-2">
      <span class="text-lg leading-none">{icon}</span>
      <span>{label}</span>
    </div>
  </div>
  <div class="text-xs text-gray-500 dark:text-gray-400">
    {#if $sleepStatus}
      {subtitle}
    {:else}
      Checking sleep systems…
    {/if}
  </div>
</div>

<style>
  .sleep-status-card {
    backdrop-filter: blur(6px);
  }
</style>
