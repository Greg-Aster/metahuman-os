<script lang="ts">
  import { onMount } from 'svelte';
  import FlowEditor from './FlowEditor.svelte';
  import NodePalette from '../NodePalette.svelte';
  import PropertyInspector from './PropertyInspector.svelte';
  import { nodeEditorMode } from '../../stores/navigation';
  import { apiFetch } from '../../lib/client/api-config';
  import type { SvelteFlowGraph } from '../../lib/client/flow-editor/template-converter';
  import type { Node } from '@xyflow/svelte';
  import { loadSchemas } from '../../lib/client/flow-editor/template-converter';

  // Props
  let { cognitiveMode = null }: { cognitiveMode?: string | null } = $props();

  // State
  let flowEditorRef: FlowEditor | null = $state(null);
  let graphName = $state('Untitled Graph');
  let graphFileName = $state(''); // The filename (slug) for saving
  let isExecuting = $state(false);
  let executionError = $state('');
  let showSaveDialog = $state(false);
  let saveFileName = $state(''); // Filename to save as
  let saveError = $state('');
  let saveSuccess = $state(false);
  let showLoadMenu = $state(false);
  let savedGraphs = $state<Array<{ name: string; title: string; description: string; scope: string }>>([]);
  let backupGraphs = $state<Array<{ name: string; title: string; originalName?: string }>>([]);
  let graphsLoading = $state(false);
  let schemas = $state<any[]>([]);
  let selectedNode = $state<Node | null>(null);
  let showPropertyInspector = $state(true);

  // Load saved graphs list (including backups)
  async function refreshSavedGraphs() {
    graphsLoading = true;
    try {
      const res = await apiFetch('/api/cognitive-graphs?includeBackups=true');
      if (res.ok) {
        const data = await res.json();
        // Show all graphs (builtin + custom), exclude the 3 main modes already hardcoded
        const excludeHardcoded = ['dual-mode', 'agent-mode', 'emulation-mode'];
        savedGraphs = data.graphs?.filter((g: any) => !excludeHardcoded.includes(g.name)) || [];
        backupGraphs = data.backups || [];
      }
    } catch (e) {
      console.error('[FlowEditorLayout] Failed to load graphs:', e);
    } finally {
      graphsLoading = false;
    }
  }

  // Load node schemas for palette
  async function loadNodeSchemas() {
    try {
      const res = await apiFetch('/api/node-schemas');
      if (res.ok) {
        const data = await res.json();
        // API returns array directly, not { schemas: [...] }
        schemas = Array.isArray(data) ? data : (data.schemas || []);
        console.log(`[FlowEditorLayout] Loaded ${schemas.length} schemas`);
      }
    } catch (e) {
      console.error('[FlowEditorLayout] Failed to load schemas:', e);
    }
  }

  onMount(async () => {
    await loadSchemas();
    await loadNodeSchemas();
    await refreshSavedGraphs();

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        openSaveDialog();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        executeGraph();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  function exitNodeEditor() {
    nodeEditorMode.set(false);
  }

  function newGraph() {
    flowEditorRef?.clearGraph();
    graphName = 'Untitled Graph';
    graphFileName = '';
  }

  // Convert display name to valid filename (slug)
  function toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[()]/g, '') // Remove parentheses
      .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
      .replace(/^-+|-+$/g, '') // Trim leading/trailing hyphens
      .substring(0, 50); // Limit length
  }

  function openSaveDialog() {
    // Use existing filename if we have one, otherwise generate from display name
    saveFileName = graphFileName || toSlug(graphName);
    saveError = '';
    saveSuccess = false;
    showSaveDialog = true;
  }

  async function saveGraph() {
    if (!flowEditorRef || !saveFileName.trim()) return;

    saveError = '';
    saveSuccess = false;

    // Validate filename
    const validFileName = saveFileName.toLowerCase().replace(/[^a-z0-9_\-]/g, '-');
    if (!validFileName) {
      saveError = 'Invalid filename - use alphanumeric characters, hyphens, or underscores';
      return;
    }

    try {
      const graph = flowEditorRef.getCurrentGraph();

      const res = await apiFetch('/api/cognitive-graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: validFileName, graph }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      const result = await res.json();
      graphFileName = validFileName;
      saveSuccess = true;

      // Show backup info if one was created
      if (result.backupCreated) {
        console.log(`[FlowEditorLayout] Backup created: ${result.backupCreated}`);
      }

      await refreshSavedGraphs();

      setTimeout(() => {
        showSaveDialog = false;
        saveSuccess = false;
      }, 1500);
    } catch (e) {
      saveError = (e as Error).message;
    }
  }

  async function loadGraph(name: string, scope?: string) {
    try {
      const url = scope
        ? `/api/cognitive-graph?name=${encodeURIComponent(name)}&scope=${scope}`
        : `/api/cognitive-graph?name=${encodeURIComponent(name)}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.graph && flowEditorRef) {
          // Load graph into editor using the enrichGraphWithSchemas via loadGraph
          const { enrichGraphWithSchemas } = await import('../../lib/client/flow-editor/template-converter');
          const sfGraph = enrichGraphWithSchemas(data.graph);
          flowEditorRef.loadGraph(sfGraph);
          graphName = sfGraph.name || name;
          graphFileName = scope === 'backup' ? '' : name; // Don't keep backup filename
        }
      }
    } catch (e) {
      console.error('[FlowEditorLayout] Failed to load graph:', e);
    }
    showLoadMenu = false;
  }

  async function loadBackup(backupName: string) {
    await loadGraph(backupName, 'backup');
  }

  async function loadTemplate(templateId: string) {
    // Templates load via cognitiveMode prop change
    // For now, just log
    console.log('[FlowEditorLayout] Load template:', templateId);
    showLoadMenu = false;
  }

  async function executeGraph() {
    if (!flowEditorRef || isExecuting) return;

    isExecuting = true;
    executionError = '';

    // Reset previous states - nodes will light up individually as they execute
    flowEditorRef.resetExecutionStates();

    try {
      // Send native Svelte Flow format directly - no conversion needed
      const graph = flowEditorRef.getCurrentGraph();

      // Use streaming endpoint for real-time node status
      const res = await apiFetch('/api/execute-graph-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph,
          sessionId: `editor-${Date.now()}`,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Execution failed');
      }

      // Read SSE stream and update nodes in real-time
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let finalResponse = '';
      let nodeOutputs: Record<string, any> | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              handleStreamEvent(eventType, data);

              // Capture final response and node outputs
              if (eventType === 'graph_complete') {
                if (data.response) {
                  finalResponse = data.response;
                }
                if (data.nodeOutputs) {
                  nodeOutputs = data.nodeOutputs;
                }
              }
            } catch {
              // Ignore parse errors
            }
            eventType = '';
          }
        }
      }

      console.log('[FlowEditorLayout] Streaming execution complete');

      // Update display nodes with final response and node outputs
      if (finalResponse && flowEditorRef) {
        flowEditorRef.updateDisplayNodes(finalResponse, nodeOutputs);
      }
    } catch (e) {
      executionError = (e as Error).message;
      // Mark all nodes as failed on error
      if (flowEditorRef) {
        flowEditorRef.markAllNodesFailed();
      }
    } finally {
      isExecuting = false;
    }
  }

  /**
   * Handle streaming SSE events to update node states
   */
  function handleStreamEvent(eventType: string, data: any) {
    if (!flowEditorRef) return;

    switch (eventType) {
      case 'node_start':
        // Mark this node as running
        flowEditorRef.setNodeExecutionState(data.nodeId, 'running');
        break;

      case 'node_complete':
        // Mark this node as completed
        flowEditorRef.setNodeExecutionState(data.nodeId, 'completed');
        break;

      case 'node_error':
        // Mark this node as failed
        flowEditorRef.setNodeExecutionState(data.nodeId, 'failed');
        break;

      case 'graph_error':
        // Graph-level error - mark all running nodes as failed
        executionError = data.error || 'Execution failed';
        flowEditorRef.markAllNodesFailed();
        break;

      case 'graph_complete':
        console.log('[FlowEditorLayout] Graph complete:', data.durationMs + 'ms');
        break;
    }
  }

  function handleGraphChange(graph: SvelteFlowGraph) {
    // Update graph name when template loads or graph changes
    if (graph.name && graph.name !== 'Untitled Graph') {
      graphName = graph.name;
    }
    // Set filename based on cognitive mode (e.g., "dual" -> "dual-mode")
    if (graph.cognitiveMode) {
      graphFileName = `${graph.cognitiveMode}-mode`;
    }
  }

  function handleNodeSelected(nodeType: string) {
    if (!flowEditorRef) return;

    // Find schema for this node
    const schema = schemas.find((s) => s.id === nodeType || `cognitive/${s.id}` === nodeType);
    if (!schema) {
      console.warn('[FlowEditorLayout] Schema not found for:', nodeType);
      return;
    }

    // Create new node
    const newNode: Node = {
      id: `node-${Date.now()}`,
      type: 'genericNode',
      position: { x: 100 + Math.random() * 100, y: 100 + Math.random() * 100 },
      data: {
        nodeType: `cognitive/${schema.id}`,
        schema,
        properties: schema.properties || {},
        executionState: 'idle',
      },
    };

    flowEditorRef.addNode(newNode);
  }

  function handleSelectionChange(node: Node | null) {
    selectedNode = node;
  }

  function handleUpdateNodeData(nodeId: string, data: Record<string, any>) {
    if (flowEditorRef) {
      flowEditorRef.updateNodeData(nodeId, data);
    }
  }

  function togglePropertyInspector() {
    showPropertyInspector = !showPropertyInspector;
  }
</script>

<div class="flow-editor-layout">
  <!-- Header -->
  <header class="flow-editor-header">
    <div class="header-left">
      <button class="exit-button" onclick={exitNodeEditor}>
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        <span>Exit</span>
      </button>

      <div class="graph-name">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
        </svg>
        <span>{graphName}</span>
        <span class="svelte-flow-badge">Svelte Flow</span>
      </div>
    </div>

    <div class="header-actions">
      <button class="action-button" onclick={newGraph}>
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        New
      </button>

      <div class="dropdown">
        <button class="action-button" onclick={() => (showLoadMenu = !showLoadMenu)}>
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
          </svg>
          Load
        </button>
        {#if showLoadMenu}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div class="dropdown-menu" onclick={(e) => e.stopPropagation()}>
            <div class="dropdown-header">Cognitive Mode Templates</div>
            <button class="dropdown-item" onclick={() => loadTemplate('dual-mode')}>
              Dual Consciousness Mode
            </button>
            <button class="dropdown-item" onclick={() => loadTemplate('agent-mode')}>
              Agent Mode
            </button>
            <button class="dropdown-item" onclick={() => loadTemplate('emulation-mode')}>
              Emulation Mode
            </button>

            {#if savedGraphs.length > 0}
              <div class="dropdown-divider"></div>
              <div class="dropdown-header">All Graphs</div>
              {#each savedGraphs as graph}
                <button class="dropdown-item" onclick={() => loadGraph(graph.name)}>
                  {graph.title || graph.name}
                </button>
              {/each}
            {/if}

            {#if backupGraphs.length > 0}
              <div class="dropdown-divider"></div>
              <div class="dropdown-header">Backups</div>
              {#each backupGraphs.slice(0, 10) as backup}
                <button class="dropdown-item backup-item" onclick={() => loadBackup(backup.name)}>
                  {backup.title}
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </div>

      <button
        class="action-button execute"
        disabled={isExecuting}
        onclick={executeGraph}
      >
        {#if isExecuting}
          <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Running...
        {:else}
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Execute
        {/if}
      </button>

      <button class="action-button primary" onclick={openSaveDialog}>
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
        </svg>
        Save
      </button>

      <button
        class="action-button"
        class:active={showPropertyInspector}
        onclick={togglePropertyInspector}
        title="Toggle Property Inspector"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
        Props
      </button>
    </div>
  </header>

  <!-- Error Banner -->
  {#if executionError}
    <div class="error-banner">
      <span>Execution failed: {executionError}</span>
      <button onclick={() => (executionError = '')}>Dismiss</button>
    </div>
  {/if}

  <!-- Main Content -->
  <div class="main-content">
    <NodePalette onNodeSelected={handleNodeSelected} />

    <div class="editor-area">
      <FlowEditor
        bind:this={flowEditorRef}
        {cognitiveMode}
        onGraphChange={handleGraphChange}
        onSelectionChange={handleSelectionChange}
      />
    </div>

    {#if showPropertyInspector}
      <div class="property-panel">
        <PropertyInspector
          {selectedNode}
          onUpdateNodeData={handleUpdateNodeData}
        />
      </div>
    {/if}
  </div>

  <!-- Save Dialog -->
  {#if showSaveDialog}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="modal-overlay" onclick={() => (showSaveDialog = false)}>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="modal" onclick={(e) => e.stopPropagation()}>
        <h3>Save Graph</h3>
        <div class="save-info">
          <span class="save-label">Graph:</span>
          <span class="save-value">{graphName}</span>
        </div>
        <div class="save-field">
          <label for="save-filename">Filename:</label>
          <div class="filename-input-wrapper">
            <input
              id="save-filename"
              type="text"
              bind:value={saveFileName}
              placeholder="filename"
              class="graph-name-input"
            />
            <span class="filename-ext">.json</span>
          </div>
          <p class="save-hint">Change the filename to save as a new graph, or keep it to overwrite (backup created automatically)</p>
        </div>
        {#if saveError}
          <div class="save-error">{saveError}</div>
        {/if}
        {#if saveSuccess}
          <div class="save-success">Saved! Backup created.</div>
        {/if}
        <div class="modal-actions">
          <button class="cancel-button" onclick={() => (showSaveDialog = false)}>Cancel</button>
          <button class="save-button" onclick={saveGraph} disabled={saveSuccess}>
            {saveSuccess ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .flow-editor-layout {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: #0a0a0a;
  }

  .flow-editor-header {
    height: 60px;
    background: #1a1a1a;
    border-bottom: 1px solid #333;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1.5rem;
    gap: 1rem;
    flex-shrink: 0;
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

  .svelte-flow-badge {
    font-size: 10px;
    padding: 2px 6px;
    background: linear-gradient(135deg, #ff3e00, #ff6b35);
    color: #fff;
    border-radius: 4px;
    font-weight: 600;
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
  }

  .action-button.execute {
    background: #10b981;
    border-color: #10b981;
    color: #fff;
  }

  .action-button.execute:hover:not(:disabled) {
    background: #059669;
  }

  .action-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .animate-spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .dropdown {
    position: relative;
  }

  .dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 0.5rem;
    min-width: 250px;
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
    color: #888;
    text-transform: uppercase;
    background: #151515;
    border-bottom: 1px solid #333;
  }

  .dropdown-item {
    display: block;
    width: 100%;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    border-bottom: 1px solid #2a2a2a;
    color: #ddd;
    text-align: left;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .dropdown-item:last-child {
    border-bottom: none;
  }

  .dropdown-item:hover {
    background: #2a2a2a;
  }

  .dropdown-divider {
    height: 1px;
    background: #333;
    margin: 0.5rem 0;
  }

  .error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.5rem;
    background: #7f1d1d;
    border-bottom: 1px solid #991b1b;
    color: #fecaca;
  }

  .error-banner button {
    padding: 0.25rem 0.75rem;
    background: transparent;
    border: 1px solid #fecaca;
    color: #fecaca;
    border-radius: 4px;
    cursor: pointer;
  }

  .main-content {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .editor-area {
    flex: 1;
    overflow: hidden;
  }

  .property-panel {
    width: 280px;
    flex-shrink: 0;
    overflow: hidden;
  }

  .action-button.active {
    background: #3b82f6;
    border-color: #3b82f6;
    color: #fff;
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
    margin-bottom: 1rem;
  }

  .graph-name-input:focus {
    outline: none;
    border-color: #3b82f6;
  }

  .save-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: #0a0a0a;
    border-radius: 6px;
  }

  .save-label {
    color: #888;
    font-size: 0.875rem;
  }

  .save-value {
    color: #fff;
    font-weight: 500;
  }

  .save-field {
    margin-bottom: 1rem;
  }

  .save-field label {
    display: block;
    margin-bottom: 0.5rem;
    color: #888;
    font-size: 0.875rem;
  }

  .filename-input-wrapper {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .filename-input-wrapper .graph-name-input {
    flex: 1;
    border-radius: 6px 0 0 6px;
    margin-bottom: 0;
  }

  .filename-ext {
    padding: 0.75rem;
    background: #333;
    border: 1px solid #444;
    border-left: none;
    border-radius: 0 6px 6px 0;
    color: #888;
    font-size: 0.875rem;
  }

  .save-hint {
    margin-top: 0.5rem;
    color: #666;
    font-size: 0.75rem;
    line-height: 1.4;
  }

  .backup-item {
    color: #a5a5a5;
    font-size: 0.8rem;
  }

  .save-error {
    padding: 0.5rem;
    margin-bottom: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid #dc2626;
    border-radius: 4px;
    color: #fca5a5;
    font-size: 0.875rem;
  }

  .save-success {
    padding: 0.5rem;
    margin-bottom: 1rem;
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid #16a34a;
    border-radius: 4px;
    color: #86efac;
    font-size: 0.875rem;
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
    border: none;
  }

  .cancel-button {
    background: #333;
    color: #ddd;
  }

  .cancel-button:hover {
    background: #444;
  }

  .save-button {
    background: #3b82f6;
    color: #fff;
  }

  .save-button:hover {
    background: #2563eb;
  }

  .save-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .w-5 {
    width: 1.25rem;
  }

  .h-5 {
    height: 1.25rem;
  }
</style>
