/**
 * Chat Settings API
 *
 * GET /api/chat-settings - Get current settings and configuration
 * PUT /api/chat-settings - Update specific settings
 * POST /api/chat-settings/preset - Apply a preset configuration
 */

import type { APIRoute } from 'astro';
import {
  loadChatSettings,
  saveChatSettings,
  applyPreset,
  getChatSettingsConfig,
  getChatSettingsScope,
  type ChatSettings,
} from '@metahuman/core/chat-settings';
import { withUserContext } from '../../middleware/userContext';
import { getUserContext } from '@metahuman/core/context';

const getHandler: APIRoute = async () => {
  try {
    const settings = loadChatSettings();
    const config = getChatSettingsConfig();
    const scope = getChatSettingsScope();

    return new Response(
      JSON.stringify({
        settings,
        config,
        scope,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[chat-settings] GET error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to load chat settings' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

const putHandler: APIRoute = async ({ request }) => {
  try {
    const ctx = getUserContext();
    const actor = ctx?.username || 'anonymous';

    const body = await request.json();
    const updates: Partial<ChatSettings> = body.updates;

    if (!updates || typeof updates !== 'object') {
      return new Response(
        JSON.stringify({ error: 'Invalid updates object' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    saveChatSettings(updates, actor);

    const newSettings = loadChatSettings();
    const scope = getChatSettingsScope();

    return new Response(
      JSON.stringify({
        success: true,
        settings: newSettings,
        scope,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[chat-settings] PUT error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to update chat settings' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

const postHandler: APIRoute = async ({ request }) => {
  try {
    const ctx = getUserContext();
    const actor = ctx?.username || 'anonymous';

    const body = await request.json();
    const { preset } = body;

    if (!preset || typeof preset !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid preset name' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const newSettings = applyPreset(preset, actor);
    const scope = getChatSettingsScope();

    return new Response(
      JSON.stringify({
        success: true,
        settings: newSettings,
        preset,
        scope,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[chat-settings] POST error:', error);
    const message = error instanceof Error ? error.message : 'Failed to apply preset';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const GET = withUserContext(getHandler);
export const PUT = withUserContext(putHandler);
export const POST = withUserContext(postHandler);
