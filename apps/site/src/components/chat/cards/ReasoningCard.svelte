<script lang="ts">
  import type { ChatMessage } from '../../../lib/client/composables/useMessages';
  import Thinking from '../../Thinking.svelte';

  export let message: ChatMessage;
  export const index: number = 0; // Required by card interface but not used
  export let isSelected: boolean = false;

  // Get label from metadata or generate default
  $: label = message.meta?.label || formatReasoningLabel(message.meta?.stage);

  function formatReasoningLabel(stage: any): string {
    if (!stage) return '🤔 Reasoning';
    const stageName = String(stage.stage || 'plan')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return `🤔 Round ${stage.round}: ${stageName}`;
  }
</script>

<div class="card-wrapper">
  <div class="reasoning-card" class:selected={isSelected}>
    <Thinking steps={message.content} {label} initiallyOpen={true} />
  </div>
</div>

<style>
  .card-wrapper {
    display: flex;
    justify-content: flex-start;
    width: 100%;
  }

  .reasoning-card {
    max-width: 85%;
    border-radius: 0.75rem;
    transition: all 0.15s ease;
  }

  .reasoning-card.selected {
    box-shadow: 0 0 0 2px var(--accent-color, #eab308);
  }
</style>
