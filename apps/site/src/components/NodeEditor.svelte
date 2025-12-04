<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { registerCognitiveNodes } from '../lib/client/visual-editor/node-registry';
  import { ExecutionMonitor } from '../lib/client/visual-editor/execution-monitor';

  let canvasElement: HTMLCanvasElement;
  let containerElement: HTMLDivElement;
  let graph: any;
  let canvas: any;
  let executionMonitor: ExecutionMonitor | null = null;
  let isExecuting = false;
  let executionError = '';
  let templateWatcherSource: EventSource | null = null;
  let autoReloadEnabled = true; // Can be toggled via UI

  // Dynamic imports to avoid SSR issues
  let LGraph: any;
  let LGraphCanvas: any;
  let LGraphNode: any;
  let LiteGraph: any;

  export let graphData: any = null; // Optional graph data to load
  export let onExecute: ((graph: any) => Promise<void>) | null = null; // Callback for execution
  export let cognitiveMode: string | null | undefined = null; // Cognitive mode to load template for

  // Load the template for the current cognitive mode
  async function loadCognitiveTemplate() {
    try {
      // Use passed cognitive mode if available, otherwise fetch from API
      let currentMode: string;

      if (cognitiveMode) {
        currentMode = cognitiveMode;
        console.log(`[NodeEditor] Using passed cognitive mode: ${currentMode}`);
      } else {
        const { apiFetch } = await import('../lib/client/api-config');
        const modeResponse = await apiFetch('/api/cognitive-mode');
        if (!modeResponse.ok) {
          console.warn('[NodeEditor] Could not fetch cognitive mode, using dual-mode');
          await loadTemplateByName('dual-mode');
          return;
        }

        const modeData = await modeResponse.json();
        currentMode = modeData.currentMode || 'dual';
        console.log(`[NodeEditor] Fetched cognitive mode from API: ${currentMode}`);
      }

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
      const { loadTemplateAsGraph } = await import('../lib/client/visual-editor/template-loader');
      const templateGraph = await loadTemplateAsGraph(templateName);

      if (templateGraph) {
        console.log(`[NodeEditor] Loading template: ${templateName}`);

        // IMPORTANT: Save links array and node info BEFORE configure() mutates it
        const linksArray = Array.isArray(templateGraph.links) ? [...templateGraph.links] : [];
        const originalNodeIds = new Map<number, { type: string; pos: number[]; title?: string }>();

        if (Array.isArray(templateGraph.nodes)) {
          templateGraph.nodes.forEach((node: any) => {
            originalNodeIds.set(node.id, {
              type: node.type,
              pos: node.pos,
              title: node.title
            });
          });
        }

        console.log(`[NodeEditor] Saved ${linksArray.length} links, ${originalNodeIds.size} node mappings before configure`);

        graph.configure(templateGraph);

        // Build ID mapping from original IDs to LiteGraph nodes
        const idToNode = new Map<number, any>();
        const graphNodes = graph._nodes || [];

        originalNodeIds.forEach((info, originalId) => {
          // First try getNodeById (works if LiteGraph preserved the ID)
          let node = graph.getNodeById(originalId);

          if (!node) {
            // Fall back to matching by position and type
            node = graphNodes.find((n: any) =>
              n.type === info.type &&
              n.pos && info.pos &&
              Math.abs(n.pos[0] - info.pos[0]) < 1 &&
              Math.abs(n.pos[1] - info.pos[1]) < 1
            );
          }

          if (node) {
            idToNode.set(originalId, node);
          }
        });

        console.log(`[NodeEditor] Mapped ${idToNode.size}/${originalNodeIds.size} nodes`);

        // Manually connect nodes using the saved links array and our ID mapping
        console.log(`[NodeEditor] Manually connecting ${linksArray.length} links...`);
        let connectedCount = 0;
        linksArray.forEach((link: any) => {
          const [linkId, originId, originSlot, targetId, targetSlot] = link;
          const originNode = idToNode.get(originId);
          const targetNode = idToNode.get(targetId);

          if (originNode && targetNode) {
            try {
              originNode.connect(originSlot, targetNode, targetSlot);
              connectedCount++;
            } catch (error) {
              console.warn(`[NodeEditor] Failed to connect link ${linkId}:`, error);
            }
          } else {
            console.warn(`[NodeEditor] Skipping link ${linkId} - nodes not found (origin: ${!!originNode}, target: ${!!targetNode}), originalIds: ${originId} -> ${targetId}`);
          }
        });

        console.log(`[NodeEditor] Template loaded. Nodes: ${graphNodes.length}, Connected: ${connectedCount}/${linksArray.length} links`);

        // Force canvas to redraw connections
        if (canvas) {
          canvas.setDirty(true, true);
          graph.setDirtyCanvas(true, true);
          console.log('[NodeEditor] Forced canvas redraw to show connections');
        }
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

    console.log('[NodeEditor] Raw litegraph module:', {
      keys: Object.keys(litegraphModule).slice(0, 20),
      hasLITEGRAPH: 'LITEGRAPH' in litegraphModule,
      hasDefault: 'default' in litegraphModule,
      LITEGRAPHtype: typeof litegraphModule.LITEGRAPH,
      defaultType: typeof litegraphModule.default,
    });

    const lgModule = litegraphModule?.LITEGRAPH || litegraphModule?.default || litegraphModule;

    console.log('[NodeEditor] Selected lgModule:', {
      type: typeof lgModule,
      keys: Object.keys(lgModule).slice(0, 30),
      hasRegisterNodeType: typeof lgModule.registerNodeType,
      hasRegisteredNodeTypes: 'registered_node_types' in lgModule,
    });

    LiteGraph = lgModule;
    LGraph = lgModule?.LGraph;
    LGraphCanvas = lgModule?.LGraphCanvas;
    LGraphNode = lgModule?.LGraphNode;

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

    console.log('[NodeEditor] About to register nodes. LiteGraph object:', {
      type: typeof LiteGraph,
      hasRegisterMethod: typeof LiteGraph?.registerNodeType,
      registeredTypes: LiteGraph?.registered_node_types ? Object.keys(LiteGraph.registered_node_types).length : 'N/A',
      keys: Object.keys(LiteGraph).slice(0, 20), // Show first 20 keys
    });

    // Register all cognitive nodes with LiteGraph instance
    // Use the default export as LiteGraph, and LGraphNode from it
    try {
      registerCognitiveNodes(LiteGraph, LGraphNode);
      console.log('[NodeEditor] Registration completed. Registered types:',
        LiteGraph?.registered_node_types ? Object.keys(LiteGraph.registered_node_types).length : 'N/A'
      );
    } catch (error) {
      console.error('[NodeEditor] Registration failed:', error);
    }

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

    // Disable automatic execution (we'll trigger manually when needed)
    graph.runningtime = 0;

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

    // Additional canvas options for better context menu support
    canvas.allow_dragcanvas = true;
    canvas.allow_dragnodes = true;
    canvas.allow_interaction = true;

    // Load graph data if provided
    if (graphData) {
      graph.configure(graphData);

      // Force canvas to redraw connections
      if (canvas) {
        canvas.setDirty(true, true);
        graph.setDirtyCanvas(true, true);
        console.log('[NodeEditor] Forced canvas redraw after initial graph load');
      }
    } else {
      // Auto-load template for current cognitive mode
      await loadCognitiveTemplate();
    }

    // DON'T auto-start the graph - only execute when user explicitly runs it
    // graph.start();

    // Initialize execution monitor
    executionMonitor = new ExecutionMonitor(graph);

    // Set up template watcher for hot-reload
    if (autoReloadEnabled) {
      setupTemplateWatcher();
    }

    // Resize canvas to fit container
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  });

  // Set up EventSource connection for template watching
  function setupTemplateWatcher() {
    try {
      templateWatcherSource = new EventSource('/api/template-watch');

      templateWatcherSource.addEventListener('connected', (e) => {
        const data = JSON.parse(e.data);
        console.log('[NodeEditor] Template watcher connected:', data.clientId);
      });

      templateWatcherSource.addEventListener('template-changed', async (e) => {
        const data = JSON.parse(e.data);
        console.log('[NodeEditor] Template changed:', data.templateName);

        if (autoReloadEnabled) {
          console.log('[NodeEditor] Auto-reloading template...');
          const success = await reloadTemplate();
          if (success) {
            console.log('[NodeEditor] Template auto-reloaded successfully!');
          }
        }
      });

      templateWatcherSource.onerror = (error) => {
        console.error('[NodeEditor] Template watcher error:', error);
        // Reconnect after 5 seconds
        setTimeout(() => {
          if (templateWatcherSource) {
            templateWatcherSource.close();
          }
          if (autoReloadEnabled) {
            setupTemplateWatcher();
          }
        }, 5000);
      };
    } catch (error) {
      console.error('[NodeEditor] Failed to setup template watcher:', error);
    }
  }

  // Cleanup when component is destroyed
  onDestroy(() => {
    if (graph) {
      graph.stop();
    }
    if (templateWatcherSource) {
      templateWatcherSource.close();
      templateWatcherSource = null;
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
    if (!LiteGraph || !graph) {
      console.error('[NodeEditor] Cannot create default graph: LiteGraph or graph not initialized');
      return;
    }

    console.log('[NodeEditor] Creating default graph...');

    try {
      // Input: User message
      const userInput = LiteGraph.createNode('cognitive/user_input');
      if (!userInput) {
        console.error('[NodeEditor] Failed to create user_input node - node type not registered?');
        return;
      }
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

      // Center the view (only if canvas is initialized)
      if (canvas && canvas.ds) {
        canvas.ds.offset = [-100, -50];
        canvas.ds.scale = 1.0;
      }

      console.log('[NodeEditor] Default graph created successfully');
    } catch (error) {
      console.error('[NodeEditor] Error creating default graph:', error);
    }
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
      // IMPORTANT: Save links array and node ID mapping BEFORE configure() mutates it
      const linksArray = Array.isArray(data.links) ? [...data.links] : [];
      const originalNodeIds = new Map<number, { type: string; pos: number[]; title?: string }>();

      // Save original node info for mapping after configure
      if (Array.isArray(data.nodes)) {
        data.nodes.forEach((node: any) => {
          originalNodeIds.set(node.id, {
            type: node.type,
            pos: node.pos,
            title: node.title
          });
        });
      }

      console.log(`[NodeEditor] loadGraph: Saved ${linksArray.length} links, ${originalNodeIds.size} node mappings before configure`);

      graph.configure(data);

      // Build ID mapping from original IDs to LiteGraph nodes
      // LiteGraph may assign new internal IDs, so we need to map by position/type
      const idToNode = new Map<number, any>();
      const graphNodes = graph._nodes || [];

      originalNodeIds.forEach((info, originalId) => {
        // First try getNodeById (works if LiteGraph preserved the ID)
        let node = graph.getNodeById(originalId);

        if (!node) {
          // Fall back to matching by position and type
          node = graphNodes.find((n: any) =>
            n.type === info.type &&
            n.pos && info.pos &&
            Math.abs(n.pos[0] - info.pos[0]) < 1 &&
            Math.abs(n.pos[1] - info.pos[1]) < 1
          );
        }

        if (node) {
          idToNode.set(originalId, node);
        }
      });

      console.log(`[NodeEditor] loadGraph: Mapped ${idToNode.size}/${originalNodeIds.size} nodes`);

      // Manually reconnect nodes using the saved links array and our ID mapping
      console.log(`[NodeEditor] loadGraph: Manually connecting ${linksArray.length} links...`);
      let connectedCount = 0;
      linksArray.forEach((link: any, index: number) => {
        const [linkId, originId, originSlot, targetId, targetSlot] = link;
        const originNode = idToNode.get(originId);
        const targetNode = idToNode.get(targetId);

        if (originNode && targetNode) {
          try {
            originNode.connect(originSlot, targetNode, targetSlot);
            connectedCount++;
          } catch (error) {
            console.warn(`[NodeEditor] loadGraph: Failed to connect link ${linkId}:`, error);
          }
        } else {
          console.warn(`[NodeEditor] loadGraph: Skipping link ${linkId} - nodes not found (origin: ${!!originNode}, target: ${!!targetNode}), originalIds: ${originId} -> ${targetId}`);
        }
      });

      console.log(`[NodeEditor] loadGraph: Connected ${connectedCount}/${linksArray.length} links`);

      // Force canvas to redraw connections
      if (canvas) {
        canvas.setDirty(true, true);
        graph.setDirtyCanvas(true, true);
        console.log('[NodeEditor] Forced canvas redraw after loadGraph');
      }
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

  // Reload current template (hot-reload support)
  export async function reloadTemplate() {
    if (!graph) {
      console.error('[NodeEditor] Cannot reload: graph not initialized');
      return false;
    }

    try {
      const { apiFetch } = await import('../lib/client/api-config');

      // Determine which template is currently loaded
      const modeResponse = await apiFetch('/api/cognitive-mode');
      const modeData = await modeResponse.json();
      const currentMode = modeData.currentMode || 'dual';
      const templateName = `${currentMode}-mode`;

      console.log(`[NodeEditor] Reloading template: ${templateName}`);

      // Fetch the latest version of the template
      const response = await apiFetch(`/api/template/${templateName}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch template: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.success || !data.template) {
        throw new Error('Invalid template response');
      }

      // Convert to LiteGraph format
      const { templateToLiteGraph } = await import('../lib/client/visual-editor/template-loader');
      const templateGraph = templateToLiteGraph(data.template);

      if (!templateGraph) {
        throw new Error('Failed to convert template');
      }

      console.log(`[NodeEditor] Template reloaded, clearing graph...`);

      // Clear current graph
      graph.clear();

      // Save links array before configure
      const linksArray = Array.isArray(templateGraph.links) ? [...templateGraph.links] : [];

      // Load new template
      graph.configure(templateGraph);

      // Manually reconnect nodes
      linksArray.forEach((link: any) => {
        const [linkId, originId, originSlot, targetId, targetSlot] = link;
        const originNode = graph.getNodeById(originId);
        const targetNode = graph.getNodeById(targetId);

        if (originNode && targetNode) {
          try {
            originNode.connect(originSlot, targetNode, targetSlot);
          } catch (error) {
            console.warn(`[NodeEditor] Failed to reconnect link ${linkId}:`, error);
          }
        }
      });

      // Force canvas to redraw connections
      if (canvas) {
        canvas.setDirty(true, true);
        graph.setDirtyCanvas(true, true);
        console.log('[NodeEditor] Forced canvas redraw after template reload');
      }

      console.log(`[NodeEditor] Template reloaded successfully!`);
      return true;
    } catch (error) {
      console.error('[NodeEditor] Error reloading template:', error);
      return false;
    }
  }

  // Toggle auto-reload feature
  export function setAutoReload(enabled: boolean) {
    autoReloadEnabled = enabled;

    if (enabled && !templateWatcherSource) {
      setupTemplateWatcher();
    } else if (!enabled && templateWatcherSource) {
      templateWatcherSource.close();
      templateWatcherSource = null;
    }

    console.log(`[NodeEditor] Auto-reload ${enabled ? 'enabled' : 'disabled'}`);
  }

  // Get auto-reload status
  export function isAutoReloadEnabled() {
    return autoReloadEnabled;
  }

  // Add a node to the graph (called from palette)
  export function addNode(nodeType: string) {
    console.log('[NodeEditor] addNode called with:', nodeType);

    if (!graph) {
      console.error('[NodeEditor] Cannot add node: graph not initialized');
      return;
    }

    // Test if createNode works with a known type
    console.log('[NodeEditor] Testing createNode with user_input...');
    try {
      const testNode = LiteGraph.createNode('cognitive/user_input');
      console.log('[NodeEditor] Test createNode result:', !!testNode, testNode?.constructor?.name);

      if (testNode) {
        // Successfully created test node - now try the requested type
        console.log('[NodeEditor] Test succeeded! Now trying requested type:', nodeType);
        const node = LiteGraph.createNode(nodeType);
        console.log('[NodeEditor] Requested createNode result:', !!node, node?.constructor?.name);

        if (node) {
          // Position at canvas center (or slightly offset)
          const offset = Math.floor(Math.random() * 50);
          node.pos = [100 + offset, 100 + offset];
          console.log('[NodeEditor] Adding node to graph at position:', node.pos);
          graph.add(node);
          console.log(`[NodeEditor] Successfully added node: ${nodeType}`);

          // Force canvas redraw
          if (canvas) {
            canvas.setDirty(true, true);
          }
        } else {
          console.error('[NodeEditor] createNode returned null/undefined for:', nodeType);
        }
      } else {
        console.error('[NodeEditor] Even test node (user_input) failed to create!');
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
