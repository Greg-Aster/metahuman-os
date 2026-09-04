# Agent Graph Bypass Repair Record

Date: 2026-09-03

## Scope and decision

This record covers maintained finite agents and model-backed product operations
that could perform cognition outside the editable cognitive-graph runtime.

The repair is structural. It does not add another scheduler, registry, execution
classification framework, feature flag, compatibility path, or runtime fallback.
Core Work Coordinator remains the sole finite-work admission owner, the existing
graph runtime remains the cognition executor, and existing domain services remain
the owners of persistence and external effects.

## Root cause

Trigger Manager and Work Coordinator correctly owned admission, but a finite
agent executable was historically free to call model transport and implement its
own prompts, parsing, branching, and effects. `packages/agent-runtime` also still
contained an unused loader, mutable registry, runtime, and two executors that
duplicated concepts already owned by Core.

That allowed Inner Curiosity and several other retained features to perform
model-backed work in TypeScript before or instead of executing a graph.

## Canonical architecture after repair

The maintained path is:

1. Trigger Manager, an authenticated API/CLI request, or an owning workflow
   admits finite work to Core Work Coordinator.
2. The existing coordinator handler or bounded Brain adapter resolves the
   authenticated profile and loads its canonical cognitive graph.
3. Registered nodes own prompts, model calls, parsing, and graph-visible
   branching.
4. Existing domain owners perform durable writes and external effects through
   their narrow contracts.
5. Node or graph failures remain failures; removed paths are not retained as
   hidden fallbacks.

Not every process is a cognitive graph. Persistent transports, model-provider
transport, embeddings, deterministic storage and validation, ingestion, profile
sync, and the coordinator itself remain ordinary code. They do not make an
agentic/model decision and are not competing cognition executors.

## Removed alternate and orphan paths

The unused alternate Agent Runtime execution system was deleted:

- `packages/agent-runtime/src/loader.ts`
- `packages/agent-runtime/src/registry.ts`
- `packages/agent-runtime/src/runtime.ts`
- `packages/agent-runtime/src/executors/interface.ts`
- `packages/agent-runtime/src/executors/mobile-inproc.ts`
- `packages/agent-runtime/src/executors/web-process.ts`

The package now contains only the shared finite-agent TypeScript contracts used
by Brain and the maintained mobile adapter. Its ignored `dist` directory was
cleaned and rebuilt so removed executors are not left as runnable compiled
artifacts.

Static export and caller review also confirmed and removed these unused Core
model/reasoning paths and their public exports:

- `packages/core/src/graph-error-handler.ts`
- `packages/core/src/specialist-broker.ts`
- `packages/core/src/intelligent-memory-retrieval.ts`
- `packages/core/src/reasoning/`

The unused Active Operator `triggerBigBrotherHealing()` wrapper was removed with
its types and exports. Active Operator self-healing now has one graph-backed
analysis path rather than a second escalation wrapper.

## Retained Brain agents migrated to graphs

- Audio Organizer: `audio-organizer.json` owns transcript enrichment and typed
  graph results; the Brain adapter retains bounded file selection and uses the
  existing memory owner for capture.
- Curiosity Researcher: `curiosity-researcher.json` owns research-topic and
  grounded finding generation; its distinct background-research purpose remains.
- Desire Generator: `desire-generator.json` owns candidate generation and
  reinforcement decisions; Core Agency storage remains canonical.
- Desire Planner: `desire-planner.json` owns feasibility, clarification, plan
  generation, validation, and persistence transitions. The formerly public
  direct-model `generateQuestions()` helper was removed; only the registered
  question node calls model transport.
- Psychoanalyzer: `psychoanalyzer.json` owns evidence-to-proposal model analysis;
  Persona Learning remains the sole validator and writer.
- Inner Curiosity: `inner-curiosity.json` owns the complete question, answer,
  related-memory, persistence, and optional Train of Thought flow.

Their Brain cores no longer import or call model transport.

## Retained Core product flows migrated to graphs

- Desire Check-in: `desire-checkin.json`
- Project reflection task suggestions: `reflection-task-suggestions.json`
- Persona transcript extraction: `persona-extraction.json`
- Persona interview question generation: `persona-interview-question.json`
- Preference learning and contradiction decisions: `preference-learning.json`
- Weekly goal review insights: `goal-review.json`
- Active Operator self-healing analysis: `self-healing-analysis.json`
- Semantic turn classification: `semantic-turn.json`

The existing API, Work Coordinator, storage, and domain owners remain in place;
only model-backed cognition and its validation moved into registered nodes.
Malformed model output and graph failure are explicit failures rather than
fabricated success or silent empty results.

## Paths intentionally retained outside graphs

- `packages/core/src/model-router.ts`, provider bridges, and backend managers are
  the model transport used by graph nodes.
- The authenticated model warmup handler performs infrastructure health/warmup,
  not a product cognitive decision.
- Embedding generation and vector-index operations are search infrastructure.
- Big Brother and remote-dispatch transports invoke explicitly selected external
  execution providers; they are governed by their own documented ownership
  boundary and are not an implicit finite-agent cognition fallback.
- `brain/agents/environment-bridge` is a persistent transport service.
- `brain/agents/ingestor` and `brain/agents/profile-sync` are deterministic
  finite workers over canonical Core storage/network contracts.
- Desire Executor and Desire Outcome Reviewer Brain adapters delegate to Core
  services whose retained execution paths run `desire-executor.json` and
  `outcome-reviewer.json`.
- Sleep Workflow is a bounded coordinator-owned composite. Its model-backed
  children run their own graphs; Sleep itself does not make model decisions.

## Source evidence

- A maintained-source search for `callLLM`, `callLLMPrompt`, and `callLLMText`
  now finds product model calls only in registered node implementations. Outside
  nodes it finds the canonical model router and authenticated warmup transport.
- A separate import search finds no Brain agent importing model router,
  provider bridge, or backend transport.
- Searches for the removed runtime classes and orphan Core exports find no live
  maintained caller; remaining mentions are historical records.
- All 40 cognitive-graph JSON files resolve registered nodes and pass graph
  validation.

## Validation and limitations

Passed during this repair:

- Agent Runtime package build after cleaning stale compiled outputs.
- Focused unit tests for migrated parsing/node contracts and affected Brain
  adapters, including Desire Planner, Desire Check-in, task suggestions,
  preference learning, goal review, self-healing, semantic turns, and both
  persona flows.
- Core, Brain, Agent Runtime, and CLI typechecks.
- Cognitive-graph validation and the maintained-source architecture guardrail.
- The complete root `pnpm build` chain, including all package typechecks, root
  tests and validators, user-agnostic checks, and the Site production build.

No live model backend, Trigger Manager schedule, queued production job, browser,
mobile bundle, external provider, or physical device was exercised. The proof is
source, focused unit, type, package-build, and graph-validation evidence—not live
runtime or hardware evidence.
