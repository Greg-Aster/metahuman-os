<script lang="ts">
  import { onMount } from 'svelte'
  import { apiFetch } from '../lib/client/api-config'

  interface RegistryModel {
    id: string
    provider: string
    model: string
    roles?: string[]
    capabilities?: string[]
    options?: Record<string, any>
    source?: string
  }

  let models: RegistryModel[] = []
  let environmentModelId = ''
  let selectedModelId = ''
  let imageCapable = false
  let maxImages = 4
  let maxImageMb = 5
  let contextWindow = 8192
  let enableThinking = false
  let allowedImageMimeTypes = ['image/jpeg', 'image/png', 'image/webp']
  let loading = true
  let savingAssignment = false
  let savingOptions = false
  let message = ''
  let error = ''

  $: selectedModel = models.find(model => model.id === selectedModelId) || null

  onMount(loadRegistry)

  function clearFeedback() {
    message = ''
    error = ''
  }

  function loadSelectedOptions() {
    const model = models.find(candidate => candidate.id === selectedModelId)
    if (!model) return
    imageCapable = model.capabilities?.includes('image') ?? false
    maxImages = Number(model.options?.maxImages ?? 4)
    maxImageMb = Math.max(1, Math.round(Number(model.options?.maxImageBytes ?? 5 * 1024 * 1024) / 1024 / 1024))
    contextWindow = Number(model.options?.contextWindow ?? 8192)
    enableThinking = Boolean(model.options?.enableThinking ?? false)
    allowedImageMimeTypes = Array.isArray(model.options?.allowedImageMimeTypes)
      ? [...model.options.allowedImageMimeTypes]
      : ['image/jpeg', 'image/png', 'image/webp']
  }

  async function loadRegistry() {
    loading = true
    clearFeedback()
    try {
      const response = await apiFetch('/api/model-registry?cognitiveMode=environment')
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load model registry')
      }

      models = Array.isArray(data.availableModels) ? data.availableModels : []
      environmentModelId = data.roleAssignments?.persona || ''
      const editableModels = models.filter(model => model.source === 'user-registry')
      if (!selectedModelId || !editableModels.some(model => model.id === selectedModelId)) {
        selectedModelId = editableModels.find(model => model.id === environmentModelId)?.id || editableModels[0]?.id || ''
      }
      loadSelectedOptions()
    } catch (cause) {
      error = (cause as Error).message
    } finally {
      loading = false
    }
  }

  async function assignEnvironmentModel() {
    if (!environmentModelId) return
    savingAssignment = true
    clearFeedback()
    try {
      const response = await apiFetch('/api/model-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'persona',
          modelId: environmentModelId,
          cognitiveMode: 'environment',
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to assign the Environment Mode model')
      }
      selectedModelId = environmentModelId
      await loadRegistry()
      message = 'Environment Mode model assignment saved.'
    } catch (cause) {
      error = (cause as Error).message
    } finally {
      savingAssignment = false
    }
  }

  async function saveModelOptions() {
    if (!selectedModelId) return
    if (allowedImageMimeTypes.length === 0) {
      error = 'Enable at least one accepted image format.'
      return
    }

    savingOptions = true
    clearFeedback()
    try {
      const response = await apiFetch('/api/model-registry', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: selectedModelId,
          capabilities: imageCapable ? ['text', 'image'] : ['text'],
          options: {
            maxImages: Number(maxImages),
            maxImageBytes: Number(maxImageMb) * 1024 * 1024,
            allowedImageMimeTypes,
            contextWindow: Number(contextWindow),
            enableThinking,
          },
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to save model input options')
      }
      await loadRegistry()
      message = 'Model input options saved through the model registry.'
    } catch (cause) {
      error = (cause as Error).message
    } finally {
      savingOptions = false
    }
  }
</script>

<div class="setting-group">
  <div class="flex items-start justify-between gap-3 mb-3">
    <div>
      <span class="setting-label m-0">Model Routing and Input Capabilities</span>
      <p class="text-sm text-gray-500 dark:text-gray-400 m-0 mt-1">
        Uses the normal user model registry. Image input does not select or start a separate backend.
      </p>
    </div>
    <button class="btn-secondary btn-sm" on:click={loadRegistry} disabled={loading}>
      {loading ? 'Loading...' : 'Refresh'}
    </button>
  </div>

  {#if error}
    <div class="text-sm rounded-md border px-3 py-2 mb-3 bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300">{error}</div>
  {/if}
  {#if message}
    <div class="text-sm rounded-md border px-3 py-2 mb-3 bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300">{message}</div>
  {/if}

  {#if !loading && models.length === 0}
    <p class="text-sm text-gray-500 dark:text-gray-400 m-0">No models are available from the active backend or user registry.</p>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <label class="block text-sm">
        <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Environment Mode model</span>
        <select class="select-field w-full" bind:value={environmentModelId} disabled={loading || savingAssignment}>
          {#each models as model}
            <option value={model.id}>{model.model} ({model.provider}){model.capabilities?.includes('image') ? ' - image' : ''}</option>
          {/each}
        </select>
      </label>
      <div class="flex items-end">
        <button class="btn-primary" on:click={assignEnvironmentModel} disabled={!environmentModelId || savingAssignment}>
          {savingAssignment ? 'Assigning...' : 'Assign through model registry'}
        </button>
      </div>
    </div>

    <div class="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700">
      <label class="block text-sm mb-3">
        <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Edit registered model options</span>
        <select class="select-field w-full" bind:value={selectedModelId} on:change={loadSelectedOptions} disabled={loading}>
          {#each models.filter(model => model.source === 'user-registry') as model}
            <option value={model.id}>{model.model} ({model.provider})</option>
          {/each}
        </select>
      </label>

      {#if selectedModel}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 md:col-span-2">
            <input type="checkbox" bind:checked={imageCapable} class="w-4 h-4 accent-violet-600" />
            <span>Selected model accepts image input</span>
          </label>
          <label class="block text-sm">
            <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Maximum images per request</span>
            <input class="input-field" type="number" min="1" max="16" bind:value={maxImages} />
          </label>
          <label class="block text-sm">
            <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Maximum size per image (MB)</span>
            <input class="input-field" type="number" min="1" max="20" bind:value={maxImageMb} />
          </label>
          <label class="block text-sm">
            <span class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Context window</span>
            <input class="input-field" type="number" min="512" step="512" bind:value={contextWindow} />
          </label>
          <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            <input type="checkbox" bind:checked={enableThinking} class="w-4 h-4 accent-violet-600" />
            <span>Enable model reasoning mode</span>
          </label>
          <fieldset class="text-sm md:col-span-2">
            <legend class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Accepted image formats</legend>
            <div class="flex flex-wrap gap-3 pt-1">
              <label class="flex items-center gap-1.5"><input type="checkbox" value="image/jpeg" bind:group={allowedImageMimeTypes} /> JPEG</label>
              <label class="flex items-center gap-1.5"><input type="checkbox" value="image/png" bind:group={allowedImageMimeTypes} /> PNG</label>
              <label class="flex items-center gap-1.5"><input type="checkbox" value="image/webp" bind:group={allowedImageMimeTypes} /> WebP</label>
            </div>
          </fieldset>
        </div>
        <button class="btn-primary mt-4" on:click={saveModelOptions} disabled={!selectedModelId || savingOptions}>
          {savingOptions ? 'Saving...' : 'Save model options'}
        </button>
      {/if}
    </div>
  {/if}
</div>
