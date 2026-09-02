# Node Editor

The Node Editor is the visual editor for cognitive and agent graphs. It uses the same graph schemas, persistence handler, and execution engine as maintained JSON workflows; it is not a separate runtime.

## Open the Editor

Use the node-editor toggle in the application header. The editor is loaded only when opened so the Svelte Flow bundle is not part of the normal chat path. Choose **Exit** to return to the standard interface.

## Editor Layout

- the left palette lists node schemas reported by the server;
- the center canvas contains nodes, typed connections, purpose summaries, and important configured values;
- expanded canvas nodes and the property inspector edit the same schema-backed properties;
- the header provides **New**, **Load**, **Execute**, **Save**, and inspector controls.

The canvas supports pan, zoom, selection, multi-selection with Shift, and deletion with Delete or Backspace.

## Read and Edit Nodes on the Canvas

Every schema-backed node uses the same canvas renderer. In its compact state, a node shows its workflow purpose, a prompt or long-text preview when it owns one, and a summary of its configured settings. A prompt-consuming node links to the connected upstream prompt owner, so the effective prompt can be found without creating a second copy of it.

Choose **+** in a node header to expand it. The expanded node provides:

- direct editing for prompts, templates, and other long-text properties;
- a field selector when the node owns more than one prompt or long-text property;
- controls for every standard schema-backed setting;
- a collapsible **Advanced settings** section; and
- horizontal resize handles while the expanded node is selected.

If an incoming connection supplies a property, its local control is marked **Input overrides** and disabled because the connected value is the effective runtime value. Canvas and inspector controls share one renderer and update the same in-memory graph properties. Expand or collapse state is session-only; property edits and resized node dimensions require **Save** to persist the graph.

Schema metadata can also expose behavior badges, grouped outputs, configuration warnings, and selected runtime status directly on the node and in the inspector. Multivalue settings use checkboxes with **All** and **Clear** actions instead of a native multiselect.

### Environment Bridge Input

**Environment Bridge Input** is a read-only source node. It selects the triggering environment session, a configured session, or the latest connected session and exposes its most recent observation. It has no prompt, does not capture a new observation, and does not send robot or environment actions.

The **Observation Session** setting accepts a session ID or offers currently known sessions when the Environment Bridge is available. **Observation Fields** controls which optional observation outputs are populated. A connected output that is excluded by this setting produces a configuration warning. After execution, the node shows a compact observation summary; the complete output remains available under **Last Run** in the inspector.

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
3. Expand it to edit schema-backed properties on the canvas, or select it to use the complete inspector.
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
