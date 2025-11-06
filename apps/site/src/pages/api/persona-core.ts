import type { APIRoute } from 'astro';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { paths } from '@metahuman/core';
import { requireWriteMode } from '../../middleware/cognitiveModeGuard';
import { withUserContext } from '../../middleware/userContext';

async function readPersonaCore() {
  // Use context-aware paths.personaCore which resolves to user profile
  const raw = await fs.readFile(paths.personaCore, 'utf-8');
  return JSON.parse(raw);
}

function sanitizeArray(input: any, separator = ',') {
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(separator)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

const getHandler: APIRoute = async () => {
  try {
    const persona = await readPersonaCore();
    return new Response(JSON.stringify({ success: true, persona }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[persona-core] Failed to read persona core:', error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

const postHandler: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const persona = await readPersonaCore();

    if (body.identity) {
      const identity = persona.identity || {};
      const payload = body.identity;
      if (typeof payload.name === 'string') identity.name = payload.name.trim();
      if (typeof payload.role === 'string') identity.role = payload.role.trim();
      if (typeof payload.purpose === 'string') identity.purpose = payload.purpose.trim();
      if (typeof payload.humanName === 'string') identity.humanName = payload.humanName.trim();
      if (typeof payload.email === 'string') identity.email = payload.email.trim();
      if (typeof payload.avatar === 'string') identity.avatar = payload.avatar.trim();
      if (payload.aliases !== undefined) identity.aliases = sanitizeArray(payload.aliases);
      persona.identity = identity;
    }

    if (body.personality) {
      persona.personality = persona.personality || {};
      if (body.personality.communicationStyle) {
        const current = persona.personality.communicationStyle || {};
        const cs = body.personality.communicationStyle;
        if (cs.tone !== undefined) current.tone = sanitizeArray(cs.tone);
        if (typeof cs.humor === 'string') current.humor = cs.humor.trim();
        if (typeof cs.formality === 'string') current.formality = cs.formality.trim();
        if (typeof cs.verbosity === 'string') current.verbosity = cs.verbosity.trim();
        persona.personality.communicationStyle = current;
      }
      if (body.personality.narrativeStyle !== undefined) {
        persona.personality.narrativeStyle = String(body.personality.narrativeStyle || '').trim();
      }
    }

    if (body.values) {
      persona.values = persona.values || {};
      if (body.values.boundaries !== undefined) {
        persona.values.boundaries = sanitizeArray(body.values.boundaries, '\n');
      }
    }

    persona.lastUpdated = new Date().toISOString();

    // Use context-aware paths.personaCore which resolves to user profile
    await fs.writeFile(paths.personaCore, JSON.stringify(persona, null, 2) + '\n', 'utf-8');

    return new Response(JSON.stringify({ success: true, persona }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[persona-core] Failed to update persona core:', error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// Wrap with user context middleware and cognitive mode guard
export const GET = withUserContext(getHandler);
export const POST = withUserContext(requireWriteMode(postHandler));
