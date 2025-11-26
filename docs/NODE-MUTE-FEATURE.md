# Node Mute Feature

## Overview

The Node Mute feature allows you to temporarily disable nodes in cognitive graphs without removing them. Muted nodes are skipped during execution, with their inputs passed through directly to their outputs.

## Benefits

1. **Fast Debugging**: Quickly disable parts of your workflow to isolate issues
2. **Clean Alternative to Deletion**: Keep nodes in the graph without breaking connections
3. **A/B Testing**: Toggle between different execution paths
4. **Visual Clarity**: Muted nodes are clearly marked with a 🔇 icon and dimmed overlay

## How to Use

### Muting a Node

1. **Right-click** on any node in the Node Editor
2. Select **"🔇 Mute Node"** from the context menu
3. The node will display a 🔇 icon and become semi-transparent

### Unmuting a Node

1. **Right-click** on the muted node
2. Select **"🔊 Unmute Node"** from the context menu
3. The node returns to normal appearance and functionality

## Execution Behavior

- **Muted nodes** are **skipped** during graph execution
- **Inputs are passed through** to outputs unchanged
- **No processing** occurs (no LLM calls, no file operations, etc.)
- **Execution logs** show `🔇 Node X MUTED - skipping execution`

## Use Cases

### 1. Debugging Complex Workflows

Instead of deleting the ReAct operator loop, you can mute nodes 9-17:

```
Before: User Input → ReAct Loop (9-17) → Response
After:  User Input → [MUTED Loop] → Response
```

### 2. Bypass Expensive Operations

Mute LLM or web search nodes during testing:

```
Muted: Orchestrator LLM, Semantic Search, Claude Full Task
Result: Fast execution with mock data
```

### 3. A/B Test Different Paths

Create two parallel paths and mute one:

```
Path A: Smart Router → [MUTED] ReAct Operator → Response
Path B: Smart Router → Claude Full Task → Response
```

## Persistence

- **Mute state is saved** when you export the graph
- **Persists across sessions** in graph JSON files
- **Property**: `"muted": true` in node definition

## Example: Dual Mode with Muted ReAct Loop

Instead of removing links, you can mute the entire ReAct operator:

```json
{
  "nodes": [
    {"id": 9, "type": "cognitive/scratchpad_initializer", "muted": true},
    {"id": 10, "type": "cognitive/iteration_counter", "muted": true},
    {"id": 11, "type": "cognitive/react_planner", "muted": true},
    {"id": 12, "type": "cognitive/skill_executor", "muted": true},
    {"id": 13, "type": "cognitive/scratchpad_updater", "muted": true},
    {"id": 14, "type": "cognitive/scratchpad_completion_checker", "muted": true},
    {"id": 15, "type": "cognitive/conditional_router", "muted": true},
    {"id": 16, "type": "cognitive/scratchpad_formatter", "muted": true}
  ]
}
```

Result: The graph executes with the ReAct loop completely bypassed.

## Implementation Details

### Schema Addition

```typescript
export interface CognitiveGraphNode {
  id: number;
  type: string;
  muted?: boolean;  // When true, node is skipped
  // ... other properties
}
```

### Graph Executor Behavior

```typescript
if (node.muted) {
  log.debug(`🔇 Node ${nodeId} MUTED - skipping execution`);
  const inputs = getNodeInputs(nodeId, graph, executionState);

  // Pass through inputs as outputs
  executionState.set(nodeId, {
    status: 'completed',
    outputs: inputs,  // Direct pass-through
  });

  return;  // Skip execution
}
```

### Visual Indicator

- **Icon**: 🔇 (muted speaker) in top-right corner
- **Overlay**: 25% dark overlay to dim the node
- **Context Menu**: Toggle between 🔇 Mute / 🔊 Unmute

## Comparison: Mute vs. Remove Links

| Action | Mute Nodes | Remove Links |
|--------|-----------|--------------|
| **Speed** | Instant toggle | Manual editing |
| **Reversible** | One click | Re-create links |
| **Visual** | Clear indicator | Graph looks different |
| **Execution** | Skipped, inputs passed through | Node never reached |
| **Best For** | Temporary debugging | Permanent changes |

## Future Enhancements

Potential additions:

- **Keyboard Shortcut**: `M` to toggle mute on selected nodes
- **Mute Groups**: Mute all nodes in a group
- **Conditional Muting**: Mute based on runtime conditions
- **Mute Profiles**: Save/load different mute configurations

---

**Implementation Files:**
- Schema: `packages/core/src/cognitive-graph-schema.ts`
- Executor: `packages/core/src/graph-executor.ts`
- UI: `apps/site/src/lib/cognitive-nodes/node-registry.ts`
