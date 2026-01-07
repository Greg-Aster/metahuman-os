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

<div class="flex flex-col gap-3">
  <p class="text-sm text-gray-500 dark:text-gray-400 m-0">
    How often your AI generates internal reflections on memories when idle. These are inner thoughts only, visible in the Inner Dialogue tab.
  </p>

  {#if feedback}
    <div class="banner {feedback.type === 'success' ? 'banner-success' : 'banner-error'}">
      {feedback.text}
    </div>
  {/if}

  {#if isLoading}
    <p class="text-sm m-0 text-gray-500 dark:text-gray-400">Loading...</p>
  {:else if error}
    <p class="text-sm m-0 text-red-600 dark:text-red-400">Error: {error}</p>
  {:else}
    <div class="flex flex-col gap-2">
      {#each levels as l}
        <label class="flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5">
          <input
            type="radio"
            name="boredom-level"
            bind:group={level}
            value={l.id}
            on:change={() => handleLevelChange(l.id)}
            class="w-4 h-4 cursor-pointer accent-violet-600"
          />
          <span class="text-sm text-gray-900 dark:text-gray-100">{l.label}</span>
        </label>
      {/each}
    </div>
  {/if}
</div>
