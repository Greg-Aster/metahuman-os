<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  // @ts-ignore - LiteGraph doesn't have proper TypeScript definitions
  import { LGraph, LGraphCanvas, LiteGraph } from 'litegraph.js';
  import { registerCognitiveNodes, getCognitiveNodesList } from '../lib/cognitive-nodes/node-registry';

  let canvasElement: HTMLCanvasElement;
  let graph: any;
  let canvas: any;

  export let graphData: any = null; // Optional graph data to load

  // Initialize LiteGraph when component mounts
  onMount(() => {
    // Register all cognitive nodes
    registerCognitiveNodes();

    // Create the graph
    graph = new LGraph();

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
      // Create a simple default graph as a demo
      createDefaultGraph();
    }

    // Start the graph
    graph.start();

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
      canvasElement.width = parent.clientWidth;
      canvasElement.height = parent.clientHeight;
      if (canvas) {
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
    width: 100%;
    height: 100%;
  }

  /* Dark mode support */
  :global(.dark) .node-editor-container {
    background-color: #0a0a0a;
  }
</style>
