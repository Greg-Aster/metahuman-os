/**
 * Reset Persona File API
 *
 * POST: Reset persona/core.json to default settings
 * DANGEROUS: This action is irreversible (though a backup is created)
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, storageClient } from '@metahuman/core';
import { auditAction } from '@metahuman/core/audit';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Default persona structure
 * Matches the schema defined in persona/core.json
 */
const DEFAULT_PERSONA = {
  version: '1.0.0',
  identity: {
    name: '',
    pronouns: [],
    age: null,
    location: '',
    occupation: '',
    background: '',
  },
  personality: {
    traits: {
      openness: 50,
      conscientiousness: 50,
      extraversion: 50,
      agreeableness: 50,
      neuroticism: 50,
    },
    communication_style: {
      formality: 'balanced',
      verbosity: 'moderate',
      humor: 'occasional',
      directness: 'balanced',
      emotional_expression: 'moderate',
    },
    cognitive_patterns: {
      decision_making: 'balanced',
      problem_solving: 'systematic',
      learning_style: 'visual',
      attention_to_detail: 'moderate',
    },
  },
  values: {
    core_values: [],
    ethical_principles: [],
    priorities: [],
  },
  goals: {
    short_term: [],
    long_term: [],
    aspirations: [],
  },
  interests: {
    hobbies: [],
    topics_of_interest: [],
    skills: [],
  },
  context: {
    daily_routine: '',
    current_projects: [],
    relationships: [],
    challenges: [],
  },
  metadata: {
    created_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    sources: ['system_default'],
    confidence: 0,
  },
};

const handler: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Verify access to persona core
    const pathResult = storageClient.resolvePath({
      category: 'config',
      subcategory: 'persona',
      relativePath: 'core.json',
    });
    if (!pathResult.success || !pathResult.path) {
      return new Response(
        JSON.stringify({ error: 'Access denied' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const personaPath = pathResult.path;

    // Create backup before resetting
    const backupDir = path.join(path.dirname(personaPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `persona-core-reset-${timestamp}.json`);

    // Read current persona if it exists
    let currentPersona = DEFAULT_PERSONA;
    if (fs.existsSync(personaPath)) {
      const existingContent = fs.readFileSync(personaPath, 'utf-8');
      currentPersona = JSON.parse(existingContent);
    }

    // Save backup
    fs.writeFileSync(backupPath, JSON.stringify(currentPersona, null, 2), 'utf-8');

    // Reset to defaults
    fs.writeFileSync(personaPath, JSON.stringify(DEFAULT_PERSONA, null, 2), 'utf-8');

    // Audit the reset action
    await auditAction({
      action: 'persona_file_reset',
      actor: user.username,
      details: {
        backupPath,
        timestamp: new Date().toISOString(),
      },
      outcome: 'success',
    });

    return new Response(
      JSON.stringify({
        success: true,
        backupPath,
        message: 'Persona file reset to defaults',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[persona/generator/reset-persona] POST error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to reset persona',
        details: (error as Error).message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// POST requires authentication for persona generation
export const POST = handler;
