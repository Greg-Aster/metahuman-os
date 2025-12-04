/**
 * Add Notes to Persona API
 *
 * POST: Process free-form notes and merge extracted personality data with existing persona
 * Allows users to iteratively refine their persona by adding observations
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, storageClient } from '@metahuman/core';
import { auditAction } from '@metahuman/core/audit';
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

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const body = await request.json();
    const { notes } = body as { notes: string };

    if (!notes || typeof notes !== 'string' || notes.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Notes text is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Convert notes to a conversation format for the extractor
    // We'll treat it as if the user answered a general question
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'Tell me about yourself, your personality, values, and what matters to you.',
      },
      {
        role: 'user',
        content: notes,
      },
    ];

    // Extract persona data from notes
    const extracted = await extractPersonaFromTranscript(messages);

    // Load existing persona
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
    const currentPersona = loadExistingPersona(personaPath);

    // Create backup before applying changes
    const backupDir = path.join(path.dirname(personaPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `persona-core-notes-${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(currentPersona, null, 2), 'utf-8');

    // Merge extracted data with existing persona (using 'merge' strategy)
    const { updated } = mergePersonaDraft(currentPersona, extracted, 'merge');

    // Save updated persona
    savePersona(personaPath, updated);

    // Save notes as episodic memory
    await captureEvent(`Persona Notes - Self-Reflection\n\n${notes}`, {
      type: 'observation',
      tags: ['persona-notes', 'self-reflection', 'quick-add'],
      metadata: {
        source: 'persona-generator-notes',
        extractedPersona: true,
        confidence: extracted.confidence?.overall || 0,
      },
    });

    // Audit the action
    await auditAction({
      action: 'persona_notes_added',
      actor: user.username,
      details: {
        notesLength: notes.length,
        backupPath,
        confidence: extracted.confidence?.overall || 0,
        timestamp: new Date().toISOString(),
      },
      outcome: 'success',
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Notes processed and merged with persona',
        extracted,
        backupPath,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[persona/generator/add-notes] POST error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to process notes',
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
