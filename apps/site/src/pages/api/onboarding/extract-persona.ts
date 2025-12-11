/**
 * Onboarding Persona Extraction API
 *
 * POST: Use LLM to extract personality traits from conversation history
 * Updates persona/core.json with Big Five traits, values, communication style
 *
 * NOTE: This endpoint now uses the shared persona extractor from @metahuman/core
 * to avoid code duplication with the persona generator feature.
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, storageClient } from '@metahuman/core';
import {
  extractPersonaFromTranscript,
  type ChatMessage,
} from '@metahuman/core/persona/extractor';
import {
  loadExistingPersona,
  mergePersonaDraft,
  savePersona,
} from '@metahuman/core/persona/merger';
import { captureEvent } from '@metahuman/core/memory';
import path from 'node:path';
import fs from 'node:fs';

/**
 * POST /api/onboarding/extract-persona
 * Extract personality data from conversation
 * Body: { messages: ChatMessage[] }
 */
const handler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const body = await request.json();
    const { messages } = body as { messages: ChatMessage[] };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid request body. Expected { messages: ChatMessage[] }' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Extract persona from conversation using shared extractor
    const extracted = await extractPersonaFromTranscript(messages);

    // Load existing persona
    const personaCoreResult = storageClient.resolvePath({
      category: 'config',
      subcategory: 'persona',
      relativePath: 'core.json',
    });
    if (!personaCoreResult.success || !personaCoreResult.path) {
      return new Response(
        JSON.stringify({ error: 'Access denied' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const personaPath = personaCoreResult.path;
    const currentPersona = loadExistingPersona(personaPath);

    // Create backup before applying changes
    const backupDir = path.join(path.dirname(personaPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `persona-core-onboarding-${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(currentPersona, null, 2), 'utf-8');

    // Merge extracted data with existing persona (using 'merge' strategy)
    const { updated } = mergePersonaDraft(currentPersona, extracted, 'merge');

    // Save updated persona
    savePersona(personaPath, updated);

    // Save conversation transcript as episodic memory
    const transcript = messages
      .map((m) => `${m.role === 'assistant' ? 'Interviewer' : 'You'}: ${m.content}`)
      .join('\n\n');

    await captureEvent(`Quick Personality Survey - Onboarding\n\n${transcript}`, {
      type: 'observation',
      tags: ['onboarding', 'personality-survey', 'quick-survey'],
      metadata: {
        source: 'onboarding',
        questionCount: messages.filter((m) => m.role === 'assistant').length,
        extractedPersona: true,
        confidence: extracted.confidence?.overall || 0,
      },
    });

    // Export as training data (JSONL format)
    const profileRootResult = storageClient.getProfileRoot();
    if (!profileRootResult.success || !profileRootResult.path) {
      return new Response(
        JSON.stringify({ error: 'Access denied' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const trainingDir = path.join(
      profileRootResult.path,
      'memory/training/personality-surveys'
    );
    fs.mkdirSync(trainingDir, { recursive: true });

    const trainingPath = path.join(
      trainingDir,
      `quick-survey-${timestamp}.jsonl`
    );

    const trainingData = messages
      .map((m) => JSON.stringify({ role: m.role, content: m.content }))
      .join('\n');

    fs.writeFileSync(trainingPath, trainingData, 'utf-8');

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Personality data extracted and saved',
        extracted,
        personaPath,
        backupPath,
        trainingDataPath: trainingPath,
        episodicMemorySaved: true,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[onboarding/extract-persona] POST error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to extract personality data',
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
export const POST = handler;
