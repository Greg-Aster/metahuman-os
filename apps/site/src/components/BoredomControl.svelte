<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  let level: string = 'off';
  let isLoading: boolean = true;
  let error: string | null = null;
  let feedback: { type: 'success' | 'error'; text: string } | null = null;

  const levels = [
    { id: 'high', label: 'Wandering (Every ~1 min)' },
    { id: 'medium', label: 'Default (Every ~5 mins)' },
    { id: 'low', label: 'Focused (Every ~15 mins)' },
    { id: 'off', label: 'Manual Only' },
  ];

  onMount(async () => {
    isLoading = true;
    try {
      const response = await apiFetch('/api/boredom');
      if (!response.ok) throw new Error('Failed to fetch boredom settings');
      const data = await response.json();
      level = data.level;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      isLoading = false;
    }
  });

  async function handleLevelChange(newLevel: string) {
    level = newLevel;
    feedback = null;
    try {
      const response = await apiFetch('/api/boredom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: newLevel }),
      });
      if (!response.ok) throw new Error('Failed to update boredom level');

      // Show success feedback
      feedback = {
        type: 'success',
        text: 'Settings applied. Reflections are internal thoughts only.'
      };
      setTimeout(() => { feedback = null; }, 4000);
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

<div class="boredom-control">
  <p class="description">
    How often your AI generates internal reflections on memories when idle. These are inner thoughts only, visible in the Inner Dialogue tab.
  </p>
  {#if feedback}
    <div class="banner" class:success={feedback.type === 'success'} class:error={feedback.type === 'error'}>
      {feedback.text}
    </div>
  {/if}
  {#if isLoading}
    <p class="loading">Loading...</p>
  {:else if error}
    <p class="error">Error: {error}</p>
  {:else}
    <div class="levels-list">
      {#each levels as l}
        <label class="level-option">
          <input
            type="radio"
            name="boredom-level"
            bind:group={level}
            value={l.id}
            on:change={() => handleLevelChange(l.id)}
            class="level-radio"
          />
          <span class="level-label">{l.label}</span>
        </label>
      {/each}
    </div>
  {/if}
</div>

<style>
  .boredom-control {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .description {
    font-size: 0.875rem;
    color: rgb(107 114 128);
    margin: 0;
  }

  :global(.dark) .description {
    color: rgb(156 163 175);
  }

  .loading,
  .error {
    font-size: 0.875rem;
    margin: 0;
  }

  .error {
    color: rgb(220 38 38);
  }

  :global(.dark) .error {
    color: rgb(252 165 165);
  }

  .banner {
    font-size: 0.8rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    line-height: 1.4;
  }

  .banner.success {
    background: rgba(34, 197, 94, 0.15);
    color: rgb(21 128 61);
  }

  :global(.dark) .banner.success {
    background: rgba(34, 197, 94, 0.2);
    color: rgb(134 239 172);
  }

  .banner.error {
    background: rgba(239, 68, 68, 0.15);
    color: rgb(220 38 38);
  }

  :global(.dark) .banner.error {
    background: rgba(239, 68, 68, 0.2);
    color: rgb(248 113 113);
  }

  .levels-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .level-option {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .level-option:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  :global(.dark) .level-option:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .level-radio {
    width: 1rem;
    height: 1rem;
    cursor: pointer;
  }

  .level-label {
    font-size: 0.875rem;
    color: rgb(17 24 39);
  }

  :global(.dark) .level-label {
    color: rgb(243 244 246);
  }
</style>
