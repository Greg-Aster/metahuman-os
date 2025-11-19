/**
 * Execution Monitor for Node Editor
 *
 * Provides real-time visual feedback during graph execution
 */

// @ts-ignore - LiteGraph doesn't have proper TypeScript definitions
import { LGraph } from 'litegraph.js';
import type { ExecutionEvent, GraphExecutionState } from '@metahuman/core/graph-executor';

export class ExecutionMonitor {
  private graph: any; // LGraph instance
  private activeNodes: Set<number> = new Set();
  private completedNodes: Set<number> = new Set();
  private failedNodes: Set<number> = new Set();

  constructor(graph: any) {
    this.graph = graph;
  }

  /**
   * Handle execution events and update node visuals
   */
  handleEvent(event: ExecutionEvent) {
    const { type, nodeId } = event;

    if (!nodeId) return;

    const node = this.graph.getNodeById(nodeId);
    if (!node) return;

    switch (type) {
      case 'node_start':
        this.activeNodes.add(nodeId);
        this.highlightNode(node, 'running');
        break;

      case 'node_complete':
        this.activeNodes.delete(nodeId);
        this.completedNodes.add(nodeId);
        this.highlightNode(node, 'completed');
        break;

      case 'node_error':
        this.activeNodes.delete(nodeId);
        this.failedNodes.add(nodeId);
        this.highlightNode(node, 'failed');
        break;

      case 'graph_complete':
        this.reset();
        break;

      case 'graph_error':
        // Keep failed nodes highlighted
        break;
    }
  }

  /**
   * Highlight a node with a specific status
   */
  private highlightNode(node: any, status: 'running' | 'completed' | 'failed') {
    switch (status) {
      case 'running':
        node.boxcolor = '#fbbf24'; // Amber - currently executing
        node.color = '#92400e';
        break;

      case 'completed':
        node.boxcolor = '#22c55e'; // Green - success
        node.color = '#166534';
        // Fade back to normal after 2 seconds
        setTimeout(() => {
          if (this.completedNodes.has(node.id)) {
            node.boxcolor = null;
            node.color = null;
          }
        }, 2000);
        break;

      case 'failed':
        node.boxcolor = '#ef4444'; // Red - error
        node.color = '#991b1b';
        break;
    }
  }

  /**
   * Reset all visual indicators
   */
  reset() {
    this.activeNodes.clear();
    this.completedNodes.clear();
    this.failedNodes.clear();

    // Reset all node colors
    this.graph._nodes.forEach((node: any) => {
      node.boxcolor = null;
      node.color = null;
    });
  }

  /**
   * Get current execution statistics
   */
  getStats() {
    return {
      active: this.activeNodes.size,
      completed: this.completedNodes.size,
      failed: this.failedNodes.size,
      total: this.graph._nodes.length,
    };
  }
}

/**
 * Animate data flowing through a connection
 */
export function animateDataFlow(canvas: any, linkId: number) {
  // This would require access to the LGraphCanvas
  // For now, we'll skip the animation
  // In a full implementation, we'd draw animated dots along the connection
}

/**
 * Display execution progress overlay
 */
export function showExecutionProgress(
  state: GraphExecutionState,
  containerElement: HTMLElement
) {
  const existing = containerElement.querySelector('.execution-progress');
  if (existing) {
    existing.remove();
  }

  const completed = Array.from(state.nodes.values()).filter(n => n.status === 'completed').length;
  const total = state.nodes.size;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  const overlay = document.createElement('div');
  overlay.className = 'execution-progress';
  overlay.innerHTML = `
    <div class="execution-progress-bar">
      <div class="execution-progress-fill" style="width: ${percentage}%"></div>
    </div>
    <div class="execution-progress-text">${completed} / ${total} nodes</div>
  `;

  containerElement.appendChild(overlay);

  // Remove when complete
  if (state.status === 'completed' || state.status === 'failed') {
    setTimeout(() => overlay.remove(), 3000);
  }
}
