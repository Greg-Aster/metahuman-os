<script lang="ts">
  /**
   * MessageList.svelte
   * Orchestrates message card rendering using the card component system.
   * Each message type has its own self-contained card component.
   */
  import { createEventDispatcher } from 'svelte';
  import Thinking from '../Thinking.svelte';
  import type { ChatMessage, ReasoningStage } from '../../lib/client/composables/useMessages';
  import { getCardComponent, isVisibleInMode } from './message-discriminator';
  import { cardComponents } from './cards/index';

  // Props
  export let messages: ChatMessage[] = [];
  export let mode: 'conversation' | 'inner' | 'combined' = 'conversation';
  export let showSystemMessages: boolean = false;
  export let selectedMessageIndex: number | null = null;
  export let loading: boolean = false;
  export let reasoningStages: ReasoningStage[] = [];
  export let showThinkingIndicator: boolean = false;
  export let thinkingSteps: string = '';
  export let thinkingStatusLabel: string = '';

  const dispatch = createEventDispatcher<{
    messageClick: { message: ChatMessage; index: number };
    deleteMessage: { relPath: string };
    validateMessage: { relPath: string; status: 'correct' | 'incorrect' };
    speakMessage: { content: string };
    desireApproved: { desireId: string };
    desireRejected: { desireId: string };
    desireFeedback: { desireId: string; feedback: string };
  }>();

  // Filter visible messages based on mode
  $: visibleMessages = messages
    .map((msg, originalIndex) => ({ msg, originalIndex }))
    .filter(({ msg }) => isVisibleInMode(msg, mode, showSystemMessages));

  // Event forwarding functions
  function forwardMessageClick(e: CustomEvent<{ message: ChatMessage; index: number }>) {
    dispatch('messageClick', e.detail);
  }

  function forwardDeleteMessage(e: CustomEvent<{ relPath: string }>) {
    dispatch('deleteMessage', e.detail);
  }

  function forwardValidateMessage(e: CustomEvent<{ relPath: string; status: 'correct' | 'incorrect' }>) {
    dispatch('validateMessage', e.detail);
  }

  function forwardSpeakMessage(e: CustomEvent<{ content: string }>) {
    dispatch('speakMessage', e.detail);
  }

  function forwardDesireApproved(e: CustomEvent<{ desireId: string }>) {
    dispatch('desireApproved', e.detail);
  }

  function forwardDesireRejected(e: CustomEvent<{ desireId: string }>) {
    dispatch('desireRejected', e.detail);
  }

  function forwardDesireFeedback(e: CustomEvent<{ desireId: string; feedback: string }>) {
    dispatch('desireFeedback', e.detail);
  }

  function formatReasoningLabel(stage: ReasoningStage): string {
    const stageName = String(stage.stage || 'plan')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    return `🤔 Round ${stage.round}: ${stageName}`;
  }
</script>

<div class="messages-list">
  {#each visibleMessages as { msg, originalIndex } (msg.timestamp + '-' + originalIndex)}
    {@const cardType = getCardComponent(msg)}
    <svelte:component
      this={cardComponents[cardType]}
      message={msg}
      index={originalIndex}
      isSelected={selectedMessageIndex === originalIndex}
      {mode}
      on:messageClick={forwardMessageClick}
      on:deleteMessage={forwardDeleteMessage}
      on:validateMessage={forwardValidateMessage}
      on:speakMessage={forwardSpeakMessage}
      on:desireApproved={forwardDesireApproved}
      on:desireRejected={forwardDesireRejected}
      on:desireFeedback={forwardDesireFeedback}
    />
  {/each}

  {#if reasoningStages.length > 0}
    {#each reasoningStages as stage (stage.timestamp + '-' + stage.round + '-' + stage.stage)}
      <Thinking
        steps={stage.content}
        label={formatReasoningLabel(stage)}
        initiallyOpen={true}
      />
    {/each}
  {/if}

  {#if showThinkingIndicator}
    <Thinking
      steps={thinkingSteps}
      label={thinkingStatusLabel}
      initiallyOpen={true}
    />
  {/if}

  {#if loading && reasoningStages.length === 0}
    <div class="typing-wrapper">
      <div class="typing-indicator">
        <div class="typing-header">
          <span class="typing-role">MetaHuman</span>
        </div>
        <div class="typing-dots">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .messages-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
  }

  /* Typing indicator wrapper */
  .typing-wrapper {
    display: flex;
    justify-content: flex-start;
    width: 100%;
  }

  .typing-indicator {
    max-width: 85%;
    padding: 0.75rem 1rem;
    border-radius: 0.75rem;
    background: var(--bg-secondary, #1e1e1e);
    border: 1px solid var(--border-color, #333);
  }

  .typing-header {
    margin-bottom: 0.5rem;
  }

  .typing-role {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--text-primary, #f3f4f6);
  }

  .typing-dots {
    display: flex;
    gap: 0.25rem;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted, #9ca3af);
    animation: typing 1.4s infinite;
  }

  .dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes typing {
    0%, 60%, 100% {
      opacity: 0.3;
      transform: scale(1);
    }
    30% {
      opacity: 1;
      transform: scale(1.2);
    }
  }

  /* Light mode */
  :global(.light) .typing-indicator {
    background: #ffffff;
    border-color: #e5e7eb;
  }

  :global(.light) .typing-role {
    color: #1f2937;
  }
</style>
