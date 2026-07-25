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
  roleLabel={message.meta?.bufferSource === 'robot' || message.role === 'robot' ? 'Robot Buffer' : 'System Buffer'}
  roleIcon={message.meta?.bufferSource === 'robot' || message.role === 'robot' ? '🤖' : '⚙️'}
  showActions={false}
  showSpeakButton={false}
  on:messageClick
  on:deleteMessage
  on:validateMessage
  on:speakMessage
>
  <svelte:fragment slot="content">
    <span class="source-badge" class:robot={message.meta?.bufferSource === 'robot' || message.role === 'robot'}>
      {message.meta?.bufferSource === 'robot' || message.role === 'robot' ? 'ROBOT' : 'SYSTEM'}
    </span>
    <p class="system-text">{message.content}</p>
  </svelte:fragment>
</BaseMessageCard>

<style>
  .system-text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-size: 0.875rem;
    color: var(--text-muted, #9ca3af);
    font-style: italic;
  }

  .source-badge {
    display: inline-block;
    margin-bottom: 0.45rem;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    background: rgba(107, 114, 128, 0.22);
    color: #d1d5db;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .source-badge.robot {
    background: rgba(20, 184, 166, 0.2);
    color: #5eead4;
  }
</style>
