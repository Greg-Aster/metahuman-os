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
    // Don't intercept keyboard events when user is typing in an input/textarea
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable) {
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }
</script>

<div class="card-wrapper" class:align-right={message.role === 'user'}>
  <!-- Header outside card -->
  <div class="card-outer-header" class:align-right={message.role === 'user'}>
    <span class="text-[0.8125rem] font-semibold text-gray-100 flex items-center gap-1" style={accentColor ? `color: ${accentColor}` : ''}>
      {#if displayIcon}<span class="text-sm">{displayIcon}</span>{/if}
      {displayName}
    </span>
    <span class="text-xs text-gray-400">{formatTimestamp(message.timestamp)}</span>
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
    <div class="text-[0.9375rem] leading-relaxed">
      <slot name="content">
        <p class="m-0 whitespace-pre-wrap break-words">{message.content}</p>
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
  /* Card wrapper for alignment */
  .card-wrapper {
    @apply flex flex-col items-start w-full max-w-[85%];
  }
  .card-wrapper.align-right {
    @apply items-end ml-auto;
  }

  /* External header above card */
  .card-outer-header {
    @apply flex items-center gap-2 px-1 mb-1;
  }
  .card-outer-header.align-right {
    @apply flex-row-reverse;
  }

  /* Header actions (show on hover) */
  .header-actions {
    @apply flex gap-1 opacity-0 transition-opacity;
  }
  .card-wrapper:hover .header-actions {
    @apply opacity-100;
  }

  /* Card base with CSS variables for theming */
  .card-base {
    @apply w-full relative py-3 px-4 rounded-xl border cursor-pointer transition-all;
    --card-bg: var(--bg-secondary, #1e1e1e);
    --card-border: var(--border-color, #333);
    --card-text: var(--text-primary, #f3f4f6);
    --card-muted: var(--text-muted, #9ca3af);
    --card-accent: var(--accent-color, #3b82f6);
    border-color: var(--card-border);
    background: var(--card-bg);
    color: var(--card-text);
  }
  .card-base:hover { border-color: var(--card-accent); }
  .card-base:focus { @apply outline-none; border-color: var(--card-accent); box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3); }
  .card-selected { border-color: var(--card-accent); box-shadow: 0 0 0 1px var(--card-accent); }

  /* Role-specific backgrounds */
  .card-user { --card-bg: rgba(59, 130, 246, 0.1); --card-border: rgba(59, 130, 246, 0.2); --card-accent: #3b82f6; }
  .card-assistant { --card-bg: var(--bg-secondary, #1e1e1e); }
  .card-reflection { --card-bg: rgba(139, 92, 246, 0.1); --card-border: rgba(139, 92, 246, 0.2); --card-accent: #8b5cf6; }
  .card-dream { --card-bg: rgba(99, 102, 241, 0.1); --card-border: rgba(99, 102, 241, 0.2); --card-accent: #6366f1; }
  .card-reasoning { --card-bg: rgba(234, 179, 8, 0.1); --card-border: rgba(234, 179, 8, 0.2); --card-accent: #eab308; }
  .card-system { --card-bg: rgba(107, 114, 128, 0.1); --card-border: rgba(107, 114, 128, 0.2); --card-accent: #6b7280; }

  /* Accented card (persona color) */
  .card-accented {
    border-color: color-mix(in srgb, var(--card-accent) 50%, transparent);
    background: color-mix(in srgb, var(--card-accent) 8%, var(--card-bg));
  }

  /* Action buttons */
  .action-btn {
    @apply w-5 h-5 border-0 rounded bg-transparent cursor-pointer text-base font-bold flex items-center justify-center transition-all;
    color: var(--card-muted);
  }
  .action-btn:hover { @apply bg-white/10; }
  .action-btn.delete:hover { @apply text-red-500; }
  .action-btn.validate:hover { @apply text-green-500; }

  /* Speak button */
  .speak-btn {
    @apply absolute bottom-2 right-2 w-6 h-6 border-0 rounded bg-transparent cursor-pointer opacity-0 transition-opacity flex items-center justify-center;
    color: var(--card-muted);
  }
  .card-base:hover .speak-btn { @apply opacity-100; }
  .speak-btn:hover { @apply bg-white/10; color: var(--card-text); }

  /* Light mode */
  :global(.light) .card-base { --card-bg: #ffffff; --card-border: #e5e7eb; --card-text: #1f2937; --card-muted: #6b7280; }
  :global(.light) .card-user { --card-bg: rgba(59, 130, 246, 0.08); }
  :global(.light) .card-reflection { --card-bg: rgba(139, 92, 246, 0.08); }
  :global(.light) .card-dream { --card-bg: rgba(99, 102, 241, 0.08); }
  :global(.light) .action-btn:hover, :global(.light) .speak-btn:hover { @apply bg-black/5; }
</style>
