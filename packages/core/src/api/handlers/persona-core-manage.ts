/**
 * Persona Core Manage API Handlers
 *
 * GET/POST complete core.json for persona editing.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { getProfilePaths } from '../../paths.js';
import { audit } from '../../audit.js';

const DEFAULT_PERSONA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  version: "0.2.0",
  lastUpdated: new Date().toISOString(),
  identity: {
    name: "MetaHuman",
    role: "Digital Assistant",
    purpose: "",
    humanName: "",
    email: "",
    icon: "",
    aliases: []
  },
  personality: {
    communicationStyle: {
      tone: [],
      humor: "",
      formality: "",
      verbosity: "",
      vocabularyLevel: "",
      preferredPronouns: ""
    },
    cadence: {
      modes: [],
      energyPeaks: [],
      loopSignals: []
    },
    traits: {
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      neuroticism: 0.5,
      notes: ""
    },
    archetypes: [],
    aesthetic: [],
    narrativeStyle: "",
    interests: []
  },
  values: {
    core: [],
    boundaries: []
  },
  decisionHeuristics: [],
  writingStyle: {
    structure: "",
    motifs: [],
    defaultMantra: ""
  },
  goals: {
    shortTerm: [],
    midTerm: [],
    longTerm: []
  },
  context: {
    domains: [],
    projects: [],
    currentFocus: []
  },
  notes: "",
  background: ""
};

/**
 * GET /api/persona-core-manage - Get complete persona core.json
 */
export async function handleGetPersonaCoreManage(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    // Anonymous users see default structure
    if (!user.isAuthenticated) {
      return successResponse({
        success: true,
        persona: { ...DEFAULT_PERSONA, lastUpdated: new Date().toISOString() }
      });
    }

    const paths = getProfilePaths(user.username);
    const personaPath = paths.personaCore;

    if (!existsSync(personaPath)) {
      return {
        status: 404,
        error: 'Persona core file not found',
      };
    }

    const personaData = JSON.parse(await fs.readFile(personaPath, 'utf-8'));

    return successResponse({
      success: true,
      persona: personaData
    });
  } catch (error) {
    console.error('[persona-core-manage] GET error:', error);
    return { status: 500, error: 'Failed to load persona configuration' };
  }
}

/**
 * POST /api/persona-core-manage - Update complete persona core.json
 */
export async function handleUpdatePersonaCoreManage(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    const { persona } = body || {};

    if (!persona || typeof persona !== 'object') {
      return { status: 400, error: 'Invalid persona data' };
    }

    const paths = getProfilePaths(user.username);
    const personaPath = paths.personaCore;

    // Preserve $schema and version from original if not provided
    let existingData: Record<string, any> = {};
    if (existsSync(personaPath)) {
      existingData = JSON.parse(await fs.readFile(personaPath, 'utf-8'));
    }

    // Update lastUpdated timestamp
    const updatedPersona = {
      $schema: persona.$schema || existingData.$schema || "https://json-schema.org/draft/2020-12/schema",
      version: persona.version || existingData.version || "0.2.0",
      lastUpdated: new Date().toISOString(),
      ...persona
    };

    // Write the updated persona
    await fs.writeFile(personaPath, JSON.stringify(updatedPersona, null, 2));

    // Audit the change
    audit({
      level: 'info',
      category: 'data_change',
      event: 'persona_core_updated',
      details: {
        identityName: updatedPersona.identity?.name,
        hasGoals: !!(updatedPersona.goals),
        hasValues: !!(updatedPersona.values),
        username: user.username,
      },
      actor: user.username,
    });

    return successResponse({
      success: true,
      message: 'Persona configuration saved successfully'
    });
  } catch (error) {
    console.error('[persona-core-manage] POST error:', error);
    return { status: 500, error: 'Failed to save persona configuration' };
  }
}
