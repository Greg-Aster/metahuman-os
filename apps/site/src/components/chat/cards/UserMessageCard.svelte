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
  roleLabel="You"
  roleIcon=""
  showActions={false}
  showSpeakButton={false}
  on:messageClick
  on:deleteMessage
  on:validateMessage
  on:speakMessage
>
  <svelte:fragment slot="content">
    <p class="card-text">{message.content}</p>
  </svelte:fragment>
</BaseMessageCard>

<style>
  .card-text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
</style>
