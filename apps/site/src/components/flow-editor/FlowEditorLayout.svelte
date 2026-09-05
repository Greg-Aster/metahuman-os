<script lang="ts">
  import { onMount } from 'svelte';
  import FlowEditor from './FlowEditor.svelte';
  import NodePalette from '../NodePalette.svelte';
  import PropertyInspector from './PropertyInspector.svelte';
  import GraphInspector from './GraphInspector.svelte';
  import EdgeInspector from './EdgeInspector.svelte';
  import ExecutionPanel from './ExecutionPanel.svelte';
  import { apiFetch } from '../../lib/client/api-config';
  import type { SvelteFlowGraph } from '../../lib/client/flow-editor/template-converter';
  import type { Edge, Node } from '@xyflow/svelte';
  import {
    enrichGraphWithSchemas,
    loadSchemas,
    materializeSchemaProperties,
    serializeGraphForPersistence,
  } from '../../lib/client/flow-editor/template-converter';
  import {
    inspectSchemaHealth,
    validateAuthoringGraph,
    type AuthoringIssue,
  } from '../../lib/client/flow-editor/graph-authoring';
  import {
    updateTimeline,
    type ExecutionTimelineEntry,
  } from '../../lib/client/flow-editor/execution-observability';
  import {
    normalizeGraphFileName,
    overwritesDifferentGraph,
    saveDialogFileName,
  } from '../../lib/client/flow-editor/graph-file-identity';
  import { groupWorkflows } from '../../lib/client/flow-editor/workflow-groups';

  type GraphScope = 'builtin' | 'custom' | 'backup';
  type GraphSummary = {
    name: string;
    title: string;
    description: string;
    scope: GraphScope;
    originalName?: string;
  };

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
  let saveCreatedBackup = $state(false);
  let showLoadMenu = $state(false);
  let knownGraphFileNames = $state<string[]>([]);
  let savedGraphs = $state<GraphSummary[]>([]);
  let backupGraphs = $state<GraphSummary[]>([]);
  let graphsLoading = $state(false);
  let schemas = $state<any[]>([]);
  let selectedNode = $state<Node | null>(null);
  let selectedEdge = $state<Edge | null>(null);
  let currentGraph = $state<SvelteFlowGraph | null>(null);
  let lastNodeOutputs = $state<Record<string, unknown>>({});
  let lastRunDurationMs = $state<number | null>(null);
  let showPropertyInspector = $state(true);
  let showExecutionPanel = $state(false);
  let executionTimeline = $state<ExecutionTimelineEntry[]>([]);
  let historyState = $state({ canUndo: false, canRedo: false, canPaste: false });
  let cleanGraphSignature = $state('');
  let isDirty = $state(false);
  const authoringIssues = $derived(currentGraph ? validateAuthoringGraph(currentGraph) : []);
  const schemaHealth = $derived(currentGraph ? inspectSchemaHealth(currentGraph.nodes) : null);
  const workflowGroups = $derived(groupWorkflows(savedGraphs));

  $effect(() => {
    if (flowEditorRef && !currentGraph) {
      handleGraphChange(flowEditorRef.getCurrentGraph());
    }
  });

  function graphSignature(graph: SvelteFlowGraph): string {
    return JSON.stringify(serializeGraphForPersistence(graph));
  }

  function markGraphClean(graph: SvelteFlowGraph): void {
    cleanGraphSignature = graphSignature(graph);
    isDirty = false;
  }

  function mayDiscardChanges(): boolean {
    return !isDirty || window.confirm('Discard unsaved graph changes?');
  }

  // Load saved graphs list (including backups)
  async function refreshSavedGraphs() {
    graphsLoading = true;
    try {
      const res = await apiFetch('/api/cognitive-graphs?includeBackups=true');
      if (res.ok) {
        const data = await res.json();
        // Show all graphs (builtin + custom), exclude the main modes already hardcoded
        const excludeHardcoded = ['dual-mode', 'agent-mode', 'emulation-mode', 'environment-mode'];
        const availableGraphs: GraphSummary[] = data.graphs || [];
        knownGraphFileNames = availableGraphs.map(graph => graph.name);
        savedGraphs = availableGraphs.filter(graph => !excludeHardcoded.includes(graph.name));
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

  onMount(() => {
    void (async () => {
      await loadSchemas();
      await loadNodeSchemas();
      await refreshSavedGraphs();
    })();

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

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  });

  function newGraph() {
    if (!mayDiscardChanges()) return;
    flowEditorRef?.clearGraph();
    graphName = 'Untitled Graph';
    graphFileName = '';
    currentGraph = flowEditorRef?.getCurrentGraph() || null;
    selectedNode = null;
    selectedEdge = null;
    lastNodeOutputs = {};
    lastRunDurationMs = null;
    executionTimeline = [];
    if (currentGraph) markGraphClean(currentGraph);
  }

  function openSaveDialog() {
    saveFileName = saveDialogFileName(graphFileName, graphName);
    saveError = '';
    saveSuccess = false;
    saveCreatedBackup = false;
    showSaveDialog = true;
  }

  async function saveGraph() {
    if (!flowEditorRef || !saveFileName.trim()) return;

    saveError = '';
    saveSuccess = false;

    // Validate filename
    const validFileName = normalizeGraphFileName(saveFileName);
    if (!validFileName) {
      saveError = 'Invalid filename - use alphanumeric characters, hyphens, or underscores';
      return;
    }

    saveFileName = validFileName;
    if (
      overwritesDifferentGraph(graphFileName, validFileName, knownGraphFileNames)
      && !window.confirm(`A different graph named "${validFileName}.json" already exists. Overwrite it?`)
    ) {
      return;
    }

    try {
      const authoringGraph = flowEditorRef.getCurrentGraph();
      const blockingIssues = validateAuthoringGraph(authoringGraph).filter(issue => issue.level === 'error');
      if (blockingIssues.length > 0) {
        selectedNode = null;
        selectedEdge = null;
        showPropertyInspector = true;
        throw new Error(`Resolve ${blockingIssues.length} graph validation error${blockingIssues.length === 1 ? '' : 's'} before saving.`);
      }
      const graph = serializeGraphForPersistence(authoringGraph);

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
      saveCreatedBackup = Boolean(result.backupCreated);
      currentGraph = authoringGraph;
      markGraphClean(authoringGraph);

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

  async function loadGraph(name: string, scope?: GraphScope, saveTargetName?: string) {
    if (!mayDiscardChanges()) return;
    try {
      const url = scope
        ? `/api/cognitive-graph?name=${encodeURIComponent(name)}&scope=${scope}`
        : `/api/cognitive-graph?name=${encodeURIComponent(name)}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.graph && flowEditorRef) {
          const sfGraph = enrichGraphWithSchemas(data.graph);
          flowEditorRef.loadGraph(sfGraph);
          graphName = sfGraph.name || name;
          const resolvedName = typeof data.name === 'string' ? data.name : name;
          const resolvedScope: GraphScope = data.scope || scope || 'custom';
          graphFileName = resolvedScope === 'backup' ? (saveTargetName || '') : resolvedName;
          currentGraph = sfGraph;
          selectedNode = null;
          selectedEdge = null;
          lastNodeOutputs = {};
          lastRunDurationMs = null;
          executionTimeline = [];
          markGraphClean(sfGraph);
        }
      }
    } catch (e) {
      console.error('[FlowEditorLayout] Failed to load graph:', e);
    }
    showLoadMenu = false;
  }

  async function loadBackup(backup: GraphSummary) {
    await loadGraph(backup.name, 'backup', backup.originalName);
  }

  async function loadTemplate(templateId: string) {
    await loadGraph(templateId);
  }

  async function executeGraph() {
    if (!flowEditorRef || isExecuting) return;

    const graph = flowEditorRef.getCurrentGraph();
    const blockingIssues = validateAuthoringGraph(graph).filter(issue => issue.level === 'error');
    if (blockingIssues.length > 0) {
      executionError = `Resolve ${blockingIssues.length} graph validation error${blockingIssues.length === 1 ? '' : 's'} before execution.`;
      currentGraph = graph;
      selectedNode = null;
      selectedEdge = null;
      showPropertyInspector = true;
      return;
    }

    isExecuting = true;
    executionError = '';
    lastNodeOutputs = {};
    lastRunDurationMs = null;
    executionTimeline = [];
    showExecutionPanel = true;

    // Reset previous states - nodes will light up individually as they execute
    flowEditorRef.resetExecutionStates();

    try {
      // Send native Svelte Flow format directly - no conversion needed
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
                  lastNodeOutputs = data.nodeOutputs;
                  flowEditorRef.updateNodeOutputs(data.nodeOutputs);
                }
                lastRunDurationMs = typeof data.durationMs === 'number' ? data.durationMs : null;
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
    executionTimeline = updateTimeline(executionTimeline, eventType, data);

    switch (eventType) {
      case 'node_start':
        // Mark this node as running
        flowEditorRef.setNodeExecutionState(data.nodeId, 'running');
        if (selectedNode?.id === data.nodeId) {
          selectedNode = { ...selectedNode, data: { ...selectedNode.data, executionState: 'running' } };
        }
        break;

      case 'node_complete':
        // Mark this node as completed
        flowEditorRef.setNodeExecutionState(data.nodeId, 'completed');
        if (selectedNode?.id === data.nodeId) {
          selectedNode = { ...selectedNode, data: { ...selectedNode.data, executionState: 'completed' } };
        }
        break;

      case 'node_skip':
        flowEditorRef.setNodeExecutionState(data.nodeId, 'skipped', data.reason);
        if (selectedNode?.id === data.nodeId) {
          selectedNode = {
            ...selectedNode,
            data: {
              ...selectedNode.data,
              executionState: 'skipped',
              executionSkipReason: data.reason,
            },
          };
        }
        break;

      case 'node_error':
        // Mark this node as failed
        flowEditorRef.setNodeExecutionState(data.nodeId, 'failed');
        if (selectedNode?.id === data.nodeId) {
          selectedNode = { ...selectedNode, data: { ...selectedNode.data, executionState: 'failed' } };
        }
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
    currentGraph = graph;
    if (selectedNode) {
      selectedNode = graph.nodes.find((node) => node.id === selectedNode?.id) || null;
    }
    if (selectedEdge) {
      selectedEdge = graph.edges.find((edge) => edge.id === selectedEdge?.id) || null;
    }
    // Update graph name when template loads or graph changes
    if (graph.name && graph.name !== 'Untitled Graph') {
      graphName = graph.name;
    }
    if (!cleanGraphSignature) markGraphClean(graph);
    else isDirty = graphSignature(graph) !== cleanGraphSignature;
  }

  function handleGraphLoaded(fileName: string, scope: GraphScope) {
    if (scope !== 'backup') graphFileName = fileName;
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
      id: `node-${crypto.randomUUID()}`,
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

  function handleSelectionChange(node: Node | null, edge: Edge | null) {
    selectedNode = node;
    selectedEdge = edge;
  }

  function handleUpdateNodeData(nodeId: string, data: Record<string, any>) {
    if (flowEditorRef) {
      flowEditorRef.updateNodeData(nodeId, data);
    }
  }

  function handleUpdateNodeProperty(nodeId: string, propertyKey: string, value: unknown) {
    flowEditorRef?.updateNodeProperty(nodeId, propertyKey, value);
  }

  function handleSelectNode(nodeId: string) {
    flowEditorRef?.selectNode(nodeId);
  }

  function handleSelectIssue(issue: AuthoringIssue) {
    if (issue.nodeId) flowEditorRef?.selectNode(issue.nodeId);
    else if (issue.edgeId) flowEditorRef?.selectEdge(issue.edgeId);
  }

  function handleUpdateEdgeData(edgeId: string, patch: Record<string, unknown>) {
    flowEditorRef?.updateEdgeData(edgeId, patch);
  }

  function handleUpdateGraph(patch: { name?: string; description?: string; maxLoopIterations?: number }) {
    flowEditorRef?.updateGraphMetadata(patch);
  }

  function showGraphInspector() {
    flowEditorRef?.clearSelection();
    showPropertyInspector = true;
  }

  function togglePropertyInspector() {
    showPropertyInspector = !showPropertyInspector;
  }
</script>

<div class="w-screen h-screen flex flex-col bg-[#0a0a0a]">
  <!-- Header -->
  <header class="h-[60px] bg-[#1a1a1a] border-b border-neutral-700 flex items-center justify-between px-6 gap-4 flex-shrink-0">
    <div class="flex items-center">
      <div class="flex items-center gap-2 text-white font-medium text-lg">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
        </svg>
        <span>{graphName}</span>
        <span class="text-[10px] px-1.5 py-0.5 bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded font-semibold">Svelte Flow</span>
        {#if isDirty}<span class="rounded bg-amber-950 px-2 py-0.5 text-[10px] font-semibold text-amber-300">Unsaved</span>{/if}
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
          aria-expanded={showLoadMenu}
          aria-controls="workflow-load-menu"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
          </svg>
          Load
        </button>
        {#if showLoadMenu}
          <div id="workflow-load-menu" class="absolute top-full right-0 mt-2 w-[340px] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto overscroll-contain bg-[#1a1a1a] border border-neutral-600 rounded-md shadow-2xl z-[1000]" aria-label="Load workflow">
            <div class="sticky top-0 z-10 px-4 py-3 text-xs font-semibold text-neutral-400 uppercase bg-[#151515] border-b border-neutral-700">Core Cognitive Modes</div>
            <button class="block w-full px-4 py-2.5 bg-transparent border-none border-b border-neutral-800 text-neutral-300 text-left cursor-pointer text-sm hover:bg-neutral-800" onclick={() => loadTemplate('dual-mode')}>
              Dual Consciousness Mode
            </button>
            <button class="block w-full px-4 py-2.5 bg-transparent border-none border-b border-neutral-800 text-neutral-300 text-left cursor-pointer text-sm hover:bg-neutral-800" onclick={() => loadTemplate('agent-mode')}>
              Agent Mode
            </button>
            <button class="block w-full px-4 py-2.5 bg-transparent border-none border-b border-neutral-800 text-neutral-300 text-left cursor-pointer text-sm hover:bg-neutral-800" onclick={() => loadTemplate('emulation-mode')}>
              Emulation Mode
            </button>
            <button class="block w-full px-4 py-2.5 bg-transparent border-none border-b border-neutral-800 text-neutral-300 text-left cursor-pointer text-sm hover:bg-neutral-800" onclick={() => loadTemplate('environment-mode')}>
              Environment Mode
            </button>

            {#if graphsLoading}
              <div class="px-4 py-3 text-sm text-neutral-500">Loading workflows…</div>
            {:else}
              {#each workflowGroups as group}
                <details class="group border-t border-neutral-700" open={group.id === 'robot-autonomy' || group.id === 'desires-agency'}>
                  <summary class="flex cursor-pointer list-none items-center justify-between gap-3 bg-[#151515] px-4 py-3 text-xs font-semibold uppercase text-neutral-300 hover:bg-neutral-800">
                    <span>{group.label}</span>
                    <span class="flex items-center gap-2">
                      <span class="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] tabular-nums text-neutral-400">{group.workflows.length}</span>
                      <svg class="h-3.5 w-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 5 7 7-7 7" />
                      </svg>
                    </span>
                  </summary>
                  {#each group.workflows as graph}
                    <button class="block w-full px-5 py-2.5 bg-transparent border-none border-t border-neutral-800 text-neutral-300 text-left cursor-pointer text-sm hover:bg-neutral-800" onclick={() => loadGraph(graph.name)}>
                      {graph.title || graph.name}
                    </button>
                  {/each}
                </details>
              {/each}
            {/if}

            {#if backupGraphs.length > 0}
              <details class="group border-t border-neutral-700">
                <summary class="flex cursor-pointer list-none items-center justify-between gap-3 bg-[#151515] px-4 py-3 text-xs font-semibold uppercase text-neutral-400 hover:bg-neutral-800">
                  <span>Recent Backups</span>
                  <span class="flex items-center gap-2">
                    <span class="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] tabular-nums text-neutral-500">{Math.min(backupGraphs.length, 10)}</span>
                    <svg class="h-3.5 w-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 5 7 7-7 7" />
                    </svg>
                  </span>
                </summary>
                {#each backupGraphs.slice(0, 10) as backup}
                  <button class="block w-full px-5 py-2.5 bg-transparent border-none border-t border-neutral-800 text-neutral-400 text-left cursor-pointer text-[0.8rem] hover:bg-neutral-800" onclick={() => loadBackup(backup)}>
                    {backup.title}
                  </button>
                {/each}
              </details>
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

  <div class="flex h-10 flex-shrink-0 items-center gap-1.5 overflow-x-auto border-b border-neutral-800 bg-[#131313] px-4">
    <button class="editor-tool" title="Show workflow-wide settings and validation" onclick={showGraphInspector}>Graph</button>
    <span class="tool-divider"></span>
    <button class="editor-tool" disabled={!historyState.canUndo} title="Undo (Ctrl/Cmd+Z)" onclick={() => flowEditorRef?.undo()}>Undo</button>
    <button class="editor-tool" disabled={!historyState.canRedo} title="Redo (Ctrl/Cmd+Shift+Z)" onclick={() => flowEditorRef?.redo()}>Redo</button>
    <span class="tool-divider"></span>
    <button class="editor-tool" title="Copy selected nodes (Ctrl/Cmd+C)" onclick={() => flowEditorRef?.copySelected()}>Copy</button>
    <button class="editor-tool" disabled={!historyState.canPaste} title="Paste copied nodes (Ctrl/Cmd+V)" onclick={() => flowEditorRef?.paste()}>Paste</button>
    <button class="editor-tool" title="Duplicate selected nodes (Ctrl/Cmd+D)" onclick={() => flowEditorRef?.duplicateSelected()}>Duplicate</button>
    <span class="tool-divider"></span>
    <button class="editor-tool" title="Place selected top-level nodes in a movable frame (Ctrl/Cmd+G)" onclick={() => flowEditorRef?.groupSelected()}>Group</button>
    <button class="editor-tool" title="Remove the selected frame while keeping its nodes (Ctrl/Cmd+Shift+G)" onclick={() => flowEditorRef?.ungroupSelected()}>Ungroup</button>
    <button class="editor-tool" title="Arrange nodes by dependency order" onclick={() => flowEditorRef?.autoLayout()}>Auto layout</button>
    <span class="tool-divider"></span>
    <button class="editor-tool" class:active-tool={showExecutionPanel} title="Toggle execution timeline" onclick={() => (showExecutionPanel = !showExecutionPanel)}>Run log</button>
  </div>

  <!-- Main Content -->
  <div class="flex-1 flex overflow-hidden">
    <NodePalette onNodeSelected={handleNodeSelected} />

    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div class="min-h-0 flex-1 overflow-hidden">
        <FlowEditor
          bind:this={flowEditorRef}
          {cognitiveMode}
          onGraphChange={handleGraphChange}
          onGraphLoaded={handleGraphLoaded}
          onSelectionChange={handleSelectionChange}
          onHistoryChange={(state) => (historyState = state)}
        />
      </div>
      {#if showExecutionPanel}
        <div class="h-[230px] flex-shrink-0 overflow-hidden">
          <ExecutionPanel
            graph={currentGraph}
            entries={executionTimeline}
            nodeOutputs={lastNodeOutputs}
            {isExecuting}
            onSelectNode={handleSelectNode}
          />
        </div>
      {/if}
    </div>

    {#if showPropertyInspector}
      <div class="w-[360px] flex-shrink-0 overflow-hidden">
        {#if selectedNode}
          <PropertyInspector
            {selectedNode}
            graphNodes={currentGraph?.nodes || []}
            graphEdges={currentGraph?.edges || []}
            lastOutput={lastNodeOutputs[selectedNode.id]}
            {lastRunDurationMs}
            onUpdateNodeData={handleUpdateNodeData}
            onUpdateNodeProperty={handleUpdateNodeProperty}
            onSelectNode={handleSelectNode}
          />
        {:else if selectedEdge}
          <EdgeInspector
            {selectedEdge}
            graphNodes={currentGraph?.nodes || []}
            onUpdateEdgeData={handleUpdateEdgeData}
            onSelectNode={handleSelectNode}
          />
        {:else}
          <GraphInspector
            graph={currentGraph}
            issues={authoringIssues}
            {schemaHealth}
            onUpdateGraph={handleUpdateGraph}
            onSelectIssue={handleSelectIssue}
          />
        {/if}
      </div>
    {/if}
  </div>

  <!-- Save Dialog -->
  {#if showSaveDialog}
    <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000]">
      <div class="bg-[#1a1a1a] border border-neutral-700 rounded-lg p-8 min-w-[400px]" role="dialog" aria-modal="true" aria-labelledby="save-graph-title" tabindex="-1">
        <h3 id="save-graph-title" class="m-0 mb-6 text-white text-xl">Save Graph</h3>
        <div class="mb-4 space-y-2 rounded-md bg-[#0a0a0a] p-3">
          <div class="flex items-center gap-2">
            <span class="text-neutral-500 text-sm">Workflow:</span>
            <span class="text-white font-medium">{graphName}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-neutral-500 text-sm">Current file:</span>
            <span class="font-mono text-sm text-blue-300">{graphFileName ? `${graphFileName}.json` : 'New unsaved graph'}</span>
          </div>
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
          {#if normalizeGraphFileName(saveFileName) === graphFileName && graphFileName}
            <p class="mt-2 text-blue-300 text-xs leading-relaxed">This updates the graph currently loaded. A backup is created before overwriting it.</p>
          {:else if overwritesDifferentGraph(graphFileName, normalizeGraphFileName(saveFileName), knownGraphFileNames)}
            <p class="mt-2 text-amber-300 text-xs leading-relaxed">This filename belongs to a different graph. You will be asked to confirm before it is overwritten.</p>
          {:else}
            <p class="mt-2 text-neutral-500 text-xs leading-relaxed">This saves a new graph file. Change the filename only when you intend to use Save As.</p>
          {/if}
        </div>
        {#if saveError}
          <div class="p-2 mb-4 bg-red-500/10 border border-red-600 rounded text-red-300 text-sm">{saveError}</div>
        {/if}
        {#if saveSuccess}
          <div class="p-2 mb-4 bg-green-500/10 border border-green-600 rounded text-green-300 text-sm">{saveCreatedBackup ? 'Saved. Backup created.' : 'Saved as a new graph.'}</div>
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

<style>
  .editor-tool {
    @apply whitespace-nowrap rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[11px] text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-35;
  }
  .editor-tool.active-tool { @apply border-blue-700 bg-blue-950/40 text-blue-300; }
  .tool-divider { @apply mx-1 h-5 w-px flex-shrink-0 bg-neutral-800; }
</style>
