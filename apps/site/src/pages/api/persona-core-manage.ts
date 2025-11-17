/**
 * API endpoint to read and write the complete core.json file
 * This allows editing the entire persona configuration
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import { tryResolveProfilePath } from '@metahuman/core/paths';
import { audit } from '@metahuman/core/audit';
import { withUserContext } from '../../middleware/userContext';
import { requireWriteMode } from '../../middleware/cognitiveModeGuard';

const getHandler: APIRoute = async () => {
  try {
    // Use safe path resolution
    const result = tryResolveProfilePath('personaCore');

    if (!result.ok) {
      // Anonymous user - return minimal default structure
      return new Response(
        JSON.stringify({
          success: true,
          persona: {
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
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const personaPath = result.path;

    if (!fs.existsSync(personaPath)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Persona core file not found'
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const personaData = JSON.parse(fs.readFileSync(personaPath, 'utf-8'));

    return new Response(
      JSON.stringify({
        success: true,
        persona: personaData
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[persona-core-manage] GET error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to load persona configuration' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

const postHandler: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { persona } = body;

    if (!persona || typeof persona !== 'object') {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid persona data' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Use safe path resolution - require authentication for writes
    const result = tryResolveProfilePath('personaCore');

    if (!result.ok) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required to save persona' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const personaPath = result.path;

    // Preserve $schema and version from original if not provided
    let existingData = {};
    if (fs.existsSync(personaPath)) {
      existingData = JSON.parse(fs.readFileSync(personaPath, 'utf-8'));
    }

    // Update lastUpdated timestamp
    const updatedPersona = {
      $schema: persona.$schema || (existingData as any).$schema || "https://json-schema.org/draft/2020-12/schema",
      version: persona.version || (existingData as any).version || "0.2.0",
      lastUpdated: new Date().toISOString(),
      ...persona
    };

    // Write the updated persona
    fs.writeFileSync(personaPath, JSON.stringify(updatedPersona, null, 2));

    // Audit the change
    audit({
      level: 'info',
      category: 'data_change',
      event: 'persona_core_updated',
      details: {
        identityName: updatedPersona.identity?.name,
        hasGoals: !!(updatedPersona.goals),
        hasValues: !!(updatedPersona.values),
      },
      actor: 'web_ui',
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Persona configuration saved successfully'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[persona-core-manage] POST error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to save persona configuration' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// Wrap with user context middleware and cognitive mode guard for automatic profile path resolution
export const GET = withUserContext(getHandler);
export const POST = withUserContext(requireWriteMode(postHandler));
