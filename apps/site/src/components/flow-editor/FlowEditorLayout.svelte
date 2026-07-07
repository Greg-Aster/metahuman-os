<script lang="ts">
  import { onMount } from 'svelte';
  import FlowEditor from './FlowEditor.svelte';
  import NodePalette from '../NodePalette.svelte';
  import PropertyInspector from './PropertyInspector.svelte';
  import { nodeEditorMode } from '../../stores/navigation';
  import { apiFetch } from '../../lib/client/api-config';
  import type { SvelteFlowGraph } from '../../lib/client/flow-editor/template-converter';
  import type { Node } from '@xyflow/svelte';
  import {
    loadSchemas,
    materializeSchemaProperties,
    serializeGraphForPersistence,
  } from '../../lib/client/flow-editor/template-converter';

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
        // Show all graphs (builtin + custom), exclude the main modes already hardcoded
        const excludeHardcoded = ['dual-mode', 'agent-mode', 'emulation-mode', 'environment-mode'];
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
      const graph = serializeGraphForPersistence(flowEditorRef.getCurrentGraph());

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
    await loadGraph(templateId);
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
        properties: materializeSchemaProperties(schema),
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

<div class="w-screen h-screen flex flex-col bg-[#0a0a0a]">
  <!-- Header -->
  <header class="h-[60px] bg-[#1a1a1a] border-b border-neutral-700 flex items-center justify-between px-6 gap-4 flex-shrink-0">
    <div class="flex items-center gap-6">
      <button
        class="flex items-center gap-2 px-4 py-2 bg-transparent border border-neutral-600 text-neutral-400 rounded-md cursor-pointer transition-all text-sm hover:bg-neutral-800 hover:border-neutral-500 hover:text-white"
        onclick={exitNodeEditor}
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        <span>Exit</span>
      </button>

      <div class="flex items-center gap-2 text-white font-medium text-lg">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
        </svg>
        <span>{graphName}</span>
        <span class="text-[10px] px-1.5 py-0.5 bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded font-semibold">Svelte Flow</span>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <button
        class="flex items-center gap-2 px-4 py-2 bg-neutral-800 border border-neutral-600 text-neutral-300 rounded-md cursor-pointer transition-all text-sm hover:bg-neutral-700 hover:border-neutral-500 hover:text-white"
        onclick={newGraph}
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        New
      </button>

      <div class="relative">
        <button
          class="flex items-center gap-2 px-4 py-2 bg-neutral-800 border border-neutral-600 text-neutral-300 rounded-md cursor-pointer transition-all text-sm hover:bg-neutral-700 hover:border-neutral-500 hover:text-white"
          onclick={() => (showLoadMenu = !showLoadMenu)}
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
          </svg>
          Load
        </button>
        {#if showLoadMenu}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div class="absolute top-full left-0 mt-2 min-w-[250px] bg-[#1a1a1a] border border-neutral-600 rounded-md shadow-2xl z-[1000] overflow-hidden" onclick={(e) => e.stopPropagation()}>
            <div class="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase bg-[#151515] border-b border-neutral-700">Cognitive Mode Templates</div>
            <button class="block w-full px-4 py-3 bg-transparent border-none border-b border-neutral-800 text-neutral-300 text-left cursor-pointer text-sm hover:bg-neutral-800" onclick={() => loadTemplate('dual-mode')}>
              Dual Consciousness Mode
            </button>
            <button class="block w-full px-4 py-3 bg-transparent border-none border-b border-neutral-800 text-neutral-300 text-left cursor-pointer text-sm hover:bg-neutral-800" onclick={() => loadTemplate('agent-mode')}>
              Agent Mode
            </button>
            <button class="block w-full px-4 py-3 bg-transparent border-none border-b border-neutral-800 text-neutral-300 text-left cursor-pointer text-sm hover:bg-neutral-800" onclick={() => loadTemplate('emulation-mode')}>
              Emulation Mode
            </button>
            <button class="block w-full px-4 py-3 bg-transparent border-none border-b border-neutral-800 text-neutral-300 text-left cursor-pointer text-sm hover:bg-neutral-800 last:border-b-0" onclick={() => loadTemplate('environment-mode')}>
              Environment Mode
            </button>

            {#if savedGraphs.length > 0}
              <div class="h-px bg-neutral-700 my-2"></div>
              <div class="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase bg-[#151515] border-b border-neutral-700">All Graphs</div>
              {#each savedGraphs as graph}
                <button class="block w-full px-4 py-3 bg-transparent border-none border-b border-neutral-800 text-neutral-300 text-left cursor-pointer text-sm hover:bg-neutral-800 last:border-b-0" onclick={() => loadGraph(graph.name)}>
                  {graph.title || graph.name}
                </button>
              {/each}
            {/if}

            {#if backupGraphs.length > 0}
              <div class="h-px bg-neutral-700 my-2"></div>
              <div class="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase bg-[#151515] border-b border-neutral-700">Backups</div>
              {#each backupGraphs.slice(0, 10) as backup}
                <button class="block w-full px-4 py-3 bg-transparent border-none border-b border-neutral-800 text-neutral-400 text-left cursor-pointer text-[0.8rem] hover:bg-neutral-800 last:border-b-0" onclick={() => loadBackup(backup.name)}>
                  {backup.title}
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </div>

      <button
        class="flex items-center gap-2 px-4 py-2 bg-emerald-500 border border-emerald-500 text-white rounded-md cursor-pointer transition-all text-sm hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed"
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

      <button
        class="flex items-center gap-2 px-4 py-2 bg-blue-500 border border-blue-500 text-white rounded-md cursor-pointer transition-all text-sm hover:bg-blue-600"
        onclick={openSaveDialog}
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
        </svg>
        Save
      </button>

      <button
        class="flex items-center gap-2 px-4 py-2 rounded-md cursor-pointer transition-all text-sm {showPropertyInspector ? 'bg-blue-500 border border-blue-500 text-white' : 'bg-neutral-800 border border-neutral-600 text-neutral-300 hover:bg-neutral-700 hover:border-neutral-500 hover:text-white'}"
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
    <div class="flex items-center justify-between px-6 py-3 bg-red-900 border-b border-red-800 text-red-200">
      <span>Execution failed: {executionError}</span>
      <button class="px-3 py-1 bg-transparent border border-red-200 text-red-200 rounded cursor-pointer" onclick={() => (executionError = '')}>Dismiss</button>
    </div>
  {/if}

  <!-- Main Content -->
  <div class="flex-1 flex overflow-hidden">
    <NodePalette onNodeSelected={handleNodeSelected} />

    <div class="flex-1 overflow-hidden">
      <FlowEditor
        bind:this={flowEditorRef}
        {cognitiveMode}
        onGraphChange={handleGraphChange}
        onSelectionChange={handleSelectionChange}
      />
    </div>

    {#if showPropertyInspector}
      <div class="w-[280px] flex-shrink-0 overflow-hidden">
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
    <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000]" onclick={() => (showSaveDialog = false)}>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="bg-[#1a1a1a] border border-neutral-700 rounded-lg p-8 min-w-[400px]" onclick={(e) => e.stopPropagation()}>
        <h3 class="m-0 mb-6 text-white text-xl">Save Graph</h3>
        <div class="flex items-center gap-2 mb-4 p-3 bg-[#0a0a0a] rounded-md">
          <span class="text-neutral-500 text-sm">Graph:</span>
          <span class="text-white font-medium">{graphName}</span>
        </div>
        <div class="mb-4">
          <label for="save-filename" class="block mb-2 text-neutral-500 text-sm">Filename:</label>
          <div class="flex items-center">
            <input
              id="save-filename"
              type="text"
              bind:value={saveFileName}
              placeholder="filename"
              class="flex-1 px-3 py-3 bg-[#0a0a0a] border border-neutral-600 rounded-l-md text-white text-base focus:outline-none focus:border-blue-500"
            />
            <span class="px-3 py-3 bg-neutral-700 border border-neutral-600 border-l-0 rounded-r-md text-neutral-500 text-sm">.json</span>
          </div>
          <p class="mt-2 text-neutral-600 text-xs leading-relaxed">Change the filename to save as a new graph, or keep it to overwrite (backup created automatically)</p>
        </div>
        {#if saveError}
          <div class="p-2 mb-4 bg-red-500/10 border border-red-600 rounded text-red-300 text-sm">{saveError}</div>
        {/if}
        {#if saveSuccess}
          <div class="p-2 mb-4 bg-green-500/10 border border-green-600 rounded text-green-300 text-sm">Saved! Backup created.</div>
        {/if}
        <div class="flex gap-3 justify-end">
          <button class="px-5 py-2.5 rounded-md cursor-pointer text-sm border-none bg-neutral-700 text-neutral-300 hover:bg-neutral-600" onclick={() => (showSaveDialog = false)}>Cancel</button>
          <button class="px-5 py-2.5 rounded-md cursor-pointer text-sm border-none bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed" onclick={saveGraph} disabled={saveSuccess}>
            {saveSuccess ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
