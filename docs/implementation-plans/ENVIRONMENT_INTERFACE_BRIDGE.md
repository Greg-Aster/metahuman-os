# Environment Interface Bridge Plan

Status: architecture reset after separation review
Scope: connect MetaHuman OS Environment Mode graphs to external environments such as Megameal without baking Megameal behavior into MetaHuman core.

## Goal

MetaHuman OS should be able to observe an environment, reason over that observation through the node graph, and send bounded text or movement actions back through an adapter.

The first target environment is Megameal, but the interface must remain generic enough to support a different game, simulator, robot, desktop surface, or physical device later.

## Current Decision

The bridge must be split into three separable pieces:

```text
Megameal External DEV Bridge
  -> exposed current-player input/output adapter
  -> MetaHuman environment-bridge agent
  -> Environment Mode node graph
  -> MetaHuman environment-bridge agent
  -> exposed current-player input/output adapter
```

The entry and exit point inside MetaHuman is the node system. The bridge agent is the exchange process between the external adapter and the nodes. The game should not know prompts, graphs, model routing, personas, or cognitive policy.

## Non-Negotiable Boundaries

- Megameal owns the External DEV Bridge, its editor switch, its saved global settings, and the current-player adapter surface.
- The External DEV Bridge must be optional. If disabled or deleted, normal Megameal gameplay and multiplayer continue.
- The adapter attaches to the normal Megameal client/player that is already in the multiplayer room. It must not create a special MetaHuman-only game mode or hidden second player.
- If a human player and AI player should coexist, run two normal Megameal clients in the same room: one human-controlled with bridge disabled, one bridge-controlled with bridge enabled.
- MetaHuman owns the `environment-bridge` agent.
- Starting the `environment-bridge` agent connects to the exposed current-player adapter. It does not launch a strange URL session, invent a second browser policy, spawn a player, or create a separate local bridge server.
- MetaHuman Environment Mode owns the node workflow that prepares prompts, runs model decisions, parses actions, and sends outputs.
- `packages/core` environment nodes must stay generic. No Megameal map parser, Megameal touch-control IDs, hardcoded Megameal rooms, Megameal URL parameters, or Megameal-only schema defaults belong in core nodes.
- Megameal-specific translation belongs at the Megameal External DEV Bridge edge or in a clearly isolated adapter folder, not in core cognitive nodes.
- No polling loop should be used for bridge traffic. Events should flow when relevant data changes or when the adapter receives a command.
- Any file outside the listed owner surfaces requires explicit permission before implementation.

## Rejected Designs

These approaches are out of scope for the current implementation:

- Playwright-owned or browser-automation-owned avatar.
- A third local server just for the bridge.
- MetaHuman launching a dedicated special Megameal URL with `metahumanBridge` or `bridgeEndpoint` parameters.
- MetaHuman creating a second Megameal player/session on behalf of the game.
- Megameal hardcoding a MetaHuman URL as its transport policy.
- Megameal posting observations directly to a hardcoded MetaHuman endpoint as the primary architecture.
- Megameal-specific nodes or map normalization inside `packages/core`.
- Polling timers that repeatedly scan game state or bridge state.
- Broad Agent Monitor, startup script, model config, README, or unrelated UI changes as part of the bridge.

## Ownership

MetaHuman owns:

- `brain/agents/environment-bridge/`: the optional bridge agent process.
- Generic environment protocol types.
- Generic bridge storage for observations, actions, feedback, and connection/session state.
- Generic Environment Mode nodes.
- Environment Mode graph templates and graph editor canvas integration.
- Prompt/data preparation inside the graph.
- Action parsing and validation inside generic send nodes.

Megameal owns:

- The External DEV Bridge editor switch and configuration UI.
- Saving External DEV Bridge settings into the level/global settings file.
- The adapter surface exposed on the current normal player/client when the External DEV Bridge is enabled.
- Translating generic semantic actions into local game controls.
- Publishing game observations from that current player/client.
- Rejecting commands when bridge support is disabled, game input is blocked, or UI capture makes control unsafe.

Shared contract:

- Observations and actions use a generic protocol.
- Either side can be removed without leaving orphaned cognitive/game policy in the other.
- Megameal does not import MetaHuman concepts.
- MetaHuman core does not import Megameal concepts.

## Allowed File Surfaces

MetaHuman expected surfaces:

```text
brain/agents/environment-bridge/
packages/core/src/environment-interface/
packages/core/src/nodes/environment/
packages/core/src/nodes/schemas.ts
etc/cognitive-graphs/environment-mode.json
apps/site graph/editor files only when needed for Environment Mode canvas support
docs/implementation-plans/ENVIRONMENT_INTERFACE_BRIDGE.md
```

Megameal expected surfaces:

```text
apps/game.megameal/src/app/gameDevBridge.ts
apps/game.megameal/src/app/gameDevBridgeRuntime.ts
apps/game.megameal/src/levels/global/settings.ts
apps/game.megameal/src/editor/MasterControlMap.svelte
apps/game.megameal/src/editor/masterControlGraph.ts
apps/game.megameal/scripts/editor-dev-api.mjs
```

Any additional file requires a short explanation and explicit approval before editing.

## External DEV Bridge Requirements

The game editor gets an External DEV Bridge section with:

- Enable/disable switch.
- Configurable exposed settings.
- Configurable host/room/adapter fields if needed by the game-side adapter.
- Data category switches for text, location, state, map, snapshots, and later visual frames.
- Saved values in the game global settings file.

When enabled, the game exposes a current-player adapter surface:

- It uses the current normal player/client already running in the multiplayer session.
- It does not create a hidden player, second browser tab, or special bridge-only game mode.
- It exposes input controls for movement, stop, interaction, and chat text.
- It has exposed output channels for text, location, state, map, feedback, and later visual frames.
- It emits observations only when relevant events occur.
- It accepts commands only through the bridge-controlled interface.

## MetaHuman Agent Requirements

The `environment-bridge` agent:

- Starts only when requested.
- Connects to the exposed current-player adapter.
- Does not poll.
- Does not launch Megameal through special URL parameters.
- Does not create a Megameal player or browser session.
- Does not create a separate local bridge server.
- Receives adapter observations and writes them into the generic environment interface store.
- Triggers or routes data into the Environment Mode graph.
- Reads node-authored actions and sends them back to the exposed current-player adapter.
- Can be stopped or deleted without breaking normal MetaHuman OS operation.

The agent may need connection settings, but those settings are generic:

- adapter id
- host or adapter endpoint
- room/session name
- graph name
- enabled state

The settings should not encode Megameal-specific commands in core.

## Environment Mode Node Workflow

The Environment Mode graph is the center of cognition for this feature.

Generic nodes:

- `environment_connect`: stores/selects generic adapter connection information.
- `environment_bridge_status`: reads bridge/session status.
- `environment_observation`: reads the latest observation.
- `environment_feedback`: reads recent action feedback.
- `environment_map_input`: optional authored map/coordinate context with generic `EnvironmentMapData`.
- `environment_context_builder`: prepares text, state, location, map, visual metadata, feedback, and capabilities for model input.
- `environment_prompt`: optional prompt/template node.
- `environment_action_parser`: turns model output or user movement intent into semantic actions.
- `environment_send_action`: queues movement/interaction/control commands.
- `environment_send_text`: queues chat/speech text.

The graph, not hardcoded bridge code, decides:

- what information goes to the model,
- what instructions frame the model,
- whether a message is treated as conversation or movement intent,
- which actions are sent back.

## Observation Contract

Observation packets separate channels so graph authors can route them independently:

```ts
type EnvironmentObservation = {
  environmentId: string
  adapter: string
  sessionId: string
  timestamp: string
  text?: EnvironmentTextEvent[]
  state?: EnvironmentState
  location?: EnvironmentLocationData
  map?: EnvironmentMapData
  visual?: EnvironmentVisualFrame
  visuals?: EnvironmentVisualFrame[]
  feedback?: EnvironmentFeedback[]
  capabilities: EnvironmentCapabilities
}
```

Text examples:

- Multiplayer chat from another player.
- NPC dialogue.
- Story-note body or interaction prompt.
- System messages from the environment.

State examples:

- Scene or room id.
- Player position and heading.
- Health or energy.
- Active target.
- Nearby interactables.
- Movement/input enabled flags.
- Connected peers.

Visual examples:

- Screenshot URL or base64 image reference.
- Frame dimensions.
- Capture timestamp.
- Camera pose metadata.

Map data must be supplied by an adapter observation or by an explicit graph node. Environment Mode must not ship with baked Megameal maps, room lists, player locations, or scenario data.

## Action Contract

Actions are semantic, not raw keyboard events:

```ts
type EnvironmentAction =
  | { type: "move"; vector?: [number, number, number]; direction?: string; durationMs?: number; speed?: "walk" | "run" }
  | { type: "look"; delta?: [number, number]; target?: [number, number, number] }
  | { type: "jump" }
  | { type: "interact"; targetId?: string }
  | { type: "stop" }
  | { type: "sendText"; text: string; channel?: string }
```

The adapter translates these into its local control surface. A game adapter may turn `move` into touch/keyboard/gamepad values. A robot adapter could turn the same action into a motor command.

## Prompt/Data Flow

Do not push raw game data directly into a user input node as an unstructured blob.

Preferred graph flow:

```text
environment_observation
  -> environment_context_builder
  -> environment_prompt
  -> model_router/persona_llm
  -> environment_action_parser
  -> environment_send_action / environment_send_text
```

The context builder should produce:

- `message`: model-ready text.
- `messages`: model-router compatible messages where supported.
- `context`: structured text, state, location, map, visual, feedback, capabilities, and recent history.
- `images`: future vision-capable frame references.
- `availableActions`: explicit action vocabulary.

## First Testable Goal

The first useful test is:

1. Start Megameal multiplayer server.
2. Start MetaHuman OS.
3. In Megameal editor/global settings, configure the External DEV Bridge settings.
4. Open the Megameal client that should be AI-controlled and join the target multiplayer room normally.
5. Enable the External DEV Bridge for that client/player.
6. Start MetaHuman `environment-bridge` agent.
7. The agent connects to the exposed adapter on that already-open Megameal client.
8. A human player sends chat in the room, such as "how are you?".
9. The adapter emits a text observation.
10. MetaHuman routes that observation into Environment Mode.
11. The graph/model produces one response.
12. The response exits through `environment_send_text`.
13. The agent sends the text action to the adapter.
14. The bridged Megameal player says the response in the room.

Movement test:

1. A human player sends "walk forward ten steps".
2. The observation reaches Environment Mode.
3. The graph/model or movement parser emits a bounded `move` action.
4. The send node validates duration and action type.
5. The agent sends the action to the adapter.
6. The bridged Megameal player moves in the room.

## Implementation Sequence

1. Audit and remove rejected bridge code from MetaHuman and Megameal.
2. Keep Environment Mode canvas and generic environment nodes.
3. Keep or implement generic environment protocol/store only where needed.
4. Keep `environment-bridge` agent as a thin event-driven connector.
5. Implement Megameal External DEV Bridge settings in the editor and global settings file.
6. Implement the Megameal current-player adapter behind that switch.
7. Wire the agent to connect to that current-player adapter.
8. Route observations through the Environment Mode graph.
9. Route graph actions back to the current-player adapter.
10. Add visual frames and richer map support later through the same generic observation contract.

## Current Cleanup Checklist

- Remove MetaHuman-launched special Megameal URL behavior.
- Remove `metahumanBridge` / `bridgeEndpoint` URL parameter plan.
- Remove Megameal-specific map normalization from core environment nodes.
- Remove Megameal-specific adapter defaults from generic node schemas.
- Remove direct game-to-hardcoded-MetaHuman API as the primary architecture.
- Remove stale claims about successful live movement tests until retested under this architecture.
- Keep Environment Mode graph/canvas work.
- Keep generic observation/action contracts.
- Keep the bridge agent, but simplify it to a connector between adapter and nodes.
- Keep start/stop fixes only if they solve stale local agent processes and do not entangle bridge architecture.

## Safety Requirements

- Manual enable switch before accepting external actions.
- Adapter-level command allowlist.
- Node-level action validation.
- Rate limits and maximum action duration.
- `stop` must always be available.
- Unknown action types must be rejected by default.
- Observation packets should avoid private local data and include only environment state.
- Commands must be rejected when gameplay input is disabled or UI is capturing input.

## Open Decisions

- Exact transport between MetaHuman agent and exposed current-player adapter.
- Whether the current-player adapter is controlled through browser-local events, WebSocket, or a multiplayer-native control channel.
- Where user-editable bridge connection settings live on the MetaHuman side.
- What model path will handle visual frames.
- Whether adapter-specific convenience nodes should exist later outside core.

## Recommendation

Build the smallest event-driven loop that proves the separation:

```text
normal Megameal multiplayer room
  <-> External DEV Bridge current-player adapter
  <-> MetaHuman environment-bridge agent
  <-> Environment Mode graph nodes
```

Do not add more bridge policy to unrelated UI, startup scripts, README files, model config, or game engine core. Keep the adapter replaceable and keep the cognitive entry/exit inside the node graph.
