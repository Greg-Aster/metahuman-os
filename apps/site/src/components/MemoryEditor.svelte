<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  export let isOpen = false;
  export let relPath: string = '';
  export let memoryType: string = 'Memory';

  const dispatch = createEventDispatcher();

  let content: string = '';
  let originalContent: string = '';
  let loading = false;
  let saving = false;
  let error: string = '';
  let format: 'json' | 'text' = 'json';
  let isDirty = false;

  $: if (isOpen && relPath) {
    loadContent();
  }

  $: isDirty = content !== originalContent;

  async function loadContent() {
    loading = true;
    error = '';
    try {
      const res = await apiFetch(`/api/memory-content?relPath=${encodeURIComponent(relPath)}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Failed to load memory');
      }
      content = data.content || '';
      originalContent = content;
      format = data.format || 'text';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function saveContent() {
    saving = true;
    error = '';
    try {
      const res = await apiFetch('/api/memory-content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relPath, content }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'Failed to save memory');
      }
      originalContent = content;
      dispatch('saved', { relPath });
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }

  function close() {
    if (isDirty) {
      if (!confirm('You have unsaved changes. Close anyway?')) {
        return;
      }
    }
    isOpen = false;
    content = '';
    originalContent = '';
    error = '';
    dispatch('close');
  }

  function handleKeydown(e: KeyboardEvent) {
    // Cmd/Ctrl + S to save
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (isDirty && !saving) {
        saveContent();
      }
    }
    // Escape to close
    if (e.key === 'Escape') {
      close();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
  <div class="modal-overlay" on:click={close}>
    <div class="modal-container bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-5xl w-full h-[80vh] flex flex-col" on:click|stopPropagation>
      <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div class="flex items-center gap-3">
          <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
          </svg>
          <div>
            <div class="text-lg font-semibold text-gray-900 dark:text-gray-100">{memoryType} Editor</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 font-mono">{relPath}</div>
          </div>
        </div>
        <button class="p-2 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" on:click={close} title="Close (Esc)">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      {#if error}
        <div class="banner banner-error mx-4 mt-4">
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          {error}
        </div>
      {/if}

      <div class="flex-1 overflow-hidden relative">
        {#if loading}
          <div class="flex flex-col items-center justify-center h-full gap-4 text-gray-500">
            <div class="spinner"></div>
            Loading memory...
          </div>
        {:else}
          <textarea
            class="editor-textarea"
            bind:value={content}
            placeholder="Memory content..."
            spellcheck="false"
          />
        {/if}
      </div>

      <div class="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700">
        <div class="flex items-center gap-4 text-xs">
          {#if isDirty}
            <span class="text-yellow-500 font-medium">Unsaved changes</span>
          {:else}
            <span class="text-green-500 font-medium">All changes saved</span>
          {/if}
          <span class="text-gray-400">Ctrl+S to save, Esc to close</span>
        </div>
        <div class="flex gap-3">
          <button class="btn-secondary" on:click={close} disabled={saving}>
            Close
          </button>
          <button
            class="btn-primary"
            on:click={saveContent}
            disabled={!isDirty || saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Modal overlay */
  .modal-overlay {
    @apply fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4;
  }

  /* Modal container - additional styling handled via Tailwind classes in HTML */
  .modal-container {
    @apply overflow-hidden;
  }

  /* Spinner animation */
  .spinner {
    @apply w-8 h-8 border-[3px] border-gray-200 dark:border-gray-700 border-t-blue-500 rounded-full;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Editor textarea */
  .editor-textarea {
    @apply w-full h-full p-6 border-0 outline-none resize-none
           font-mono text-sm leading-relaxed
           bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100;
  }
</style>
