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
  AIDER: 'aider',
  GEMINI_CLI: 'gemini-cli',
  QWEN_CODE: 'qwen-code',
  CODEX: 'codex',
} as const;

export type BackendId = (typeof BACKEND_IDS)[keyof typeof BACKEND_IDS];

export function isBackendId(value: unknown): value is BackendId {
  return Object.values(BACKEND_IDS).some(id => id === value);
}
