import type { APIRoute } from 'astro';
import {
  listCognitiveModes,
  loadCognitiveMode,
  saveCognitiveMode,
  applyModeDefaults,
  type CognitiveModeId,
} from '@metahuman/core/cognitive-mode';
import { audit } from '@metahuman/core';
import { auditConfigAccess, requireOwner } from '../../middleware/cognitiveModeGuard';

export const GET: APIRoute = async () => {
  const config = loadCognitiveMode();
  const modes = listCognitiveModes();
  return new Response(
    JSON.stringify({
      mode: config.currentMode,
      lastChanged: config.lastChanged,
      history: config.history ?? [],
      modes,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

const postHandler: APIRoute = async (context) => {
  try {
    const { request } = context;
    const body = await request.json();
    const mode = String(body?.mode ?? '').toLowerCase() as CognitiveModeId;

    if (!mode || !listCognitiveModes().some(def => def.id === mode)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid cognitive mode' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const actor = typeof body?.actor === 'string' ? body.actor : 'web_ui';
    const currentMode = loadCognitiveMode();

    // Audit the mode change attempt
    auditConfigAccess(context, 'cognitive_mode_change');

    // Additional audit with mode details
    audit({
      level: 'warn',
      category: 'security',
      event: 'cognitive_mode_change',
      details: {
        from: currentMode.currentMode,
        to: mode,
        actor
      },
      actor
    });

    const updated = saveCognitiveMode(mode, actor);
    applyModeDefaults(mode);

    return new Response(
      JSON.stringify({
        success: true,
        mode: updated.currentMode,
        lastChanged: updated.lastChanged,
        history: updated.history ?? [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// Wrap with owner-only guard (blocks mode switching for non-owners)
// NOTE: Currently everyone is 'anonymous' until auth is implemented
// Once auth is added, only authenticated owners can switch modes
export const POST = requireOwner(postHandler);
