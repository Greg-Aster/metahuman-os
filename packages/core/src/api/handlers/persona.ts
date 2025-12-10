/**
 * Persona Handlers
 *
 * Unified handlers for persona data access.
 * Includes individual persona components for mobile sync.
 */

import fs from 'fs';
import path from 'path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, notFoundResponse } from '../types.js';
import { getProfilePaths } from '../../path-builder.js';
import { loadPersonaCore, getIdentitySummary } from '../../identity.js';

/**
 * GET /api/persona - Get full persona data
 */
export async function handleGetPersona(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    const persona = await loadPersonaComponent(req.user.username, 'core');
    if (!persona || Object.keys(persona).length === 0) {
      return notFoundResponse('Persona not found');
    }

    return successResponse({
      success: true,
      persona,
    });
  } catch {
    return notFoundResponse('Persona not found');
  }
}

/**
 * GET /api/persona/summary - Get persona summary (public)
 */
export async function handleGetPersonaSummary(req: UnifiedRequest): Promise<UnifiedResponse> {
  // For unauthenticated users, return a default summary
  if (!req.user.isAuthenticated) {
    return successResponse({
      success: true,
      summary: {
        name: 'MetaHuman',
        description: 'An autonomous digital personality extension',
      },
    });
  }

  try {
    const summary = getIdentitySummary();
    return successResponse({
      success: true,
      summary: summary || {
        name: req.user.username,
        description: 'No persona configured',
      },
    });
  } catch {
    return successResponse({
      success: true,
      summary: {
        name: req.user.username,
        description: 'No persona configured',
      },
    });
  }
}

/**
 * Helper function to load persona component file
 */
async function loadPersonaComponent(username: string, component: string): Promise<any> {
  const profilePaths = getProfilePaths(username);
  const filePath = path.join(profilePaths.persona, `${component}.json`);
  
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    // Return empty object if file doesn't exist
    return {};
  }
}

/**
 * GET /api/persona-core - Get core persona data
 */
export async function handleGetPersonaCore(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    const core = await loadPersonaComponent(req.user.username, 'core');
    return successResponse({ success: true, persona: core });
  } catch (error) {
    console.error('[persona-core] Error loading core:', error);
    return { status: 500, error: 'Failed to load persona core' };
  }
}

/**
 * Helper to sanitize array inputs
 */
function sanitizeArray(input: any, separator = ','): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input.split(separator).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

/**
 * POST /api/persona-core - Update core persona data
 */
export async function handleUpdatePersonaCore(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  const { body } = req;
  if (!body) {
    return { status: 400, error: 'Request body is required' };
  }

  try {
    const profilePaths = getProfilePaths(req.user.username);
    const persona = await loadPersonaComponent(req.user.username, 'core');

    // Update identity section
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

    // Update personality section
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

    // Update values section
    if (body.values) {
      persona.values = persona.values || {};
      if (body.values.boundaries !== undefined) {
        persona.values.boundaries = sanitizeArray(body.values.boundaries, '\n');
      }
    }

    persona.lastUpdated = new Date().toISOString();

    // Save updated persona
    const corePath = path.join(profilePaths.persona, 'core.json');
    await fs.promises.mkdir(profilePaths.persona, { recursive: true });
    await fs.promises.writeFile(corePath, JSON.stringify(persona, null, 2) + '\n', 'utf-8');

    return successResponse({ success: true, persona });
  } catch (error) {
    console.error('[persona-core] Error updating core:', error);
    return { status: 500, error: 'Failed to update persona core' };
  }
}

/**
 * GET /api/persona-relationships - Get relationships data
 */
export async function handleGetPersonaRelationships(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    const relationships = await loadPersonaComponent(req.user.username, 'relationships');
    return successResponse(relationships);
  } catch (error) {
    console.error('[persona-relationships] Error loading relationships:', error);
    return { status: 500, error: 'Failed to load persona relationships' };
  }
}

/**
 * GET /api/persona-routines - Get routines data
 */
export async function handleGetPersonaRoutines(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    const routines = await loadPersonaComponent(req.user.username, 'routines');
    return successResponse(routines);
  } catch (error) {
    console.error('[persona-routines] Error loading routines:', error);
    return { status: 500, error: 'Failed to load persona routines' };
  }
}

/**
 * GET /api/persona-decision-rules - Get decision rules data
 */
export async function handleGetPersonaDecisionRules(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    const decisionRules = await loadPersonaComponent(req.user.username, 'decision-rules');
    return successResponse(decisionRules);
  } catch (error) {
    console.error('[persona-decision-rules] Error loading decision rules:', error);
    return { status: 500, error: 'Failed to load persona decision rules' };
  }
}
