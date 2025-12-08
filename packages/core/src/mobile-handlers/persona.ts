/**
 * Mobile Persona Handlers
 *
 * Persona/identity loading for mobile
 */

// Note: We read persona files directly instead of using identity.js functions
// because those rely on AsyncLocalStorage context
import { loadCognitiveMode, getModeDefinition, type CognitiveModeId } from '../cognitive-mode.js';
import { getProfilePaths } from '../paths.js';
import fs from 'node:fs';
import path from 'node:path';
import type { MobileRequest, MobileResponse, MobileUserContext } from './types.js';
import { successResponse, errorResponse } from './types.js';

/**
 * GET /api/persona - Get persona core data
 */
export async function handleGetPersona(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return errorResponse(request.id, 401, 'Authentication required');
  }

  try {
    const profilePaths = getProfilePaths(user.username);
    const coreFile = profilePaths.personaCore;

    if (!fs.existsSync(coreFile)) {
      return errorResponse(request.id, 404, 'Persona not found');
    }

    const raw = fs.readFileSync(coreFile, 'utf-8');
    const persona = JSON.parse(raw);

    return successResponse(request.id, {
      success: true,
      persona,
    });
  } catch (error) {
    console.error('[mobile-handlers] Get persona failed:', error);
    return errorResponse(request.id, 500, (error as Error).message);
  }
}

/**
 * GET /api/cognitive-mode - Get current cognitive mode
 */
export async function handleGetCognitiveMode(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  try {
    const config = loadCognitiveMode();
    const currentMode = config.currentMode as CognitiveModeId;
    const modeDefinition = getModeDefinition(currentMode);

    return successResponse(request.id, {
      success: true,
      currentMode,
      definition: modeDefinition,
      lastChanged: config.lastChanged,
    });
  } catch (error) {
    console.error('[mobile-handlers] Get cognitive mode failed:', error);
    return errorResponse(request.id, 500, (error as Error).message);
  }
}

/**
 * GET /api/persona/summary - Get persona summary for context
 */
export async function handleGetPersonaSummary(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    // Return generic summary for anonymous users
    return successResponse(request.id, {
      success: true,
      summary: 'You are an AI assistant.',
      isAnonymous: true,
    });
  }

  try {
    const profilePaths = getProfilePaths(user.username);
    const coreFile = profilePaths.personaCore;

    if (!fs.existsSync(coreFile)) {
      return successResponse(request.id, {
        success: true,
        summary: 'Persona not configured.',
        isConfigured: false,
      });
    }

    const raw = fs.readFileSync(coreFile, 'utf-8');
    const persona = JSON.parse(raw);

    // Build summary string for LLM context
    const identity = persona.identity || {};
    const personality = persona.personality || {};
    const values = persona.values?.core || [];

    const communicationStyle = personality.communicationStyle ?? {};
    const tone = communicationStyle.tone;
    const toneText = Array.isArray(tone) ? tone.join(', ') : tone || 'adaptive';

    const valueList = values
      .map((v: any) => v.value || v)
      .filter(Boolean)
      .join(', ');

    const summary = `
You are ${identity.name || 'an AI assistant'}, an autonomous digital personality extension.
Your role is: ${identity.role || 'general assistant'}.
Your purpose is: ${identity.purpose || 'to help and assist'}.

Your personality is defined by these traits:
- Communication Style: ${toneText}.
- Values: ${valueList || 'Not specified'}.
    `.trim();

    return successResponse(request.id, {
      success: true,
      summary,
      isConfigured: true,
      identity,
    });
  } catch (error) {
    console.error('[mobile-handlers] Get persona summary failed:', error);
    return errorResponse(request.id, 500, (error as Error).message);
  }
}
