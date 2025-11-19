<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { registerCognitiveNodes } from '../lib/cognitive-nodes/node-registry';
  import { ExecutionMonitor } from '../lib/cognitive-nodes/execution-monitor';

  let canvasElement: HTMLCanvasElement;
  let containerElement: HTMLDivElement;
  let graph: any;
  let canvas: any;
  let executionMonitor: ExecutionMonitor | null = null;
  let isExecuting = false;
  let executionError = '';

  // Dynamic imports to avoid SSR issues
  let LGraph: any;
  let LGraphCanvas: any;
  let LiteGraph: any;

  export let graphData: any = null; // Optional graph data to load
  export let onExecute: ((graph: any) => Promise<void>) | null = null; // Callback for execution

  // Load the template for the current cognitive mode
  async function loadCognitiveTemplate() {
    try {
      // Fetch current cognitive mode
      const modeResponse = await fetch('/api/cognitive-mode');
      if (!modeResponse.ok) {
        console.warn('[NodeEditor] Could not fetch cognitive mode, using dual-mode');
        await loadTemplateByName('dual-mode');
        return;
      }

      const modeData = await modeResponse.json();
      const currentMode = modeData.currentMode || 'dual';
      console.log(`[NodeEditor] Current cognitive mode: ${currentMode}`);

      // Load template for this mode
      const templateName = `${currentMode}-mode`;
      await loadTemplateByName(templateName);
    } catch (error) {
      console.error('[NodeEditor] Error loading cognitive template:', error);
      // Fall back to creating a simple default graph
      createDefaultGraph();
    }
  }

  // Load a specific template by name
  async function loadTemplateByName(templateName: string) {
    try {
      const { loadTemplateAsGraph } = await import('../lib/cognitive-nodes/template-loader');
      const templateGraph = await loadTemplateAsGraph(templateName);

      if (templateGraph) {
        console.log(`[NodeEditor] Loading template: ${templateName}`, templateGraph);
        graph.configure(templateGraph);
        ensureTemplateLinks(templateGraph);
        console.log(`[NodeEditor] Template loaded successfully. Nodes: ${templateGraph.nodes.length}, Links: ${templateGraph.links.length}`);
      } else {
        console.warn(`[NodeEditor] Template ${templateName} not found, creating default graph`);
        createDefaultGraph();
      }
    } catch (error) {
      console.error(`[NodeEditor] Error loading template ${templateName}:`, error);
      createDefaultGraph();
    }
  }

  // Initialize LiteGraph when component mounts
  onMount(async () => {
    // Dynamically import LiteGraph only on client-side
    // LiteGraph bundles its ESM build as a named export called LITEGRAPH
    // Use the module build so Vite doesn't try to SSR it
    // @ts-ignore - LiteGraph typings are incomplete
    const litegraphModule = await import('litegraph.js/dist/litegraph.module.js');
    const lgModule = litegraphModule?.LITEGRAPH || litegraphModule?.default || litegraphModule;

    LiteGraph = lgModule;
    LGraph = lgModule?.LGraph;
    LGraphCanvas = lgModule?.LGraphCanvas;
    const LGraphNode = lgModule?.LGraphNode;

    console.log('[NodeEditor] LiteGraph loaded:', {
      hasLiteGraph: !!LiteGraph,
      hasLGraph: !!LGraph,
      hasLGraphCanvas: !!LGraphCanvas,
      hasLGraphNode: !!LGraphNode,
    });

    if (!LGraph || !LGraphCanvas || !LGraphNode) {
      console.error('[NodeEditor] Failed to load LiteGraph classes!', {
        LGraph: !!LGraph,
        LGraphCanvas: !!LGraphCanvas,
        LGraphNode: !!LGraphNode
      });
      return;
    }

    // Register all cognitive nodes with LiteGraph instance
    // Use the default export as LiteGraph, and LGraphNode from it
    registerCognitiveNodes(LiteGraph, LGraphNode);

    // LiteGraph's context menu expects a global helper called getNodeTypesCategories.
    // Recent versions don't expose it, so polyfill a minimal version that inspects
    // the registered node types and returns the available categories.
    if (typeof (LiteGraph as any).getNodeTypesCategories !== 'function' || typeof (globalThis as any).getNodeTypesCategories !== 'function') {
      const categoryResolver = () => {
        const categories = new Set<string>();
        const registry = (LiteGraph as any)?.registered_node_types || {};
        Object.values(registry).forEach((nodeClass: any) => {
          const category = nodeClass?.prototype?.category || 'misc';
          categories.add(category);
        });
        return Array.from(categories);
      };
      (LiteGraph as any).getNodeTypesCategories = categoryResolver;
      (globalThis as any).getNodeTypesCategories = categoryResolver;
    }

    // Create the graph
    graph = new LGraph();

    // Enable undo/redo support (if available in this version of LiteGraph)
    if (typeof graph.setSupportForUndo === 'function') {
      graph.setSupportForUndo(true);
    }

    // Create the canvas
    canvas = new LGraphCanvas(canvasElement, graph);

    // Configure canvas settings
    canvas.background_image = null;
    canvas.render_shadows = false;
    canvas.render_canvas_border = false;
    canvas.clear_background = true;
    canvas.clear_background_color = '#0a0a0a';

    // Enable right-click context menu for adding nodes
    canvas.allow_searchbox = true;
    canvas.show_info = true;

    // Load graph data if provided
    if (graphData) {
      graph.configure(graphData);
    } else {
      // Auto-load template for current cognitive mode
      await loadCognitiveTemplate();
    }

    // Start the graph
    graph.start();

    // Initialize execution monitor
    executionMonitor = new ExecutionMonitor(graph);

    // Resize canvas to fit container
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  });

  // Cleanup when component is destroyed
  onDestroy(() => {
    if (graph) {
      graph.stop();
    }
    window.removeEventListener('resize', resizeCanvas);
  });

  // Resize canvas to fill container
  function resizeCanvas() {
    if (canvasElement && canvasElement.parentElement) {
      const parent = canvasElement.parentElement;
      const dpi = window.devicePixelRatio || 1;

      // Set CSS size (logical pixels)
      canvasElement.style.width = parent.clientWidth + 'px';
      canvasElement.style.height = parent.clientHeight + 'px';

      // Set canvas buffer size (physical pixels for HiDPI)
      canvasElement.width = parent.clientWidth * dpi;
      canvasElement.height = parent.clientHeight * dpi;

      if (canvas) {
        // Let LiteGraph handle its internal scaling
        canvas.resize();
      }
    }
  }

  // Create a simple default graph for testing
  function createDefaultGraph() {
    // Create a simple demo graph showing the basic flow

    // Input: User message
    const userInput = LiteGraph.createNode('cognitive/user_input');
    userInput.pos = [50, 100];
    graph.add(userInput);

    // Get system settings
    const systemSettings = LiteGraph.createNode('cognitive/system_settings');
    systemSettings.pos = [50, 250];
    graph.add(systemSettings);

    // Route based on cognitive mode
    const modeRouter = LiteGraph.createNode('cognitive/cognitive_mode_router');
    modeRouter.pos = [350, 150];
    graph.add(modeRouter);

    // Conversational response (for simple queries)
    const conversationalResponse = LiteGraph.createNode('cognitive/skill_conversational_response');
    conversationalResponse.pos = [650, 100];
    graph.add(conversationalResponse);

    // Stream output
    const streamWriter = LiteGraph.createNode('cognitive/stream_writer');
    streamWriter.pos = [950, 100];
    graph.add(streamWriter);

    // Connect the nodes
    userInput.connect(0, modeRouter, 1); // message -> router
    systemSettings.connect(0, modeRouter, 0); // cognitiveMode -> router

    conversationalResponse.connect(0, streamWriter, 0); // response -> stream

    // Center the view
    canvas.ds.offset = [-100, -50];
    canvas.ds.scale = 1.0;
  }

  /**
   * LiteGraph expects serialized nodes to include per-input/per-output link references.
   * Our JSON templates only include a top-level links array, so rebuild those connections
   * manually after configure to make the "noodles" visible and usable.
   */
  function ensureTemplateLinks(templateGraph: any) {
    if (!graph || !templateGraph?.links?.length) return;

    const existingLinks = graph.links ? Object.keys(graph.links).length : 0;
    if (existingLinks > 0) {
      return;
    }

    templateGraph.links.forEach((link: any) => {
      const [, originId, originSlot, targetId, targetSlot] = link;
      const originNode = graph.getNodeById?.(originId);
      const targetNode = graph.getNodeById?.(targetId);
      if (originNode && targetNode) {
        try {
          originNode.connect(originSlot, targetNode, targetSlot);
        } catch (err) {
          console.warn('[NodeEditor] Failed to connect nodes from template link:', link, err);
        }
      }
    });
  }

  // Export graph data
  export function exportGraph() {
    if (graph) {
      return graph.serialize();
    }
    return null;
  }

  // Load graph data
  export function loadGraph(data: any) {
    if (graph && data) {
      graph.configure(data);
    }
  }

  // Clear the graph
  export function clearGraph() {
    if (graph) {
      graph.clear();
    }
  }

  // Execute the graph with visual feedback
  export async function executeGraph(contextData: Record<string, any> = {}) {
    if (!graph) {
      throw new Error('Graph not initialized');
    }

    isExecuting = true;
    executionError = '';

    try {
      // Import the graph executor
      const { executeGraph: runGraph } = await import('@metahuman/core/graph-executor');

      // Serialize the current graph
      const graphData = graph.serialize();

      // Convert to CognitiveGraph format
      const cognitiveGraph = {
        version: '1.0',
        name: 'Current Graph',
        description: 'Executing current graph',
        nodes: graphData.nodes.map((node: any) => ({
          id: node.id,
          type: node.type.replace('cognitive/', ''),
          pos: node.pos,
          properties: node.properties || {},
        })),
        links: graphData.links.map((link: any) => ({
          id: link.id,
          origin_id: link.origin_id,
          origin_slot: link.origin_slot,
          target_id: link.target_id,
          target_slot: link.target_slot,
        })),
      };

      // Execute with event handling for visual feedback
      await runGraph(cognitiveGraph, contextData, (event) => {
        if (executionMonitor) {
          executionMonitor.handleEvent(event);
        }

        // Force canvas redraw to show highlighting
        if (canvas) {
          canvas.setDirty(true, true);
        }
      });

      // Execution completed successfully
      console.log('[NodeEditor] Graph execution completed');
    } catch (e) {
      executionError = (e as Error).message;
      console.error('[NodeEditor] Execution error:', e);
      throw e;
    } finally {
      isExecuting = false;
    }
  }

  // Get execution status
  export function getExecutionStatus() {
    return {
      isExecuting,
      error: executionError,
      stats: executionMonitor?.getStats() || null,
    };
  }

  // Add a node to the graph (called from palette)
  export function addNode(nodeType: string) {
    if (!graph) {
      console.error('[NodeEditor] Cannot add node: graph not initialized');
      return;
    }

    try {
      const node = LiteGraph.createNode(nodeType);
      if (node) {
        // Position at canvas center (or slightly offset)
        const offset = Math.floor(Math.random() * 50);
        node.pos = [100 + offset, 100 + offset];
        graph.add(node);
        console.log(`[NodeEditor] Added node: ${nodeType}`);
      }
    } catch (e) {
      console.error(`[NodeEditor] Failed to create node ${nodeType}:`, e);
    }
  }
</script>

<div class="node-editor-container">
  <canvas bind:this={canvasElement}></canvas>
</div>

<style>
  .node-editor-container {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
    background-color: #1a1a1a;
  }

  canvas {
    display: block;
    /* Width and height set dynamically via JS for proper DPI scaling */
  }

  /* Dark mode support */
  :global(.dark) .node-editor-container {
    background-color: #0a0a0a;
  }
</style>
