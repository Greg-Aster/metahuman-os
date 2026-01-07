<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface ProposalData {
    id: string;
    taskType: string;
    taskDescription: string;
    reasoning: string;
    createdAt: string;
    status: string;
    context?: {
      cycleNumber?: number;
      triggerSource?: string;
    };
  }

  interface ExecutionResultData {
    success: boolean;
    summary?: string;
    error?: string;
  }

  interface BigBrotherReview {
    success: boolean;
    analysis?: string;
    suggestions?: string[];
    codeChangeRecommended?: boolean;
    error?: string;
  }

  export let proposal: ProposalData;
  export let type: 'proposal' | 'post-feedback' = 'proposal';
  export let executionResult: ExecutionResultData | undefined = undefined;

  const dispatch = createEventDispatcher();

  let loading = false;
  let userInput = '';
  let showInput = false;
  let comment = '';
  let showComment = false;
  let showDetails = false; // Collapsed by default for compact view

  // Big Brother review state
  let bigBrotherReview: BigBrotherReview | null = null;
  let reviewLoading = false;
  let showImproveInput = false;
  let improveInput = '';
  let improveLoading = false;

  // Truncate reasoning for compact display
  function truncateText(text: string, maxLength: number = 80): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }

  const taskEmojis: Record<string, string> = {
    reflect: '🤔',
    dream: '💭',
    curiosity: '❓',
    inner_curiosity: '🧐',
    memory_curate: '📚',
    desire_generate: '✨',
    desire_execute: '🎯',
    psychoanalyze: '🧠',
    custom: '⚡',
  };

  function getTimeAgo(timestamp: string): string {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  async function respond(response: 'approved' | 'rejected' | 'modified') {
    loading = true;
    try {
      const res = await apiFetch('/api/operator-proposals/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: proposal.id,
          response,
          userInput: response === 'modified' ? userInput : undefined,
        }),
      });

      if (res.ok) {
        dispatch('responded', { proposalId: proposal.id, response });
      }
    } catch (err) {
      console.error('Error responding to proposal:', err);
    } finally {
      loading = false;
    }
  }

  async function submitFeedback(rating: 'good' | 'neutral' | 'bad') {
    loading = true;
    try {
      const res = await apiFetch('/api/operator-proposals/post-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: proposal.id,
          rating,
          comment: showComment ? comment : undefined,
        }),
      });

      if (res.ok) {
        dispatch('feedback', { proposalId: proposal.id, rating });
      }
    } catch (err) {
      console.error('Error submitting feedback:', err);
    } finally {
      loading = false;
    }
  }

  async function requestBigBrotherReview() {
    reviewLoading = true;
    try {
      const res = await apiFetch('/api/operator-proposals/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: proposal.id }),
      });

      if (res.ok) {
        bigBrotherReview = await res.json();
      } else {
        bigBrotherReview = { success: false, error: 'Review request failed' };
      }
    } catch (err) {
      console.error('Error requesting Big Brother review:', err);
      bigBrotherReview = { success: false, error: (err as Error).message };
    } finally {
      reviewLoading = false;
    }
  }

  async function submitImprovement() {
    if (!improveInput.trim()) return;

    improveLoading = true;
    try {
      const res = await apiFetch('/api/operator-proposals/improve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: proposal.id,
          userInput: improveInput,
          bigBrotherAnalysis: bigBrotherReview?.analysis,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          // Show success message and close input
          showImproveInput = false;
          improveInput = '';
          // Add a note to the review
          if (bigBrotherReview) {
            bigBrotherReview = {
              ...bigBrotherReview,
              analysis: (bigBrotherReview.analysis || '') +
                '\n\n✅ Improvement request submitted to System Coder.',
            };
          }
        }
      }
    } catch (err) {
      console.error('Error submitting improvement:', err);
    } finally {
      improveLoading = false;
    }
  }
</script>

<!-- Compact card design - everything on fewer lines -->
<div class="card py-2 px-3 mb-2" class:border-l-2={type === 'post-feedback'} class:border-l-green-500={type === 'post-feedback'}>
  <!-- Single-line header with task and actions -->
  <div class="flex items-center gap-2 flex-nowrap">
    <span class="text-base">{taskEmojis[proposal.taskType] || '🤖'}</span>
    <span class="font-semibold text-[0.85rem] capitalize whitespace-nowrap">{proposal.taskType.replace(/_/g, ' ')}</span>
    <span class="text-[0.7rem] text-gray-500 dark:text-gray-500 whitespace-nowrap">{getTimeAgo(proposal.createdAt)}</span>

    {#if type === 'proposal'}
      <!-- Inline approval buttons -->
      <div class="flex gap-1 ml-auto">
        <button class="proposal-btn hover:bg-green-500/20" on:click={() => respond('approved')} disabled={loading} title="Approve">✅</button>
        <button class="proposal-btn hover:bg-red-500/20" on:click={() => respond('rejected')} disabled={loading} title="Reject">❌</button>
        <button class="proposal-btn hover:bg-blue-500/20" on:click={() => showInput = !showInput} disabled={loading} title="Modify">✏️</button>
        <button class="proposal-btn text-gray-500 text-[0.7rem]" on:click={() => showDetails = !showDetails} title="Details">{showDetails ? '▼' : '▶'}</button>
      </div>
    {:else}
      <!-- Inline feedback buttons -->
      <div class="flex gap-1 ml-auto">
        <button class="proposal-btn hover:bg-green-500/20" on:click={() => submitFeedback('good')} disabled={loading} title="Good">👍</button>
        <button class="proposal-btn hover:bg-yellow-500/20" on:click={() => submitFeedback('neutral')} disabled={loading} title="Neutral">🤷</button>
        <button class="proposal-btn hover:bg-red-500/20" on:click={() => submitFeedback('bad')} disabled={loading} title="Bad">👎</button>
        <button class="proposal-btn text-gray-500 text-[0.7rem]" on:click={() => showDetails = !showDetails} title="Details">{showDetails ? '▼' : '▶'}</button>
      </div>
    {/if}
  </div>

  <!-- Description - always visible but truncated -->
  <p class="text-[0.8rem] text-gray-400 mt-1 mb-0 ml-6 leading-tight">{proposal.taskDescription}</p>

  {#if type === 'post-feedback' && executionResult}
    <span class="absolute right-2 top-2 text-[0.8rem]">
      {executionResult.success ? '✅' : '❌'}
    </span>
  {/if}

  <!-- Expandable details section -->
  {#if showDetails}
    <div class="mt-2 pt-2 border-t border-gray-700 dark:border-gray-700 text-[0.8rem]">
      <p class="text-gray-500 text-[0.75rem] m-0 mb-2 leading-snug"><em>"{proposal.reasoning}"</em></p>

      {#if type === 'post-feedback' && executionResult?.summary}
        <div class="py-1 px-2 rounded text-[0.75rem] mb-2"
          class:bg-green-500/10={executionResult.success}
          class:text-green-500={executionResult.success}
          class:bg-red-500/10={!executionResult.success}
          class:text-red-500={!executionResult.success}>
          {executionResult.summary}
        </div>
      {/if}

      {#if type === 'proposal' && showInput}
        <div class="flex gap-1 mb-2">
          <input type="text" bind:value={userInput} placeholder="Modification..." class="proposal-input flex-1" />
          <button class="proposal-btn bg-blue-500 text-white" on:click={() => respond('modified')} disabled={loading || !userInput.trim()}>Submit</button>
        </div>
      {/if}

      {#if type === 'post-feedback'}
        <div class="flex gap-2 mb-2">
          <button class="proposal-btn text-blue-500" on:click={() => showComment = !showComment}>💬 Comment</button>
          <button class="proposal-btn text-purple-500" on:click={requestBigBrotherReview} disabled={reviewLoading}>
            {reviewLoading ? '⏳' : '🔍'} AI Review
          </button>
        </div>

        {#if showComment}
          <div class="flex gap-1 mb-2">
            <input type="text" bind:value={comment} placeholder="Add a comment..." class="proposal-input flex-1" />
          </div>
        {/if}

        {#if bigBrotherReview}
          <div class="rounded p-2 mt-2" class:bg-purple-500/10={bigBrotherReview.success} class:bg-red-500/10={!bigBrotherReview.success}>
            {#if bigBrotherReview.success}
              <div class="text-[0.75rem] leading-snug max-h-[100px] overflow-y-auto">{bigBrotherReview.analysis}</div>
              {#if bigBrotherReview.codeChangeRecommended}
                <button class="proposal-btn text-emerald-500 mt-1" on:click={() => showImproveInput = !showImproveInput}>✨ Improve</button>
              {/if}
              {#if showImproveInput}
                <textarea bind:value={improveInput} placeholder="Describe improvement..." class="proposal-input w-full mt-1 resize-none" rows="2"></textarea>
                <button class="proposal-btn bg-emerald-500 text-white mt-1" on:click={submitImprovement} disabled={improveLoading || !improveInput.trim()}>🚀 Send</button>
              {/if}
            {:else}
              <span class="text-red-500 text-[0.75rem]">❌ {bigBrotherReview.error}</span>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Proposal button base */
  .proposal-btn {
    @apply py-0.5 px-1.5 border-0 rounded cursor-pointer text-[0.85rem] bg-transparent transition-colors;
  }
  .proposal-btn:disabled {
    @apply opacity-40 cursor-not-allowed;
  }

  /* Proposal input styling */
  .proposal-input {
    @apply py-1 px-2 border border-gray-700 rounded bg-gray-900 text-white text-[0.75rem] font-inherit;
  }
</style>
