import type { APIRoute } from 'astro';
import {
  listCognitiveModes,
  loadCognitiveMode,
  saveCognitiveMode,
  applyModeDefaults,
  type CognitiveModeId,
} from '@metahuman/core/cognitive-mode';
import { audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadTrustCoupling, getMappedTrustLevel } from '@metahuman/core';
import { setTrustLevel } from '@metahuman/core';
import { auditConfigAccess, requireOwner } from '../../middleware/cognitiveModeGuard';
import { withUserContext } from '../../middleware/userContext';
import { getUserContext } from '@metahuman/core/context';

const getHandler: APIRoute = async (context) => {
  const ctx = getUserContext();
  if (!ctx || ctx.role === 'anonymous') {
    return new Response(
      JSON.stringify({ error: 'Authentication required to view cognitive mode.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const config = loadCognitiveMode();
  const modes = listCognitiveModes();

  // Get the actual enforced mode (may differ from saved mode for anonymous users)
  const policy = getSecurityPolicy(context);
  const enforcedMode = policy.mode;

  return new Response(
    JSON.stringify({
      mode: enforcedMode, // Return the enforced mode, not the saved preference
      savedMode: config.currentMode, // Also include what's saved in the file
      lastChanged: config.lastChanged,
      history: config.history ?? [],
      modes,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

const postHandler: APIRoute = async (context) => {
  try {
    const ctx = getUserContext();
    if (!ctx || ctx.role === 'anonymous') {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required to modify cognitive mode.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

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

    // Check if trust level should be automatically adjusted based on coupling
    const coupling = loadTrustCoupling();
    if (coupling.coupled) {
      const mappedTrustLevel = getMappedTrustLevel(mode);
      setTrustLevel(mappedTrustLevel);

      audit({
        level: 'info',
        category: 'security',
        event: 'trust_level_auto_adjusted',
        details: {
          trigger: 'cognitive_mode_change',
          mode,
          newTrustLevel: mappedTrustLevel,
          reason: 'Trust coupling enabled',
        },
        actor,
      });
    }

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

// Wrap with user context middleware and owner-only guard (blocks mode switching for non-owners)
// NOTE: Currently everyone is 'anonymous' until auth is implemented
// Once auth is added, only authenticated owners can switch modes
export const GET = withUserContext(getHandler);
export const POST = withUserContext(requireOwner(postHandler));
