<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';
  import { isOwner } from '../stores/security-policy';

  // Types
  interface LogEntry {
    id: string;
    timestamp: string;
    cycleNumber: number;
    username: string;
    decision: {
      task: string | null;
      reasoning: string;
      triggersEvaluated: number;
      triggersFired: string[];
    };
    execution?: {
      success: boolean;
      durationMs: number;
      error?: string;
    };
    context: {
      queueLength: number;
      systemState: Record<string, unknown>;
      scratchpadSize: number;
    };
    bigBrotherReview?: {
      triggeredAt: string;
      reason: string;
      suggestions: string[];
    };
  }

  interface LogSummary {
    totalCycles: number;
    tasksExecuted: number;
    successRate: number;
    bigBrotherReviews: number;
    errorsDetected: number;
    tasksByType: Record<string, number>;
  }

  // State
  let entries: LogEntry[] = [];
  let summary: LogSummary | null = null;
  let availableDates: string[] = [];
  let selectedDate = new Date().toISOString().split('T')[0];
  let loading = true;
  let error = '';
  let triggeringReview = false;
  let reviewResult: { success: boolean; reasoning?: string; suggestions?: string[] } | null = null;

  // Polling
  let pollInterval: ReturnType<typeof setInterval>;

  async function loadLogs() {
    try {
      loading = true;
      error = '';

      const res = await apiFetch(`/api/lizard-brain/logs?date=${selectedDate}`);
      if (res.ok) {
        const data = await res.json();
        entries = data.entries || [];
        summary = data.summary || null;
      } else {
        const errData = await res.json();
        error = errData.error || 'Failed to load logs';
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function loadAvailableDates() {
    try {
      const res = await apiFetch('/api/lizard-brain/logs?list=true');
      if (res.ok) {
        const data = await res.json();
        availableDates = data.dates || [];
      }
    } catch (e) {
      console.error('Failed to load available dates:', e);
    }
  }

  async function triggerReview() {
    if (!$isOwner) {
      error = 'Only owners can trigger Big Brother reviews';
      return;
    }

    triggeringReview = true;
    reviewResult = null;
    error = '';

    try {
      const res = await apiFetch('/api/lizard-brain/trigger-review', {
        method: 'POST',
      });

      if (res.ok) {
        reviewResult = await res.json();
        // Reload logs to show new review
        await loadLogs();
      } else {
        const errData = await res.json();
        error = errData.error || 'Failed to trigger review';
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      triggeringReview = false;
    }
  }

  function handleDateChange() {
    loadLogs();
  }

  function formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  onMount(() => {
    loadLogs();
    loadAvailableDates();
    // Poll every 30 seconds
    pollInterval = setInterval(loadLogs, 30000);
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });
</script>

<div class="card p-4 max-h-[600px] overflow-y-auto">
  <div class="flex justify-between items-center mb-4">
    <h3 class="m-0 text-base font-semibold text-white">Lizard Brain Activity</h3>
    <div class="flex gap-2 items-center">
      <select class="form-input py-1 px-2 text-sm" bind:value={selectedDate} on:change={handleDateChange}>
        {#if availableDates.length === 0}
          <option value={selectedDate}>{selectedDate}</option>
        {:else}
          {#each availableDates as date}
            <option value={date}>{date}</option>
          {/each}
        {/if}
      </select>
      {#if $isOwner}
        <button
          class="py-1 px-3 bg-orange-500 hover:bg-orange-600 border-0 rounded text-white text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          on:click={triggerReview}
          disabled={triggeringReview}
        >
          {triggeringReview ? 'Reviewing...' : 'Trigger Review'}
        </button>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="banner banner-error mb-4">{error}</div>
  {/if}

  {#if reviewResult}
    <div class="review-result" class:success={reviewResult.success}>
      <div class="font-semibold mb-2" class:text-green-500={reviewResult.success} class:text-orange-500={!reviewResult.success}>
        Big Brother Review {reviewResult.success ? 'Complete' : 'Failed'}
      </div>
      {#if reviewResult.reasoning}
        <div class="text-sm text-gray-400 mb-2">{reviewResult.reasoning}</div>
      {/if}
      {#if reviewResult.suggestions && reviewResult.suggestions.length > 0}
        <ul class="m-0 pl-5 text-xs text-gray-500">
          {#each reviewResult.suggestions as suggestion}
            <li>{suggestion}</li>
          {/each}
        </ul>
      {/if}
      <button class="btn-ghost text-xs mt-2" on:click={() => reviewResult = null}>Dismiss</button>
    </div>
  {/if}

  {#if summary}
    <div class="grid grid-cols-5 gap-2 mb-4">
      {#each [
        { value: summary.totalCycles, label: 'Cycles' },
        { value: summary.tasksExecuted, label: 'Tasks' },
        { value: `${(summary.successRate * 100).toFixed(0)}%`, label: 'Success' },
        { value: summary.bigBrotherReviews, label: 'Reviews' },
        { value: summary.errorsDetected, label: 'Errors' }
      ] as stat}
        <div class="bg-white/5 p-2 rounded text-center">
          <span class="block text-xl font-semibold text-white">{stat.value}</span>
          <span class="text-[0.7rem] text-gray-500 uppercase">{stat.label}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if loading && entries.length === 0}
    <div class="py-8 text-center text-gray-500">Loading...</div>
  {:else if entries.length === 0}
    <div class="py-8 text-center text-gray-500">No activity logged for {selectedDate}</div>
  {:else}
    <div class="flex flex-col gap-2">
      {#each [...entries].reverse() as entry (entry.id)}
        <div class="log-entry" class:success={entry.execution?.success} class:error={entry.execution && !entry.execution.success} class:no-task={!entry.decision.task}>
          <div class="flex items-center gap-2 mb-1">
            <span class="font-semibold text-sm text-white">#{entry.cycleNumber}</span>
            <span class="text-xs text-gray-500">{formatTime(entry.timestamp)}</span>
            {#if entry.bigBrotherReview}
              <span class="bg-orange-500 text-white px-1.5 py-0.5 rounded text-[0.65rem] font-semibold" title={entry.bigBrotherReview.reason}>BB</span>
            {/if}
          </div>

          <div class="flex items-center gap-2 mb-1">
            {#if entry.decision.task}
              <span class="font-medium text-blue-400">{entry.decision.task}</span>
              {#if entry.execution}
                <span class="execution-status" class:success={entry.execution.success}>
                  {entry.execution.success ? 'OK' : 'FAIL'}
                  ({formatDuration(entry.execution.durationMs)})
                </span>
              {/if}
            {:else}
              <span class="text-gray-500 italic">No task</span>
            {/if}
          </div>

          <div class="text-sm text-gray-400 leading-relaxed">{entry.decision.reasoning}</div>

          {#if entry.execution?.error}
            <div class="text-xs text-red-400 mt-1 p-1 bg-red-500/10 rounded">{entry.execution.error}</div>
          {/if}

          {#if entry.bigBrotherReview}
            <div class="mt-2 p-2 bg-orange-500/10 rounded border-l-2 border-orange-500">
              <div class="text-xs font-semibold text-orange-500 mb-1">
                Big Brother ({entry.bigBrotherReview.reason})
              </div>
              {#if entry.bigBrotherReview.suggestions?.length > 0}
                <ul class="m-0 pl-4 text-xs text-gray-400">
                  {#each entry.bigBrotherReview.suggestions as suggestion}
                    <li>{suggestion}</li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Review result card */
  .review-result {
    @apply bg-white/5 rounded-md p-3 mb-4 border border-orange-500;
  }
  .review-result.success {
    @apply border-green-500;
  }

  /* Log entry with colored left border */
  .log-entry {
    @apply bg-white/5 rounded-md p-3 border-l-[3px] border-l-gray-600;
  }
  .log-entry.success {
    @apply border-l-green-500;
  }
  .log-entry.error {
    @apply border-l-red-500;
  }
  .log-entry.no-task {
    @apply border-l-gray-500 opacity-70;
  }

  /* Execution status badge */
  .execution-status {
    @apply text-xs px-1.5 py-0.5 rounded bg-red-500 text-white;
  }
  .execution-status.success {
    @apply bg-green-500;
  }
</style>
