<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    SvelteFlow,
    Controls,
    Background,
    MiniMap,
    type Node,
    type Edge,
    type Connection,
    type NodeTypes,
    BackgroundVariant,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import BaseNode from './BaseNode.svelte';
  import NoteNode from './NoteNode.svelte';
  import {
    convertLiteGraphToSvelteFlow,
    convertSvelteFlowToExecutor,
    type SvelteFlowGraph,
  } from '../../lib/client/flow-editor/template-converter';
  import { apiFetch } from '../../lib/client/api-config';

  // Props
  let {
    cognitiveMode = null,
    onExecute = null,
    onGraphChange = null,
    onSelectionChange = null,
  }: {
    cognitiveMode?: string | null;
    onExecute?: ((graph: SvelteFlowGraph) => Promise<void>) | null;
    onGraphChange?: ((graph: SvelteFlowGraph) => void) | null;
    onSelectionChange?: ((node: Node | null) => void) | null;
  } = $props();

  // State - use regular $state for two-way binding with Svelte Flow
  let nodes = $state<Node[]>([]);
  let edges = $state<Edge[]>([]);
  let graphName = $state('Untitled Graph');
  let graphDescription = $state('');
  let isLoading = $state(true);
  let error = $state<string | null>(null);

  // Node types registry
  const nodeTypes: NodeTypes = {
    genericNode: BaseNode,
    inputNode: BaseNode,
    outputNode: BaseNode,
    routerNode: BaseNode,
    contextNode: BaseNode,
    operatorNode: BaseNode,
    llmNode: BaseNode,
    skillNode: BaseNode,
    memoryNode: BaseNode,
    utilityNode: BaseNode,
    agentNode: BaseNode,
    personaNode: BaseNode,
    cognitiveNode: BaseNode,
    curatorNode: BaseNode,
    safetyNode: BaseNode,
    agencyNode: BaseNode,
    noteNode: NoteNode, // Special node for documentation
  };

  // Load template when cognitive mode changes
  // Schemas are loaded statically at module import - no async needed
  $effect(() => {
    if (cognitiveMode) {
      loadTemplateForMode(cognitiveMode);
    }
  });

  onMount(() => {
    // Schemas already loaded statically via template-converter import
    // Just handle the case where no cognitive mode is set
    if (!cognitiveMode) {
      isLoading = false;
    }
  });

  /**
   * Load template for a cognitive mode
   */
  async function loadTemplateForMode(mode: string) {
    isLoading = true;
    error = null;

    try {
      const templateName = `${mode}-mode`;
      const response = await apiFetch(`/api/cognitive-graph?name=${templateName}`);

      if (!response.ok) {
        throw new Error(`Failed to load template: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.graph) {
        throw new Error('Invalid template response');
      }

      // Convert from LiteGraph format to Svelte Flow format
      const sfGraph = convertLiteGraphToSvelteFlow(data.graph);

      nodes = sfGraph.nodes;
      edges = sfGraph.edges;
      graphName = sfGraph.name;
      graphDescription = sfGraph.description;

      console.log(`[FlowEditor] Loaded template: ${templateName}`, {
        nodes: nodes.length,
        edges: edges.length,
      });

      // Update unconnected status after loading
      updateUnconnectedStatusInternal();

      // Notify parent of the loaded graph (includes name)
      notifyGraphChange();
    } catch (e) {
      console.error('[FlowEditor] Error loading template:', e);
      error = (e as Error).message;
    } finally {
      isLoading = false;
    }
  }

  /**
   * Handle new connections
   */
  function handleConnect(event: CustomEvent<Connection>) {
    const connection = event.detail;
    if (!connection.source || !connection.target) return;

    const newEdge: Edge = {
      id: `e-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle || undefined,
      targetHandle: connection.targetHandle || undefined,
    };

    edges = [...edges, newEdge];
    notifyGraphChange();
  }

  /**
   * Handle edge deletion
   */
  function handleEdgesDelete(event: CustomEvent<Edge[]>) {
    const deletedEdges = event.detail;
    const deletedIds = new Set(deletedEdges.map((e) => e.id));
    edges = edges.filter((e) => !deletedIds.has(e.id));
    notifyGraphChange();
  }

  /**
   * Handle node deletion
   */
  function handleNodesDelete(event: CustomEvent<Node[]>) {
    const deletedNodes = event.detail;
    const deletedIds = new Set(deletedNodes.map((n) => n.id));

    // Remove nodes
    nodes = nodes.filter((n) => !deletedIds.has(n.id));

    // Remove edges connected to deleted nodes
    edges = edges.filter(
      (e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)
    );

    notifyGraphChange();
  }

  /**
   * Handle selection changes - notify parent of selected node
   */
  function handleSelectionChange({ nodes: selectedNodes }: { nodes: Node[]; edges: Edge[] }) {
    const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;

    if (onSelectionChange) {
      onSelectionChange(selectedNode);
    }
  }

  /**
   * Notify parent of graph changes
   */
  function notifyGraphChange() {
    // Update unconnected status whenever graph changes
    updateUnconnectedStatusInternal();

    if (onGraphChange) {
      onGraphChange(getCurrentGraph());
    }
  }

  /**
   * Internal function to update unconnected status
   * (exported version calls this but is available externally)
   */
  function updateUnconnectedStatusInternal() {
    const connectedNodeIds = new Set<string>();
    for (const edge of edges) {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    }

    nodes = nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        isUnconnected: !connectedNodeIds.has(node.id),
      },
    }));
  }

  /**
   * Get current graph in Svelte Flow format
   */
  export function getCurrentGraph(): SvelteFlowGraph {
    return {
      version: '1.0',
      name: graphName,
      description: graphDescription,
      cognitiveMode: cognitiveMode as 'dual' | 'agent' | 'emulation' | undefined,
      nodes,
      edges,
    };
  }

  /**
   * Get graph in executor format (for backend execution)
   */
  export function getExecutorGraph(): any {
    return convertSvelteFlowToExecutor(getCurrentGraph());
  }

  /**
   * Load a graph from data
   */
  export function loadGraph(graph: SvelteFlowGraph) {
    nodes = graph.nodes;
    edges = graph.edges;
    graphName = graph.name;
    graphDescription = graph.description;
  }

  /**
   * Clear the graph
   */
  export function clearGraph() {
    nodes = [];
    edges = [];
    graphName = 'Untitled Graph';
    graphDescription = '';
  }

  /**
   * Add a node to the graph
   */
  export function addNode(node: Node) {
    nodes = [...nodes, node];
    notifyGraphChange();
  }

  /**
   * Update node data (used by PropertyInspector)
   */
  export function updateNodeData(nodeId: string, data: Record<string, any>) {
    nodes = nodes.map((n) =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, ...data } }
        : n
    );
    notifyGraphChange();
  }

  /**
   * Update execution state for a node
   */
  export function setNodeExecutionState(
    nodeId: string,
    state: 'idle' | 'running' | 'completed' | 'failed'
  ) {
    nodes = nodes.map((n) =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, executionState: state } }
        : n
    );
  }

  /**
   * Reset all nodes to idle state
   */
  export function resetExecutionStates() {
    nodes = nodes.map((n) => ({
      ...n,
      data: { ...n.data, executionState: 'idle' },
    }));
  }

  /**
   * Delete selected nodes and edges
   */
  export function deleteSelected() {
    const selectedNodeIds = new Set(nodes.filter(n => n.selected).map(n => n.id));
    const selectedEdgeIds = new Set(edges.filter(e => e.selected).map(e => e.id));

    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) {
      console.log('[FlowEditor] No nodes or edges selected for deletion');
      return;
    }

    // Remove selected nodes
    nodes = nodes.filter(n => !selectedNodeIds.has(n.id));

    // Remove selected edges AND edges connected to deleted nodes
    edges = edges.filter(e =>
      !selectedEdgeIds.has(e.id) &&
      !selectedNodeIds.has(e.source) &&
      !selectedNodeIds.has(e.target)
    );

    console.log(`[FlowEditor] Deleted ${selectedNodeIds.size} nodes, ${selectedEdgeIds.size} edges`);
    notifyGraphChange();
  }

  /**
   * Update display nodes with execution output
   * Called after graph execution to show results in chat_view and display_buffer nodes
   */
  export function updateDisplayNodes(response: string, nodeOutputs?: Record<string, any>) {
    const displayNodeTypes = ['chat_view', 'display_buffer', 'output_viewer'];

    nodes = nodes.map((node) => {
      const nodeType = node.data?.schema?.id || node.data?.nodeType?.replace('cognitive/', '');

      if (displayNodeTypes.includes(nodeType)) {
        // Get node-specific output if available, otherwise use the main response
        let output = response;
        if (nodeOutputs && nodeOutputs[node.id]) {
          const nodeOutput = nodeOutputs[node.id];

          // Output Viewer shows formatted debug info with full data
          if (nodeType === 'output_viewer') {
            const iteration = nodeOutput.iteration || 1;
            const dataType = nodeOutput.dataType || 'unknown';
            const entryCount = nodeOutput.entryCount || 1;
            // Show full data, formatted based on type
            let dataDisplay = '';
            const data = nodeOutput.data;
            if (data === null || data === undefined) {
              dataDisplay = '(empty)';
            } else if (typeof data === 'string') {
              // Show full string, truncate only if very long
              dataDisplay = data.length > 500 ? data.substring(0, 500) + '...' : data;
            } else if (typeof data === 'object') {
              // Pretty print JSON, truncate if too long
              const json = JSON.stringify(data, null, 2);
              dataDisplay = json.length > 800 ? json.substring(0, 800) + '\n...' : json;
            } else {
              dataDisplay = String(data);
            }
            output = `[Iter ${iteration}] ${dataType} (${entryCount} entries)\n─────────────────\n${dataDisplay}`;
          } else {
            output = nodeOutput.output || nodeOutput.response || nodeOutput.display || response;
          }
        }

        return {
          ...node,
          data: {
            ...node.data,
            executionOutput: output,
            executionState: 'completed' as const,
          },
        };
      }
      return node;
    });

    console.log(`[FlowEditor] Updated display nodes with output (${response.length} chars)`);
  }

  /**
   * Update unconnected status for all nodes
   * Nodes with no incoming AND no outgoing edges are marked as unconnected (yellow)
   */
  export function updateUnconnectedStatus() {
    // Build sets of connected node IDs
    const connectedNodeIds = new Set<string>();
    for (const edge of edges) {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    }

    nodes = nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        isUnconnected: !connectedNodeIds.has(node.id),
      },
    }));
  }

  /**
   * Mark all nodes as running (start of execution)
   */
  export function markAllNodesRunning() {
    nodes = nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        executionState: 'running' as const,
      },
    }));
  }

  /**
   * Mark all nodes as completed
   */
  export function markAllNodesCompleted() {
    nodes = nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        executionState: 'completed' as const,
      },
    }));
  }

  /**
   * Mark all nodes as failed
   */
  export function markAllNodesFailed() {
    nodes = nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        executionState: 'failed' as const,
      },
    }));
  }

  /**
   * Mark specific nodes with their execution results
   */
  export function updateNodeResults(nodeResults: Record<string, { success: boolean; error?: string }>) {
    nodes = nodes.map((node) => {
      const result = nodeResults[node.id];
      if (result) {
        return {
          ...node,
          data: {
            ...node.data,
            executionState: result.success ? 'completed' as const : 'failed' as const,
          },
        };
      }
      return node;
    });
  }
</script>

<div class="flow-editor-container">
  {#if isLoading}
    <div class="loading-overlay">
      <div class="loading-spinner"></div>
      <span>Loading graph...</span>
    </div>
  {:else if error}
    <div class="error-overlay">
      <span class="error-icon">!</span>
      <span>{error}</span>
      <button onclick={() => cognitiveMode && loadTemplateForMode(cognitiveMode)}>
        Retry
      </button>
    </div>
  {:else}
    <SvelteFlow
      bind:nodes
      bind:edges
      {nodeTypes}
      fitView
      snapToGrid
      snapGrid={[15, 15]}
      minZoom={0.1}
      maxZoom={2}
      deleteKeyCode={['Delete', 'Backspace']}
      selectionKeyCode="Shift"
      multiSelectionKeyCode="Shift"
      onconnect={handleConnect}
      onedgesdelete={handleEdgesDelete}
      onnodesdelete={handleNodesDelete}
      onselectionchange={handleSelectionChange}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} color="#333" />
      <Controls />
      <!-- MiniMap disabled - was causing 100% CPU with large graphs (26+ nodes)
      <MiniMap
        nodeColor={(node) => node.data?.schema?.bgColor || '#475569'}
        maskColor="rgba(0, 0, 0, 0.8)"
      />
      -->
    </SvelteFlow>
  {/if}
</div>

<style>
  .flow-editor-container {
    width: 100%;
    height: 100%;
    background: #0a0a0a;
    position: relative;
  }

  .loading-overlay,
  .error-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    background: rgba(10, 10, 10, 0.9);
    color: #fff;
    font-size: 1rem;
    z-index: 100;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #333;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error-overlay {
    color: #fca5a5;
  }

  .error-icon {
    width: 48px;
    height: 48px;
    border: 3px solid #ef4444;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    font-weight: bold;
  }

  .error-overlay button {
    padding: 0.5rem 1rem;
    background: #3b82f6;
    border: none;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .error-overlay button:hover {
    background: #2563eb;
  }

  /* Svelte Flow theme overrides */
  :global(.svelte-flow) {
    background: #0a0a0a !important;
  }

  :global(.svelte-flow__minimap) {
    background: #1a1a1a !important;
    border: 1px solid #333 !important;
    border-radius: 4px !important;
  }

  :global(.svelte-flow__controls) {
    background: #1a1a1a !important;
    border: 1px solid #333 !important;
    border-radius: 4px !important;
  }

  :global(.svelte-flow__controls-button) {
    background: #1a1a1a !important;
    border-bottom: 1px solid #333 !important;
    fill: #888 !important;
  }

  :global(.svelte-flow__controls-button:hover) {
    background: #2a2a2a !important;
  }

  :global(.svelte-flow__edge-path) {
    stroke: #666 !important;
    stroke-width: 2 !important;
  }

  :global(.svelte-flow__edge.selected .svelte-flow__edge-path) {
    stroke: #3b82f6 !important;
  }

  :global(.svelte-flow__connection-path) {
    stroke: #3b82f6 !important;
    stroke-width: 2 !important;
  }
</style>
