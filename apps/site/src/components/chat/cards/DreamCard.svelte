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
  roleLabel="Dream"
  roleIcon="🌙"
  accentColor="#6366f1"
  on:messageClick
  on:deleteMessage
  on:validateMessage
  on:speakMessage
>
  <svelte:fragment slot="content">
    <p class="dream-text">{message.content}</p>
  </svelte:fragment>
</BaseMessageCard>

<style>
  .dream-text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-style: italic;
    line-height: 1.7;
  }
</style>
