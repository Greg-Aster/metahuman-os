# Conversation Graph Flow Refactor

Date: 2026-07-02

## Owner

Core graph runtime and chat/graph API flow.

## Summary

Conversation and graph execution now route through a shared `graph-runtime` helper layer instead of each maintained caller invoking `executeGraph` directly. The shared layer centralizes graph execution calls, output extraction, TTS output extraction, node-output collection, failed-node collection, SSE formatting helpers, and report-only executor coverage utilities.

## Boundary Notes

- `executeGraph` remains the low-level engine.
- `runGraph` is the maintained caller-facing graph execution helper.
- `graph-streaming` now owns graph loading/cache and cancellation only.
- Chat, response pipeline, graph editor execution, agency execution/review, active-operator lizard-brain execution, agent templates, and graph-based brain agents call `runGraph`.
- Missing node executor handling was not changed at runtime. The new `pnpm audit:graph-executors` command reports graph-node executor coverage without adding startup or request-time stop behavior.
- Executor coverage gaps found by the audit were closed with registry-compatible runtime coverage only: `cot_stripper` aliases to `thinking_stripper`, and the existing `conditional` / `result_aggregator` graph node IDs now have small compatibility executors.

## Cleanup Notes

- Removed the unused exported `streamGraphExecution` path from `graph-streaming.ts`; maintained-source search found no caller outside that same file.
- Reduced duplicated client-side request construction and EventSource cleanup in `ChatInterface.svelte` with browser-safe helpers in `conversation-transport.ts`.
- Removed misleading legacy-vs-graph wording from the graph regression script and System Settings chat copy.
- Existing public routes and response shapes are intended to remain stable.
- `pnpm audit:graph-executors` now checks 19 maintained graph files and reports 0 missing executors.

## Deferred Cleanup

- `apps/site/src/utils/node-pipeline.ts` duplicates core node-pipeline runtime helpers and appears unused by maintained source, but it was left in place for a later route/settings cleanup pass because it is adjacent to settings UI ownership rather than the conversation runner itself.

## Validation Targets

- `pnpm validate:graphs`
- `pnpm audit:graph-executors`
- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`
- `pnpm --dir apps/site build`
- focused API smoke tests for `/api/persona_chat`, `/api/response-pipeline`, and `/api/execute-graph-stream`

## Validation Results

- `git diff --check`: passed.
- `pnpm validate:graphs`: passed; 19 valid graphs, 0 invalid.
- `pnpm audit:graph-executors -- --fail-on-missing`: passed; 203 graph nodes checked, 0 missing executors.
- `pnpm -s exec tsx scripts/check-architecture.ts --fail-on-stale-baseline`: passed; 0 current architecture violations.
- `pnpm --dir apps/site build`: passed. Existing Svelte accessibility warnings and Rollup chunk/circular export warnings remain.
- `pnpm -s exec tsc --noEmit --project packages/core/tsconfig.json --pretty false`: failed on existing broad TypeScript debt across connectors, event bus, persona/agency nodes, and duplicate exports; no new compatibility-node errors were reported.
- `pnpm -s exec tsc --noEmit --project apps/site/tsconfig.json --pretty false`: failed on existing generated Astro/types, card component typings, local-memory typings, dependency type issues, and the same core TypeScript debt; the site build still passed.
