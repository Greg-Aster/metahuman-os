<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ChatMessage } from '../../../lib/client/composables/useMessages';
  import { formatTimestamp } from '../message-discriminator';

  // Props
  export let message: ChatMessage;
  export let index: number;
  export let isSelected: boolean = false;
  export let roleLabel: string = '';
  export let roleIcon: string = '';
  export let accentColor: string = '';
  export let showActions: boolean = true;
  export let showSpeakButton: boolean = true;

  const dispatch = createEventDispatcher();

  function handleClick() {
    dispatch('messageClick', { message, index });
  }

  function handleDelete(e: MouseEvent) {
    e.stopPropagation();
    if (message.relPath) {
      dispatch('deleteMessage', { relPath: message.relPath });
    }
  }

  function handleValidate(e: MouseEvent, status: 'correct' | 'incorrect') {
    e.stopPropagation();
    if (message.relPath) {
      dispatch('validateMessage', { relPath: message.relPath, status });
    }
  }

  function handleSpeak(e: MouseEvent) {
    e.stopPropagation();
    dispatch('speakMessage', { content: message.content });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }
</script>

<div
  class="card-base card-{message.role}"
  class:card-selected={isSelected}
  style={accentColor ? `--card-accent: ${accentColor}` : ''}
  on:click={handleClick}
  on:keydown={handleKeydown}
  role="button"
  tabindex="0"
>
  <div class="card-header">
    <span class="card-role">
      {#if roleIcon}<span class="role-icon">{roleIcon}</span>{/if}
      {roleLabel}
    </span>
    <span class="card-time">{formatTimestamp(message.timestamp)}</span>

    {#if showActions && message.relPath}
      <span class="card-actions">
        <button
          class="action-btn delete"
          title="Delete message"
          on:click={handleDelete}
        >
          −
        </button>
        <button
          class="action-btn validate"
          title="Mark as correct"
          on:click={(e) => handleValidate(e, 'correct')}
        >
          +
        </button>
      </span>
    {/if}
  </div>

  <div class="card-body">
    <slot name="content">
      <p class="card-text">{message.content}</p>
    </slot>
  </div>

  <slot name="footer" />

  {#if showSpeakButton}
    <button
      class="speak-btn"
      title="Listen to message"
      on:click={handleSpeak}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
      </svg>
    </button>
  {/if}
</div>

<style>
  /* CSS Variables for theming */
  .card-base {
    --card-bg: var(--bg-secondary, #1e1e1e);
    --card-border: var(--border-color, #333);
    --card-text: var(--text-primary, #f3f4f6);
    --card-muted: var(--text-muted, #9ca3af);
    --card-accent: var(--accent-color, #3b82f6);

    position: relative;
    padding: 0.75rem 1rem;
    border-radius: 0.75rem;
    border: 1px solid var(--card-border);
    background: var(--card-bg);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .card-base:hover {
    border-color: var(--card-accent);
  }

  .card-base:focus {
    outline: none;
    border-color: var(--card-accent);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
  }

  .card-selected {
    border-color: var(--card-accent);
    box-shadow: 0 0 0 1px var(--card-accent);
  }

  /* Role-specific backgrounds */
  .card-user {
    --card-bg: rgba(59, 130, 246, 0.1);
    --card-border: rgba(59, 130, 246, 0.2);
    --card-accent: #3b82f6;
  }

  .card-assistant {
    --card-bg: var(--bg-secondary, #1e1e1e);
  }

  .card-reflection {
    --card-bg: rgba(139, 92, 246, 0.1);
    --card-border: rgba(139, 92, 246, 0.2);
    --card-accent: #8b5cf6;
  }

  .card-dream {
    --card-bg: rgba(99, 102, 241, 0.1);
    --card-border: rgba(99, 102, 241, 0.2);
    --card-accent: #6366f1;
  }

  .card-reasoning {
    --card-bg: rgba(234, 179, 8, 0.1);
    --card-border: rgba(234, 179, 8, 0.2);
    --card-accent: #eab308;
  }

  .card-system {
    --card-bg: rgba(107, 114, 128, 0.1);
    --card-border: rgba(107, 114, 128, 0.2);
    --card-accent: #6b7280;
  }

  /* Header layout */
  .card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .card-role {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--card-text);
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .role-icon {
    font-size: 1rem;
  }

  .card-time {
    font-size: 0.75rem;
    color: var(--card-muted);
  }

  .card-actions {
    margin-left: auto;
    display: flex;
    gap: 0.25rem;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .card-base:hover .card-actions {
    opacity: 1;
  }

  .action-btn {
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--card-muted);
    cursor: pointer;
    font-size: 1rem;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .action-btn.delete:hover {
    color: #ef4444;
  }

  .action-btn.validate:hover {
    color: #22c55e;
  }

  /* Body */
  .card-body {
    color: var(--card-text);
    font-size: 0.9375rem;
    line-height: 1.6;
  }

  .card-text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  /* Speak button */
  .speak-btn {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--card-muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .card-base:hover .speak-btn {
    opacity: 1;
  }

  .speak-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--card-text);
  }

  /* Light mode adjustments */
  :global(.light) .card-base {
    --card-bg: #ffffff;
    --card-border: #e5e7eb;
    --card-text: #1f2937;
    --card-muted: #6b7280;
  }

  :global(.light) .card-user {
    --card-bg: rgba(59, 130, 246, 0.08);
    --card-border: rgba(59, 130, 246, 0.2);
  }

  :global(.light) .card-reflection {
    --card-bg: rgba(139, 92, 246, 0.08);
    --card-border: rgba(139, 92, 246, 0.2);
  }

  :global(.light) .card-dream {
    --card-bg: rgba(99, 102, 241, 0.08);
    --card-border: rgba(99, 102, 241, 0.2);
  }

  :global(.light) .action-btn:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.light) .speak-btn:hover {
    background: rgba(0, 0, 0, 0.05);
  }
</style>
