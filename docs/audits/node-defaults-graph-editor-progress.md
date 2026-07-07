# Node Defaults and Graph Editor Progress

This document tracks the systematic conversion of cognitive graph nodes so node
files own reusable defaults, the graph editor can edit those defaults, and saved
workflow JSON persists the full per-node values needed to reproduce a graph.

## Goal

- One node definition per node file remains the source of truth.
- The node registry supplies schemas, defaults, aliases, and executors.
- The graph editor renders controls from `propertySchemas` generically.
- Workflow JSON stores full editable node `properties` for each node instance.
- Prompt-bearing LLM/operator nodes expose prompt defaults as editable text
  properties instead of burying those prompts entirely in runtime code.

## Generic Infrastructure

- [x] Registry schemas are extracted from executable node definitions.
- [x] New node instances materialize full defaults from `properties` and
  `propertySchemas`.
- [x] Loaded graphs merge missing defaults without overwriting saved overrides.
- [x] Saved graphs strip editor-only fields such as embedded schemas and
  execution state.
- [x] Runtime graph execution passes effective defaults plus saved overrides to
  node executors.
- [x] Property inspector supports text, multiline text, number, slider, select,
  multiselect, boolean/toggle, color, JSON, and tags.
- [x] Duplicate registry ID `audit_logger` resolved by renaming the unreachable
  output-layer logger to `output_audit_logger`; existing `audit_logger`
  workflows continue to resolve to the cognitive logger.
- [x] Added `pnpm validate:node-defaults` for registry/default checks and graph
  persistence migration reporting.

## Prompt Conversion Inventory

Status values:

- `done`: prompt defaults are editable properties and runtime uses those values.
- `partial`: node had some editable prompt/config support before this pass, but
  not every prompt path is exposed.
- `pending`: prompt text is still primarily hardcoded in node runtime code.

| Status | Node file | Notes |
| --- | --- | --- |
| done | `active-operator/big-brother-decision.node.ts` | Big Brother decision prompt exposed as `decisionPromptTemplate`; timeout editable. |
| done | `active-operator/decision-engine.node.ts` | Active-operator decision prompt exposed as system/user templates; model/tuning editable. |
| done | `active-operator/unified-decision-llm.node.ts` | Unified decision LLM prompt exposed as system/user templates; local/Big Brother token limits, role, thinking, and temperature editable. |
| done | `agency/desire-alignment-reviewer.node.ts` | Alignment review prompt exposed as `systemPrompt` and `userPromptTemplate`; role/tuning editable. |
| done | `agency/desire-detector.node.ts` | Desire detection prompt exposed as `systemPrompt` and `userPromptTemplate`; role/tuning editable. |
| done | `agency/desire-executor.node.ts` | Per-step operator task prompt exposed as `taskPromptTemplate`. |
| done | `agency/desire-plan-generator.node.ts` | Plan generation prompt exposed as system/user templates plus revision, execution, and milestone context templates. |
| done | `agency/desire-question-generator.node.ts` | Clarifying-question prompt exposed as `promptTemplate`; role/tuning editable; definition normalized to current node shape. |
| done | `agency/desire-safety-reviewer.node.ts` | Safety review prompt exposed as `systemPrompt` and `userPromptTemplate`; role/tuning editable. |
| done | `agency/outcome-reviewer.node.ts` | Outcome review prompt exposed as `systemPrompt` and `userPromptTemplate`; role/tuning editable. |
| done | `agent/llm-enricher.node.ts` | Enrichment prompt exposed as `systemPrompt` and `promptTemplate`; LLM role/tuning editable. |
| done | `cognitive/quality-scorer.node.ts` | Quality scoring prompt exposed as `systemPrompt` and `userPromptTemplate`. |
| done | `curator/curator-llm.node.ts` | Memory curation prompt exposed as system/user templates; role/tuning editable. |
| done | `curiosity/curiosity-question-generator.node.ts` | Curiosity prompt exposed as `systemPrompt` and `userPromptTemplate`. |
| done | `dreamer/daydreamer-generator.node.ts` | Daydream prompt exposed as `systemPrompt` and `userPromptTemplate`; max tokens editable. |
| done | `dreamer/dreamer-continuation-generator.node.ts` | Continuation prompt exposed as `systemPrompt` and `userPromptTemplate`; role/max tokens editable. |
| done | `dreamer/dreamer-dream-generator.node.ts` | Dream generation prompt exposed as `systemPrompt` and `userPromptTemplate`. |
| done | `dreamer/dreamer-learnings-extractor.node.ts` | Learnings extraction prompt exposed as `systemPrompt` and `userPromptTemplate`. |
| done | `environment/context-builder.node.ts` | Context-builder prompt is schema-backed as editable `systemPrompt`; no hidden LLM call path in this node. |
| done | `llm/orchestrator-llm.node.ts` | Intent routing prompt exposed as `systemPrompt` and `userPromptTemplate`; temperature/maxTokens editable. |
| done | `llm/persona-llm.node.ts` | System prompt assembly exposed as `systemPromptTemplate`; fallback prompt, role, repeat penalty editable. |
| done | `llm/reflector-llm.node.ts` | Reflection fallback and summarizer prompts exposed as editable prompt properties. |
| done | `memory/search-interpreter.node.ts` | Search interpretation prompt exposed as `systemPrompt` and `userPromptTemplate`. |
| done | `operator/big-brother-executor.node.ts` | Skill escalation prompt and timeout exposed as editable properties. |
| done | `operator/claude-full-task.node.ts` | Full-task operator prompt exposed as `fullTaskPromptTemplate`. |
| done | `operator/react-planner.node.ts` | ReAct planning, search guidance, and LLM tuning exposed as editable properties. |
| done | `operator/response-synthesizer.node.ts` | Context, persona, delegated-work, unknown-memory, and scratchpad synthesis prompt paths exposed as editable templates; repeated LLM tuning values editable. |
| done | `response/response-llm.node.ts` | Card instruction map, Big Brother prompt, fallback prompts, timeout, and local LLM tuning exposed as editable properties. |
| done | `thought/thought-aggregator.node.ts` | Thought aggregation prompt exposed as system/user templates; LLM role/tuning editable. |
| done | `thought/thought-generator.node.ts` | Thought generation prompt exposed as system/user templates; LLM role/tuning editable. |

## Current Pass Notes

- 2026-07-07: Started registry/default/property-editor/persistence pass.
- 2026-07-07: Confirmed current graph editor already had a property inspector,
  but it only supported a subset of core property types.
- 2026-07-07: Confirmed `/api/node-schemas` was still using a duplicated static
  schema file; active work routes it through the executable node registry.
- 2026-07-07: Converted first prompt batch: orchestrator, search interpreter,
  quality scorer, curiosity question generator, and dream generator.
- 2026-07-07: Converted second prompt batch: daydream generator, dream
  continuation generator, dream learnings extractor, thought generator, thought
  aggregator, LLM enricher, persona LLM, and reflector LLM. Verified
  environment context builder already uses an editable `systemPrompt` property.
- 2026-07-07: Converted curator/agency batch: curator LLM, desire question
  generator, desire safety reviewer, and outcome reviewer.
- 2026-07-07: Converted remaining agency batch: desire detector, desire
  alignment reviewer, desire plan generator, and desire executor.
- 2026-07-07: Converted active-operator batch part 1: Big Brother decision and
  active-operator decision engine. Left unified decision LLM pending for a
  dedicated pass because its decision prompt is much larger and more behavior
  sensitive.
- 2026-07-07: Converted remaining active-operator/operator/response batch:
  unified decision LLM, Big Brother executor, Claude full task, ReAct planner,
  response LLM, and response synthesizer.
- 2026-07-07: `pnpm validate:node-defaults` passed the registry/default checks
  and initially reported 79 existing graph JSON editor-only fields as migration
  debt. That follow-up cleanup is tracked in
  `docs/audits/graph-json-persistence-migration.md`.

## Validation Log

- 2026-07-07: `git diff --check` passed.
- 2026-07-07: `pnpm validate:node-defaults` passed after resolving the
  duplicate `audit_logger` registry ID. The command reports current graph JSON
  migration debt but does not fail until run with `--strict-graphs`.
- 2026-07-07: `pnpm --dir apps/site build` passed with existing Svelte/Vite
  warnings.
- 2026-07-07: `pnpm -s exec tsc --noEmit --project packages/core/tsconfig.json
  --pretty false` remains red due existing broad core TypeScript debt outside
  this node-defaults pass.
- 2026-07-07: After the second prompt batch, `git diff --check` passed,
  `pnpm validate:node-defaults` passed with the same 79-field graph JSON
  migration-debt warning, and `pnpm --dir apps/site build` passed with existing
  Svelte/Vite warnings.
- 2026-07-07: After the curator/agency batch, `git diff --check` passed,
  `pnpm validate:node-defaults` passed with the same 79-field graph JSON
  migration-debt warning, and `pnpm --dir apps/site build` passed with existing
  Svelte/Vite warnings.
- 2026-07-07: After the remaining agency batch, `git diff --check` passed,
  `pnpm validate:node-defaults` passed with the same 79-field graph JSON
  migration-debt warning, and `pnpm --dir apps/site build` passed with existing
  Svelte/Vite warnings.
- 2026-07-07: After active-operator batch part 1, `git diff --check` passed,
  `pnpm validate:node-defaults` passed with the same 79-field graph JSON
  migration-debt warning, and `pnpm --dir apps/site build` passed with existing
  Svelte/Vite warnings.
- 2026-07-07: After the remaining active-operator/operator/response batch,
  `git diff --check` passed, `pnpm validate:node-defaults` passed with the same
  79-field graph JSON migration-debt warning, and `pnpm --dir apps/site build`
  passed with existing Svelte/Vite warnings.
- 2026-07-07: After graph JSON persistence migration, direct scan found 0
  remaining persisted editor/runtime-only fields and
  `pnpm validate:node-defaults -- --strict-graphs` passed.
