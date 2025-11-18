<script lang="ts">
  import { onMount } from 'svelte';
  import { nodeEditorMode } from '../stores/navigation';
  import NodeEditor from './NodeEditor.svelte';

  // Import LiteGraph.js CSS
  import 'litegraph.js/css/litegraph.css';

  let nodeEditorRef: any;
  let currentGraph: any = null;
  let graphName = 'Untitled Graph';
  let availableGraphs: string[] = [];
  let showSaveDialog = false;
  let saveGraphName = '';

  // Load available graphs on mount
  onMount(async () => {
    await loadAvailableGraphs();
  });

  async function loadAvailableGraphs() {
    try {
      const res = await fetch('/api/cognitive-graphs');
      if (res.ok) {
        const data = await res.json();
        availableGraphs = data.graphs || [];
      }
    } catch (e) {
      console.error('Failed to load graphs:', e);
    }
  }

  async function loadGraph(name: string) {
    try {
      const res = await fetch(`/api/cognitive-graph?name=${encodeURIComponent(name)}`);
      if (res.ok) {
        const data = await res.json();
        if (nodeEditorRef) {
          nodeEditorRef.loadGraph(data.graph);
          graphName = name;
        }
      }
    } catch (e) {
      console.error('Failed to load graph:', e);
    }
  }

  function newGraph() {
    if (nodeEditorRef) {
      nodeEditorRef.clearGraph();
      graphName = 'Untitled Graph';
    }
  }

  function openSaveDialog() {
    saveGraphName = graphName;
    showSaveDialog = true;
  }

  async function saveGraph() {
    if (!nodeEditorRef || !saveGraphName.trim()) return;

    try {
      const graphData = nodeEditorRef.exportGraph();
      const res = await fetch('/api/cognitive-graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveGraphName,
          graph: graphData,
        }),
      });

      if (res.ok) {
        graphName = saveGraphName;
        showSaveDialog = false;
        await loadAvailableGraphs();
      }
    } catch (e) {
      console.error('Failed to save graph:', e);
    }
  }

  function exitNodeEditor() {
    nodeEditorMode.set(false);
  }
</script>

<div class="node-editor-layout">
  <!-- Header -->
  <header class="node-editor-header">
    <div class="header-left">
      <button
        on:click={exitNodeEditor}
        class="exit-button"
        aria-label="Exit node editor"
        title="Back to traditional view"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
        </svg>
        <span>Exit Node Editor</span>
      </button>

      <div class="graph-name">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
        </svg>
        <span>{graphName}</span>
      </div>
    </div>

    <div class="header-actions">
      <button on:click={newGraph} class="action-button">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        New
      </button>

      <div class="dropdown">
        <button class="action-button">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"/>
          </svg>
          Load
        </button>
      </div>

      <button on:click={openSaveDialog} class="action-button primary">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/>
        </svg>
        Save
      </button>
    </div>
  </header>

  <!-- Main Editor Area -->
  <div class="editor-area">
    <NodeEditor bind:this={nodeEditorRef} />
  </div>

  <!-- Save Dialog -->
  {#if showSaveDialog}
    <div class="modal-overlay" on:click={() => showSaveDialog = false}>
      <div class="modal" on:click|stopPropagation>
        <h3>Save Cognitive Graph</h3>
        <input
          type="text"
          bind:value={saveGraphName}
          placeholder="Enter graph name"
          class="graph-name-input"
        />
        <div class="modal-actions">
          <button on:click={() => showSaveDialog = false} class="cancel-button">Cancel</button>
          <button on:click={saveGraph} class="save-button">Save</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .node-editor-layout {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: #0a0a0a;
  }

  .node-editor-header {
    height: 60px;
    background: #1a1a1a;
    border-bottom: 1px solid #333;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1.5rem;
    gap: 1rem;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }

  .exit-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid #444;
    color: #aaa;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.875rem;
  }

  .exit-button:hover {
    background: #2a2a2a;
    border-color: #666;
    color: #fff;
  }

  .graph-name {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #fff;
    font-weight: 500;
    font-size: 1.125rem;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .action-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: #2a2a2a;
    border: 1px solid #444;
    color: #ddd;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.875rem;
  }

  .action-button:hover {
    background: #333;
    border-color: #666;
    color: #fff;
  }

  .action-button.primary {
    background: #3b82f6;
    border-color: #3b82f6;
    color: #fff;
  }

  .action-button.primary:hover {
    background: #2563eb;
    border-color: #2563eb;
  }

  .editor-area {
    flex: 1;
    overflow: hidden;
  }

  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 2rem;
    min-width: 400px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }

  .modal h3 {
    margin: 0 0 1.5rem 0;
    color: #fff;
    font-size: 1.25rem;
  }

  .graph-name-input {
    width: 100%;
    padding: 0.75rem;
    background: #0a0a0a;
    border: 1px solid #444;
    border-radius: 6px;
    color: #fff;
    font-size: 1rem;
    margin-bottom: 1.5rem;
  }

  .graph-name-input:focus {
    outline: none;
    border-color: #3b82f6;
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
  }

  .cancel-button,
  .save-button {
    padding: 0.625rem 1.25rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
  }

  .cancel-button {
    background: transparent;
    border: 1px solid #444;
    color: #ddd;
  }

  .cancel-button:hover {
    background: #2a2a2a;
  }

  .save-button {
    background: #3b82f6;
    border: 1px solid #3b82f6;
    color: #fff;
  }

  .save-button:hover {
    background: #2563eb;
  }

  /* Dark mode support (already dark by default) */
  :global(.dark) .node-editor-layout {
    /* Already dark */
  }
</style>
