import { registerBackend } from '../escalation-backend.js'
import { BACKEND_IDS } from '../escalation-constants.js'
import { createTerminalSessionBackend } from './terminal-session-backend.js'

export const claudeCodeBackend = createTerminalSessionBackend({
  id: BACKEND_IDS.CLAUDE_CODE,
  name: 'Claude Code CLI',
  description: 'Claude Code in the shared visible Big Brother terminal session',
})

registerBackend(claudeCodeBackend)
