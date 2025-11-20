<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { nodeEditorMode } from '../stores/navigation';
  import NodeEditor from './NodeEditor.svelte';
  import NodePalette from './NodePalette.svelte';
  import { listTemplates, loadTemplateAsGraph } from '../lib/cognitive-nodes/template-loader';

  // Import LiteGraph.js CSS (CSS imports are safe during SSR)
  import 'litegraph.js/css/litegraph.css';

  // Accept current cognitive mode from parent
  export let cognitiveMode: string | null | undefined = null;

  let nodeEditorRef: any;
  let currentGraph: any = null;
  let graphName = 'Untitled Graph';
  let availableTemplates = listTemplates();
  type GraphSummary = {
    name: string;
    title: string;
    description: string;
    cognitiveMode: string | null;
    scope: 'builtin' | 'custom';
    updatedAt: string;
  };
  let savedGraphs: GraphSummary[] = [];
  let graphsLoading = false;
  let graphsError = '';
  let showSaveDialog = false;
  let showLoadMenu = false;
  let saveGraphName = '';
  let isExecuting = false;
  let executionError = '';
  let showKeyboardHelp = false;
  let showTracesPanel = false;
  let traceEntries: Array<{
    timestamp: string;
    mode?: string;
    graph?: string;
    sessionId?: string;
    status?: string;
    durationMs?: number;
    eventCount?: number;
    error?: string;
  }> = [];
  let tracesLoading = false;
  let tracesError = '';
  let loadMenuRef: HTMLDivElement;

  // Update graph name when cognitive mode changes
  $: {
    console.log('[NodeEditorLayout] Cognitive mode prop changed:', cognitiveMode);
    if (cognitiveMode) {
      const template = availableTemplates.find(t => t.id === `${cognitiveMode}-mode`);
      graphName = template?.name || `${cognitiveMode.charAt(0).toUpperCase() + cognitiveMode.slice(1)} Mode`;
      console.log('[NodeEditorLayout] Updated graph name to:', graphName);
    } else {
      console.log('[NodeEditorLayout] Cognitive mode is null/undefined, keeping default name');
    }
  }

  // Load available graphs on mount
  onMount(async () => {
    // Templates are already listed
    void refreshSavedGraphs();

    // NodeEditor will auto-load the template based on cognitiveMode prop
    // No need to duplicate that logic here

    // Add keyboard shortcuts
    window.addEventListener('keydown', handleKeyDown);
    // Add click-outside handler for dropdown menu
    window.addEventListener('click', handleClickOutside);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleClickOutside);
    };
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('click', handleClickOutside);
  });

  function handleClickOutside(e: MouseEvent) {
    if (!showLoadMenu) return;

    // Check if click is outside the dropdown menu
    if (loadMenuRef && !loadMenuRef.contains(e.target as Node)) {
      showLoadMenu = false;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Ignore if typing in an input field
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    // Ctrl+S: Save graph
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      openSaveDialog();
      return;
    }

    // Ctrl+Z: Undo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
      e.preventDefault();
      if (nodeEditorRef?.graph) {
        nodeEditorRef.graph.undo?.();
        console.log('[NodeEditor] Undo');
      }
      return;
    }

    // Ctrl+Y or Ctrl+Shift+Z: Redo
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
      e.preventDefault();
      if (nodeEditorRef?.graph) {
        nodeEditorRef.graph.redo?.();
        console.log('[NodeEditor] Redo');
      }
      return;
    }

    // Delete or Backspace: Delete selected nodes
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (nodeEditorRef?.graph) {
        const selected = nodeEditorRef.graph.getSelectedNodes();
        if (selected && selected.length > 0) {
          selected.forEach((node: any) => {
            nodeEditorRef.graph.remove(node);
          });
          console.log(`[NodeEditor] Deleted ${selected.length} node(s)`);
        }
      }
      return;
    }

    // Ctrl+A: Select all nodes
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      if (nodeEditorRef?.graph) {
        nodeEditorRef.graph.selectNodes();
        console.log('[NodeEditor] Selected all nodes');
      }
      return;
    }

    // Escape: Deselect all
    if (e.key === 'Escape') {
      e.preventDefault();
      if (nodeEditorRef?.graph) {
        nodeEditorRef.graph.deselectAllNodes?.() || nodeEditorRef.graph.clearSelection?.();
        console.log('[NodeEditor] Deselected all nodes');
      }
      return;
    }

    // Ctrl+E: Execute graph
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
      e.preventDefault();
      if (!isExecuting) {
        executeGraph();
      }
      return;
    }

    // ?: Show keyboard shortcuts help
    if (e.key === '?') {
      e.preventDefault();
      showKeyboardHelp = !showKeyboardHelp;
      return;
    }
  }

  async function executeGraph() {
    if (!nodeEditorRef || !nodeEditorRef.graph) return;

    isExecuting = true;
    executionError = '';

    try {
      // Get the graph data from the editor
      const graphData = nodeEditorRef.graph.serialize();

      console.log('[NodeEditorLayout] Sending graph to backend for REAL execution...', {
        nodes: graphData.nodes?.length || 0,
        links: graphData.links?.length || 0,
      });

      // Send to backend for REAL execution with actual node implementations
      const response = await fetch('/api/execute-graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: graphData,
          sessionId: `editor-${Date.now()}`,
          userMessage: 'Test message from node editor',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Server error: ${response.status}`);
      }

      const result = await response.json();

      console.log('[NodeEditorLayout] ✅ REAL execution completed!', {
        durationMs: result.durationMs,
        executedNodes: result.result?.executedNodes?.length || 0,
      });

      // TODO: Display results in UI (for now, check console)
    } catch (e: any) {
      console.error('[NodeEditorLayout] Execution error:', e);
      executionError = e.message || 'Execution failed';

      // Show error for 3 seconds
      setTimeout(() => {
        executionError = '';
      }, 3000);
    } finally {
      isExecuting = false;
    }
  }

  async function loadTemplate(templateId: string) {
    try {
      console.log(`[NodeEditor] Loading template: ${templateId}`);
      const graphData = await loadTemplateAsGraph(templateId);

      if (!graphData) {
        console.error(`[NodeEditor] Failed to load template data for ${templateId}`);
        return;
      }

      if (!nodeEditorRef) {
        console.error(`[NodeEditor] Node editor ref not ready yet`);
        return;
      }

      console.log(`[NodeEditor] Loading graph into editor...`);
      nodeEditorRef.loadGraph(graphData);

      const template = availableTemplates.find(t => t.id === templateId);
      graphName = template?.name || templateId;
      console.log(`[NodeEditor] Graph loaded successfully: ${graphName}`);

      showLoadMenu = false;
    } catch (e) {
      console.error('[NodeEditor] Failed to load template:', e);
    }
  }

  async function refreshSavedGraphs() {
    graphsLoading = true;
    graphsError = '';
    try {
      const res = await fetch('/api/cognitive-graphs');
      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}`);
      }
      const data = await res.json();
      // Only show custom graphs in "Saved Graphs" - built-in templates appear in "Cognitive Mode Templates"
      savedGraphs = Array.isArray(data.graphs) ? data.graphs.filter((g: GraphSummary) => g.scope === 'custom') : [];
    } catch (error: any) {
      console.error('[NodeEditor] Failed to fetch graphs:', error);
      graphsError = error?.message || 'Failed to load graphs';
    } finally {
      graphsLoading = false;
    }
  }

  async function loadTraces() {
    tracesLoading = true;
    tracesError = '';
    try {
      const res = await fetch('/api/graph-traces?limit=25');
      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}`);
      }
      const data = await res.json();
      traceEntries = Array.isArray(data.traces) ? data.traces : [];
    } catch (error: any) {
      console.error('[NodeEditor] Failed to load traces:', error);
      tracesError = error?.message || 'Failed to load graph traces';
    } finally {
      tracesLoading = false;
    }
  }

  async function openTracesPanel() {
    showTracesPanel = true;
    await loadTraces();
  }

  async function loadGraph(name: string) {
    try {
      const res = await fetch(`/api/cognitive-graph?name=${encodeURIComponent(name)}`);
      if (res.ok) {
        const data = await res.json();
        if (nodeEditorRef) {
          nodeEditorRef.loadGraph(data.graph);
          graphName = data.graph?.name || name;
          showLoadMenu = false;
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

  let saveError = '';
  let saveSuccess = false;

  async function saveGraph() {
    if (!nodeEditorRef || !saveGraphName.trim()) return;

    saveError = '';
    saveSuccess = false;

    try {
      const graphData = nodeEditorRef.exportGraph();

      // Add metadata to the graph
      const graphWithMetadata = {
        ...graphData,
        name: saveGraphName,
        description: `Custom cognitive graph: ${saveGraphName}`,
        version: '1.0',
        created: graphData.created || new Date().toISOString(),
        last_modified: new Date().toISOString(),
      };

      const res = await fetch('/api/cognitive-graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveGraphName,
          graph: graphWithMetadata,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save graph');
      }

      const result = await res.json();
      console.log('[NodeEditor] Graph saved:', result);

      graphName = saveGraphName;
      saveSuccess = true;
      void refreshSavedGraphs();

      // Close dialog after 1 second
      setTimeout(() => {
        showSaveDialog = false;
        saveSuccess = false;
      }, 1000);

    } catch (e: any) {
      console.error('Failed to save graph:', e);
      saveError = e.message || 'Failed to save graph';
    }
  }

  function exitNodeEditor() {
    nodeEditorMode.set(false);
  }

  function handleNodeSelected(nodeType: string) {
    console.log('[NodeEditorLayout] handleNodeSelected called with:', nodeType);
    console.log('[NodeEditorLayout] nodeEditorRef exists:', !!nodeEditorRef);

    if (!nodeEditorRef) {
      console.warn('[NodeEditorLayout] Node editor not initialized');
      return;
    }

    console.log('[NodeEditorLayout] Calling nodeEditorRef.addNode');
    nodeEditorRef.addNode(nodeType);
  }

  async function deleteGraph(name: string) {
    if (!name) return;
    const confirmation = confirm(`Delete graph "${name}"? This cannot be undone.`);
    if (!confirmation) return;

    try {
      const res = await fetch(`/api/cognitive-graph?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to delete graph');
      }

      console.log('[NodeEditor] Graph deleted:', name);
      if (graphName === name) {
        graphName = 'Untitled Graph';
      }
      void refreshSavedGraphs();
    } catch (error) {
      console.error('Failed to delete graph:', error);
      alert((error as Error).message || 'Failed to delete graph');
    }
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

      <div class="dropdown" style="position: relative" bind:this={loadMenuRef}>
        <button class="action-button" on:click|stopPropagation={() => showLoadMenu = !showLoadMenu}>
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"/>
          </svg>
          Load Graph
        </button>
        {#if showLoadMenu}
          <div class="dropdown-menu" on:click|stopPropagation>
            <div class="dropdown-header">Saved Graphs</div>
            {#if graphsLoading}
              <div class="dropdown-item disabled">Loading...</div>
            {:else if graphsError}
              <div class="dropdown-item error">{graphsError}</div>
            {:else if savedGraphs.length === 0}
              <div class="dropdown-item disabled">No saved graphs yet</div>
            {:else}
              {#each savedGraphs as graph}
                <div class="dropdown-item saved-graph">
                  <button class="dropdown-item-button" on:click={() => loadGraph(graph.name)}>
                    <div class="template-name">{graph.title}</div>
                    <div class="template-description">
                      {graph.description || 'Custom graph'}
                      {#if graph.cognitiveMode}
                        · Mode: {graph.cognitiveMode}
                      {/if}
                    </div>
                  </button>
                  {#if graph.scope === 'custom'}
                    <button class="delete-button" title="Delete graph" on:click|stopPropagation={() => deleteGraph(graph.name)}>
                      ✕
                    </button>
                  {/if}
                </div>
              {/each}
            {/if}
            <div class="dropdown-divider"></div>
            <div class="dropdown-header">Cognitive Mode Templates</div>
            {#each availableTemplates as template}
              <button class="dropdown-item" on:click={() => loadTemplate(template.id)}>
                <div>
                  <div class="template-name">{template.name}</div>
                  <div class="template-description">{template.description}</div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <button
        on:click={executeGraph}
        class="action-button execute"
        disabled={isExecuting}
        title={isExecuting ? 'Executing...' : 'Execute graph'}
      >
        {#if isExecuting}
          <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        {:else}
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
        {/if}
        {isExecuting ? 'Executing...' : 'Execute'}
      </button>

      <button on:click={openSaveDialog} class="action-button primary">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/>
        </svg>
        Save
      </button>

      <button
        on:click={openTracesPanel}
        class="action-button"
        title="Graph telemetry"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 12h4l3 8 4-16 3 8h4"/>
        </svg>
      </button>

      <button
        on:click={() => showKeyboardHelp = true}
        class="action-button"
        title="Keyboard shortcuts (?)"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
      </button>
    </div>
  </header>

  <!-- Execution Error Notification -->
  {#if executionError}
    <div class="execution-error-banner">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <span>Execution failed: {executionError}</span>
      <button on:click={() => executionError = ''} class="close-error">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
  {/if}

  <!-- Main Content Area with Palette -->
  <div class="main-content">
    <!-- Node Palette Sidebar -->
    <NodePalette onNodeSelected={handleNodeSelected} />

    <!-- Editor Area -->
    <div class="editor-area">
      <NodeEditor bind:this={nodeEditorRef} {cognitiveMode} />

      <!-- Execution Progress Overlay -->
      {#if isExecuting}
        <div class="execution-overlay">
          <div class="execution-status">
            <svg class="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <div class="execution-text">
              <div class="execution-title">Executing Graph...</div>
              <div class="execution-subtitle">Watch nodes highlight as they process</div>
            </div>
          </div>
        </div>
      {/if}
    </div>
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
          on:keydown={(e) => e.key === 'Enter' && saveGraph()}
        />
        {#if saveError}
          <div class="save-error">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            {saveError}
          </div>
        {/if}
        {#if saveSuccess}
          <div class="save-success">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
            Graph saved successfully!
          </div>
        {/if}
        <div class="modal-actions">
          <button on:click={() => showSaveDialog = false} class="cancel-button">Cancel</button>
          <button on:click={saveGraph} class="save-button" disabled={saveSuccess}>
            {saveSuccess ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Keyboard Shortcuts Help -->
  {#if showKeyboardHelp}
    <div class="modal-overlay" on:click={() => showKeyboardHelp = false}>
      <div class="modal help-modal" on:click|stopPropagation>
        <div class="help-header">
          <h3>Keyboard Shortcuts</h3>
          <button on:click={() => showKeyboardHelp = false} class="close-help">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div class="shortcuts-grid">
          <div class="shortcut-section">
            <h4>Graph Operations</h4>
            <div class="shortcut-item">
              <kbd>Ctrl</kbd> + <kbd>S</kbd>
              <span>Save graph</span>
            </div>
            <div class="shortcut-item">
              <kbd>Ctrl</kbd> + <kbd>E</kbd>
              <span>Execute graph</span>
            </div>
          </div>

          <div class="shortcut-section">
            <h4>Editing</h4>
            <div class="shortcut-item">
              <kbd>Ctrl</kbd> + <kbd>Z</kbd>
              <span>Undo</span>
            </div>
            <div class="shortcut-item">
              <kbd>Ctrl</kbd> + <kbd>Y</kbd>
              <span>Redo</span>
            </div>
            <div class="shortcut-item">
              <kbd>Delete</kbd>
              <span>Delete selected nodes</span>
            </div>
          </div>

          <div class="shortcut-section">
            <h4>Selection</h4>
            <div class="shortcut-item">
              <kbd>Ctrl</kbd> + <kbd>A</kbd>
              <span>Select all</span>
            </div>
            <div class="shortcut-item">
              <kbd>Esc</kbd>
              <span>Deselect all</span>
            </div>
          </div>

          <div class="shortcut-section">
            <h4>Navigation</h4>
            <div class="shortcut-item">
              <kbd>Space</kbd> + <span class="text-small">drag</span>
              <span>Pan canvas</span>
            </div>
            <div class="shortcut-item">
              <kbd>Scroll</kbd>
              <span>Zoom in/out</span>
            </div>
            <div class="shortcut-item">
              <kbd>Right-click</kbd>
              <span>Add node menu</span>
            </div>
          </div>

          <div class="shortcut-section">
            <h4>Help</h4>
            <div class="shortcut-item">
              <kbd>?</kbd>
              <span>Toggle this help</span>
            </div>
          </div>
        </div>

        <div class="help-footer">
          <p class="help-hint">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <span>Right-click on canvas to see all available nodes</span>
          </p>
        </div>
      </div>
    </div>
  {/if}

  {#if showTracesPanel}
    <div class="modal-overlay" on:click={() => showTracesPanel = false}>
      <div class="modal telemetry-modal" on:click|stopPropagation>
        <div class="telemetry-header">
          <h3>Recent Graph Traces</h3>
          <div class="telemetry-actions">
            <button class="action-button" on:click={loadTraces} disabled={tracesLoading}>
              {#if tracesLoading}Loading…{:else}Refresh{/if}
            </button>
            <button class="close-help" on:click={() => showTracesPanel = false}>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        {#if tracesError}
          <div class="trace-error">{tracesError}</div>
        {:else if tracesLoading}
          <div class="trace-empty">Loading trace data…</div>
        {:else if traceEntries.length === 0}
          <div class="trace-empty">No trace entries yet. Run a graph and check back.</div>
        {:else}
          <div class="trace-list">
            {#each traceEntries as entry}
              <div class="trace-entry">
                <div class="trace-line">
                  <span class="trace-timestamp">{new Date(entry.timestamp).toLocaleString()}</span>
                  <span class={`trace-status ${entry.status ?? 'unknown'}`}>{entry.status ?? 'unknown'}</span>
                </div>
                <div class="trace-details">
                  <div>Mode: <strong>{entry.mode || 'n/a'}</strong></div>
                  <div>Graph: <code>{entry.graph || 'custom'}</code></div>
                  {#if entry.durationMs}
                    <div>Duration: {entry.durationMs}ms ({entry.eventCount || 0} events)</div>
                  {/if}
                  {#if entry.error}
                    <div class="trace-error-text">Error: {entry.error}</div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
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

  .action-button.execute {
    background: #10b981;
    border-color: #10b981;
    color: #fff;
  }

  .action-button.execute:hover:not(:disabled) {
    background: #059669;
    border-color: #059669;
  }

  .action-button.execute:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .animate-spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .execution-error-banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1.5rem;
    background: #7f1d1d;
    border-bottom: 1px solid #991b1b;
    color: #fecaca;
  }

  .execution-error-banner svg {
    flex-shrink: 0;
  }

  .execution-error-banner span {
    flex: 1;
  }

  .close-error {
    background: transparent;
    border: none;
    color: #fecaca;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    transition: background 0.2s;
  }

  .close-error:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .main-content {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .editor-area {
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  .execution-overlay {
    position: absolute;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    pointer-events: none;
  }

  .execution-status {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.5rem;
    background: rgba(16, 185, 129, 0.95);
    border: 2px solid #10b981;
    border-radius: 8px;
    color: #fff;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
  }

  .execution-text {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .execution-title {
    font-weight: 600;
    font-size: 1rem;
  }

  .execution-subtitle {
    font-size: 0.875rem;
    opacity: 0.9;
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

  .save-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .save-error,
  .save-success {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
  }

  .save-error {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid #dc2626;
    color: #fca5a5;
  }

  .save-success {
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid #16a34a;
    color: #86efac;
  }

  /* Dropdown menu */
  .dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 0.5rem;
    min-width: 320px;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 6px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    z-index: 1000;
    overflow: hidden;
  }

  .dropdown-header {
    padding: 0.75rem 1rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: #999;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid #333;
  }

  .dropdown-item {
    width: 100%;
    padding: 0.875rem 1rem;
    background: transparent;
    border: none;
    border-bottom: 1px solid #2a2a2a;
    color: #ddd;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s;
  }

  .dropdown-item:last-child {
    border-bottom: none;
  }

  .dropdown-item:hover {
    background: #2a2a2a;
  }

  .dropdown-item.disabled {
    color: #666;
    cursor: default;
  }

  .dropdown-item.error {
    color: #ff8a8a;
    cursor: default;
  }

  .dropdown-divider {
    height: 1px;
    background: #2a2a2a;
  }

  .saved-graph {
    padding: 0.375rem 0.75rem;
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
  }

  .dropdown-item-button {
    width: 100%;
    display: block;
    background: transparent;
    border: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .dropdown-item-button:hover {
    color: inherit;
  }

  .delete-button {
    background: transparent;
    border: none;
    color: #777;
    cursor: pointer;
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
  }

  .delete-button:hover {
    color: #ff6b6b;
    background: #2a2a2a;
  }

  .template-name {
    font-weight: 500;
    color: #fff;
    margin-bottom: 0.25rem;
  }

  .template-description {
    font-size: 0.75rem;
    color: #999;
  }

  /* Keyboard Shortcuts Help */
  .help-modal {
    max-width: 700px;
    max-height: 80vh;
    overflow-y: auto;
  }

  .help-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }

  .help-header h3 {
    margin: 0;
  }

  .close-help {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 4px;
    display: flex;
    transition: all 0.2s;
  }

  .close-help:hover {
    background: #2a2a2a;
    color: #fff;
  }

  .shortcuts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 2rem;
  }

  .shortcut-section h4 {
    font-size: 0.875rem;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 1rem 0;
  }

  .shortcut-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0;
    color: #ddd;
    font-size: 0.875rem;
  }

  .shortcut-item kbd {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.75rem;
    color: #fff;
    box-shadow: 0 2px 0 #1a1a1a;
  }

  .shortcut-item .text-small {
    font-size: 0.75rem;
    color: #888;
  }

  .shortcut-item span:last-child {
    color: #aaa;
  }

  .help-footer {
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 1px solid #333;
  }

  .help-hint {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    padding: 0.75rem 1rem;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 6px;
    color: #999;
    font-size: 0.875rem;
  }

  .help-hint svg {
    flex-shrink: 0;
    color: #3b82f6;
  }

  .telemetry-modal {
    max-width: 720px;
    max-height: 80vh;
    overflow-y: auto;
  }

  .telemetry-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .telemetry-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .trace-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .trace-entry {
    padding: 0.75rem;
    border: 1px solid #333;
    border-radius: 6px;
    background: #111;
  }

  .trace-line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
    margin-bottom: 0.5rem;
  }

  .trace-timestamp {
    color: #bbb;
  }

  .trace-status {
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    text-transform: capitalize;
  }

  .trace-status.completed {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }

  .trace-status.failed,
  .trace-status.error {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .trace-status.running {
    background: rgba(251, 191, 36, 0.15);
    color: #fbbf24;
  }

  .trace-details {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.5rem;
    font-size: 0.85rem;
    color: #ddd;
  }

  .trace-error,
  .trace-error-text {
    color: #fca5a5;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    padding: 0.5rem;
    border-radius: 4px;
    margin-top: 0.5rem;
  }

  .trace-empty {
    text-align: center;
    color: #aaa;
    padding: 1rem 0;
  }

  /* Dark mode support (already dark by default) */
  :global(.dark) .node-editor-layout {
    /* Already dark */
  }
</style>
