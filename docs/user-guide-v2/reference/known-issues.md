# Known Issues & Experimental Features

This section documents features that are still in development or have known limitations.

## Autonomous Dual-Adapter Workflow

The documentation describes a fully autonomous, dual-adapter workflow for long-term memory. While parts of this system are implemented, it is currently **experimental** and has several important caveats:

1.  **Remote Training Only:** The autonomous dual-adapter logic is **only** implemented in the remote training workflow (triggered by the "Run Full Cycle Now" button in the web UI). It is **not** supported for local training via the `mh-train-local` script, which will always fall back to a single-adapter model.

2.  **Architectural Mismatch:** The implementation's architecture differs from the diagrams in the documentation. The code loads the *recent* adapter as a base model and applies the *historical* adapter on top, rather than loading a neutral base model and applying both adapters sequentially.

3.  **Potential Instability:** The code contains explicit warnings from the developers that the dual-adapter mode may not function correctly with the project's current default model (Qwen3-30B) due to limitations in the underlying `llama.cpp` technology. The system may fall back to a single-adapter model, and the code includes recommendations to disable dual-mode entirely.

**Summary:** While the goal is a fully autonomous dual-adapter system, the current implementation should be considered an experimental feature for remote training only, with known limitations.

## Memory Editor

The web UI includes a memory editor that allows you to view and edit memory files directly in the browser.

**Features:**
- Full-screen modal editor for viewing/editing memories
- Supports all memory types (Episodic, Reflections, Dreams, Tasks, etc.)
- Auto-save detection with unsaved changes warning
- Keyboard shortcuts (Ctrl+S to save, Esc to close)
- Permission-based access (requires authentication to edit)
- All edits are audited to the audit log

**Usage:**
- Click the blue pencil icon (✏️) next to any memory entry
- View/edit the full JSON content in the modal editor
- Press Ctrl+S or click "Save" to save changes
- Press Esc or click "Close" to exit

**Technical Details:**
The memory editor ([MemoryEditor.svelte](../../apps/site/src/components/MemoryEditor.svelte)) provides a better user experience than inline expansion, especially for large memories or when editing is needed. It uses the `/api/memory-content` endpoint for reading and writing memory files with proper security checks.
