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
  }: {
    cognitiveMode?: string | null;
    onExecute?: ((graph: SvelteFlowGraph) => Promise<void>) | null;
    onGraphChange?: ((graph: SvelteFlowGraph) => void) | null;
  } = $props();

  // State - use $state.raw for nodes/edges as recommended by Svelte Flow for performance
  let nodes = $state.raw<Node[]>([]);
  let edges = $state.raw<Edge[]>([]);
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
   * Handle node position changes
   * Note: Svelte Flow event structure can vary - handle both formats
   */
  function handleNodeDragStop(event: CustomEvent<{ node: Node } | Node[]>) {
    if (!event.detail) return;

    // Svelte Flow may pass node directly, as { node }, or as array
    const detail = event.detail;
    let movedNode: Node | undefined;

    if (Array.isArray(detail)) {
      movedNode = detail[0];
    } else if ('node' in detail) {
      movedNode = (detail as { node: Node }).node;
    } else if ('id' in detail) {
      movedNode = detail as unknown as Node;
    }

    if (!movedNode) return;

    nodes = nodes.map((n) =>
      n.id === movedNode!.id ? { ...n, position: movedNode!.position } : n
    );
    notifyGraphChange();
  }

  /**
   * Notify parent of graph changes
   */
  function notifyGraphChange() {
    if (onGraphChange) {
      onGraphChange(getCurrentGraph());
    }
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
      {nodes}
      {edges}
      {nodeTypes}
      fitView
      snapToGrid
      snapGrid={[15, 15]}
      onconnect={handleConnect}
      onedgesdelete={handleEdgesDelete}
      onnodesdelete={handleNodesDelete}
      onnodedragstop={handleNodeDragStop}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} color="#333" />
      <Controls />
      <MiniMap
        nodeColor={(node) => node.data?.schema?.bgColor || '#475569'}
        maskColor="rgba(0, 0, 0, 0.8)"
      />
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
