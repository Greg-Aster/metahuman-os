/** Browser-safe terminal contracts. No runtime imports or startup side effects. */
export type TerminalProvider = 'claude-code' | 'codex'
export interface TerminalSession {
  id: string
  kind: 'shell' | 'provider' | 'log'
  title: string
  provider?: TerminalProvider
  phase: 'running' | 'completed' | 'failed' | 'stopping'
  cols: number
  rows: number
  error?: string
}
export interface TerminalState {
  status: 'running' | 'stopping' | 'stopped'
  sessions: TerminalSession[]
}
export type TerminalEvent =
  | { type: 'state'; state: TerminalState }
  | { type: 'screen'; id: string; data: string; cols: number; rows: number }
  | { type: 'output'; id: string; data: string }
  | { type: 'error'; error: string }

export class TerminalError extends Error {
  constructor(message: string, public readonly status = 500) { super(message) }
}

export function dimensions(cols: unknown, rows: unknown): { cols: number; rows: number } {
  if (!Number.isInteger(cols) || !Number.isInteger(rows)
    || Number(cols) < 2 || Number(cols) > 300 || Number(rows) < 2 || Number(rows) > 120) {
    throw new TerminalError('Terminal size must be 2–300 columns and 2–120 rows', 400)
  }
  return { cols: Number(cols), rows: Number(rows) }
}
