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
  roleLabel="System"
  roleIcon="⚙️"
  showActions={false}
  showSpeakButton={false}
  on:messageClick
  on:deleteMessage
  on:validateMessage
  on:speakMessage
>
  <svelte:fragment slot="content">
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
</style>
