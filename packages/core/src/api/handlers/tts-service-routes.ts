import type { UnifiedHandler } from '../types.js';
import {
  ensureVoiceServiceRunning,
  getVoiceServiceStatus,
  stopVoiceService,
} from '../../voice-service-manager.js';
import {
  getSovitsServerStatus,
  startSovitsServer,
  stopSovitsServer,
} from '../../tts/server-manager.js';

export const handleKokoroServer: UnifiedHandler = async (req) => {
  try {
    if (req.method === 'GET') return { status: 200, data: await getVoiceServiceStatus('kokoro') };

    const { action } = req.body ?? {};
    if (action === 'start') {
      const result = await ensureVoiceServiceRunning('kokoro');
      return { status: 200, data: { success: true, message: 'Kokoro server start accepted', ...result } };
    }

    if (action === 'stop') {
      const result = await stopVoiceService('kokoro');
      return { status: result.success ? 200 : 500, data: result };
    }

    return { status: 400, data: { error: 'Invalid action. Use "start" or "stop".' } };
  } catch (error) {
    return { status: 500, data: { error: String(error), success: false, running: false } };
  }
};

export const handleSovitsServer: UnifiedHandler = async (req) => {
  try {
    if (req.method === 'GET') return { status: 200, data: await getSovitsServerStatus() };

    const { action, port } = req.body ?? {};
    if (action === 'start') {
      const result = await startSovitsServer(port ?? 9880);
      return { status: result.success ? 200 : 500, data: result };
    }
    if (action === 'stop') {
      const result = await stopSovitsServer();
      return { status: result.success ? 200 : 500, data: result };
    }

    return { status: 400, data: { error: 'Invalid action. Use "start" or "stop".' } };
  } catch (error) {
    return { status: 500, data: { error: String(error), success: false, running: false } };
  }
};
