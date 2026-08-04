import type { UnifiedHandler } from '../types.js'
import { errorResponse, successResponse } from '../types.js'
import {
  ensureVoiceServiceRunning,
  getVoiceServiceStatus,
  stopVoiceService,
} from '../../voice-service-manager.js'

export const handleWhisperServer: UnifiedHandler = async (req) => {
  try {
    if (req.method === 'GET') {
      return successResponse(await getVoiceServiceStatus('whisper'))
    }

    const action = req.body?.action
    if (action === 'start') {
      const status = await ensureVoiceServiceRunning('whisper')
      return successResponse({ success: true, message: 'Whisper server start accepted', ...status })
    }
    if (action === 'stop') {
      const result = await stopVoiceService('whisper')
      return successResponse(result)
    }
    return errorResponse('Invalid action. Use "start" or "stop"', 400)
  } catch (error) {
    console.error('[whisper-server] Error:', error)
    return errorResponse((error as Error).message, 500)
  }
}
