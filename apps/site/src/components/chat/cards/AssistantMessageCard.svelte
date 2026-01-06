<script lang="ts">
  import BaseMessageCard from './BaseMessageCard.svelte';
  import Thinking from '../../Thinking.svelte';
  import type { ChatMessage } from '../../../lib/client/composables/useMessages';
  import { parseThinkBlocks } from '../message-discriminator';

  export let message: ChatMessage;
  export let index: number;
  export let isSelected: boolean = false;

  // Parse thinking blocks from content
  $: parsed = parseThinkBlocks(message.content);
  $: hasThinking = parsed.thinking.length > 0;

  // Build role label with facet if present
  $: facet = message.meta?.facet;
  $: roleLabel = facet ? `MetaHuman (${facet})` : 'MetaHuman';
</script>

<BaseMessageCard
  {message}
  {index}
  {isSelected}
  {roleLabel}
  roleIcon=""
  accentColor={message.meta?.displayColor}
  on:messageClick
  on:deleteMessage
  on:validateMessage
  on:speakMessage
>
  <svelte:fragment slot="content">
    {#if hasThinking}
      <div class="thinking-section">
        <Thinking steps={parsed.thinking} label="💭 Thinking" initiallyOpen={false} />
      </div>
    {/if}
    <p class="card-text">{parsed.response}</p>
  </svelte:fragment>
</BaseMessageCard>

<style>
  .card-text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .thinking-section {
    margin-bottom: 0.75rem;
  }
</style>
