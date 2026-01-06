<script lang="ts">
  import BaseMessageCard from './BaseMessageCard.svelte';
  import type { ChatMessage } from '../../../lib/client/composables/useMessages';

  export let message: ChatMessage;
  export let index: number;
  export let isSelected: boolean = false;
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
    <p class="reply-hint">Click to reply to this question</p>
  </svelte:fragment>
</BaseMessageCard>

<style>
  .curiosity-text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    line-height: 1.6;
  }

  .reply-hint {
    margin: 0.5rem 0 0 0;
    font-size: 0.75rem;
    color: var(--text-muted, #9ca3af);
    font-style: italic;
    opacity: 0;
    transition: opacity 0.15s;
  }

  :global(.card-base):hover .reply-hint {
    opacity: 1;
  }
</style>
