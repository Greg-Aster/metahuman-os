# Node Editor

The Node Editor is the visual editor for cognitive and agent graphs. It uses the same graph schemas, persistence handler, and execution engine as maintained JSON workflows; it is not a separate runtime.

## Open the Editor

Use the node-editor toggle in the application header. The editor is loaded only when opened so the Svelte Flow bundle is not part of the normal chat path. Choose **Exit** to return to the standard interface.

## Editor Layout

- the left palette lists node schemas reported by the server;
- the center canvas contains nodes and typed connections;
- the property inspector edits the selected node's schema-backed properties;
- the header provides **New**, **Load**, **Execute**, **Save**, and inspector controls.

The canvas supports pan, zoom, selection, multi-selection with Shift, and deletion with Delete or Backspace.

## Load a Graph

**Load** includes the four cognitive-mode graphs:

- Dual Consciousness
- Agent
- Emulation
- Environment

It also lists other saved graphs and recent backups. Loading a backup opens its content without treating the backup filename as the active save target.

Built-in graphs are operational configuration. Review the complete graph and save behavior before changing one that a live mode or agent uses.

## Build and Edit

1. Choose a node schema from the palette.
2. Position the new node on the canvas.
3. Select it and set required properties in the inspector.
4. Connect compatible handles in the intended data-flow direction.
5. Remove accidental nodes or edges.
6. Save under a deliberate graph name.

The server provides the available schema set. Do not rely on a static category list in documentation; node types change with the maintained registry.

## Save and Backups

Choose **Save** or press Ctrl/Cmd+S. Filenames are normalized to lowercase letters, numbers, hyphens, and underscores. Saving an existing graph can create a backup, which appears in the Load menu.

Saving proves the graph was accepted by the persistence handler. It does not prove that a Trigger Manager registration or cognitive mode now points to that graph.

## Execute a Graph

Choose **Execute** or press Ctrl/Cmd+E. The editor submits the current in-memory graph to the streaming graph endpoint and marks nodes as they start, complete, or fail. Display nodes receive the final response and node outputs when execution completes.

An editor run is an explicit test execution. It does not register a schedule, replace an agent's graph selection, or prove an external action occurred.

## Safe Workflow

1. Load the current graph and understand its entry and output nodes.
2. Save a copy under a new name for experimental work.
3. make the smallest complete change.
4. Execute representative success and failure inputs.
5. Inspect failed nodes and final output.
6. Only then update the owning mode, agent, or trigger through its canonical configuration.

Avoid maintaining two graphs for the same live responsibility. Once a replacement is adopted and validated, remove the superseded graph and its registration.

## Related Guides

- [Cognitive Modes](/user-guide#cognitive-modes)
- [Architecture](/user-guide#architecture)
- [Autonomous Work](/user-guide#autonomous-agents)
- [Configuration Ownership](/user-guide#configuration-files)
