# Big Brother Session Contract

Big Brother has one visible session owner: `packages/core/src/big-brother-session.ts`.
Claude Code and Codex are provider adapters inside that lifecycle, not separate
terminal or background execution systems.

## Invariants

- Every Claude Code or Codex escalation opens the Big Brother tab in the
  MetaHuman terminal interface.
- The session owner starts and stops the CLI process, parses its JSON event
  stream, emits terminal events, and returns the final text to the normal chat
  response path.
- Closing the Big Brother terminal tab cancels the process group and closes the
  viewer. There is no detached fallback execution path.
- Provider changes and disabling Big Brother stop the current shared session.
- API routes and UI components may control or display the session; they may not
  spawn Claude Code or Codex directly.

## Maintained paths

- Session/process owner: `packages/core/src/big-brother-session.ts`
- Provider process helper inside ttyd: `packages/core/src/big-brother-session-worker.ts`
- Provider invocation/event adapters: `packages/core/src/big-brother-cli.ts`
- Thin provider adapters: `packages/core/src/backends/terminal-session-backend.ts`
- Status/control/events: `packages/core/src/api/handlers/big-brother-terminal.ts`
- Terminal tab: `apps/site/src/components/TerminalManager.svelte`
- Final chat routing: `packages/core/src/providers/bridge.ts` and escalation callers
