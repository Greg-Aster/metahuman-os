<script lang="ts">
  import BaseMessageCard from './BaseMessageCard.svelte';
  import type { ChatMessage } from '../../../lib/client/composables/useMessages';

  export let message: ChatMessage;
  export let index: number;
  export let isSelected: boolean = false;

  // Determine source label based on dialogueSource
  $: sourceLabel = getSourceLabel(message.meta?.dialogueSource);

  function getSourceLabel(source?: string): { label: string; icon: string } {
    switch (source) {
      case 'dreamer':
        return { label: 'Dream Thought', icon: '🌙' };
      case 'reflector':
        return { label: 'Reflection', icon: '🪞' };
      case 'curiosity':
        return { label: 'Curious Thought', icon: '❓' };
      case 'big-brother':
        return { label: 'Big Brother', icon: '👁️' };
      case 'desire-executor':
        return { label: 'Execution Report', icon: '⚡' };
      case 'agency-executor':
        return { label: 'Agency Execution', icon: '🎯' };
      default:
        return { label: 'Idle Thought', icon: '💭' };
    }
  }
</script>

<BaseMessageCard
  {message}
  {index}
  {isSelected}
  roleLabel={sourceLabel.label}
  roleIcon={sourceLabel.icon}
  accentColor={message.meta?.displayColor || '#8b5cf6'}
  on:messageClick
  on:deleteMessage
  on:validateMessage
  on:speakMessage
>
  <svelte:fragment slot="content">
    <p class="reflection-text">{message.content}</p>
  </svelte:fragment>
</BaseMessageCard>

<style>
  .reflection-text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    line-height: 1.6;
  }
</style>
