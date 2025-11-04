import type { APIRoute } from 'astro';
import {
  listCognitiveModes,
  loadCognitiveMode,
  saveCognitiveMode,
  applyModeDefaults,
  type CognitiveModeId,
} from '@metahuman/core/cognitive-mode';

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

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const mode = String(body?.mode ?? '').toLowerCase() as CognitiveModeId;
    if (!mode || !listCognitiveModes().some(def => def.id === mode)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid cognitive mode' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const actor = typeof body?.actor === 'string' ? body.actor : 'web_ui';
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
