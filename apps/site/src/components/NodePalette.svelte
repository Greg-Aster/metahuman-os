<script lang="ts">
  import { getCognitiveNodesList } from '../lib/client/visual-editor/node-registry';

  export let onNodeSelected: (nodeType: string) => void;
  export let collapsed = false;

  let searchQuery = '';
  let expandedCategories: Set<string> = new Set(['input', 'output']); // Default expanded

  const allNodes = getCognitiveNodesList();

  // Group nodes by category
  const nodesByCategory = allNodes.reduce((acc, node) => {
    if (!acc[node.category]) {
      acc[node.category] = [];
    }
    acc[node.category].push(node);
    return acc;
  }, {} as Record<string, typeof allNodes>);

  // Category display names and order
  const categoryInfo = {
    input: { name: 'Input', icon: '📥', order: 1 },
    router: { name: 'Router', icon: '🔀', order: 2 },
    context: { name: 'Context', icon: '📚', order: 3 },
    operator: { name: 'Operator', icon: '⚙️', order: 4 },
    chat: { name: 'Chat', icon: '💬', order: 5 },
    model: { name: 'Model', icon: '🤖', order: 6 },
    skill: { name: 'Skill', icon: '🔧', order: 7 },
    output: { name: 'Output', icon: '📤', order: 8 },
  };

  // Get sorted categories
  const sortedCategories = Object.keys(nodesByCategory).sort(
    (a, b) => (categoryInfo[a]?.order || 99) - (categoryInfo[b]?.order || 99)
  );

  // Filter nodes based on search query
  $: filteredCategories = sortedCategories.map(category => ({
    category,
    nodes: nodesByCategory[category].filter(node =>
      node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.description.toLowerCase().includes(searchQuery.toLowerCase())
    )
  })).filter(cat => cat.nodes.length > 0);

  function toggleCategory(category: string) {
    if (expandedCategories.has(category)) {
      expandedCategories.delete(category);
    } else {
      expandedCategories.add(category);
    }
    expandedCategories = expandedCategories; // Trigger reactivity
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
    <div class="palette-header">
      <div class="palette-title">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/>
        </svg>
        <span>Node Palette</span>
      </div>
      <button on:click={() => collapsed = true} class="collapse-button" title="Collapse palette">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
      </button>
    </div>

    <div class="search-box">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search nodes..."
        class="search-input"
      />
      {#if searchQuery}
        <button on:click={() => searchQuery = ''} class="clear-search">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      {/if}
    </div>

    <div class="categories-list">
      {#each filteredCategories as { category, nodes }}
        <div class="category">
          <button
            class="category-header"
            on:click={() => toggleCategory(category)}
          >
            <svg class="w-4 h-4 chevron" class:expanded={expandedCategories.has(category)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
            <span class="category-icon">{categoryInfo[category]?.icon || '📦'}</span>
            <span class="category-name">{categoryInfo[category]?.name || category}</span>
            <span class="category-count">{nodes.length}</span>
          </button>

          {#if expandedCategories.has(category)}
            <div class="nodes-list">
              {#each nodes as node}
                <button
                  class="node-item"
                  on:click={() => handleNodeClick(node.id)}
                  title={node.description}
                  style="--node-color: {node.color}; --node-bg: {node.bgColor};"
                >
                  <div class="node-color-bar" style="background: {node.color};"></div>
                  <div class="node-info">
                    <div class="node-name">{node.name}</div>
                    <div class="node-description">{node.description}</div>
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}

      {#if filteredCategories.length === 0}
        <div class="no-results">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p>No nodes found</p>
          <p class="hint">Try a different search term</p>
        </div>
      {/if}
    </div>
  {:else}
    <button on:click={() => collapsed = false} class="expand-button" title="Expand node palette">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/>
      </svg>
      <span class="expand-text">Nodes</span>
    </button>
  {/if}
</div>

<style>
  .node-palette {
    width: 280px;
    height: 100%;
    background: #1a1a1a;
    border-right: 1px solid #333;
    display: flex;
    flex-direction: column;
    transition: width 0.3s ease;
  }

  .node-palette.collapsed {
    width: 48px;
  }

  .palette-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-bottom: 1px solid #333;
  }

  .palette-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #fff;
    font-weight: 600;
    font-size: 0.875rem;
  }

  .collapse-button,
  .expand-button {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    transition: all 0.2s;
  }

  .collapse-button:hover,
  .expand-button:hover {
    background: #2a2a2a;
    color: #fff;
  }

  .expand-button {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    padding: 1rem 0.5rem;
    width: 100%;
    height: 100%;
    justify-content: center;
  }

  .expand-text {
    font-size: 0.75rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #888;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #333;
    background: #151515;
  }

  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    color: #fff;
    font-size: 0.875rem;
    outline: none;
  }

  .search-input::placeholder {
    color: #666;
  }

  .clear-search {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 4px;
    display: flex;
    transition: all 0.2s;
  }

  .clear-search:hover {
    background: #2a2a2a;
    color: #fff;
  }

  .categories-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .category {
    border-bottom: 1px solid #2a2a2a;
  }

  .category-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    color: #ddd;
    cursor: pointer;
    transition: background 0.2s;
    text-align: left;
    font-size: 0.875rem;
  }

  .category-header:hover {
    background: #2a2a2a;
  }

  .chevron {
    transition: transform 0.2s;
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  .category-icon {
    font-size: 1rem;
  }

  .category-name {
    flex: 1;
    font-weight: 600;
  }

  .category-count {
    color: #666;
    font-size: 0.75rem;
    background: #2a2a2a;
    padding: 0.125rem 0.5rem;
    border-radius: 12px;
  }

  .nodes-list {
    padding: 0.5rem 0;
  }

  .node-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    padding-left: 2.5rem;
    background: transparent;
    border: none;
    color: #ddd;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
  }

  .node-item:hover {
    background: #2a2a2a;
  }

  .node-color-bar {
    width: 3px;
    height: 32px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .node-info {
    flex: 1;
    min-width: 0;
  }

  .node-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .node-description {
    font-size: 0.75rem;
    color: #888;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 0.125rem;
  }

  .no-results {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 1rem;
    text-align: center;
    color: #666;
  }

  .no-results svg {
    margin-bottom: 1rem;
    opacity: 0.5;
  }

  .no-results p {
    margin: 0.25rem 0;
  }

  .no-results .hint {
    font-size: 0.75rem;
    color: #555;
  }

  /* Custom scrollbar */
  .categories-list::-webkit-scrollbar {
    width: 8px;
  }

  .categories-list::-webkit-scrollbar-track {
    background: #1a1a1a;
  }

  .categories-list::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 4px;
  }

  .categories-list::-webkit-scrollbar-thumb:hover {
    background: #444;
  }
</style>
