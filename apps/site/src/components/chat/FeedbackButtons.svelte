<script lang="ts">
  /**
   * FeedbackButtons - Unified +/- feedback system
   *
   * Compact buttons that appear in the input area.
   * Default value is 0 (no feedback). + sets to 1, - sets to -1.
   * Clicking either button opens an optional comment input.
   */
  import { createEventDispatcher } from 'svelte';
  import { apiFetch } from '../../lib/client/api-config';

  const dispatch = createEventDispatcher<{
    feedbackSubmitted: { rating: number; comment?: string };
  }>();

  // State
  let currentRating: number = 0; // -1, 0, or 1
  let showInput = false;
  let comment = '';
  let submitting = false;
  let showSuccess = false;
  let successTimeout: ReturnType<typeof setTimeout> | null = null;

  // Props for context (what we're rating)
  export let targetType: 'conversation' | 'task' | 'memory' = 'conversation';
  export let targetId: string | undefined = undefined; // Optional - for specific items

  function handlePlusClick() {
    if (currentRating === 1) {
      // Already positive, toggle input visibility
      showInput = !showInput;
    } else {
      currentRating = 1;
      showInput = true;
    }
  }

  function handleMinusClick() {
    if (currentRating === -1) {
      // Already negative, toggle input visibility
      showInput = !showInput;
    } else {
      currentRating = -1;
      showInput = true;
    }
  }

  async function submitFeedback() {
    if (currentRating === 0) return;

    submitting = true;
    try {
      const res = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: currentRating,
          comment: comment.trim() || undefined,
          targetType,
          targetId,
        }),
      });

      if (res.ok) {
        dispatch('feedbackSubmitted', { rating: currentRating, comment: comment.trim() || undefined });
        // Show brief success indicator
        showSuccess = true;
        if (successTimeout) clearTimeout(successTimeout);
        successTimeout = setTimeout(() => {
          showSuccess = false;
          // Reset state after success
          showInput = false;
          comment = '';
          currentRating = 0;
        }, 1500);
      }
    } catch (err) {
      console.error('[FeedbackButtons] Error submitting feedback:', err);
    } finally {
      submitting = false;
    }
  }

  function handleKeyPress(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitFeedback();
    }
    if (e.key === 'Escape') {
      showInput = false;
      comment = '';
    }
  }

  function cancel() {
    showInput = false;
    comment = '';
    currentRating = 0;
  }
</script>

<div class="feedback-container" class:expanded={showInput}>
  {#if showSuccess}
    <div class="success-indicator">
      <span class="success-icon">✓</span>
    </div>
  {:else}
    <div class="feedback-buttons">
      <button
        class="fb-btn minus"
        class:active={currentRating === -1}
        on:click={handleMinusClick}
        disabled={submitting}
        title="Negative feedback"
      >−</button>
      <button
        class="fb-btn plus"
        class:active={currentRating === 1}
        on:click={handlePlusClick}
        disabled={submitting}
        title="Positive feedback"
      >+</button>
    </div>

    {#if showInput}
      <div class="feedback-input-row">
        <input
          type="text"
          bind:value={comment}
          placeholder="Why? (optional)"
          class="feedback-input"
          on:keydown={handleKeyPress}
          disabled={submitting}
        />
        <button
          class="submit-btn"
          on:click={submitFeedback}
          disabled={submitting || currentRating === 0}
          title="Submit feedback"
        >
          {submitting ? '...' : '→'}
        </button>
        <button
          class="cancel-btn"
          on:click={cancel}
          disabled={submitting}
          title="Cancel"
        >×</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .feedback-container {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    transition: all 0.2s ease;
  }

  .feedback-container.expanded {
    flex-wrap: wrap;
  }

  .feedback-buttons {
    display: flex;
    gap: 0.15rem;
  }

  .fb-btn {
    width: 24px;
    height: 24px;
    border: 1px solid rgba(128, 128, 128, 0.3);
    border-radius: 4px;
    background: transparent;
    color: rgba(128, 128, 128, 0.6);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .fb-btn:hover:not(:disabled) {
    background: rgba(128, 128, 128, 0.1);
  }

  .fb-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .fb-btn.plus:hover:not(:disabled),
  .fb-btn.plus.active {
    color: #22c55e;
    border-color: #22c55e;
    background: rgba(34, 197, 94, 0.1);
  }

  .fb-btn.minus:hover:not(:disabled),
  .fb-btn.minus.active {
    color: #ef4444;
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
  }

  .feedback-input-row {
    display: flex;
    gap: 0.25rem;
    align-items: center;
    margin-left: 0.25rem;
  }

  .feedback-input {
    width: 140px;
    padding: 0.25rem 0.5rem;
    border: 1px solid rgba(128, 128, 128, 0.3);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font-size: 0.75rem;
    outline: none;
  }

  .feedback-input:focus {
    border-color: var(--accent-color, #3b82f6);
  }

  :global(.dark) .feedback-input {
    background: rgba(0, 0, 0, 0.2);
  }

  .submit-btn, .cancel-btn {
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .submit-btn {
    background: var(--accent-color, #3b82f6);
    color: white;
  }

  .submit-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .submit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .cancel-btn {
    background: transparent;
    color: rgba(128, 128, 128, 0.6);
    border: 1px solid rgba(128, 128, 128, 0.3);
  }

  .cancel-btn:hover:not(:disabled) {
    background: rgba(128, 128, 128, 0.1);
  }

  .success-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px; /* Same width as two buttons + gap */
    height: 24px;
  }

  .success-icon {
    color: #22c55e;
    font-size: 1rem;
    font-weight: 600;
  }
</style>
