# Known Issues & Experimental Features

This section documents features that are still in development or have known limitations.

## Autonomous Dual-Adapter Workflow

The documentation describes a fully autonomous, dual-adapter workflow for long-term memory. While parts of this system are implemented, it is currently **experimental** and has several important caveats:

1.  **Remote Training Only:** The autonomous dual-adapter logic is **only** implemented in the remote training workflow (triggered by the "Run Full Cycle Now" button in the web UI). It is **not** supported for local training via the `mh-train-local` script, which will always fall back to a single-adapter model.

2.  **Architectural Mismatch:** The implementation's architecture differs from the diagrams in the documentation. The code loads the *recent* adapter as a base model and applies the *historical* adapter on top, rather than loading a neutral base model and applying both adapters sequentially.

3.  **Potential Instability:** The code contains explicit warnings from the developers that the dual-adapter mode may not function correctly with the project's current default model (Qwen3-30B) due to limitations in the underlying `llama.cpp` technology. The system may fall back to a single-adapter model, and the code includes recommendations to disable dual-mode entirely.

**Summary:** While the goal is a fully autonomous dual-adapter system, the current implementation should be considered an experimental feature for remote training only, with known limitations.

## Dream Tab Expansion UI Issue

In the web UI's Memory section, the Dreams tab displays a list of dream entries with expand/collapse functionality to view full dream content. Currently, there is a known Svelte reactivity issue where clicking the expand button does not update the UI, even though the underlying state changes correctly.

**Symptoms:**
- Clicking on a dream entry's expand button has no visible effect
- The API call succeeds (visible in terminal/browser console: `/api/memory-content` returns 200)
- JavaScript state updates correctly (`expanded[key]` changes to `true`)
- Console logs show the click handler fires and state updates
- UI remains static and does not re-render to show dream content

**Technical Details:**
The issue stems from Svelte's reactivity system not tracking changes to nested object properties (`expanded[key] = true`) within the `CenterContent.svelte` component. Multiple fixes have been attempted:
- Version counter pattern to force reactivity updates
- Accessing version variables in derived functions to create Svelte dependencies

None of these standard Svelte reactivity patterns have resolved the issue.

**Current Status:**
This issue is documented but not yet resolved. The dreams list loads correctly, but individual dream content cannot be expanded in the UI.

**Temporary Workarounds:**
- View dream content directly via the file system in `memory/episodic/dreams/`
- Use the API endpoint directly: `/api/memory-content?relPath=<path-to-dream-file>`
- Refresh the page and click again (may occasionally trigger the update)

**Related Files:**
- [apps/site/src/components/CenterContent.svelte](../../apps/site/src/components/CenterContent.svelte) - Component containing the expansion logic
- [apps/site/src/pages/api/memory-content.ts](../../apps/site/src/pages/api/memory-content.ts) - API endpoint (working correctly)
