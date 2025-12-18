<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
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
      executionState?: 'idle' | 'running' | 'completed' | 'failed';
    };
    selected?: boolean;
  } = $props();

  // Derive values from data
  const schema = $derived(data.schema);
  const nodeTitle = $derived(data.title || schema?.name || 'Node');
  const isMuted = $derived(data.muted || false);
  const executionState = $derived(data.executionState || 'idle');

  // Category abbreviation for badge
  const categoryBadge = $derived(schema?.category?.slice(0, 3).toUpperCase() || 'NOD');
</script>

<div
  class="base-node"
  class:selected
  class:muted={isMuted}
  class:running={executionState === 'running'}
  class:completed={executionState === 'completed'}
  class:failed={executionState === 'failed'}
  style="--node-color: {schema?.color || '#94a3b8'}; --node-bg: {schema?.bgColor || '#475569'};"
>
  <!-- Input Handles (Left side) -->
  {#if schema?.inputs}
    {#each schema.inputs as input, index}
      <Handle
        type="target"
        position={Position.Left}
        id={input.name}
        style="top: {44 + index * 20}px; background: var(--node-color);"
      />
    {/each}
  {/if}

  <!-- Node Header -->
  <div class="node-header">
    <span class="category-badge">{categoryBadge}</span>
    <span class="node-title">{nodeTitle}</span>
    {#if isMuted}
      <span class="muted-badge">MUTED</span>
    {/if}
  </div>

  <!-- Node Body - Shows inputs/outputs -->
  <div class="node-body">
    <div class="slots-container">
      <!-- Inputs column -->
      <div class="inputs-column">
        {#if schema?.inputs}
          {#each schema.inputs as input, index}
            <div class="slot-label input-label" title={input.description || input.name}>
              {input.name}
            </div>
          {/each}
        {/if}
      </div>

      <!-- Outputs column -->
      <div class="outputs-column">
        {#if schema?.outputs}
          {#each schema.outputs as output, index}
            <div class="slot-label output-label" title={output.description || output.name}>
              {output.name}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>

  <!-- Output Handles (Right side) -->
  {#if schema?.outputs}
    {#each schema.outputs as output, index}
      <Handle
        type="source"
        position={Position.Right}
        id={output.name}
        style="top: {44 + index * 20}px; background: var(--node-color);"
      />
    {/each}
  {/if}
</div>

<style>
  .base-node {
    background: var(--node-bg);
    border: 2px solid var(--node-color);
    border-radius: 8px;
    min-width: 180px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 12px;
    color: #fff;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    transition: all 0.15s ease;
  }

  .base-node.selected {
    border-color: #fff;
    box-shadow: 0 0 0 2px var(--node-color), 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .base-node.muted {
    opacity: 0.5;
  }

  .base-node.running {
    border-color: #fbbf24;
    box-shadow: 0 0 12px rgba(251, 191, 36, 0.5);
    animation: pulse 1s ease-in-out infinite;
  }

  .base-node.completed {
    border-color: #22c55e;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.4);
  }

  .base-node.failed {
    border-color: #ef4444;
    box-shadow: 0 0 8px rgba(239, 68, 68, 0.4);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
  }

  .node-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.3);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px 6px 0 0;
  }

  .category-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 2px 6px;
    background: var(--node-color);
    color: var(--node-bg);
    border-radius: 3px;
    letter-spacing: 0.5px;
  }

  .node-title {
    font-weight: 600;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .muted-badge {
    font-size: 8px;
    padding: 2px 4px;
    background: #666;
    border-radius: 2px;
    color: #ccc;
  }

  .node-body {
    padding: 8px 12px;
    min-height: 40px;
  }

  .slots-container {
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }

  .inputs-column,
  .outputs-column {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .outputs-column {
    text-align: right;
  }

  .slot-label {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.7);
    padding: 2px 0;
    line-height: 16px;
  }

  .input-label::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    background: var(--node-color);
    border-radius: 50%;
    margin-right: 4px;
    vertical-align: middle;
  }

  .output-label::after {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    background: var(--node-color);
    border-radius: 50%;
    margin-left: 4px;
    vertical-align: middle;
  }

  /* Handle styling is controlled via the style prop */
  :global(.svelte-flow .svelte-flow__handle) {
    width: 10px;
    height: 10px;
    border: 2px solid #1a1a1a;
    border-radius: 50%;
  }
</style>
