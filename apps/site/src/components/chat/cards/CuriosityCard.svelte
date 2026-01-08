<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import BaseMessageCard from './BaseMessageCard.svelte';
  import type { ChatMessage } from '../../../lib/client/composables/useMessages';
  import { apiFetch } from '../../../lib/client/api-config';

  export let message: ChatMessage;
  export let index: number;
  export let isSelected: boolean = false;

  const dispatch = createEventDispatcher();

  let responseText = '';
  let hasResponded = false;
  let isSubmitting = false;
  let responseStatus: 'idle' | 'success' | 'error' = 'idle';

  // Check if this question has already been answered (from meta)
  $: if (message.meta?.answered || message.meta?.skipped) {
    hasResponded = true;
  }

  async function submitResponse() {
    if (!responseText.trim() || isSubmitting) return;

    isSubmitting = true;
    responseStatus = 'idle';

    try {
      // Get the question ID from message meta or generate from message ID
      const questionId = message.meta?.questionId || message.id;

      // Send the response via persona-chat API with replyToQuestionId
      const response = await apiFetch('/api/persona_chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: responseText,
          replyToQuestionId: questionId,
          replyToContent: message.content,
        }),
      });

      if (response.ok) {
        hasResponded = true;
        responseStatus = 'success';

        // Notify parent that a response was sent
        dispatch('curiosityResponded', {
          questionId,
          response: responseText,
          action: 'responded',
        });

        // Clear the pause manager's curiosity awaiting state
        try {
          await apiFetch('/api/pause-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'clearCuriosity',
              reason: 'responded',
            }),
          });
        } catch (e) {
          // Non-critical, continue
        }
      } else {
        responseStatus = 'error';
      }
    } catch (error) {
      console.error('[CuriosityCard] Error submitting response:', error);
      responseStatus = 'error';
    } finally {
      isSubmitting = false;
    }
  }

  async function dismissQuestion() {
    if (isSubmitting) return;

    isSubmitting = true;

    try {
      const questionId = message.meta?.questionId || message.id;

      hasResponded = true;
      responseStatus = 'success';

      // Notify parent that question was skipped
      dispatch('curiosityResponded', {
        questionId,
        response: null,
        action: 'skipped',
      });

      // Clear the pause manager's curiosity awaiting state
      try {
        await apiFetch('/api/pause-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'clearCuriosity',
            reason: 'skipped',
          }),
        });
      } catch (e) {
        // Non-critical, continue
      }
    } finally {
      isSubmitting = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitResponse();
    }
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
    <p class="curiosity-text">{message.content}</p>

    {#if !hasResponded}
      <!-- Inline response area -->
      <div class="curiosity-response-area">
        <textarea
          bind:value={responseText}
          on:keydown={handleKeydown}
          placeholder="Share your thoughts..."
          rows="2"
          disabled={isSubmitting}
          class="response-textarea"
        />
        <div class="response-actions">
          <button
            class="btn-reply"
            on:click={submitResponse}
            disabled={!responseText.trim() || isSubmitting}
          >
            {#if isSubmitting}
              Sending...
            {:else}
              Reply
            {/if}
          </button>
          <button
            class="btn-skip"
            on:click={dismissQuestion}
            disabled={isSubmitting}
          >
            Skip
          </button>
        </div>
        {#if responseStatus === 'error'}
          <p class="response-error">Failed to send. Please try again.</p>
        {/if}
      </div>
    {:else}
      <!-- Response sent confirmation -->
      <div class="response-sent">
        {#if message.meta?.skipped}
          <span class="skip-indicator">⏭ Skipped</span>
        {:else}
          <span class="success-indicator">✓ Response sent</span>
        {/if}
      </div>
    {/if}

    <p class="reply-hint">Or click anywhere to reply in the main input</p>
  </svelte:fragment>
</BaseMessageCard>

<style>
  .curiosity-text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    line-height: 1.6;
  }

  /* Inline response area */
  .curiosity-response-area {
    margin-top: 1rem;
    padding: 0.75rem;
    background: rgba(139, 92, 246, 0.08);
    border-radius: 0.5rem;
    border: 1px solid rgba(139, 92, 246, 0.2);
  }

  .response-textarea {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: var(--bg-secondary, #1e1e2e);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 0.375rem;
    color: var(--text-primary, #cdd6f4);
    font-size: 0.875rem;
    font-family: inherit;
    resize: none;
    transition: border-color 0.15s;
  }

  .response-textarea:focus {
    outline: none;
    border-color: #8b5cf6;
  }

  .response-textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .response-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .btn-reply,
  .btn-skip {
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-reply {
    background: #8b5cf6;
    color: white;
    border: none;
  }

  .btn-reply:hover:not(:disabled) {
    background: #7c3aed;
  }

  .btn-reply:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-skip {
    background: transparent;
    color: var(--text-muted, #9ca3af);
    border: 1px solid rgba(139, 92, 246, 0.3);
  }

  .btn-skip:hover:not(:disabled) {
    background: rgba(139, 92, 246, 0.1);
    color: var(--text-primary, #cdd6f4);
  }

  .btn-skip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .response-error {
    margin: 0.5rem 0 0 0;
    font-size: 0.75rem;
    color: #ef4444;
  }

  /* Response sent confirmation */
  .response-sent {
    margin-top: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: rgba(139, 92, 246, 0.08);
    border-radius: 0.375rem;
    font-size: 0.8rem;
  }

  .success-indicator {
    color: #a6e3a1;
  }

  .skip-indicator {
    color: var(--text-muted, #9ca3af);
  }

  .reply-hint {
    margin: 0.5rem 0 0 0;
    font-size: 0.7rem;
    color: var(--text-muted, #9ca3af);
    font-style: italic;
    opacity: 0;
    transition: opacity 0.15s;
  }

  :global(.card-base):hover .reply-hint {
    opacity: 0.7;
  }
</style>
