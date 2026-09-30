import { getBigBrotherSessionState, stopBigBrotherSession } from '../../terminal/client.js'
import type { UnifiedHandler } from '../types.js'
import { audit } from '../../audit.js'

export const handleBigBrotherStatus: UnifiedHandler = async () => {
  const state = await getBigBrotherSessionState()
  return { status: 200, data: { ...state, running: state.processRunning, healthy: state.sessionOpen && !state.error } }
}
export const handleBigBrotherControl: UnifiedHandler = async req => {
  if (req.body?.action !== 'stop') return { status: 400, data: { error: 'Expected stop' } }
  await stopBigBrotherSession()
  audit({ level: 'info', category: 'action', event: 'big_brother_stopped', actor: req.user.username })
  return { status: 200, data: { success: true, state: await getBigBrotherSessionState() } }
}
