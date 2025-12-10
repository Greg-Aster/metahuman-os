/**
 * Chat Settings API Handlers
 *
 * Unified handlers for chat settings endpoints.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import {
  loadChatSettings,
  saveChatSettings,
  applyPreset,
  getChatSettingsConfig,
  getChatSettingsScope,
  type ChatSettings,
} from '../../chat-settings.js';

/**
 * GET /api/chat-settings - Get current settings and configuration
 */
export async function handleGetChatSettings(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const settings = loadChatSettings();
    const config = getChatSettingsConfig();
    const scope = getChatSettingsScope();

    return successResponse({
      settings,
      config,
      scope,
    });
  } catch (error) {
    console.error('[chat-settings] GET error:', error);
    return { status: 500, error: 'Failed to load chat settings' };
  }
}

/**
 * PUT /api/chat-settings - Update specific settings
 */
export async function handleUpdateChatSettings(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;
  const actor = user.username || 'anonymous';

  const updates = (body?.updates || body) as Partial<ChatSettings>;

  if (!updates || typeof updates !== 'object') {
    return { status: 400, error: 'Invalid updates object' };
  }

  try {
    saveChatSettings(updates, actor);

    const newSettings = loadChatSettings();
    const scope = getChatSettingsScope();

    return successResponse({
      success: true,
      settings: newSettings,
      scope,
    });
  } catch (error) {
    console.error('[chat-settings] PUT error:', error);
    return { status: 500, error: 'Failed to update chat settings' };
  }
}

/**
 * POST /api/chat-settings - Apply a preset configuration
 */
export async function handleApplyChatPreset(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;
  const actor = user.username || 'anonymous';

  const { preset } = (body || {}) as { preset?: string };

  if (!preset || typeof preset !== 'string') {
    return { status: 400, error: 'Invalid preset name' };
  }

  try {
    const newSettings = applyPreset(preset, actor);
    const scope = getChatSettingsScope();

    return successResponse({
      success: true,
      settings: newSettings,
      preset,
      scope,
    });
  } catch (error) {
    console.error('[chat-settings] POST error:', error);
    const message = error instanceof Error ? error.message : 'Failed to apply preset';
    return { status: 500, error: message };
  }
}
