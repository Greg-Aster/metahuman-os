<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Thinking from '../Thinking.svelte';
  import type { ChatMessage, ReasoningStage } from '../../lib/client/composables/useMessages';

  export let messages: ChatMessage[] = [];
  export let mode: 'conversation' | 'inner' = 'conversation';
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
  }>();

  function handleMessageClick(message: ChatMessage, index: number) {
    dispatch('messageClick', { message, index });
  }

  function handleDelete(relPath: string) {
    dispatch('deleteMessage', { relPath });
  }

  function handleValidate(relPath: string, status: 'correct' | 'incorrect') {
    dispatch('validateMessage', { relPath, status });
  }

  function handleSpeak(e: MouseEvent, content: string) {
    e.stopPropagation();
    dispatch('speakMessage', { content });
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function formatReasoningLabel(stage: ReasoningStage): string {
    const stageName = String(stage.stage || 'plan')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    return `🤔 Round ${stage.round}: ${stageName}`;
  }
</script>

<div class="messages-list">
  {#each messages as message, i}
    {#if mode === 'inner'
      ? (message.role === 'reflection' || message.role === 'dream' || message.role === 'reasoning')
      : (message.role !== 'reflection' && message.role !== 'dream')}
      {#if message.role === 'reasoning'}
        <Thinking
          steps={message.content}
          label={message.meta?.label ?? (message.meta?.stage ? formatReasoningLabel({ ...message.meta.stage, timestamp: message.timestamp }) : '🤔 Reasoning · ' + formatTime(message.timestamp))}
          initiallyOpen={false}
        />
      {:else}
        <div
          class="message message-{message.role}"
          class:message-selected={selectedMessageIndex === i}
          data-facet={message.meta?.facet || 'default'}
          on:click={() => handleMessageClick(message, i)}
          role="button"
          tabindex="0"
        >
          <div class="message-header">
            <span class="message-role">
              {#if message.role === 'user'}
                You
              {:else if message.role === 'assistant'}
                {#if message.meta?.isCuriosityQuestion}
                  <span class="curiosity-label">💭 I'm curious:</span>
                {:else}
                  MetaHuman{#if message.meta?.facet && message.meta.facet !== 'default'}<span class="facet-indicator" title="Speaking as {message.meta.facet} facet"> · {message.meta.facet}</span>{/if}
                {/if}
              {:else if message.role === 'reflection'}
                💭 Idle Thought
              {:else if message.role === 'dream'}
                🌙 Dream
              {:else}
                System
              {/if}
            </span>
            <span class="message-time">{formatTime(message.timestamp)}</span>

            {#if message.role === 'assistant' && message.relPath}
              <span class="message-actions">
                <button class="msg-btn bad" title="Delete from memory" on:click={() => handleDelete(message.relPath)}>−</button>
                <button class="msg-btn good" title="Mark as correct" on:click={() => handleValidate(message.relPath, 'correct')}>+</button>
              </span>
            {/if}
          </div>
          <div class="message-content">
            {message.content}
            <!-- TTS replay button inside bubble at bottom right -->
            <button class="msg-mic-btn" title="Listen to this message" on:click={(e) => handleSpeak(e, message.content)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
              </svg>
            </button>
          </div>
        </div>
      {/if}
    {/if}
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
    <div class="message message-assistant">
      <div class="message-header">
        <span class="message-role">MetaHuman</span>
      </div>
      <div class="message-content typing">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    </div>
  {/if}
</div>
