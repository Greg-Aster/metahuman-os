<script lang="ts">
  import { onMount } from 'svelte';

  let models: string[] = [];
  let activeModel: string = '';
  let isLoading: boolean = true;
  let error: string | null = null;

  onMount(async () => {
    await fetchModels();
  });

  async function fetchModels() {
    isLoading = true;
    error = null;
    try {
      const response = await fetch('/api/models');
      if (!response.ok) {
        throw new Error('Failed to fetch models');
      }
      const data = await response.json();
      const available = Array.isArray(data.baseModels) ? data.baseModels : [];
      const current = data.agent?.model || '';
      // Ensure the current model is present in the list so it always shows up
      models = available.includes(current) || !current ? available : [current, ...available];
      activeModel = current || models[0] || '';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      isLoading = false;
    }
  }

  async function handleModelChange(event: Event) {
    const selectedModel = (event.target as HTMLSelectElement).value;
    if (selectedModel === activeModel) return;

    try {
      const response = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseModel: selectedModel }),
      });

      if (!response.ok) {
        throw new Error('Failed to update model');
      }
      activeModel = selectedModel;
      // Refresh list to stay in sync with any server-side normalization
      await fetchModels();
      // Optional: show a success message
      console.log(`Model updated to ${selectedModel}`);
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

<div class="model-selector-container">
  <label for="model-selector">Active LLM</label>
  {#if isLoading}
    <p>Loading models...</p>
  {:else if error}
    <p class="error">Error: {error}</p>
  {:else}
    <select id="model-selector" on:change={handleModelChange} bind:value={activeModel}>
      {#each models as model}
        <option value={model}>{model}</option>
      {/each}
    </select>
  {/if}
</div>

<style>
  .model-selector-container {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem;
    background-color: var(--theme-bg-offset);
    border-radius: var(--theme-radius);
    border: 1px solid var(--theme-border);
  }
  label {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--theme-text-light);
  }
  select {
    width: 100%;
    padding: 0.5rem;
    border-radius: var(--theme-radius-sm);
    border: 1px solid var(--theme-border);
    background-color: var(--theme-bg);
    color: var(--theme-text);
  }
  .error {
    color: var(--theme-danger);
  }
</style>
