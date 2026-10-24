# Node and Workflow Design

The node editor is an operator-facing tool for assembling understandable,
configurable workflows from reusable elements. Repairing a workflow must not
routinely expand the node catalog or hide its behavior inside custom code.

This guide applies to node types, graph structure, and their editor presentation.
[AGENTS.md](../../AGENTS.md) governs authorization and coding work;
[Maintained Surface](MAINTAINED_SURFACE.md) owns runtime responsibilities;
[Robot Bible](../robot/ROBOT_BIBLE.md) describes intended robot behavior.

## Reuse before adding

- Inspect registered nodes, their ports and properties, and workflows already
  performing the required operation before proposing another node type.
- Prefer another instance of an existing configurable node. A different event,
  prompt, model role, action, or arrangement of inputs is not by itself a new
  node responsibility. Keep these differences in editable workflow configuration.
- Do not create a node type merely to name one procedure, incident, or workflow.
  A wake-up sequence should compose reusable operations; its descriptive labels
  belong on those instances.
- If an existing node is missing part of its own responsibility, repair that owner
  and check its other consumers. Do not copy it into a workflow-specific variant
  or add unrelated behavior to it through a growing collection of special cases.
- Before implementing a new node type, obtain the Installation Owner's explicit
  approval. Present the missing responsibility, existing nodes considered, why
  their configuration cannot express it, and where the new element can be reused.
  Do not invent speculative consumers to justify it. General feature approval
  alone does not approve new node types; an already approved concrete design does.

## Make the workflow visible and configurable

- Every executable node must have a visible representation on the graph canvas.
  Show its actual data and control connections through visible ports and edges.
  The displayed graph must describe the execution path, not a simplified diagram
  that omits operations or dependencies.
- Represent distinct workflow operations explicitly, including Robot Status reads,
  context assembly, model calls, buffer writes, memory saves, conversation output
  and TTS. Do not conceal these operations inside a generic output node, arbitrary
  script or private execution path to reduce the visible node count. Reuse their
  existing node types and connect them in the graph.
- A child-workflow invocation must be a visible, connected workflow-call node
  identifying the graph it invokes; every node and connection in that child must
  also be visible when opened. Do not silently invoke a child workflow from an
  unrelated node. When the Installation Owner requests operations directly in a
  graph, place their nodes there rather than substituting a child-workflow call.
- Use short, plain-language names that describe the function. Prefer labels such
  as “Read Camera Image”, “Build Conversation Context”, and “Generate Reply”. Avoid
  vague names, internal implementation terms, and incident-specific terminology.
  The node type names the reusable operation; its instance label describes its
  use in this graph. Name ports for the data they carry.
- Use clear workflow names and the appropriate picker category. Keep one
  maintained workflow for one responsibility; remove replaced graphs and wiring.
- Put operator-configurable prompts, model roles, action parameters, and branch
  choices in the existing editor properties and graph wiring. Use the shared model
  role catalog rather than fixed deployment names.
- An owner-approved graph procedure belongs in editable configuration, not
  hardcoded command selection inside a new node. Physical procedures assigned to
  firmware or Body Control stay with those owners; consume their event and evidence
  rather than duplicating the procedure in the higher-level graph. Preserve
  LLM-selected behavior elsewhere.
- Keep all model-visible wording subject to AGENTS.md approval. Reorganization is
  not permission to add instructions, preferred behaviors, or model calls.

## Readable graph layouts

- Arrange the main path from left to right: input, selected processing and context,
  model calls where needed, and outputs. Placement must follow the actual data
  dependencies; do not arrange nodes arbitrarily or change execution to fit a drawing.
- Put independent or alternative branches in separate horizontal rows. Keep
  supporting sources near the context join they feed. Keep unrelated event paths
  visibly separate from the primary procedure.
- Align related stages to columns and use consistent card widths and spacing.
  Measure spacing from card edges, not just their position coordinates. Leave
  generous gutters for connections and vertical room for ports and descriptions.
  Expanded cards must not cover adjacent nodes while their settings are edited.
- Collapsed cards show connected or essential ports and ordinary settings. Keep all
  ports and advanced settings available on expansion; this is presentation only.
  Show the configured prompt rather than an empty alternative prompt field.
- Keep outputs downstream and clearly separated. A reader should be able to trace
  one branch to its outputs without confusing it with a neighboring branch.
- Minimize crossings, long backtracking edges, and lines passing behind cards.
  Preserve real joins and dependencies; never add relay nodes merely to tidy wires.
- Use plain labels and existing comments to explain branch purpose where needed.
  Do not add decorative or organizational node types to compensate for poor layout.
- Check the overview and a readable editing zoom. Opening a graph should show an
  intelligible starting view; remove stale saved viewports that hide the layout.
  Check ordinary and expanded cards, not only coordinate values in JSON.
- A layout-only edit preserves node identities and order, ports, connections,
  activation, properties, prompts, and execution behavior. Verify that distinction
  and report whether the layout was visually inspected in the actual editor.

## Consistent node colors

Color identifies what a node does, consistently across the palette, canvas, and
properties panel. Use this functional palette:

| Node function | Color | Accent |
| --- | --- | --- |
| LLM inference calls, including specialist and delegated model calls | Red | `#ef4444` |
| Inputs: incoming messages, events, sensor data, and source reads | Blue | `#60a5fa` |
| Outputs: publishing, writing results, speech delivery, and command dispatch | Green | `#4ade80` |
| Context assembly and data joins | Cyan | `#22d3ee` |
| Routing, branching, and conditions | Amber | `#fbbf24` |
| Child-workflow calls and execution control | Indigo | `#818cf8` |
| Data transformation, parsing, and formatting | Slate | `#94a3b8` |
| Memory search and retrieval | Purple | `#c084fc` |
| Tool and skill execution | Orange | `#fb923c` |
| Configuration and parameters | Yellow | `#fde047` |

An LLM call is red even when it belongs to a robot, persona, memory, or autonomy
category. A source-only read is blue; a memory search is purple; an output that
saves memory is green. A workflow-call node is indigo, with model calls visible
inside the child workflow. Domain membership must not conceal the operation.

Reuse the existing presentation owner for these colors; do not create another
color registry or a new node type just to change appearance. Do not choose custom
colors independently for each graph or instance. Additional functional styles
need a documented color assignment before use. Use readable contrasting text and
backgrounds, and keep labels or icons so color is not the only identification.

This table is the required design. Existing editor colors must be checked when
implementing a presentation change; documenting the rule does not establish that
the current renderer already follows it.

## Preserve one execution and output owner

- Nodes use the existing command, execution, storage, model, and delivery owners.
  A new workflow does not justify another queue, scheduler, retry system, or
  publishing path. Reuse child workflows only for genuinely shared operations.
- Intent-selected branches must communicate their selection and results to the
  existing context assembly. A join consumes the selected dependencies; it must
  neither run before their needed results nor wait on an unselected branch.
- Keep independent speech, sensing, and motion concurrent where supported. Add
  only dependencies required by the requested operation or actual protocol.
  Completion receipts are evidence, not a global barrier to other work.
- Give each outward result one publishing owner. Task planning and assessment
  return data; they must not also publish the reply owned by the conversation
  path. Buffer, memory, feed, and speech consume that same admitted result through
  their established owners.
- Preserve event identity, source, speaker, timestamps, and uncertainty across
  ports. Do not turn an autonomous event into a human request or an action request
  into proof of completion.

## Review the complete change

Before editing, explain the intended path, reused node types, any proposed new
node types, and superseded pieces. For a shared-node change, identify its existing
consumers and test the affected behavior there as well as in the new workflow.

Verify meaningful cases: selected and unselected branches, appropriate model-call
count, correlated results, and single output delivery. Exercise replay or
reconnection when the changed owner handles those transitions. Use simulated
physical actions unless live actions are explicitly authorized for that check.

Delete superseded node registrations, schemas, exports, graphs, and references
within the authorized scope. Do not leave two competing implementations visible
for later cleanup. Report what was tested and distinguish source changes from
activation and observed robot behavior. These are coding and review rules, not
permission to add runtime gates, limits, or waits.
