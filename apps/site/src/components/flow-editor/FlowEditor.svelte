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
    type Viewport,
    BackgroundVariant,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import BaseNode from './BaseNode.svelte';
  import {
    loadSchemas,
    convertLiteGraphToSvelteFlow,
    DEFAULT_GRAPH_SCHEDULER,
    getCachedSchema,
    materializeSchemaProperties,
    type SvelteFlowGraph,
  } from '../../lib/client/flow-editor/template-converter';
  import { provideFlowEditorActions } from '../../lib/client/flow-editor/flow-editor-context';
  import { withUpdatedNodeProperty } from '../../lib/client/flow-editor/node-property-state';
  import { apiFetch } from '../../lib/client/api-config';
  import {
    autoLayoutNodes,
    connectionProblem,
    decorateEdge,
  } from '../../lib/client/flow-editor/graph-authoring';
  import {
    emptyGraphHistory,
    recordGraphHistory,
    redoGraphHistory,
    undoGraphHistory,
    type GraphHistory,
  } from '../../lib/client/flow-editor/graph-history';

  // Props
  let {
    cognitiveMode = null,
    onExecute = null,
    onGraphChange = null,
    onGraphLoaded = null,
    onSelectionChange = null,
    onHistoryChange = null,
  }: {
    cognitiveMode?: string | null;
    onExecute?: ((graph: SvelteFlowGraph) => Promise<void>) | null;
    onGraphChange?: ((graph: SvelteFlowGraph) => void) | null;
    onGraphLoaded?: ((fileName: string, scope: 'builtin' | 'custom' | 'backup') => void) | null;
    onSelectionChange?: ((node: Node | null, edge: Edge | null) => void) | null;
    onHistoryChange?: ((state: { canUndo: boolean; canRedo: boolean; canPaste: boolean }) => void) | null;
  } = $props();

  // State - use regular $state for two-way binding with Svelte Flow
  let nodes = $state<Node[]>([]);
  let edges = $state<Edge[]>([]);
  let viewport = $state<Viewport>({ x: 0, y: 0, zoom: 1 });
  let hasStoredViewport = $state(false);
  let flowInstanceKey = $state(0);
  let graphName = $state('Untitled Graph');
  let graphDescription = $state('');
  let scheduler = $state({ ...DEFAULT_GRAPH_SCHEDULER });
  let isLoading = $state(true);
  let error = $state<string | null>(null);
  let showMiniMap = $state(false);
  const miniMapAllowed = $derived(nodes.length <= 40);
  const miniMapVisible = $derived(showMiniMap && miniMapAllowed);

  type EditorSnapshot = {
    nodes: Node[];
    edges: Edge[];
    viewport: Viewport;
    graphName: string;
    graphDescription: string;
    scheduler: typeof scheduler;
  };

  let history = $state<GraphHistory<EditorSnapshot>>(emptyGraphHistory());
  let clipboard = $state<{ nodes: Node[]; edges: Edge[] } | null>(null);
  let lastHistoryKey = '';
  let lastHistoryAt = 0;

  // Node types registry
  const nodeTypes: NodeTypes = {
    genericNode: BaseNode,
    inputNode: BaseNode,
    outputNode: BaseNode,
    routerNode: BaseNode,
    contextNode: BaseNode,
    environmentNode: BaseNode,
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
    noteNode: BaseNode, // Preserved persisted type; uses the shared schema renderer
  };

  function cloneValue<T>(value: T): T {
    // Svelte's deep state proxies cannot be passed directly to
    // structuredClone. Graph authoring state is deliberately JSON-safe, so
    // normalize it through the same persisted representation used on save.
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function captureSnapshot(): EditorSnapshot {
    return cloneValue({
      nodes,
      edges,
      viewport,
      graphName,
      graphDescription,
      scheduler,
    });
  }

  function resetHistory(): void {
    history = emptyGraphHistory();
    lastHistoryKey = '';
    lastHistoryAt = 0;
    notifyHistoryChange();
  }

  function notifyHistoryChange(): void {
    onHistoryChange?.({
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      canPaste: Boolean(clipboard?.nodes.length),
    });
  }

  function recordHistory(key: string, coalesce = false): void {
    const now = Date.now();
    if (coalesce && key === lastHistoryKey && now - lastHistoryAt < 800) {
      lastHistoryAt = now;
      return;
    }
    history = recordGraphHistory(history, captureSnapshot());
    lastHistoryKey = key;
    lastHistoryAt = now;
    notifyHistoryChange();
  }

  function restoreSnapshot(snapshot: EditorSnapshot): void {
    nodes = cloneValue(snapshot.nodes);
    edges = snapshot.edges.map(edge => decorateEdge(cloneValue(edge)));
    viewport = { ...snapshot.viewport };
    graphName = snapshot.graphName;
    graphDescription = snapshot.graphDescription;
    scheduler = { ...snapshot.scheduler };
    onSelectionChange?.(null, null);
    notifyGraphChange();
  }

  export function undo(): void {
    const transition = undoGraphHistory(history, captureSnapshot());
    if (!transition.value) return;
    history = transition.history;
    restoreSnapshot(transition.value);
    notifyHistoryChange();
  }

  export function redo(): void {
    const transition = redoGraphHistory(history, captureSnapshot());
    if (!transition.value) return;
    history = transition.history;
    restoreSnapshot(transition.value);
    notifyHistoryChange();
  }

  // Load template when cognitive mode changes
  $effect(() => {
    if (cognitiveMode) {
      loadTemplateForMode(cognitiveMode);
    }
  });

  onMount(() => {
    if (!cognitiveMode) {
      isLoading = false;
      notifyGraphChange();
    }
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element
        && target.matches('input, textarea, select, [contenteditable="true"]')) return;
      const command = event.ctrlKey || event.metaKey;
      if (!command) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      } else if (key === 'c') {
        event.preventDefault();
        copySelected();
      } else if (key === 'v') {
        event.preventDefault();
        paste();
      } else if (key === 'd') {
        event.preventDefault();
        duplicateSelected();
      } else if (key === 'g') {
        event.preventDefault();
        event.shiftKey ? ungroupSelected() : groupSelected();
      }
    };
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
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

      await loadSchemas();

      // Convert from LiteGraph format to Svelte Flow format
      const sfGraph = convertLiteGraphToSvelteFlow(data.graph);

      nodes = sfGraph.nodes;
      edges = sfGraph.edges;
      restoreGraphViewport(sfGraph.viewport);
      graphName = sfGraph.name;
      graphDescription = sfGraph.description;
      scheduler = { ...sfGraph.scheduler };
      resetHistory();

      console.log(`[FlowEditor] Loaded template: ${templateName}`, {
        nodes: nodes.length,
        edges: edges.length,
      });

      // Update unconnected status after loading
      updateUnconnectedStatusInternal();

      // Preserve the exact API-resolved file identity independently from graph metadata.
      onGraphLoaded?.(data.name || templateName, data.scope || 'builtin');
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
  function handleConnect(connection: Connection) {
    if (!connection.source || !connection.target) return;
    if (connectionProblem(nodes, edges, connection)) return;
    recordHistory('connect');

    const newEdge: Edge = decorateEdge({
      id: `e-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle || undefined,
      targetHandle: connection.targetHandle || undefined,
      data: { kind: 'data' },
    });

    edges = [...edges, newEdge];
    notifyGraphChange();
  }

  /**
   * Handle edge deletion
   */
  function handleEdgesDelete(event: CustomEvent<Edge[]>) {
    const deletedEdges = 'detail' in event ? event.detail : event as unknown as Edge[];
    const deletedIds = new Set(deletedEdges.map((e) => e.id));
    edges = edges.filter((e) => !deletedIds.has(e.id));
    notifyGraphChange();
  }

  /**
   * Handle node deletion
   */
  function handleNodesDelete(event: CustomEvent<Node[]>) {
    const deletedNodes = 'detail' in event ? event.detail : event as unknown as Node[];
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
  function handleSelectionChange({ nodes: selectedNodes, edges: selectedEdges }: { nodes: Node[]; edges: Edge[] }) {
    const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
    const selectedEdge = selectedNodes.length === 0 && selectedEdges.length === 1 ? selectedEdges[0] : null;

    onSelectionChange?.(selectedNode, selectedEdge);
  }

  function handleBeforeDelete(): boolean {
    recordHistory('delete');
    return true;
  }

  function handleNodeDragStart(): void {
    recordHistory('move');
  }

  function isConnectionValid(connection: Connection | Edge): boolean {
    return connectionProblem(nodes, edges, connection as Connection) === null;
  }

  function handleReconnect(oldEdge: Edge, connection: Connection): void {
    if (connectionProblem(nodes, edges, connection, oldEdge.id)) return;
    recordHistory('reconnect');
    edges = edges.map(edge => edge.id === oldEdge.id
      ? decorateEdge({
          ...edge,
          source: connection.source!,
          target: connection.target!,
          sourceHandle: connection.sourceHandle || undefined,
          targetHandle: connection.targetHandle || undefined,
        })
      : edge);
    notifyGraphChange();
  }

  function restoreGraphViewport(nextViewport: SvelteFlowGraph['viewport']) {
    hasStoredViewport = Boolean(nextViewport);
    viewport = nextViewport
      ? { ...nextViewport }
      : { x: 0, y: 0, zoom: 1 };
    flowInstanceKey += 1;
  }

  function handleViewportMove(_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) {
    viewport = { ...nextViewport };
  }

  function handleViewportMoveEnd(event: MouseEvent | TouchEvent | null, nextViewport: Viewport) {
    handleViewportMove(event, nextViewport);
    onGraphChange?.(getCurrentGraph());
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
      cognitiveMode: cognitiveMode as 'dual' | 'agent' | 'emulation' | 'environment' | undefined,
      scheduler: { ...scheduler },
      nodes,
      edges,
      viewport: { ...viewport },
    };
  }

  /**
   * Load a graph from data
   */
  export function loadGraph(graph: SvelteFlowGraph) {
    nodes = graph.nodes;
    edges = graph.edges.map(decorateEdge);
    restoreGraphViewport(graph.viewport);
    graphName = graph.name;
    graphDescription = graph.description;
    scheduler = { ...(graph.scheduler || DEFAULT_GRAPH_SCHEDULER) };
    resetHistory();
  }

  /**
   * Clear the graph
   */
  export function clearGraph() {
    nodes = [];
    edges = [];
    restoreGraphViewport(undefined);
    graphName = 'Untitled Graph';
    graphDescription = '';
    scheduler = { ...DEFAULT_GRAPH_SCHEDULER };
    resetHistory();
  }

  /**
   * Add a node to the graph
   */
  export function addNode(node: Node) {
    recordHistory('add-node');
    nodes = [...nodes, node];
    notifyGraphChange();
  }

  /**
   * Update node data (used by PropertyInspector)
   */
  export function updateNodeData(nodeId: string, data: Record<string, any>) {
    recordHistory(`node-data:${nodeId}:${Object.keys(data).sort().join(',')}`, true);
    nodes = nodes.map((n) =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, ...data } }
        : n
    );
    notifyGraphChange();
  }

  /**
   * Atomically update one schema-backed property from either editor surface.
   * Reading the latest node inside this owner prevents rapid sibling edits from
   * replacing one another with a stale properties object.
   */
  export function updateNodeProperty(nodeId: string, propertyKey: string, value: unknown) {
    recordHistory(`node-property:${nodeId}:${propertyKey}`, true);
    nodes = nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            data: withUpdatedNodeProperty(node.data, propertyKey, value),
          }
        : node
    );
    notifyGraphChange();
  }

  /** Capture dimensions before Svelte Flow starts mutating them during a drag. */
  export function beginNodeResize(nodeId: string) {
    recordHistory(`node-size:${nodeId}`);
  }

  /** Persist user-controlled node dimensions in the canonical node state. */
  export function updateNodeDimensions(nodeId: string, width: number, height?: number) {
    if (!Number.isFinite(width)) return;

    nodes = nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            width: Math.round(width),
            height: Number.isFinite(height) ? Math.round(height!) : node.height,
          }
        : node
    );
    notifyGraphChange();
  }

  /**
   * Select a node from an external inspector link.
   * Selection is editor UI state and is not persisted with the graph.
   */
  export function selectNode(nodeId: string) {
    if (!nodes.some((node) => node.id === nodeId)) return;

    nodes = nodes.map((node) => ({
      ...node,
      selected: node.id === nodeId,
    }));
    edges = edges.map(edge => ({ ...edge, selected: false }));
    onSelectionChange?.(nodes.find((node) => node.id === nodeId) || null, null);
  }

  export function selectEdge(edgeId: string) {
    nodes = nodes.map(node => ({ ...node, selected: false }));
    edges = edges.map(edge => ({ ...edge, selected: edge.id === edgeId }));
    onSelectionChange?.(null, edges.find(edge => edge.id === edgeId) || null);
  }

  export function clearSelection() {
    nodes = nodes.map(node => ({ ...node, selected: false }));
    edges = edges.map(edge => ({ ...edge, selected: false }));
    onSelectionChange?.(null, null);
  }

  export function updateEdgeData(edgeId: string, patch: Record<string, unknown>) {
    recordHistory(`edge-data:${edgeId}:${Object.keys(patch).sort().join(',')}`, true);
    edges = edges.map(edge => {
      if (edge.id !== edgeId) return edge;
      const nextData = { ...(edge.data || {}) } as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '' || value === false && key === 'loop') delete nextData[key];
        else nextData[key] = value;
      }
      return decorateEdge({ ...edge, data: nextData });
    });
    notifyGraphChange();
  }

  export function updateGraphMetadata(patch: {
    name?: string;
    description?: string;
    maxLoopIterations?: number;
  }) {
    recordHistory(`graph:${Object.keys(patch).sort().join(',')}`, true);
    if (patch.name !== undefined) graphName = patch.name;
    if (patch.description !== undefined) graphDescription = patch.description;
    if (patch.maxLoopIterations !== undefined) {
      scheduler = { ...scheduler, maxLoopIterations: patch.maxLoopIterations };
    }
    notifyGraphChange();
  }

  function refreshExecutionEdges(): void {
    const stateByNode = new Map(nodes.map(node => [node.id, node.data?.executionState]));
    edges = edges.map(edge => {
      const decorated = decorateEdge(edge);
      const sourceState = stateByNode.get(edge.source);
      const targetState = stateByNode.get(edge.target);
      const executionClass = targetState === 'skipped'
        ? ' inactive-execution-edge'
        : sourceState === 'completed' && (targetState === 'running' || targetState === 'completed')
          ? ' active-execution-edge'
          : '';
      return { ...decorated, class: `${decorated.class || ''}${executionClass}`.trim() };
    });
  }

  /**
   * Update execution state for a node
   */
  export function setNodeExecutionState(
    nodeId: string,
    state: 'idle' | 'running' | 'completed' | 'skipped' | 'failed',
    skipReason?: string,
  ) {
    nodes = nodes.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            data: {
              ...n.data,
              executionState: state,
              executionSkipReason: state === 'skipped' ? skipReason : undefined,
            },
          }
        : n
    );
    refreshExecutionEdges();
  }

  /**
   * Reset all nodes to idle state
   */
  export function resetExecutionStates() {
    nodes = nodes.map((n) => ({
      ...n,
      data: { ...n.data, executionState: 'idle', executionOutput: undefined, executionSkipReason: undefined },
    }));
    edges = edges.map(decorateEdge);
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
    recordHistory('delete');

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

  /** Attach output only where a schema declares a compact runtime summary. */
  export function updateNodeOutputs(nodeOutputs: Record<string, unknown>) {
    nodes = nodes.map((node) => {
      const statusFields = node.data?.schema?.presentation?.statusFields;
      if (!statusFields?.length || !(node.id in nodeOutputs)) return node;

      return {
        ...node,
        data: {
          ...node.data,
          executionOutput: nodeOutputs[node.id],
        },
      };
    });
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
    refreshExecutionEdges();
  }

  export function copySelected(): void {
    const directlySelected = nodes.filter(node => node.selected);
    if (directlySelected.length === 0) return;
    const selectedIds = new Set(directlySelected.map(node => node.id));
    for (const node of nodes) {
      if (node.parentId && selectedIds.has(node.parentId)) selectedIds.add(node.id);
    }
    const selected = nodes.filter(node => selectedIds.has(node.id));
    clipboard = cloneValue({
      nodes: selected,
      edges: edges.filter(edge => selectedIds.has(edge.source) && selectedIds.has(edge.target)),
    });
    notifyHistoryChange();
  }

  function uniqueNodeId(prefix = 'node'): string {
    let suffix = 0;
    let id = `${prefix}-${Date.now()}`;
    while (nodes.some(node => node.id === id)) id = `${prefix}-${Date.now()}-${++suffix}`;
    return id;
  }

  export function paste(): void {
    if (!clipboard?.nodes.length) return;
    recordHistory('paste');
    const idMap = new Map<string, string>();
    clipboard.nodes.forEach((node, index) => idMap.set(node.id, uniqueNodeId(`node-${index + 1}`)));
    const pastedNodes = clipboard.nodes.map(node => ({
      ...cloneValue(node),
      id: idMap.get(node.id)!,
      parentId: node.parentId ? (idMap.get(node.parentId) || node.parentId) : undefined,
      position: { x: node.position.x + 48, y: node.position.y + 48 },
      selected: true,
    }));
    const pastedEdges = clipboard.edges.map((edge, index) => decorateEdge({
      ...cloneValue(edge),
      id: `e-paste-${Date.now()}-${index}`,
      source: idMap.get(edge.source)!,
      target: idMap.get(edge.target)!,
      selected: false,
    }));
    nodes = [
      ...nodes.map(node => ({ ...node, selected: false })),
      ...pastedNodes,
    ];
    edges = [...edges.map(edge => ({ ...edge, selected: false })), ...pastedEdges];
    clipboard = cloneValue({ nodes: pastedNodes, edges: pastedEdges });
    notifyGraphChange();
    notifyHistoryChange();
  }

  export function duplicateSelected(): void {
    copySelected();
    paste();
  }

  export function autoLayout(): void {
    if (nodes.length === 0) return;
    recordHistory('auto-layout');
    nodes = autoLayoutNodes(nodes, edges);
    notifyGraphChange();
  }

  export function groupSelected(): void {
    const selected = nodes.filter(node => node.selected && !node.parentId);
    if (selected.length === 0) return;
    const frameSchema = getCachedSchema('graph_note');
    if (!frameSchema) return;
    recordHistory('group');

    const left = Math.min(...selected.map(node => node.position.x));
    const top = Math.min(...selected.map(node => node.position.y));
    const right = Math.max(...selected.map(node => node.position.x + (node.width || (node.measured as any)?.width || 360)));
    const bottom = Math.max(...selected.map(node => node.position.y + (node.height || (node.measured as any)?.height || 220)));
    const frameId = uniqueNodeId('group');
    const frame: Node = {
      id: frameId,
      type: 'noteNode',
      position: { x: left - 40, y: top - 64 },
      width: Math.max(440, right - left + 80),
      height: Math.max(280, bottom - top + 104),
      zIndex: -1,
      selected: false,
      data: {
        nodeType: 'cognitive/graph_note',
        schema: frameSchema,
        properties: materializeSchemaProperties(frameSchema, {
          title: 'Node Group',
          content: '',
          style: 'info',
          frame: true,
        }),
        executionState: 'idle',
      },
    };
    const selectedIds = new Set(selected.map(node => node.id));
    const children = nodes.map(node => selectedIds.has(node.id)
      ? {
          ...node,
          position: {
            x: node.position.x - frame.position.x,
            y: node.position.y - frame.position.y,
          },
          parentId: frameId,
          extent: 'parent' as const,
          expandParent: true,
          zIndex: 1,
        }
      : node);
    nodes = [frame, ...children];
    notifyGraphChange();
  }

  export function ungroupSelected(): void {
    const selected = nodes.filter(node => node.selected);
    const groupIds = new Set<string>();
    for (const node of selected) {
      const isFrame = node.data?.schema?.id === 'graph_note' && node.data?.properties?.frame === true;
      if (isFrame) groupIds.add(node.id);
      if (node.parentId) groupIds.add(node.parentId);
    }
    if (groupIds.size === 0) return;
    recordHistory('ungroup');
    const groups = new Map(nodes.filter(node => groupIds.has(node.id)).map(node => [node.id, node]));
    const nextNodes: Node[] = [];
    for (const node of nodes) {
      if (groupIds.has(node.id)) continue;
      if (!node.parentId || !groupIds.has(node.parentId)) {
        nextNodes.push(node);
        continue;
      }
      const parent = groups.get(node.parentId)!;
      const { parentId: _parentId, extent: _extent, expandParent: _expandParent, ...rest } = node;
      nextNodes.push({
        ...rest,
        position: {
          x: parent.position.x + node.position.x,
          y: parent.position.y + node.position.y,
        },
        zIndex: undefined,
        selected: true,
      });
    }
    nodes = nextNodes;
    edges = edges.filter(edge => !groupIds.has(edge.source) && !groupIds.has(edge.target));
    notifyGraphChange();
  }

  provideFlowEditorActions({ updateNodeProperty, beginNodeResize, updateNodeDimensions, selectNode });
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
    {#key flowInstanceKey}
      <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        colorMode="dark"
        fitView={!hasStoredViewport}
        initialViewport={hasStoredViewport ? viewport : undefined}
        snapToGrid
        snapGrid={[15, 15]}
        minZoom={0.1}
        maxZoom={2}
        onlyRenderVisibleElements
        selectionOnDrag
        deleteKeyCode={['Delete', 'Backspace']}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        onconnect={handleConnect}
        onedgesdelete={handleEdgesDelete}
        onnodesdelete={handleNodesDelete}
        onselectionchange={handleSelectionChange}
        onbeforedelete={handleBeforeDelete}
        onnodedragstart={handleNodeDragStart}
        onreconnect={handleReconnect}
        isValidConnection={isConnectionValid}
        onmove={handleViewportMove}
        onmoveend={handleViewportMoveEnd}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} color="#333" />
        <Controls />
        {#if miniMapVisible}
          <MiniMap
            nodeColor={(node) => node.data?.schema?.bgColor || '#475569'}
            maskColor="rgba(0, 0, 0, 0.8)"
            pannable
            zoomable
          />
        {/if}
      </SvelteFlow>
    {/key}
    <button
      type="button"
      class="minimap-toggle"
      class:active={miniMapVisible}
      disabled={!miniMapAllowed}
      title={miniMapAllowed
        ? 'Toggle overview map'
        : 'Overview map is disabled above 40 nodes to protect canvas performance'}
      onclick={() => (showMiniMap = !showMiniMap)}
    >Map{miniMapAllowed ? '' : ' · large graph'}</button>
  {/if}
</div>

<style>
  .flow-editor-container {
    width: 100%;
    height: 100%;
    background: #0a0a0a;
    position: relative;
  }
  .minimap-toggle {
    @apply absolute right-3 top-3 z-10 rounded border border-neutral-700 bg-neutral-900/90 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 shadow;
  }
  .minimap-toggle.active {
    @apply border-blue-700 text-blue-300;
  }
  .minimap-toggle:disabled {
    @apply cursor-not-allowed opacity-60;
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
  :global(.svelte-flow__edge.control-edge .svelte-flow__edge-path) {
    stroke-dasharray: 6 5;
    stroke: #a78bfa;
  }
  :global(.svelte-flow__edge.loop-edge .svelte-flow__edge-path) {
    stroke: #f59e0b;
  }
  :global(.svelte-flow__edge.active-execution-edge .svelte-flow__edge-path) {
    stroke: #22c55e;
    stroke-width: 3;
  }
  :global(.svelte-flow__edge.inactive-execution-edge .svelte-flow__edge-path) {
    opacity: 0.25;
  }
  :global(.svelte-flow__edge-label) {
    max-width: 220px;
    padding: 3px 6px;
    overflow-wrap: anywhere;
    border: 1px solid #374151;
    border-radius: 4px;
    background: rgba(17, 24, 39, 0.94);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
    color: #d1d5db;
    font-size: 10px;
    line-height: 1.3;
    white-space: normal;
  }

  :global(.svelte-flow__connection-path) {
    stroke: #3b82f6 !important;
    stroke-width: 2 !important;
  }
</style>
