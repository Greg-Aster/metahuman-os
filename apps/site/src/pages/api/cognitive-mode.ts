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
import { getAuthenticatedUser, getUserOrAnonymous } from '@metahuman/core';

const getHandler: APIRoute = async ({ cookies }) => {
  const user = getUserOrAnonymous(cookies);

  // Allow anonymous users WITH guest profile to view (read-only)
  // Block anonymous users WITHOUT guest profile
  if (user.role === 'anonymous' && !user.activeProfile) {
    return new Response(
      JSON.stringify({ error: 'Authentication required to view cognitive mode.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const config = loadCognitiveMode();
  const modes = listCognitiveModes();

  // Get the actual enforced mode (may differ from saved mode for anonymous users)
  const policy = getSecurityPolicy({ cookies });
  const enforcedMode = policy.mode;

  return new Response(
    JSON.stringify({
      mode: enforcedMode, // Return the enforced mode, not the saved preference
      savedMode: config.currentMode, // Also include what's saved in the file
      lastChanged: config.lastChanged,
      locked: config.locked ?? false, // Include locked status
      history: config.history ?? [],
      modes,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

const postHandler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required to modify cognitive mode.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // SECURITY: Guests cannot change cognitive mode (they're stuck in emulation)
    if (user.role === 'guest') {
      return new Response(
        JSON.stringify({ success: false, error: 'Guests cannot change cognitive mode (emulation only)' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const mode = String(body?.mode ?? '').toLowerCase() as CognitiveModeId;

    if (!mode || !listCognitiveModes().some(def => def.id === mode)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid cognitive mode' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const actor = typeof body?.actor === 'string' ? body.actor : user.username || user.userId || 'web_ui';
    const currentMode = loadCognitiveMode();

    // Audit the mode change attempt (removed auditConfigAccess call - was causing 500 error)

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

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// SECURITY FIX: 2025-11-20 - Standard users can change their own mode, guests cannot
// GET: Any authenticated user (including guests viewing public profiles)
// POST: Authenticated users (not guests) - requireOwner changed to check within handler
export const GET = getHandler;
export const POST = postHandler;
