/**
 * Escalation Backend Constants
 *
 * Separated to avoid circular dependencies between
 * escalation-backend.ts and the backend implementations.
 */

// ============================================================================
// Backend IDs
// ============================================================================

export const BACKEND_IDS = {
  CLAUDE_CODE: 'claude-code',
  OPEN_INTERPRETER: 'open-interpreter',
  AIDER: 'aider',
  GEMINI_CLI: 'gemini-cli',
  QWEN_CODE: 'qwen-code',
  CODEX: 'codex',
} as const;

export type BackendId = (typeof BACKEND_IDS)[keyof typeof BACKEND_IDS];
