import { registerBackend } from '../escalation-backend.js'
import { BACKEND_IDS } from '../escalation-constants.js'
import { createTerminalSessionBackend } from './terminal-session-backend.js'

export const codexBackend = createTerminalSessionBackend({
  id: BACKEND_IDS.CODEX,
  name: 'Codex CLI',
  description: 'Codex in the shared visible Big Brother terminal session',
})

registerBackend(codexBackend)
