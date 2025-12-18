<script lang="ts">
  import type { NodeSchema } from '@metahuman/core/nodes/types';

  // Props from Svelte Flow
  let {
    id,
    data,
    selected = false,
  }: {
    id: string;
    data: {
      schema: NodeSchema;
      properties?: Record<string, any>;
      title?: string;
      muted?: boolean;
    };
    selected?: boolean;
  } = $props();

  // Derive values from data
  const properties = $derived(data.properties || {});
  const noteTitle = $derived(properties.title || data.title || 'Note');
  const noteContent = $derived(properties.content || '');
  const noteStyle = $derived(properties.style || 'info');

  // Style-based colors
  const styleColors = {
    info: { color: '#60a5fa', bgColor: '#1e3a8a' },
    warning: { color: '#fbbf24', bgColor: '#92400e' },
    success: { color: '#4ade80', bgColor: '#166534' },
    error: { color: '#f87171', bgColor: '#991b1b' },
  };

  const colors = $derived(styleColors[noteStyle as keyof typeof styleColors] || styleColors.info);
</script>

<div
  class="note-node"
  class:selected
  style="--note-color: {colors.color}; --note-bg: {colors.bgColor};"
>
  <!-- Note Header -->
  <div class="note-header">
    <span class="note-icon">
      {#if noteStyle === 'info'}📝
      {:else if noteStyle === 'warning'}⚠️
      {:else if noteStyle === 'success'}✅
      {:else if noteStyle === 'error'}❌
      {:else}📝
      {/if}
    </span>
    <span class="note-title">{noteTitle}</span>
  </div>

  <!-- Note Content -->
  <div class="note-content">
    {#if noteContent}
      <pre class="note-text">{noteContent}</pre>
    {:else}
      <span class="note-placeholder">No content. Edit properties to add documentation.</span>
    {/if}
  </div>
</div>

<style>
  .note-node {
    background: var(--note-bg);
    border: 2px solid var(--note-color);
    border-radius: 8px;
    min-width: 300px;
    max-width: 500px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 12px;
    color: #fff;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    transition: all 0.15s ease;
  }

  .note-node.selected {
    border-color: #fff;
    box-shadow: 0 0 0 2px var(--note-color), 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .note-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: rgba(0, 0, 0, 0.3);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px 6px 0 0;
  }

  .note-icon {
    font-size: 16px;
  }

  .note-title {
    font-weight: 700;
    font-size: 14px;
    flex: 1;
    color: var(--note-color);
  }

  .note-content {
    padding: 12px 14px;
    min-height: 60px;
    max-height: 300px;
    overflow-y: auto;
  }

  .note-text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.9);
  }

  .note-placeholder {
    color: rgba(255, 255, 255, 0.4);
    font-style: italic;
  }
</style>
