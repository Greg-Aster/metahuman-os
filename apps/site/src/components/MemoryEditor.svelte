<script lang="ts">
  import { createEventDispatcher } from 'svelte';

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
      const res = await fetch(`/api/memory-content?relPath=${encodeURIComponent(relPath)}`);
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
      const res = await fetch('/api/memory-content', {
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
    <div class="modal-container" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-title">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
          </svg>
          <div>
            <div class="modal-title-text">{memoryType} Editor</div>
            <div class="modal-subtitle">{relPath}</div>
          </div>
        </div>
        <button class="modal-close" on:click={close} title="Close (Esc)">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      {#if error}
        <div class="error-banner">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          {error}
        </div>
      {/if}

      <div class="modal-body">
        {#if loading}
          <div class="loading-state">
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

      <div class="modal-footer">
        <div class="footer-info">
          {#if isDirty}
            <span class="unsaved-indicator">Unsaved changes</span>
          {:else}
            <span class="saved-indicator">All changes saved</span>
          {/if}
          <span class="hint">Ctrl+S to save, Esc to close</span>
        </div>
        <div class="footer-actions">
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
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-container {
    background: white;
    border-radius: 8px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    max-width: 1200px;
    width: 100%;
    height: 80vh;
    display: flex;
    flex-direction: column;
  }

  :global(.dark) .modal-container {
    background: rgb(17 24 39);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid rgb(229 231 235);
  }

  :global(.dark) .modal-header {
    border-bottom-color: rgb(55 65 81);
  }

  .modal-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .modal-title svg {
    color: rgb(59 130 246);
  }

  .modal-title-text {
    font-size: 1.125rem;
    font-weight: 600;
    color: rgb(17 24 39);
  }

  :global(.dark) .modal-title-text {
    color: rgb(243 244 246);
  }

  .modal-subtitle {
    font-size: 0.75rem;
    color: rgb(107 114 128);
    font-family: 'Monaco', 'Menlo', monospace;
  }

  :global(.dark) .modal-subtitle {
    color: rgb(156 163 175);
  }

  .modal-close {
    padding: 0.5rem;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: rgb(107 114 128);
    cursor: pointer;
    transition: all 0.2s;
  }

  .modal-close:hover {
    background: rgb(243 244 246);
    color: rgb(17 24 39);
  }

  :global(.dark) .modal-close:hover {
    background: rgb(55 65 81);
    color: rgb(243 244 246);
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    background: rgb(254 226 226);
    color: rgb(153 27 27);
    font-size: 0.875rem;
  }

  :global(.dark) .error-banner {
    background: rgb(127 29 29);
    color: rgb(254 202 202);
  }

  .modal-body {
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 1rem;
    color: rgb(107 114 128);
  }

  .spinner {
    width: 2rem;
    height: 2rem;
    border: 3px solid rgb(229 231 235);
    border-top-color: rgb(59 130 246);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  :global(.dark) .spinner {
    border-color: rgb(55 65 81);
    border-top-color: rgb(59 130 246);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .editor-textarea {
    width: 100%;
    height: 100%;
    padding: 1.5rem;
    border: none;
    outline: none;
    resize: none;
    font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
    font-size: 0.875rem;
    line-height: 1.6;
    background: rgb(249 250 251);
    color: rgb(17 24 39);
  }

  :global(.dark) .editor-textarea {
    background: rgb(31 41 55);
    color: rgb(243 244 246);
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-top: 1px solid rgb(229 231 235);
  }

  :global(.dark) .modal-footer {
    border-top-color: rgb(55 65 81);
  }

  .footer-info {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 0.75rem;
  }

  .unsaved-indicator {
    color: rgb(234 179 8);
    font-weight: 500;
  }

  .saved-indicator {
    color: rgb(34 197 94);
    font-weight: 500;
  }

  .hint {
    color: rgb(156 163 175);
  }

  .footer-actions {
    display: flex;
    gap: 0.75rem;
  }

  .btn-secondary,
  .btn-primary {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: none;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-secondary {
    background: rgb(243 244 246);
    color: rgb(17 24 39);
  }

  .btn-secondary:hover:not(:disabled) {
    background: rgb(229 231 235);
  }

  :global(.dark) .btn-secondary {
    background: rgb(55 65 81);
    color: rgb(243 244 246);
  }

  :global(.dark) .btn-secondary:hover:not(:disabled) {
    background: rgb(75 85 99);
  }

  .btn-primary {
    background: rgb(59 130 246);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: rgb(37 99 235);
  }

  .btn-primary:disabled,
  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
