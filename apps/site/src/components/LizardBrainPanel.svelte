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

<div class="lizard-brain-panel">
  <div class="panel-header">
    <h3>Lizard Brain Activity</h3>
    <div class="controls">
      <select bind:value={selectedDate} on:change={handleDateChange}>
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
          class="trigger-button"
          on:click={triggerReview}
          disabled={triggeringReview}
        >
          {triggeringReview ? 'Reviewing...' : 'Trigger Review'}
        </button>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="error-message">{error}</div>
  {/if}

  {#if reviewResult}
    <div class="review-result" class:success={reviewResult.success}>
      <div class="review-header">
        Big Brother Review {reviewResult.success ? 'Complete' : 'Failed'}
      </div>
      {#if reviewResult.reasoning}
        <div class="review-reasoning">{reviewResult.reasoning}</div>
      {/if}
      {#if reviewResult.suggestions && reviewResult.suggestions.length > 0}
        <ul class="review-suggestions">
          {#each reviewResult.suggestions as suggestion}
            <li>{suggestion}</li>
          {/each}
        </ul>
      {/if}
      <button class="dismiss-button" on:click={() => reviewResult = null}>Dismiss</button>
    </div>
  {/if}

  {#if summary}
    <div class="summary-grid">
      <div class="stat">
        <span class="value">{summary.totalCycles}</span>
        <span class="label">Cycles</span>
      </div>
      <div class="stat">
        <span class="value">{summary.tasksExecuted}</span>
        <span class="label">Tasks</span>
      </div>
      <div class="stat">
        <span class="value">{(summary.successRate * 100).toFixed(0)}%</span>
        <span class="label">Success</span>
      </div>
      <div class="stat">
        <span class="value">{summary.bigBrotherReviews}</span>
        <span class="label">Reviews</span>
      </div>
      <div class="stat">
        <span class="value">{summary.errorsDetected}</span>
        <span class="label">Errors</span>
      </div>
    </div>
  {/if}

  {#if loading && entries.length === 0}
    <div class="loading">Loading...</div>
  {:else if entries.length === 0}
    <div class="empty">No activity logged for {selectedDate}</div>
  {:else}
    <div class="log-list">
      {#each [...entries].reverse() as entry (entry.id)}
        <div
          class="log-entry"
          class:success={entry.execution?.success}
          class:error={entry.execution && !entry.execution.success}
          class:no-task={!entry.decision.task}
        >
          <div class="entry-header">
            <span class="cycle">#{entry.cycleNumber}</span>
            <span class="time">{formatTime(entry.timestamp)}</span>
            {#if entry.bigBrotherReview}
              <span class="bb-badge" title={entry.bigBrotherReview.reason}>BB</span>
            {/if}
          </div>

          <div class="entry-task">
            {#if entry.decision.task}
              <span class="task-name">{entry.decision.task}</span>
              {#if entry.execution}
                <span class="execution-status" class:success={entry.execution.success}>
                  {entry.execution.success ? 'OK' : 'FAIL'}
                  ({formatDuration(entry.execution.durationMs)})
                </span>
              {/if}
            {:else}
              <span class="no-task-label">No task</span>
            {/if}
          </div>

          <div class="entry-reasoning">{entry.decision.reasoning}</div>

          {#if entry.execution?.error}
            <div class="entry-error">{entry.execution.error}</div>
          {/if}

          {#if entry.bigBrotherReview}
            <div class="bb-review">
              <div class="bb-header">
                Big Brother ({entry.bigBrotherReview.reason})
              </div>
              {#if entry.bigBrotherReview.suggestions?.length > 0}
                <ul class="bb-suggestions">
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
  .lizard-brain-panel {
    background: var(--card-bg, #1a1a1a);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    padding: 1rem;
    max-height: 600px;
    overflow-y: auto;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .panel-header h3 {
    margin: 0;
    font-size: 1rem;
    color: var(--text-primary, #fff);
  }

  .controls {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .controls select {
    padding: 0.25rem 0.5rem;
    background: var(--bg-secondary, #252525);
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    color: var(--text-primary, #fff);
    font-size: 0.8rem;
  }

  .trigger-button {
    padding: 0.25rem 0.75rem;
    background: #f97316;
    border: none;
    border-radius: 4px;
    color: white;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .trigger-button:hover {
    background: #ea580c;
  }

  .trigger-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error-message {
    background: #ef4444;
    color: white;
    padding: 0.5rem;
    border-radius: 4px;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }

  .review-result {
    background: var(--bg-secondary, #252525);
    border: 1px solid #f97316;
    border-radius: 6px;
    padding: 0.75rem;
    margin-bottom: 1rem;
  }

  .review-result.success {
    border-color: #22c55e;
  }

  .review-header {
    font-weight: 600;
    color: #f97316;
    margin-bottom: 0.5rem;
  }

  .review-result.success .review-header {
    color: #22c55e;
  }

  .review-reasoning {
    font-size: 0.85rem;
    color: var(--text-secondary, #ccc);
    margin-bottom: 0.5rem;
  }

  .review-suggestions {
    margin: 0;
    padding-left: 1.25rem;
    font-size: 0.8rem;
    color: var(--text-muted, #999);
  }

  .dismiss-button {
    margin-top: 0.5rem;
    padding: 0.25rem 0.5rem;
    background: transparent;
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    color: var(--text-muted, #999);
    font-size: 0.75rem;
    cursor: pointer;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .stat {
    background: var(--bg-secondary, #252525);
    padding: 0.5rem;
    border-radius: 4px;
    text-align: center;
  }

  .stat .value {
    display: block;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary, #fff);
  }

  .stat .label {
    font-size: 0.7rem;
    color: var(--text-muted, #999);
    text-transform: uppercase;
  }

  .loading,
  .empty {
    padding: 2rem;
    text-align: center;
    color: var(--text-muted, #999);
  }

  .log-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .log-entry {
    background: var(--bg-secondary, #252525);
    border-radius: 6px;
    padding: 0.75rem;
    border-left: 3px solid var(--border-color, #333);
  }

  .log-entry.success {
    border-left-color: #22c55e;
  }

  .log-entry.error {
    border-left-color: #ef4444;
  }

  .log-entry.no-task {
    border-left-color: #6b7280;
    opacity: 0.7;
  }

  .entry-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .cycle {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--text-primary, #fff);
  }

  .time {
    font-size: 0.75rem;
    color: var(--text-muted, #999);
  }

  .bb-badge {
    background: #f97316;
    color: white;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.65rem;
    font-weight: 600;
  }

  .entry-task {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .task-name {
    font-weight: 500;
    color: #3b82f6;
  }

  .no-task-label {
    color: var(--text-muted, #999);
    font-style: italic;
  }

  .execution-status {
    font-size: 0.75rem;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    background: #ef4444;
    color: white;
  }

  .execution-status.success {
    background: #22c55e;
  }

  .entry-reasoning {
    font-size: 0.8rem;
    color: var(--text-secondary, #ccc);
    line-height: 1.4;
  }

  .entry-error {
    font-size: 0.75rem;
    color: #ef4444;
    margin-top: 0.25rem;
    padding: 0.25rem;
    background: rgba(239, 68, 68, 0.1);
    border-radius: 3px;
  }

  .bb-review {
    margin-top: 0.5rem;
    padding: 0.5rem;
    background: rgba(249, 115, 22, 0.1);
    border-radius: 4px;
    border-left: 2px solid #f97316;
  }

  .bb-header {
    font-size: 0.75rem;
    font-weight: 600;
    color: #f97316;
    margin-bottom: 0.25rem;
  }

  .bb-suggestions {
    margin: 0;
    padding-left: 1rem;
    font-size: 0.75rem;
    color: var(--text-secondary, #ccc);
  }
</style>
