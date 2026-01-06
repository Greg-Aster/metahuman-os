<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ChatMessage } from '../../../lib/client/composables/useMessages';
  import { formatTimestamp } from '../message-discriminator';
  import { personaNameStore, userDisplayNameStore } from '../../../stores/navigation';

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

  // Compute display name based on role
  $: displayName = (() => {
    if (message.role === 'user') return $userDisplayNameStore;
    if (message.role === 'assistant') return $personaNameStore;
    // For other roles, use the roleLabel if provided, otherwise derive from role
    return roleLabel || message.role;
  })();

  // Compute icon based on role (only for special message types)
  $: displayIcon = roleIcon || '';

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

<div class="card-wrapper" class:align-right={message.role === 'user'}>
  <!-- Header outside card -->
  <div class="card-outer-header" class:align-right={message.role === 'user'}>
    <span class="header-role" style={accentColor ? `color: ${accentColor}` : ''}>
      {#if displayIcon}<span class="role-icon">{displayIcon}</span>{/if}
      {displayName}
    </span>
    <span class="header-time">{formatTimestamp(message.timestamp)}</span>
    {#if showActions && message.relPath}
      <span class="header-actions">
        <button class="action-btn delete" title="Delete" on:click={handleDelete}>−</button>
        <button class="action-btn validate" title="Mark correct" on:click={(e) => handleValidate(e, 'correct')}>+</button>
      </span>
    {/if}
  </div>

  <!-- Card body -->
  <div
    class="card-base card-{message.role}"
    class:card-selected={isSelected}
    class:card-accented={!!accentColor}
    data-facet={message.meta?.facet || 'default'}
    style={accentColor ? `--card-accent: ${accentColor}; --message-accent-color: ${accentColor}` : ''}
    on:click={handleClick}
    on:keydown={handleKeydown}
    role="button"
    tabindex="0"
  >
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
</div>

<style>
  /* Card wrapper for alignment - column layout with header above card */
  .card-wrapper {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    max-width: 85%;
  }

  .card-wrapper.align-right {
    align-items: flex-end;
    margin-left: auto;
  }

  /* External header above the card */
  .card-outer-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.25rem;
    margin-bottom: 0.25rem;
  }

  .card-outer-header.align-right {
    flex-direction: row-reverse;
  }

  .header-role {
    font-weight: 600;
    font-size: 0.8125rem;
    color: var(--text-primary, #f3f4f6);
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .role-icon {
    font-size: 0.875rem;
  }

  .header-time {
    font-size: 0.75rem;
    color: var(--text-muted, #9ca3af);
  }

  .header-actions {
    display: flex;
    gap: 0.25rem;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .card-wrapper:hover .header-actions {
    opacity: 1;
  }

  /* CSS Variables for theming */
  .card-base {
    width: 100%;
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

  /* Persona accent color styling (when displayColor is set) */
  .card-accented {
    border-color: color-mix(in srgb, var(--card-accent) 50%, transparent);
    background: color-mix(in srgb, var(--card-accent) 8%, var(--card-bg));
  }

  .card-accented .card-body {
    color: color-mix(in srgb, var(--card-accent) 80%, var(--card-text));
  }

  /* Action buttons (in external header) */
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
  :global(.light) .header-role {
    color: #1f2937;
  }

  :global(.light) .header-time {
    color: #6b7280;
  }

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
