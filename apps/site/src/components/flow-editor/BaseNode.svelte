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
  <div class="node-header flex items-center gap-2 py-2 px-3 bg-black/30 border-b border-white/10 rounded-t-md">
    <span class="category-badge text-[9px] font-bold py-0.5 px-1.5 rounded-sm tracking-wide">{categoryBadge}</span>
    <span class="flex-1 font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{nodeTitle}</span>
    {#if isMuted}
      <span class="text-[8px] py-0.5 px-1 bg-gray-600 rounded-sm text-gray-400">MUTED</span>
    {/if}
  </div>

  <!-- Node Body - Shows inputs/outputs -->
  <div class="node-body py-2 px-3" style="min-height: {minBodyHeight}px;">
    <!-- Text input for input nodes -->
    {#if hasTextProperty}
      <div class="mb-2 nodrag">
        <textarea
          class="node-text-input w-full box-border p-2 bg-black/40 border border-white/20 rounded text-white text-[11px] font-inherit resize-y leading-snug focus:outline-none focus:border-[var(--node-color)] focus:bg-black/60 placeholder:text-white/40 nowheel"
          placeholder="Enter text..."
          value={data.properties?.message || ''}
          oninput={handleTextChange}
          rows="3"
        ></textarea>
      </div>
    {/if}

    <!-- Output display for display nodes -->
    {#if isDisplayNode}
      <div class="mb-2 nodrag nowheel">
        {#if hasOutput}
          <div class="output-display w-full box-border max-h-[200px] p-2 bg-green-500/15 border border-green-500/40 rounded text-green-100 text-[11px] leading-snug overflow-y-auto whitespace-pre-wrap break-words">{data.executionOutput}</div>
        {:else}
          <div class="w-full box-border py-3 px-2 bg-black/30 border border-dashed border-white/20 rounded text-white/40 text-[10px] italic text-center">Output will appear here after execution...</div>
        {/if}
      </div>
    {/if}

    <div class="flex justify-between gap-4 pt-1">
      <!-- Inputs column -->
      <div class="flex flex-col">
        {#if schema?.inputs}
          {#each schema.inputs as input, index}
            <div class="slot-label text-[10px] text-white/70" title={input.description || input.name}>
              {input.name}
            </div>
          {/each}
        {/if}
      </div>

      <!-- Outputs column -->
      <div class="flex flex-col text-right">
        {#if schema?.outputs}
          {#each schema.outputs as output, index}
            <div class="slot-label text-[10px] text-white/70" title={output.description || output.name}>
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
  /* Base node with CSS variable theming */
  .base-node {
    @apply rounded-lg min-w-[180px] font-sans text-xs text-white transition-all;
    background: var(--node-bg);
    border: 2px solid var(--node-color);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  }
  .base-node.selected {
    border-color: #fff;
    box-shadow: 0 0 0 2px var(--node-color), 0 4px 12px rgba(0, 0, 0, 0.4);
  }
  .base-node.muted { @apply opacity-50; }
  .base-node.running {
    @apply border-amber-400;
    box-shadow: 0 0 12px rgba(251, 191, 36, 0.5);
    animation: pulse 1s ease-in-out infinite;
  }
  .base-node.completed {
    @apply border-green-500;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.4);
  }
  .base-node.failed {
    @apply border-red-500;
    box-shadow: 0 0 8px rgba(239, 68, 68, 0.4);
  }
  .base-node.unconnected {
    @apply border-yellow-500 border-dashed opacity-80;
    box-shadow: 0 0 8px rgba(234, 179, 8, 0.3);
  }
  .base-node.expanded {
    @apply min-w-[280px] w-[280px];
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
  }

  /* Category badge uses CSS variables for dynamic colors */
  .category-badge {
    background: var(--node-color);
    color: var(--node-bg);
  }

  /* Slot label height must match SLOT_HEIGHT constant in script */
  .slot-label {
    @apply h-5 leading-5 p-0;
  }

  /* Svelte Flow handle styling */
  :global(.svelte-flow .svelte-flow__handle) {
    @apply w-2.5 h-2.5 rounded-full;
    border: 2px solid #1a1a1a;
  }
</style>
