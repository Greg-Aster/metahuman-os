# Node Editor Rollback – November 2025

## Status
- **Node pipeline disabled:** `USE_NODE_PIPELINE` now defaults to `false` again inside `apps/site/src/pages/api/persona_chat.ts`. Requests fall back to the legacy imperative pipeline until we explicitly set `USE_NODE_PIPELINE=true` via the environment.
- **Reason:** LiteGraph templates still show rendering/connection regressions. To avoid impacting live chats, we’re pausing the graph executor rollout while we finish the editor fixes.

## Next Steps
1. **Finish template rendering fixes**
   - Verify `apps/site/src/lib/cognitive-nodes/template-loader.ts` populates LiteGraph inputs/outputs for all node types.
   - Ensure `NodeEditor` no longer needs runtime link reconstruction.
2. **Regression harness**
   - Run `node scripts/graph-regression.mjs` once the dev server is available to compare graph vs legacy responses.
3. **Telemetry**
   - Confirm `logs/graph-traces.ndjson` captures execution traces before the next enable attempt.

## Re-enabling Instructions
1. Set `USE_NODE_PIPELINE=true` in the environment or `.env`.
2. Restart the dev server / deployment (`pnpm dev`, `astro dev`, or the production process manager).
3. Monitor `/logs/graph-traces.ndjson` and `logs/audit/*.ndjson` for `graph_pipeline_*` events.
