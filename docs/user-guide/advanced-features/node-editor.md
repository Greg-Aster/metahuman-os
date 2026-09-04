# Node Editor

The Node Editor is the visual editor for cognitive and agent graphs. It uses the same graph schemas, persistence handler, and execution engine as maintained JSON workflows; it is not a separate runtime.

## Open the Editor

Use the node-editor toggle in the application header. The editor is loaded only when opened so the Svelte Flow bundle is not part of the normal chat path. Choose **Exit** to return to the standard interface.

## Editor Layout

- the left palette lists node schemas reported by the server;
- the center canvas contains nodes, typed connections, purpose summaries, and important configured values;
- expanded canvas nodes and the property inspector edit the same schema-backed properties;
- the right inspector switches between workflow, node, and connection settings based on the current selection;
- the header provides **New**, **Load**, **Execute**, **Save**, and inspector controls; and
- the authoring toolbar provides history, clipboard, grouping, layout, and execution-log controls.

The canvas supports pan, zoom, selection, multi-selection with Shift, and deletion with Delete or Backspace. **Map** opens an optional pannable and zoomable overview. It starts off and is unavailable above 40 nodes because profiling showed that a minimap for large, information-dense node cards can exceed the browser's rendering budget.

## Read and Edit Nodes on the Canvas

Every schema-backed node uses the same canvas renderer. In its compact state, a node shows its workflow purpose, a prompt or long-text preview when it owns one, and a summary of its configured settings. A prompt-consuming node links to the connected upstream prompt owner, so the effective prompt can be found without creating a second copy of it.

Choose **+** in a node header to expand it. The expanded node provides:

- direct editing for prompts, templates, and other long-text properties;
- a field selector when the node owns more than one prompt or long-text property;
- controls for every standard schema-backed setting;
- a collapsible **Advanced settings** section; and
- horizontal resize handles while the expanded node is selected.

If an incoming connection supplies a property, its local control is marked **Input overrides** and disabled because the connected value is the effective runtime value. Canvas and inspector controls share one renderer and update the same in-memory graph properties. Expand or collapse state is session-only; property edits and resized node dimensions require **Save** to persist the graph.

Schema metadata can also expose behavior badges, grouped outputs, and selected runtime status directly on the node and in the inspector. Multivalue settings use checkboxes with **All** and **Clear** actions instead of a native multiselect.

The palette searches schema IDs, names, aliases, tags, purposes, port labels and descriptions, property labels and descriptions, and select options. A **DOCS** badge means the definition still has one or more specific port or setting descriptions to complete; the right inspector identifies the exact gaps instead of hiding them.

## Direct the Workflow

The maintained scheduler is demand-driven. A node runs only when its activation contract is satisfied; nodes on inactive branches are reported as skipped and their executors are not called.

Select a node and use **Activation and Branching** to:

- mute it without deleting its connections;
- use its definition default, require all selected inputs, accept any active incoming branch, or run after all dependencies regardless of data inputs;
- choose the exact required inputs; and
- add output conditions from other nodes. Every listed condition must match.

Select a connection to edit its contract. A data connection carries one declared output into one declared input. A control connection orders two nodes without copying data. A connection condition selects that branch from the source output. An intentional loop must have a condition and is bounded by the workflow's maximum loop iterations; an undeclared cycle is rejected.

Connection creation blocks missing endpoints, unknown handles, and exact duplicates. Type mismatches are shown as review warnings because existing adapters can deliberately transform or narrow values at runtime; the warning is not silently treated as compatibility proof.

Choose **Graph** to edit the workflow name, purpose, and loop limit and to see the fixed scheduler contract, blocking errors, type/documentation warnings, and schema coverage. Clicking an issue selects its node or connection.

## Authoring Tools

- **Undo** and **Redo** retain a bounded edit history. Rapid edits to the same field or size are coalesced.
- **Copy**, **Paste**, and **Duplicate** preserve settings and internal connections. Copying a group includes its children.
- **Group** places selected top-level nodes in a persistent, movable Graph Note frame. **Ungroup** keeps the child nodes and restores their canvas positions.
- **Auto layout** arranges top-level nodes from dependencies while ignoring explicitly declared loop edges.

Keyboard equivalents are Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y, Ctrl/Cmd+C, Ctrl/Cmd+V, Ctrl/Cmd+D, Ctrl/Cmd+G, and Ctrl/Cmd+Shift+G. Shortcuts do not intercept typing in inputs, textareas, selects, or editable text.

### Environment Bridge Input

**Environment Bridge Input** is the complete read-only Ainekio bridge source. It selects the triggering Ainekio session, a configured session, or the latest connected session and exposes all available observation, body-status, gateway, session, and bridge-diagnostic data. It has no prompt, does not capture a new observation, and does not send robot or environment actions.

The **Observation Session** setting accepts a session ID or offers currently known sessions when the Environment Bridge is available. Outputs are never disabled by settings: the workflow chooses what it consumes by connecting only the required ports. The complete **Observation**, **Bridge Summary**, and **Diagnostics Snapshot** objects preserve their respective canonical payloads, while convenience ports expose battery voltage, Wi-Fi signal, body state and readiness, storage and media health, wake-word state, gateway details, transcription state, and movement diagnostics. Missing optional readings remain null or empty rather than being fabricated. The frame collection is part of the current observation, not durable image history. Location and map authoring belong to **Environment Map Input** and do not pass through this node. After execution, the node shows a compact observation and body summary; the complete output remains available under **Last Run** in the inspector.

### Verify Matched Sent Action

Before a result-bearing graph starts, Core resolves the robot-reported action ID against Work Coordinator records. **Verify Matched Sent Action** confirms that the reported ID and that trusted record agree. A match exposes the sent command, current status and result, timing, and owning action cycle; a missing or mismatched record produces no action context. The node has no editable matching settings and does not perform the lookup, send a command, decide what the robot should do, update Robot Status, or call a model.

### Find Finished Robot Report for Sent Action

**Find Finished Robot Report for Sent Action** takes the verified sent-action ID and the reports returned by the robot. It finds the newest finished report with that same ID. A finished report can say the action completed, failed, was rejected, was cancelled, or expired. This node does not decide whether a larger task is complete, send a command, update Robot Status, or call a model.

### Select Camera Frames for Current Action

**Select Camera Frames for Current Action** checks camera frames received from the robot. For a new observation, it provides the current valid frame. After an action finishes, it can provide both the saved before-action frame and the current frame marked with the same action or cycle ID. It rejects unsupported frame data, but it does not interpret the image, send a command, update Robot Status, or call a model.

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

The editor marks changed workflows **Unsaved**. Exit, New, Load, page close, and browser refresh guard against discarding those changes. Save and Execute are blocked by structural, scheduler, required-input, and property-validation errors; warnings remain visible but do not prevent deliberate work.

Saving proves the graph was accepted by the persistence handler. It does not prove that a Trigger Manager registration or cognitive mode now points to that graph.

## Execute a Graph

Choose **Execute** or press Ctrl/Cmd+E. The editor submits the current in-memory graph to the streaming graph endpoint and marks nodes as they start, complete, skip, or fail. A skipped node was not invoked; its node card and **Last Run** inspector show whether a branch was inactive, a required input was missing, or the node was muted. Display nodes receive the final response and node outputs when execution completes.

**Run log** shows the current node order, duration, skipped-state reason, error, and a bounded safe output preview. It also shows which conditional connections selected or rejected a branch and recent persisted graph traces. Large strings and embedded media are summarized rather than copied into the canvas.

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
