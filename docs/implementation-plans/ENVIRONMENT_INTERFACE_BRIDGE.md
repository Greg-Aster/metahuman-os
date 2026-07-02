# Environment Interface Bridge Plan

Status: initial implementation in progress; MetaHuman mode/graph entry point wired
Scope: architecture planning for connecting MetaHuman OS cognitive graphs to external environments such as `apps/game.megameal`.

## Goal

MetaHuman OS should be able to observe an environment, reason over that observation, and send bounded actions back to the environment without hardcoding the cognitive graph to one game or one control scheme.

The first target environment is Megameal, but the interface must stay generic enough to support a different game, simulator, robot, desktop surface, or physical device later.

## Core Design

Use a generic environment-interface layer in MetaHuman and environment-specific adapters at the edge.

```text
Environment adapter
  -> observations, text, visual frames, status, feedback
  -> MetaHuman environment interface nodes
  -> cognitive graph
  -> action/text outputs
  -> environment adapter
```

Megameal should be one adapter, not the root abstraction.

## Ownership Boundaries

MetaHuman owns:

- The optional environment bridge agent that talks to external environments.
- Generic environment protocol types.
- Generic bridge storage/queueing for observations, actions, and feedback.
- Environment interface node implementations.
- Prompt/data preparation nodes.
- Connection configuration for environment URL, room, session, and adapter type.
- Cognitive graph templates that wire observations into reasoning and actions.
- The node graph entry and exit points for environment interaction.
- Adapter translation from neutral external controls/snapshots into generic environment observations/actions.

Megameal owns:

- Runtime state, gameplay meaning, HUD state, input semantics, and multiplayer session behavior.
- The smallest neutral control/snapshot surface needed by an external bridge agent.
- Rejecting neutral control calls when game input is disabled, UI is capturing input, or external control is not manually enabled.
- No MetaHuman URLs, prompt logic, graph policy, authored map data, cognitive concepts, or environment adapter policy.

The generic MetaHuman environment layer must not import from `apps/game.megameal`. A Megameal adapter may know the neutral Megameal dev-control surface, but that adapter should live in MetaHuman's bridge-agent side or a standalone integration package.

Environment Mode must not hardcode environment data, sample room data, player state, or Megameal-specific content. Data enters through an adapter observation and becomes usable by the cognitive system through `environment_observation`. Decisions leave the cognitive system through `environment_send_action` and `environment_send_text`.

## Recommended Folder Shape

MetaHuman:

```text
packages/core/src/environment-interface/
  protocol.ts
  connections.ts
  prompt-context.ts

brain/agents/environment-bridge/
  core.ts
  cli.ts
  adapters/
    megameal-local.ts

packages/core/src/nodes/environment/
  environment-connect.node.ts
  environment-observation.node.ts
  environment-context-builder.node.ts
  environment-action-parser.node.ts
  environment-send-action.node.ts
  environment-send-text.node.ts

docs/implementation-plans/ENVIRONMENT_INTERFACE_BRIDGE.md
```

Megameal, only if needed:

```text
apps/game.megameal/src/app/gameDevBridge.ts
```

The Megameal side should stay a narrow app/runtime control surface. It should not push MetaHuman concepts into engine core, and it should not contain MetaHuman URLs, prompt logic, map data, graph policy, or environment adapter policy.

## Node Family

Use a dedicated node category such as `environment` or `interface`. This will require updating both runtime node definitions and the browser-safe node schema list.

Proposed generic nodes:

- `environment_connect`: opens or selects an environment session using adapter type, URL, room, and identity.
- `environment_bridge_status`: reads bridge/session status for graph routing.
- `environment_observation`: reads the latest observation packet.
- `environment_feedback`: reads recent adapter/action feedback.
- `environment_map_input`: supplies optional graph-authored map and coordinate context when an adapter does not publish map data yet.
- `environment_context_builder`: prepares text, state, visual metadata, and available actions into an LLM-ready context object.
- `environment_prompt`: optional template node specialized for environment prompts. This can reuse the existing `text_template` idea but should understand multimodal context.
- `environment_action_parser`: turns model output into typed actions, text responses, or no-op decisions.
- `environment_send_action`: sends movement/interaction/control commands.
- `environment_send_text`: sends chat or speech text back to the environment.

The send nodes are the cognitive egress boundary. They must validate action type, allowed action set, and duration bounds before anything reaches an adapter queue.

Adapter-specific nodes should be thin convenience nodes:

- `megameal_connect`: presets adapter type and Megameal connection fields.
- `megameal_observation`: optional convenience wrapper over `environment_observation`.
- `megameal_send_action`: optional wrapper only if Megameal action affordances need custom UI.

Prefer generic nodes first. Add Megameal-specific nodes only where the graph editor benefits from fewer knobs or clearer labels.

## Environment Observation Contract

Observation packets should separate channels so graph authors can route them independently.

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
- Camera pose metadata when available.

Location and map examples:

- Current coordinates and heading.
- Current room, area, or region label.
- Coordinate system name.
- Map bounds, landmarks, regions, paths, or navigation notes.
- Adapter-provided map data or graph-authored temporary map data.

Map data must be supplied by an adapter observation or by an explicit graph node such as `environment_map_input`. Environment Mode must not ship with a baked map, room list, player location, Megameal content, or other scenario data.

Feedback examples:

- Command accepted or rejected.
- Action succeeded or failed.
- Path blocked.
- Interaction opened a dialogue.
- Player appears stuck.

## Action Contract

Actions should be semantic, not raw keyboard events.

```ts
type EnvironmentAction =
  | { type: "move"; vector: [number, number, number]; durationMs: number; speed?: "walk" | "run" }
  | { type: "look"; delta?: [number, number]; target?: [number, number, number] }
  | { type: "jump" }
  | { type: "interact"; targetId?: string }
  | { type: "stop" }
  | { type: "sendText"; text: string; channel?: string }
```

This keeps the cognitive graph portable. A game adapter can translate `move` into gameplay commands. A robot adapter could translate the same command into a motor-controller request.

## Prompt/Data Preparation

Do not push all raw game data into `user_input` directly.

Recommended flow:

```text
environment_observation
  -> environment_context_builder
  -> environment_prompt
  -> user_input or model_router/persona_llm
  -> environment_action_parser
  -> environment_send_action / environment_send_text
```

The context builder should produce:

- `message`: the user-like prompt text for ordinary LLM nodes.
- `context`: structured object containing text, state, location, map, visual, feedback, capabilities, and recent history.
- `images`: optional visual frames for future vision-capable model nodes.
- `availableActions`: explicit action vocabulary for the parser and model prompt.

The first version can use text-only prompts and image metadata. Vision frames can be added once the active model path supports image inputs end to end.

The workflow itself should be authored in the graph canvas. The mode and node system provide the reusable building blocks; they should not ship with baked-in scenario data.

## Megameal Feasibility Notes

Current Megameal already has useful seams:

- Multiplayer has room join/host configuration and chat messages.
- Multiplayer session snapshots expose connected peers, remote players, room name, logs, chat, and local peer id.
- Runtime HUD state already includes player position, health, movement/input flags, charging, active portal, story-note, NPC, open story-note, and open NPC dialogue.
- `gameDevBridge` already proves that the browser game can publish runtime snapshots and accept a small command set in dev mode.
- The first game-side implementation should extend `gameDevBridge` as a neutral dev-control surface, not add a MetaHuman-specific `environmentBridge` to `GameClient.svelte`.

Current gaps:

- The multiplayer wire protocol currently handles pose replication, full-state replication, and chat. It does not accept semantic control commands for the local player.
- `gameDevBridge` is dev-only and currently supports runtime-scene loading and collision overlay diagnostics. It should expose only a minimal neutral control/snapshot surface needed by an external bridge agent.
- Visual frames are not yet exposed as an owned API. A screenshot bridge would need an intentional capture path from the game canvas or renderer, but the capture request and routing policy should live in the MetaHuman bridge agent.
- Megameal currently exposes little neutral state beyond location. Until a visual capture path exists, a temporary authored map can be attached in the MetaHuman graph through `environment_map_input` and combined with coordinates by `environment_context_builder`.
- MetaHuman nodes currently use a fixed `NodeCategory` union and a separate browser-safe schema list, so a new interface category requires both runtime and schema updates.

## Megameal Bridge Options

Option A: Browser local bridge first.

- Use a MetaHuman-owned bridge agent to communicate with an already-open Megameal browser tab through a neutral browser-local control/snapshot surface.
- Lowest risk for the first prototype.
- Good for local exploration with a visible browser.
- Not enough for remote headless operation by itself.

Option B: Extend Megameal multiplayer channels.

- Add environment-agent channel messages alongside multiplayer chat/pose.
- Lets MetaHuman join by room name and URL.
- Larger Megameal-side change; defer unless local bridge is insufficient.
- Better long-term match for multiplayer exploration.

Option C: Dedicated game agent endpoint.

- Megameal exposes a narrow HTTP/WebSocket endpoint for observation and commands.
- Cleanest external API shape.
- More game-side implementation than Option A.

Recommended sequence: A for proof. Treat B or C as later transport replacements only if the local bridge proves inadequate.

Implementation boundary update:

- MetaHuman owns the environment bridge agent, store, HTTP endpoints, node category, prompt/data prep, action parsing, adapter configuration, and all environment data routing.
- Megameal exposes only neutral dev bridge commands such as snapshot, chat, touch action value, touch clear, runtime scene load, diagnostics toggles, and later screenshot capture if needed.
- A Megameal adapter translates neutral Megameal snapshots/commands into generic `EnvironmentObservation` and `EnvironmentAction` values. That adapter lives on the MetaHuman side or in a standalone integration package, not inside Megameal core.
- The bridge agent can be stopped or removed without changing the Megameal runtime or the core cognitive graph system.
- The cognitive interface entry and exit points are the environment nodes. No prompt, map, gameplay interpretation, room data, or action policy should bypass those nodes.

## Safety Requirements

- Manual enable switch on the neutral game control surface before accepting external actions.
- Adapter-level command allowlist.
- Rate limits and maximum action duration.
- `stop` command must be always available.
- Action parser must reject unknown commands by default.
- Send nodes must reject unknown action types and reject unbounded movement/look actions unless the workflow explicitly sets a default duration.
- Observation packets should avoid private local data and include only environment state.
- Neutral game control methods should reject commands when gameplay input is disabled or UI is capturing input.

## First Implementation Packet

Build a text/state-only proof without vision.

MetaHuman:

1. Add generic environment protocol types.
2. Add `environment_context_builder` and `environment_action_parser` nodes.
3. Add browser-safe schemas for those nodes.
4. Add a simple Megameal adapter stub that can be pointed at a local bridge URL/session.
5. Add a sample graph template.

Megameal:

1. Expose only the minimum neutral snapshot and control methods needed by an external bridge agent.
2. Keep those methods free of MetaHuman URLs, prompt logic, graph policy, map data, and cognitive concepts.
3. Support `sendText`, `stop`, and short movement control methods first.
4. Return neutral success/failure results from those methods.

MetaHuman bridge agent:

1. Read neutral Megameal snapshots and publish generic observations into the environment bridge store.
2. Claim queued node-authored actions and translate them into neutral Megameal control calls.
3. Write adapter feedback back into the environment bridge store.
4. Stay optional: when the agent is off or removed, Megameal and the MetaHuman node graph system continue normally.

Validation should prove that MetaHuman can:

- Receive text from a neutral Megameal snapshot through the MetaHuman bridge agent.
- Build a prompt from state and text.
- Produce a structured no-op, text response, or movement action.
- Queue text or bounded movement through environment nodes.
- Have the MetaHuman bridge agent translate queued actions to Megameal controls.

## MetaHuman Progress - 2026-07-02

Completed as the first cognitive-system entry point:

- Added `environment` as a first-class cognitive mode alongside `dual`, `agent`, and `emulation`.
- Added `Environment Mode` to the main chat mode list through the existing cognitive-mode API.
- Added `etc/cognitive-graphs/environment-mode.json` as the initial editable graph template.
- Added Environment Mode to graph validation and built-in template handling.
- Added Environment Mode to the flow editor's cognitive mode template list so another agent can open and revise the graph directly.
- Updated mode-aware TypeScript contracts across cognitive graph schema, node execution context, memory metadata, security policy, environment config, trust coupling, and cognitive layer defaults.
- Kept the implementation generic: no imports from `apps/game.megameal`, no hardcoded room/player data, and no Megameal-specific graph nodes.

The current Environment Mode graph is intentionally rudimentary:

```text
user_input
environment_observation
environment_map_input
  -> environment_context_builder
  -> model_router
  -> thinking_stripper
  -> stream_writer
  -> environment_action_parser
  -> environment_send_action
```

Runtime behavior:

- `environment_observation` reads the latest environment observation from the generic bridge store.
- `environment_map_input` can provide optional graph-authored map or coordinate context without hardcoding environment data into the mode.
- `environment_context_builder` combines observation state, location, map, visual metadata, and optional user instruction into prompt-ready model messages.
- `model_router` generates the response using the normal persona model path.
- `stream_writer` sends the response back to the main chat interface.
- `environment_action_parser` accepts known semantic action types and treats plain text as `sendText` when fallback is enabled.
- `environment_send_action` queues parsed actions for the environment adapter.

Supporting compatibility patches:

- `environment_observation` now exposes `sessionId` so downstream parser/send nodes can target the active session.
- `environment_observation` now exposes `location`, `map`, `visual`, and `visuals` as separately routable outputs.
- `environment_context_builder` now exposes `messages`, `location`, and `map` so it can feed `model_router` directly while still letting the graph route structured data.
- `environment_map_input` is available as a blank graph-authored map/location node for temporary navigation context when an adapter does not publish map data yet.
- Browser-safe node schemas were updated for the environment node outputs.
- `model_router` now accepts named `messages` and `role` inputs from Svelte Flow graphs.

Validated:

- `git diff --check`
- `pnpm validate:graphs`
- `pnpm audit:graph-executors -- --fail-on-missing`
- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`
- `pnpm --dir apps/site build`

Known remaining hardening:

- `environment_send_action` now enforces action allowlists and maximum/default duration policy before queueing actions; per-session adapter policy is still a later hardening layer.
- `environment_send_text` is available as a node but is not used directly in the initial graph because plain text currently flows through `environment_action_parser` as a `sendText` action.
- `environment_connect` is still planned. `environment_bridge_status` and `environment_feedback` exist but are not dependencies of the initial graph.
- The MetaHuman bridge agent still needs to read neutral Megameal snapshots, publish generic observations, claim queued node-authored actions, call neutral Megameal controls, and write feedback.

## Open Decisions

- Should the first bridge be same-browser BroadcastChannel or cross-process WebSocket?
- Should Megameal actions be available only to a connected multiplayer peer, or can MetaHuman control the local browser player directly?
- What model path will handle images, and what message shape should carry them through the graph?
- Should environment session configuration live in user profile config, graph node properties, or both?
- Should the generic category be named `environment`, `interface`, or `embodiment`?

## Recommendation

Use generic environment interface nodes as the stable layer and make Megameal a replaceable adapter. Do not wire Megameal-specific controls directly into core cognitive nodes.

For the first practical prototype, use a visible local Megameal tab with the smallest neutral control/snapshot surface possible. The MetaHuman bridge agent should read that surface, publish observations to the node system, claim node-authored actions, and call Megameal controls. Once that works, decide whether a room-based or WebSocket transport is worth the extra Megameal-side code, then add visual frames.
