<script lang="ts">
  /**
   * CuriosityCard Component
   *
   * Displays curiosity questions asked by the system.
   *
   * Interaction Pattern:
   * 1. User clicks/selects this card
   * 2. User types response in the main chat input
   * 3. Response is routed through the response pipeline (cardType: 'curiosity_response')
   * 4. Multi-turn conversation continues while card is selected
   * 5. Deselecting ends the thread, outputs are saved as curiosity memory
   *
   * The "Skip" action dismisses the question without requiring a response.
   */
  import { createEventDispatcher } from 'svelte';
  import BaseMessageCard from './BaseMessageCard.svelte';
  import type { ChatMessage } from '../../../lib/client/composables/useMessages';
  import { apiFetch } from '../../../lib/client/api-config';

  export let message: ChatMessage;
  export let index: number;
  export let isSelected: boolean = false;

  const dispatch = createEventDispatcher();

  // Response state
  let hasResponded = false;
  let wasSkipped = false;
  let isSkipping = false;

  // Check if this question was already answered or skipped (from meta)
  $: if (message.meta?.answered) {
    hasResponded = true;
    wasSkipped = false;
  }
  $: if (message.meta?.skipped) {
    hasResponded = true;
    wasSkipped = true;
  }

  // Question ID for tracking
  $: questionId = message.meta?.questionId || message.id;

  /**
   * Skip this curiosity question without responding
   * Clears the pause manager state and marks the question as skipped
   */
  async function handleSkip() {
    if (isSkipping || hasResponded) return;

    isSkipping = true;

    try {
      // Clear the pause manager's curiosity awaiting state
      await apiFetch('/api/pause-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'clearCuriosity',
          reason: 'skipped',
        }),
      });

      hasResponded = true;
      wasSkipped = true;

      // Notify parent that question was skipped
      dispatch('curiosityResponded', {
        questionId,
        response: null,
        action: 'skipped',
      });
    } catch (error) {
      console.error('[CuriosityCard] Error skipping question:', error);
    } finally {
      isSkipping = false;
    }
  }

  /**
   * Called by parent when a response was sent via main input
   * Updates local state to show confirmation
   */
  export function markAsResponded() {
    hasResponded = true;
    wasSkipped = false;
  }
</script>

<BaseMessageCard
  {message}
  {index}
  {isSelected}
  roleLabel="I'm curious:"
  roleIcon="💭"
  accentColor={message.meta?.displayColor || '#8b5cf6'}
  on:messageClick
  on:deleteMessage
  on:validateMessage
  on:speakMessage
>
  <svelte:fragment slot="content">
    <!-- Question text -->
    <p class="curiosity-text">{message.content}</p>

    <!-- Response status or interaction hint -->
    {#if hasResponded}
      <div class="status-container">
        {#if wasSkipped}
          <span class="status-badge status-skipped">
            <span class="status-icon">⏭</span>
            Skipped
          </span>
        {:else}
          <span class="status-badge status-responded">
            <span class="status-icon">✓</span>
            Responded
          </span>
        {/if}
      </div>
    {:else}
      <!-- Interaction hint and skip button -->
      <div class="interaction-area">
        {#if isSelected}
          <div class="selection-active">
            <span class="pulse-dot"></span>
            <span class="hint-text">Selected — type your response below</span>
          </div>
        {:else}
          <div class="selection-hint">
            <span class="hint-text">Click to reply</span>
          </div>
        {/if}

        <button
          class="skip-btn"
          on:click|stopPropagation={handleSkip}
          disabled={isSkipping}
          title="Skip this question"
        >
          {#if isSkipping}
            <span class="spinner"></span>
          {:else}
            Skip
          {/if}
        </button>
      </div>
    {/if}
  </svelte:fragment>
</BaseMessageCard>

<style>
  /* Question text */
  .curiosity-text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    line-height: 1.6;
  }

  /* Status container for responded/skipped states */
  .status-container {
    margin-top: 0.75rem;
    display: flex;
    align-items: center;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .status-icon {
    font-size: 0.75rem;
  }

  .status-responded {
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .status-skipped {
    background: rgba(107, 114, 128, 0.15);
    color: #9ca3af;
    border: 1px solid rgba(107, 114, 128, 0.3);
  }

  /* Interaction area with hint and skip */
  .interaction-area {
    margin-top: 0.75rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  /* Selection hint (not selected) */
  .selection-hint {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .selection-hint .hint-text {
    font-size: 0.8125rem;
    color: var(--text-muted, #9ca3af);
    opacity: 0.8;
  }

  /* Selection active indicator */
  .selection-active {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    background: rgba(139, 92, 246, 0.15);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 9999px;
  }

  .selection-active .hint-text {
    font-size: 0.8125rem;
    color: #a78bfa;
    font-weight: 500;
  }

  /* Pulsing dot for active selection */
  .pulse-dot {
    width: 8px;
    height: 8px;
    background: #8b5cf6;
    border-radius: 50%;
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(0.8);
    }
  }

  /* Skip button */
  .skip-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 60px;
    padding: 0.375rem 0.75rem;
    background: transparent;
    color: var(--text-muted, #9ca3af);
    border: 1px solid rgba(139, 92, 246, 0.25);
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .skip-btn:hover:not(:disabled) {
    background: rgba(139, 92, 246, 0.1);
    border-color: rgba(139, 92, 246, 0.4);
    color: var(--text-primary, #f3f4f6);
  }

  .skip-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Spinner for skip button */
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(139, 92, 246, 0.3);
    border-top-color: #8b5cf6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Light mode adjustments */
  :global(.light) .status-responded {
    background: rgba(34, 197, 94, 0.1);
    color: #16a34a;
  }

  :global(.light) .status-skipped {
    background: rgba(107, 114, 128, 0.1);
    color: #6b7280;
  }

  :global(.light) .selection-active {
    background: rgba(139, 92, 246, 0.1);
  }

  :global(.light) .selection-active .hint-text {
    color: #7c3aed;
  }

  :global(.light) .selection-hint .hint-text {
    color: #6b7280;
  }
</style>
