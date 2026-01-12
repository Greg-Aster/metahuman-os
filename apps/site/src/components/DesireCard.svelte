<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  export let desire: any;
  export let collapsed = false;

  const dispatch = createEventDispatcher();

  let feedbackText = '';
  let submitting = false;
  let error = '';
  let showExecutionResults = false;
  let executionData: any[] = [];
  let executionLoading = false;

  // Status colors
  const statusColors: Record<string, string> = {
    nascent: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    planning: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    reviewing: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    questioning: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
    awaiting_approval: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    executing: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
    awaiting_review: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    rejected: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200',
    abandoned: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  };

  // Status labels
  const statusLabels: Record<string, string> = {
    nascent: 'New',
    pending: 'Building Strength',
    planning: 'Planning',
    reviewing: 'Under Review',
    questioning: 'Questions Pending',
    awaiting_approval: 'Needs Approval',
    approved: 'Approved',
    executing: 'Executing',
    awaiting_review: 'Reviewing Results',
    completed: 'Completed',
    failed: 'Failed',
    rejected: 'Rejected',
    abandoned: 'Abandoned',
  };

  function getStatusColor(status: string): string {
    return statusColors[status] || statusColors.pending;
  }

  function getStatusLabel(status: string): string {
    return statusLabels[status] || status;
  }

  function getMilestoneIcon(status: string): string {
    switch (status) {
      case 'completed': return '✅';
      case 'in_progress': return '🔄';
      case 'skipped': return '⏭️';
      case 'pending': return '⬜';
      default: return '⬜';
    }
  }

  async function loadExecutionResults() {
    if (executionData.length > 0 || executionLoading) return;

    executionLoading = true;
    try {
      const res = await apiFetch(`/api/agency/desires/${desire.id}/executions`);
      if (res.ok) {
        const data = await res.json();
        executionData = data.executions || [];
      }
    } catch (e) {
      console.error('Failed to load execution data:', e);
    } finally {
      executionLoading = false;
    }
  }

  async function submitFeedback() {
    if (!feedbackText.trim() || submitting) return;

    submitting = true;
    error = '';

    try {
      const res = await apiFetch(`/api/agency/desires/${desire.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: feedbackText.trim(),
          action: 'revise',
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit feedback');
      }

      const data = await res.json();
      feedbackText = '';
      dispatch('feedback', { desire: data.desire, message: data.message });
    } catch (e) {
      error = (e as Error).message;
    } finally {
      submitting = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      submitFeedback();
    }
  }

  onMount(() => {
    // Auto-load execution results for long-running desires
    if (desire.goalType === 'long_running' && desire.milestones?.some((m: any) => m.status === 'completed')) {
      loadExecutionResults();
    }
  });
</script>

<div class="desire-card rounded-lg border-2 border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/30 overflow-hidden">
  <!-- Header -->
  <div class="p-3 bg-violet-100 dark:bg-violet-900/50 border-b border-violet-200 dark:border-violet-800">
    <div class="flex items-start justify-between gap-2">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-lg">🎯</span>
          <h3 class="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">{desire.title}</h3>
          <span class="px-2 py-0.5 rounded-full text-xs font-medium {getStatusColor(desire.status)}">
            {getStatusLabel(desire.status)}
          </span>
        </div>
        {#if desire.goalType === 'long_running'}
          <div class="flex items-center gap-2 mt-1 text-xs text-violet-600 dark:text-violet-400">
            <span>🏔️ Long-running goal</span>
            <span>•</span>
            <span>{desire.goalProgress?.progressPercent || 0}% complete</span>
            <span>•</span>
            <span>Milestone {(desire.goalProgress?.currentMilestone || 0) + 1}/{desire.goalProgress?.totalMilestones || 0}</span>
          </div>
        {/if}
      </div>
      <button
        type="button"
        class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm"
        on:click={() => collapsed = !collapsed}
      >
        {collapsed ? '▼' : '▲'}
      </button>
    </div>
  </div>

  {#if !collapsed}
    <div class="p-3 space-y-3">
      <!-- Current milestone for long-running goals -->
      {#if desire.goalType === 'long_running' && desire.milestones}
        {@const currentMilestone = desire.milestones[desire.goalProgress?.currentMilestone || 0]}
        <div class="bg-white dark:bg-gray-900 rounded p-2 border border-violet-200 dark:border-violet-800">
          <p class="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-1">Current Milestone:</p>
          <div class="flex items-center gap-2">
            <span>{getMilestoneIcon(currentMilestone?.status || 'pending')}</span>
            <span class="text-sm font-medium text-gray-800 dark:text-gray-200">{currentMilestone?.title || 'Unknown'}</span>
          </div>
          {#if currentMilestone?.description}
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{currentMilestone.description}</p>
          {/if}
        </div>

        <!-- Completed milestones summary -->
        {#if desire.milestones.filter((m) => m.status === 'completed').length > 0}
          <details class="bg-green-50 dark:bg-green-950/30 rounded border border-green-200 dark:border-green-800">
            <summary class="p-2 cursor-pointer text-xs font-semibold text-green-700 dark:text-green-300 list-none flex justify-between items-center">
              <span>✅ Completed Work ({desire.milestones.filter((m) => m.status === 'completed').length} milestones)</span>
              <span class="text-green-500">▼</span>
            </summary>
            <div class="p-2 pt-0 space-y-2">
              {#if executionLoading}
                <p class="text-xs text-gray-500">Loading results...</p>
              {:else if executionData.length > 0}
                {@const latestExecution = executionData[0]}
                {#if latestExecution.stepResults}
                  {#each latestExecution.stepResults as result, i}
                    <details class="bg-white dark:bg-gray-900 rounded border border-green-200 dark:border-green-800">
                      <summary class="p-2 cursor-pointer text-xs list-none flex items-center gap-2">
                        <span class="{result.success ? 'text-green-500' : 'text-red-500'}">{result.success ? '✓' : '✗'}</span>
                        <span>Step {i + 1}</span>
                      </summary>
                      {#if result.result?.response}
                        <div class="p-2 text-xs text-gray-600 dark:text-gray-400 max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-green-100 dark:border-green-900">
                          {result.result.response.substring(0, 2000)}{result.result.response.length > 2000 ? '...' : ''}
                        </div>
                      {/if}
                    </details>
                  {/each}
                {/if}
              {:else}
                <button
                  type="button"
                  class="text-xs text-green-600 dark:text-green-400 hover:underline"
                  on:click={loadExecutionResults}
                >
                  Load execution details
                </button>
              {/if}
            </div>
          </details>
        {/if}
      {/if}

      <!-- Completion criteria -->
      {#if desire.completionCriteria}
        <div class="text-xs p-2 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
          <span class="font-semibold text-gray-600 dark:text-gray-400">🎯 Done when:</span>
          <span class="text-gray-700 dark:text-gray-300 ml-1">{desire.completionCriteria}</span>
        </div>
      {/if}

      <!-- Feedback input -->
      <div class="space-y-2">
        <label class="block text-xs font-semibold text-gray-700 dark:text-gray-300">
          Questions or Feedback:
        </label>
        <textarea
          bind:value={feedbackText}
          on:keydown={handleKeydown}
          placeholder="Ask follow-up questions or provide feedback... (Ctrl+Enter to submit)"
          rows="3"
          class="w-full px-3 py-2 text-sm border border-violet-300 dark:border-violet-700 rounded bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
          disabled={submitting}
        />
        {#if error}
          <p class="text-xs text-red-500">{error}</p>
        {/if}
        <div class="flex items-center justify-between">
          <p class="text-xs text-gray-400">
            Examples: "How do I get there?", "When should I start?", "Do I need a permit?"
          </p>
          <button
            type="button"
            class="px-3 py-1.5 text-xs font-medium rounded bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            disabled={!feedbackText.trim() || submitting}
            on:click={submitFeedback}
          >
            {submitting ? 'Sending...' : 'Send Feedback'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .desire-card {
    animation: slideIn 0.3s ease-out;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
