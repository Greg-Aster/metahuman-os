# Reactive Operator Refactor – Verification & Cleanup Plan

## 1. Functional Verification
1. **Unit-level sanity**
   - `pnpm test skills` (or manual `node brain/skills/task_list.spec.ts` once added) to ensure manifests still load.
   - Run `node ./brain/agents/operator-react.ts --dry-run "list tasks"` to inspect the scratchpad and confirm:
     - JSON planner output includes `thought`, optional `action`, optional `respond`.
     - Tool catalog text is injected (look for `Skill: task_list` in the prompt log).

2. **End-to-end scenarios**
   - **Task listing:** Ask “What’s on my task list?” – expect a strict, verbatim reply with title/status/priority lines and *no* extra commentary. Verify no `conversational_response` call occurs (check `/logs/run/agents/operator-react.log`).
   - **Multi-tool reasoning:** Prompt “Find unfinished tasks and rename the one about April.” Ensure planner chains `task_list → task_update_status` (or equivalent). Confirm retries if the rename fails (delete/rename file to trigger error).
   - **Error recovery:** Intentionally break a skill (e.g., `chmod 000 memory/tasks/active`). The loop should surface the error message and try an alternative or ask the user for guidance instead of failing silently.

3. **Model routing**
   - Confirm planning calls hit `default.coder` (see `llm_call` logs) while final conversational responses use persona/fallback depending on `responseStyle`.
   - Toggle `operator.reactV2` flag off and on to ensure both paths still work.

4. **Performance**
   - Measure latency before/after with `time ./bin/mh chat "list tasks"`; ensure the new loop stays within acceptable bounds (<3x previous).
   - Verify scratchpad is trimmed: after 20+ steps the prompt shouldn’t exceed configured token limits.

## 2. UI / UX Checks
1. Status widget shows real-time model assignments; verify role dropdowns still function with the new planner pipeline active.
2. Verify audit stream entries now include `react_scratchpad_snapshot` (if logging is enabled) for debugging.
3. Ensure strict responses render correctly in Chat UI (no Markdown injection issues, long JSON rendered inside `<pre>`).

## 3. Cleanup Tasks
1. Delete legacy formatting helpers once new `formatObservation` + verbatim mode are stable:
   - `brain/agents/operator-react.ts` old heuristic sections (keep only new scratchpad-based formatter).
   - Remove unused `first_task_action` fast-path logic.

2. Remove temporary feature flag after rollout:
   - Delete `operator.reactV2` gate from `etc/runtime.json` / config loader.

3. Update documentation:
   - Replace outdated “hard-coded skill order” notes in `docs/user-guide/13-advanced-usage.md`.
   - Add a troubleshooting section for the new planner under `docs/implementation-plans`.

4. Archive debug logs/scripts created during migration (e.g., scratchpad dumps older than 7 days) to keep `logs/run` tidy.

5. Confirm CI workflows (lint/test) don’t reference deleted legacy files; clean up package scripts if necessary.

