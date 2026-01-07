<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../lib/client/api-config';

  interface NodeSchema {
    id: string;
    name: string;
    category: string;
    description: string;
    color: string;
    bgColor: string;
    inputs: Array<{ name: string; type: string; optional?: boolean; description?: string }>;
    outputs: Array<{ name: string; type: string; optional?: boolean; description?: string }>;
    properties?: Record<string, any>;
  }

  let { onNodeSelected, collapsed = false }: {
    onNodeSelected: (nodeType: string) => void;
    collapsed?: boolean;
  } = $props();

  let searchQuery = $state('');
  let expandedCategories = $state<Set<string>>(new Set(['input', 'output'])); // Default expanded
  let allNodes = $state<NodeSchema[]>([]);
  let loading = $state(true);

  // Fetch schemas from API (dynamic - auto-updates when new nodes are added)
  onMount(async () => {
    try {
      const res = await apiFetch('/api/node-schemas');
      if (res.ok) {
        const data = await res.json();
        allNodes = Array.isArray(data) ? data : (data.schemas || []);
        console.log(`[NodePalette] Loaded ${allNodes.length} node schemas`);
      }
    } catch (e) {
      console.error('[NodePalette] Failed to load schemas:', e);
    } finally {
      loading = false;
    }
  });

  // Group nodes by category (reactive)
  const nodesByCategory = $derived(
    allNodes.reduce((acc, node) => {
      if (!acc[node.category]) {
        acc[node.category] = [];
      }
      acc[node.category].push(node);
      return acc;
    }, {} as Record<string, NodeSchema[]>)
  );

  // Category display names and order
  const categoryInfo: Record<string, { name: string; icon: string; order: number }> = {
    input: { name: 'Input', icon: '📥', order: 1 },
    router: { name: 'Router', icon: '🔀', order: 2 },
    context: { name: 'Context', icon: '📚', order: 3 },
    operator: { name: 'Operator', icon: '⚙️', order: 4 },
    chat: { name: 'Chat', icon: '💬', order: 5 },
    model: { name: 'Model', icon: '🤖', order: 6 },
    skill: { name: 'Skill', icon: '🔧', order: 7 },
    output: { name: 'Output', icon: '📤', order: 8 },
    control_flow: { name: 'Control Flow', icon: '🔄', order: 9 },
    memory: { name: 'Memory', icon: '🧠', order: 10 },
    utility: { name: 'Utility', icon: '🛠️', order: 11 },
    cognitive: { name: 'Cognitive', icon: '💡', order: 12 },
    safety: { name: 'Safety', icon: '🛡️', order: 13 },
    persona: { name: 'Persona', icon: '👤', order: 14 },
    agent: { name: 'Agent', icon: '🤖', order: 15 },
    thought: { name: 'Thought', icon: '💭', order: 16 },
    dreamer: { name: 'Dreamer', icon: '🌙', order: 17 },
    curiosity: { name: 'Curiosity', icon: '❓', order: 18 },
    curator: { name: 'Curator', icon: '📋', order: 19 },
    emulation: { name: 'Emulation', icon: '🎭', order: 20 },
    agency: { name: 'Agency', icon: '🎯', order: 21 },
  };

  // Get sorted categories (reactive)
  const sortedCategories = $derived(
    Object.keys(nodesByCategory).sort(
      (a, b) => (categoryInfo[a]?.order || 99) - (categoryInfo[b]?.order || 99)
    )
  );

  // Filter nodes based on search query (reactive)
  const filteredCategories = $derived(
    sortedCategories.map(category => ({
      category,
      nodes: nodesByCategory[category].filter(node =>
        node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })).filter(cat => cat.nodes.length > 0)
  );

  function toggleCategory(category: string) {
    // Must create new Set for Svelte 5 reactivity (mutations don't trigger updates)
    const newSet = new Set(expandedCategories);
    if (newSet.has(category)) {
      newSet.delete(category);
    } else {
      newSet.add(category);
    }
    expandedCategories = newSet;
  }

  function handleNodeClick(nodeId: string) {
    console.log('[NodePalette] Node clicked:', nodeId);
    const fullType = `cognitive/${nodeId}`;
    console.log('[NodePalette] Calling onNodeSelected with:', fullType);
    onNodeSelected(fullType);
  }
</script>

<div class="node-palette" class:collapsed>
  {#if !collapsed}
    <div class="flex items-center justify-between p-4 border-b border-neutral-700">
      <div class="flex items-center gap-2 text-white font-semibold text-sm">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/>
        </svg>
        <span>Node Palette</span>
      </div>
      <button onclick={() => collapsed = true} class="palette-btn" title="Collapse palette">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
      </button>
    </div>

    <div class="flex items-center gap-2 py-3 px-4 border-b border-neutral-700 bg-neutral-900">
      <svg class="w-4 h-4 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search nodes..."
        class="flex-1 bg-transparent border-0 text-white text-sm outline-none placeholder:text-neutral-600"
      />
      {#if searchQuery}
        <button onclick={() => searchQuery = ''} class="palette-btn">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      {/if}
    </div>

    <div class="categories-list">
      {#if loading}
        <div class="flex flex-col items-center justify-center py-12 px-4 gap-4 text-neutral-500">
          <span class="loading-spinner"></span>
          <p>Loading nodes...</p>
        </div>
      {:else if allNodes.length === 0}
        <div class="flex flex-col items-center justify-center py-12 px-4 text-center text-neutral-500">
          <p>No nodes available</p>
          <p class="text-xs text-neutral-600">Check server connection</p>
        </div>
      {:else}
      {#each filteredCategories as { category, nodes }}
        <div class="border-b border-neutral-800">
          <button
            class="category-header"
            onclick={() => toggleCategory(category)}
          >
            <svg class="w-4 h-4 chevron" class:expanded={expandedCategories.has(category)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
            <span class="text-base">{categoryInfo[category]?.icon || '📦'}</span>
            <span class="flex-1 font-semibold">{categoryInfo[category]?.name || category}</span>
            <span class="text-xs text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded-xl">{nodes.length}</span>
          </button>

          {#if expandedCategories.has(category)}
            <div class="py-2">
              {#each nodes as node}
                <button
                  class="node-item"
                  onclick={() => handleNodeClick(node.id)}
                  title={node.description}
                  style="--node-color: {node.color}; --node-bg: {node.bgColor};"
                >
                  <div class="w-[3px] h-8 rounded-sm flex-shrink-0" style="background: {node.color};"></div>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-white truncate">{node.name}</div>
                    <div class="text-xs text-neutral-500 truncate mt-0.5">{node.description}</div>
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}

      {#if filteredCategories.length === 0}
        <div class="flex flex-col items-center justify-center py-12 px-4 text-center text-neutral-500">
          <svg class="w-8 h-8 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p>No nodes found</p>
          <p class="text-xs text-neutral-600">Try a different search term</p>
        </div>
      {/if}
      {/if}
    </div>
  {:else}
    <button onclick={() => collapsed = false} class="expand-button" title="Expand node palette">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/>
      </svg>
      <span class="text-xs tracking-widest uppercase text-neutral-500">Nodes</span>
    </button>
  {/if}
</div>

<style>
  /* Node palette container */
  .node-palette {
    @apply w-[280px] h-full bg-neutral-900 border-r border-neutral-700 flex flex-col transition-all duration-300;
  }
  .node-palette.collapsed {
    @apply w-12;
  }

  /* Palette buttons (collapse/clear) */
  .palette-btn {
    @apply bg-transparent border-0 text-neutral-500 cursor-pointer p-1 rounded flex items-center gap-2 transition-all;
  }
  .palette-btn:hover {
    @apply bg-neutral-800 text-white;
  }

  /* Expand button (vertical text) */
  .expand-button {
    @apply bg-transparent border-0 text-neutral-500 cursor-pointer p-4 w-full h-full flex flex-col items-center justify-center gap-2 transition-all;
    writing-mode: vertical-rl;
    text-orientation: mixed;
  }
  .expand-button:hover {
    @apply bg-neutral-800 text-white;
  }

  /* Categories list with scrollbar */
  .categories-list {
    @apply flex-1 overflow-y-auto overflow-x-hidden;
  }
  .categories-list::-webkit-scrollbar { width: 8px; }
  .categories-list::-webkit-scrollbar-track { @apply bg-neutral-900; }
  .categories-list::-webkit-scrollbar-thumb { @apply bg-neutral-700 rounded; }
  .categories-list::-webkit-scrollbar-thumb:hover { @apply bg-neutral-600; }

  /* Category header */
  .category-header {
    @apply flex items-center gap-2 w-full py-3 px-4 bg-transparent border-0 text-neutral-300 cursor-pointer transition-colors text-left text-sm;
  }
  .category-header:hover {
    @apply bg-neutral-800;
  }

  /* Chevron rotation */
  .chevron {
    @apply transition-transform duration-200;
  }
  .chevron.expanded {
    transform: rotate(90deg);
  }

  /* Node item */
  .node-item {
    @apply flex items-center gap-3 w-full py-3 px-4 pl-10 bg-transparent border-0 text-neutral-300 cursor-pointer transition-all text-left;
  }
  .node-item:hover {
    @apply bg-neutral-800;
  }

  /* Loading spinner */
  .loading-spinner {
    @apply w-6 h-6 border-2 border-neutral-700 border-t-neutral-400 rounded-full;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
