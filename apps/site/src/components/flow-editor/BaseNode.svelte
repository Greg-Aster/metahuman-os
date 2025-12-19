<script lang="ts">
  import { Handle, Position, useSvelteFlow } from '@xyflow/svelte';
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
      executionOutput?: string; // Output to display for display nodes
      isUnconnected?: boolean; // True if node has no incoming/outgoing edges
    };
    selected?: boolean;
  } = $props();

  // Get Svelte Flow context for proper node updates
  const { updateNodeData } = useSvelteFlow();

  // Derive values from data
  const schema = $derived(data.schema);
  const nodeTitle = $derived(data.title || schema?.name || 'Node');
  const isMuted = $derived(data.muted || false);
  const executionState = $derived(data.executionState || 'idle');
  const isUnconnected = $derived(data.isUnconnected || false);

  // Category abbreviation for badge
  const categoryBadge = $derived(schema?.category?.slice(0, 3).toUpperCase() || 'NOD');

  // Only text_input nodes show a text input field
  // user_input receives from connected nodes (text_input, speech_to_text, etc.)
  const hasTextProperty = $derived(schema?.id === 'text_input');

  // Display nodes show execution output directly on the node
  // stream_writer outputs to these nodes, doesn't display itself
  const isDisplayNode = $derived(
    schema?.id === 'chat_view' ||
    schema?.id === 'display_buffer' ||
    schema?.id === 'output_viewer'
  );
  const hasOutput = $derived(isDisplayNode && data.executionOutput);

  // Slot height constant - handles and labels must use the same spacing
  const SLOT_HEIGHT = 20;

  // Count inputs and outputs
  const inputCount = $derived(schema?.inputs?.length || 0);
  const outputCount = $derived(schema?.outputs?.length || 0);
  const maxSlots = $derived(Math.max(inputCount, outputCount, 1));

  // Calculate handle offset based on expanded content
  // Base offset: 44px (header height + padding)
  // Text input adds ~76px (textarea with 3 rows + margin)
  // Display output adds ~60px (placeholder height + margin)
  const handleOffset = $derived(
    44 + (hasTextProperty ? 76 : 0) + (isDisplayNode ? 60 : 0)
  );

  // Calculate minimum body height to accommodate all slots
  // Each slot needs SLOT_HEIGHT px, plus padding
  const minBodyHeight = $derived(
    Math.max(40, maxSlots * SLOT_HEIGHT + 16) // 16px for padding
  );

  // Handle text input changes - use Svelte Flow's updateNodeData for proper reactivity
  // Uses 'message' property to match the schema definition
  function handleTextChange(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    updateNodeData(id, {
      properties: { ...data.properties, message: target.value }
    });
  }
</script>

<div
  class="base-node"
  class:selected
  class:muted={isMuted}
  class:running={executionState === 'running'}
  class:completed={executionState === 'completed'}
  class:failed={executionState === 'failed'}
  class:unconnected={isUnconnected}
  class:expanded={hasTextProperty || isDisplayNode}
  style="--node-color: {schema?.color || '#94a3b8'}; --node-bg: {schema?.bgColor || '#475569'};"
>
  <!-- Input Handles (Left side) -->
  {#if schema?.inputs}
    {#each schema.inputs as input, index}
      <Handle
        type="target"
        position={Position.Left}
        id={input.name}
        style="top: {handleOffset + index * SLOT_HEIGHT}px; left: 0; background: var(--node-color);"
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
  <div class="node-body" style="min-height: {minBodyHeight}px;">
    <!-- Text input for input nodes -->
    {#if hasTextProperty}
      <div class="text-input-container nodrag">
        <textarea
          class="node-text-input nowheel"
          placeholder="Enter text..."
          value={data.properties?.message || ''}
          oninput={handleTextChange}
          rows="3"
        ></textarea>
      </div>
    {/if}

    <!-- Output display for display nodes -->
    {#if isDisplayNode}
      <div class="output-display-container nodrag nowheel">
        {#if hasOutput}
          <div class="output-display">{data.executionOutput}</div>
        {:else}
          <div class="output-placeholder">Output will appear here after execution...</div>
        {/if}
      </div>
    {/if}

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
        style="top: {handleOffset + index * SLOT_HEIGHT}px; right: 0; background: var(--node-color);"
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

  .base-node.unconnected {
    border-color: #eab308;
    border-style: dashed;
    box-shadow: 0 0 8px rgba(234, 179, 8, 0.3);
    opacity: 0.8;
  }

  .base-node.expanded {
    min-width: 280px;
    width: 280px;
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
    /* padding-top accounts for header-to-handle alignment */
  }

  .text-input-container {
    margin-bottom: 8px;
  }

  .node-text-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    color: #fff;
    font-size: 11px;
    font-family: inherit;
    resize: vertical;
    line-height: 1.4;
  }

  .node-text-input:focus {
    outline: none;
    border-color: var(--node-color);
    background: rgba(0, 0, 0, 0.6);
  }

  .node-text-input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .output-display-container {
    margin-bottom: 8px;
  }

  .output-display {
    width: 100%;
    box-sizing: border-box;
    max-height: 200px;
    padding: 8px;
    background: rgba(34, 197, 94, 0.15);
    border: 1px solid rgba(34, 197, 94, 0.4);
    border-radius: 4px;
    color: #d1fae5;
    font-size: 11px;
    font-family: inherit;
    line-height: 1.4;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .output-placeholder {
    width: 100%;
    box-sizing: border-box;
    padding: 12px 8px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px dashed rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 10px;
    font-style: italic;
    text-align: center;
  }

  .slots-container {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    /* Small padding to align labels with handles (handleOffset vs header+body padding) */
    padding-top: 4px;
  }

  .inputs-column,
  .outputs-column {
    display: flex;
    flex-direction: column;
    gap: 0; /* No gap - use fixed height for exact alignment with handles */
  }

  .outputs-column {
    text-align: right;
  }

  .slot-label {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.7);
    height: 20px; /* Must match SLOT_HEIGHT in script */
    line-height: 20px;
    padding: 0;
  }

  /* Removed visual dots - real handles are on the edges, no need for duplicate indicators */

  /* Handle styling is controlled via the style prop */
  :global(.svelte-flow .svelte-flow__handle) {
    width: 10px;
    height: 10px;
    border: 2px solid #1a1a1a;
    border-radius: 50%;
  }
</style>
