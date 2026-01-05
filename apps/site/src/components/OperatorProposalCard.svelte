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
<div class="proposal-card compact" class:post-feedback={type === 'post-feedback'}>
  <!-- Single-line header with task and actions -->
  <div class="card-header-compact">
    <span class="task-emoji">{taskEmojis[proposal.taskType] || '🤖'}</span>
    <span class="task-type">{proposal.taskType.replace(/_/g, ' ')}</span>
    <span class="time-ago">{getTimeAgo(proposal.createdAt)}</span>

    {#if type === 'proposal'}
      <!-- Inline approval buttons -->
      <div class="inline-actions">
        <button class="btn-sm approve" on:click={() => respond('approved')} disabled={loading} title="Approve">✅</button>
        <button class="btn-sm reject" on:click={() => respond('rejected')} disabled={loading} title="Reject">❌</button>
        <button class="btn-sm modify" on:click={() => showInput = !showInput} disabled={loading} title="Modify">✏️</button>
        <button class="btn-sm expand" on:click={() => showDetails = !showDetails} title="Details">{showDetails ? '▼' : '▶'}</button>
      </div>
    {:else}
      <!-- Inline feedback buttons -->
      <div class="inline-actions">
        <button class="btn-sm good" on:click={() => submitFeedback('good')} disabled={loading} title="Good">👍</button>
        <button class="btn-sm neutral" on:click={() => submitFeedback('neutral')} disabled={loading} title="Neutral">🤷</button>
        <button class="btn-sm bad" on:click={() => submitFeedback('bad')} disabled={loading} title="Bad">👎</button>
        <button class="btn-sm expand" on:click={() => showDetails = !showDetails} title="Details">{showDetails ? '▼' : '▶'}</button>
      </div>
    {/if}
  </div>

  <!-- Description - always visible but truncated -->
  <p class="description-compact">{proposal.taskDescription}</p>

  {#if type === 'post-feedback' && executionResult}
    <span class="result-badge" class:success={executionResult.success} class:error={!executionResult.success}>
      {executionResult.success ? '✅' : '❌'}
    </span>
  {/if}

  <!-- Expandable details section -->
  {#if showDetails}
    <div class="details-section">
      <p class="reasoning"><em>"{proposal.reasoning}"</em></p>

      {#if type === 'post-feedback' && executionResult?.summary}
        <div class="execution-result" class:success={executionResult.success} class:error={!executionResult.success}>
          {executionResult.summary}
        </div>
      {/if}

      {#if type === 'proposal' && showInput}
        <div class="input-area">
          <input type="text" bind:value={userInput} placeholder="Modification..." class="modify-input" />
          <button class="btn-sm submit" on:click={() => respond('modified')} disabled={loading || !userInput.trim()}>Submit</button>
        </div>
      {/if}

      {#if type === 'post-feedback'}
        <div class="feedback-extras">
          <button class="btn-sm comment-toggle" on:click={() => showComment = !showComment}>💬 Comment</button>
          <button class="btn-sm review" on:click={requestBigBrotherReview} disabled={reviewLoading}>
            {reviewLoading ? '⏳' : '🔍'} AI Review
          </button>
        </div>

        {#if showComment}
          <div class="input-area">
            <input type="text" bind:value={comment} placeholder="Add a comment..." class="comment-input" />
          </div>
        {/if}

        {#if bigBrotherReview}
          <div class="review-result-compact" class:error={!bigBrotherReview.success}>
            {#if bigBrotherReview.success}
              <div class="review-analysis">{bigBrotherReview.analysis}</div>
              {#if bigBrotherReview.codeChangeRecommended}
                <button class="btn-sm improve-toggle" on:click={() => showImproveInput = !showImproveInput}>✨ Improve</button>
              {/if}
              {#if showImproveInput}
                <textarea bind:value={improveInput} placeholder="Describe improvement..." class="improve-input" rows="2"></textarea>
                <button class="btn-sm submit-improve" on:click={submitImprovement} disabled={improveLoading || !improveInput.trim()}>🚀 Send</button>
              {/if}
            {:else}
              <span class="review-error">❌ {bigBrotherReview.error}</span>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  /* COMPACT CARD DESIGN */
  .proposal-card.compact {
    background: var(--bg-secondary, #1e1e1e);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.5rem;
  }

  .proposal-card.compact.post-feedback {
    border-left: 3px solid #22c55e;
  }

  .card-header-compact {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: nowrap;
  }

  .task-emoji {
    font-size: 1rem;
  }

  .task-type {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--text-primary, #fff);
    text-transform: capitalize;
    white-space: nowrap;
  }

  .time-ago {
    font-size: 0.7rem;
    color: var(--text-muted, #666);
    white-space: nowrap;
  }

  .inline-actions {
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
  }

  .btn-sm {
    padding: 0.2rem 0.4rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    background: transparent;
    transition: background 0.15s;
  }

  .btn-sm:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }

  .btn-sm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-sm.approve:hover:not(:disabled) { background: rgba(34, 197, 94, 0.2); }
  .btn-sm.reject:hover:not(:disabled) { background: rgba(239, 68, 68, 0.2); }
  .btn-sm.modify:hover:not(:disabled) { background: rgba(59, 130, 246, 0.2); }
  .btn-sm.good:hover:not(:disabled) { background: rgba(34, 197, 94, 0.2); }
  .btn-sm.neutral:hover:not(:disabled) { background: rgba(234, 179, 8, 0.2); }
  .btn-sm.bad:hover:not(:disabled) { background: rgba(239, 68, 68, 0.2); }
  .btn-sm.expand { color: var(--text-muted, #666); font-size: 0.7rem; }
  .btn-sm.submit { background: var(--accent-color, #3b82f6); color: white; }
  .btn-sm.review { color: #8b5cf6; }
  .btn-sm.comment-toggle { color: #3b82f6; }
  .btn-sm.improve-toggle { color: #10b981; }
  .btn-sm.submit-improve { background: #10b981; color: white; }

  .description-compact {
    font-size: 0.8rem;
    color: var(--text-muted, #aaa);
    margin: 0.25rem 0 0 1.5rem;
    line-height: 1.3;
  }

  .result-badge {
    position: absolute;
    right: 0.5rem;
    top: 0.5rem;
    font-size: 0.8rem;
  }

  .details-section {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border-color, #333);
    font-size: 0.8rem;
  }

  .reasoning {
    color: var(--text-muted, #888);
    font-size: 0.75rem;
    margin: 0 0 0.5rem 0;
    line-height: 1.4;
  }

  .execution-result {
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .execution-result.success { background: rgba(34, 197, 94, 0.1); color: #22c55e; }
  .execution-result.error { background: rgba(239, 68, 68, 0.1); color: #ef4444; }

  .feedback-extras {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .input-area {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
  }

  .modify-input, .comment-input {
    flex: 1;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    background: var(--bg-primary, #0a0a0a);
    color: var(--text-primary, #fff);
    font-size: 0.75rem;
  }

  .review-result-compact {
    background: rgba(139, 92, 246, 0.1);
    border-radius: 4px;
    padding: 0.5rem;
    margin-top: 0.5rem;
  }

  .review-result-compact.error {
    background: rgba(239, 68, 68, 0.1);
  }

  .review-analysis {
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--text-primary, #fff);
    max-height: 100px;
    overflow-y: auto;
  }

  .improve-input {
    width: 100%;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    background: var(--bg-primary, #0a0a0a);
    color: var(--text-primary, #fff);
    font-size: 0.75rem;
    font-family: inherit;
    resize: none;
    margin-top: 0.25rem;
  }

  .review-error {
    color: #ef4444;
    font-size: 0.75rem;
  }
</style>
