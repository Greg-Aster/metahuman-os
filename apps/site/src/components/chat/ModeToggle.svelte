<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let mode: 'conversation' | 'inner' = 'conversation';
  export let reasoningDepth: number = 0;
  export let reasoningLabels: string[] = ['Off', 'Quick', 'Focused', 'Deep'];

  const dispatch = createEventDispatcher<{
    modeChange: { mode: 'conversation' | 'inner' };
    reasoningDepthInput: { value: number };
    reasoningDepthChange: { value: number };
  }>();

  function handleModeClick(newMode: 'conversation' | 'inner') {
    dispatch('modeChange', { mode: newMode });
  }

  function handleReasoningInput(event: Event) {
    const target = event.target as HTMLInputElement;
    dispatch('reasoningDepthInput', { value: Number(target.value) });
  }

  function handleReasoningChange(event: Event) {
    const target = event.target as HTMLInputElement;
    dispatch('reasoningDepthChange', { value: Number(target.value) });
  }
</script>

<div class="mode-toggle-container sm:gap-3">
  <div class="mode-toggle">
    <button
      class={mode === 'conversation' ? 'mode-btn active' : 'mode-btn'}
      on:click={() => handleModeClick('conversation')}
      aria-label="Conversation mode"
    >
      <span class="mode-icon" aria-hidden="true">💬</span>
      <span class="mode-label">Conversation</span>
    </button>
    <button
      class={mode === 'inner' ? 'mode-btn active' : 'mode-btn'}
      on:click={() => handleModeClick('inner')}
      aria-label="Inner dialogue mode"
    >
      <span class="mode-icon" aria-hidden="true">💭</span>
      <span class="mode-label">Inner Dialogue</span>
    </button>
  </div>

  <!-- Reasoning depth slider -->
  <div class="reasoning-toggle">
    <div class="reasoning-slider-wrapper">
      <input
        id="reasoning-range"
        type="range"
        class="reasoning-slider-input"
        min="0"
        max={reasoningLabels.length - 1}
        step="1"
        value={reasoningDepth}
        on:input={handleReasoningInput}
        on:change={handleReasoningChange}
        title="Reasoning: {reasoningLabels[reasoningDepth]}"
        aria-label="Reasoning depth: {reasoningLabels[reasoningDepth]}"
      />
      <div class="reasoning-emoji" style="left: {(reasoningDepth / (reasoningLabels.length - 1)) * 100}%">
        🧠
      </div>
    </div>
  </div>
</div>
