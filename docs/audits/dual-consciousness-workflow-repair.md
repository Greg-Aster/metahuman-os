# Dual Consciousness Workflow Repair

Date: 2026-07-17

## Scope

This audit covers the maintained Dual Consciousness chat graph, its graph-runtime
loop behavior, and the node contracts directly exercised by that graph. It does
not refactor Agent mode, the Active Operator, or legacy `apps/code-oss` code.

## Authority And Runtime Path

- Canonical server graph: `etc/cognitive-graphs/dual-mode.json`.
- Normal conversation work reaches `handlePersonaChat`, resolves the `dual`
  graph through `loadGraphForMode`, and executes it through the shared core graph
  runtime.
- No `etc/cognitive-graphs/custom/dual-mode.json` override existed at review
  time.

## Findings Before Repair

1. Safety results used `safe`, `score`, and `issues`, while the feedback router
   expected `passed`, `violations`, and a top-level `severity`. Unsafe results
   therefore defaulted to passing at the output gate.
2. The graph sent only the orchestrator's `needsMemory` boolean to Smart Router,
   while Smart Router read only a positional input that the executor does not
   populate. Memory search consequently defaulted on for every message.
3. The graph advertised a ReAct/operator route but contained no working ReAct or
   skill-execution subgraph. Dual mode is defined by the maintained cognitive-mode
   contract as deep mirroring, recording, and learning; explicit command execution
   belongs to Agent mode.
4. Persona Loader targeted an undeclared `personaData` formatter input, and the
   formatted persona output never reached Response Synthesizer. Quality scoring
   received persona data, but response generation did not.
5. The feedback back-edge restarted orchestration, memory search, and memory
   interpretation for wording-only retries. The executor also allowed the old
   output tail to remain queued before the feedback router re-evaluated the retry.
6. Audit Logger received undeclared `details` and `eventType` inputs, producing
   generic audit events with undefined data.
7. The runtime graph contained editor/debug/test nodes and undeclared or unused
   properties. Web and mobile graph copies used older incompatible graph formats.
8. Existing validation proved JSON shape, cycle allowance, and executor presence,
   but did not verify edge handles or the Dual graph's safety/persona/loop
   contracts.

## Repair Contract

- Dual mode remains a memory-grounded, persona-aware conversational mirror with
  full conversation recording and refinement.
- Orchestrator emits one typed analysis object. Smart Router converts that object
  into explicit memory hints; Memory Router performs no search when memory is not
  requested.
- Persona data reaches Context Builder and Quality Scorer, while formatted persona
  text reaches Response Synthesizer.
- Safety uses one compatible `safe` result contract from validation through the
  feedback gate. An unsafe response is never emitted merely because refinement
  reached its iteration limit.
- Refinement re-runs only context assembly, response synthesis, quality, safety,
  and response refinement. Memory search and interpretation stay stable for the
  turn.
- Streaming, memory capture, buffer persistence, TTS, and audit logging run only
  after the output gate opens.
- The canonical graph contains runtime nodes only. Web/mobile copies are generated
  from the canonical Svelte Flow graph rather than maintained as divergent legacy
  definitions.
- A focused executable contract test validates handles, executor coverage,
  persona wiring, safety behavior, loop scope, and final side-effect placement.

## Validation Record

- `pnpm exec tsx tests/dual-mode-graph.spec.ts`: passed. Covers registered handles/properties, memory
  skip semantics, persona wiring, safety fail-closed behavior, bounded retries,
  accepted-output placement, queue scheduling, and web/mobile artifact parity.
- `pnpm validate:graphs`: passed for all 21 canonical graphs. Dual mode also
  passed the new strict registered-node contract and artifact-drift checks.
- `pnpm exec tsx scripts/validate-node-defaults.ts --strict-graphs`: passed.
- `pnpm exec tsx scripts/audit-graph-executors.ts`: passed for 205 nodes across 21 graphs with no
  missing executors.
- `pnpm check:architecture`: passed with zero current violations.
- `pnpm build`: passed, including graph validation, TTS ownership validation,
  and the Astro production build. Existing Svelte accessibility and bundle
  warnings remain outside this repair scope.
- `pnpm typecheck:core`: remains blocked by the repository's existing TypeScript
  backlog in unrelated modules and unchanged lines. The compiler reported no
  error on a line changed by this repair.
