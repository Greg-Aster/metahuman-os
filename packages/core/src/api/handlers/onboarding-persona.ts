import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { storageClient } from '../../storage-client.js';
import { extractPersonaFromTranscript, type ChatMessage } from '../../persona/extractor.js';
import { loadExistingPersona, mergePersonaDraft, savePersona } from '../../persona/merger.js';
import { captureEvent } from '../../memory.js';

/**
 * POST /api/onboarding/extract-persona
 */
export async function handleExtractOnboardingPersona(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { messages } = (req.body || {}) as { messages?: ChatMessage[] };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        status: 400,
        data: { error: 'Invalid request body. Expected { messages: ChatMessage[] }' },
      };
    }

    const extracted = await extractPersonaFromTranscript(messages);

    const personaCoreResult = storageClient.resolvePath({
      category: 'config',
      subcategory: 'persona',
      relativePath: 'core.json',
    });
    if (!personaCoreResult.success || !personaCoreResult.path) {
      return {
        status: 403,
        data: { error: 'Access denied' },
      };
    }

    const personaPath = personaCoreResult.path;
    const currentPersona = loadExistingPersona(personaPath);

    const backupDir = path.join(path.dirname(personaPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `persona-core-onboarding-${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(currentPersona, null, 2), 'utf-8');

    const { updated } = mergePersonaDraft(currentPersona, extracted, 'merge');
    savePersona(personaPath, updated);

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

    const profileRootResult = storageClient.getProfileRoot();
    if (!profileRootResult.success || !profileRootResult.path) {
      return {
        status: 403,
        data: { error: 'Access denied' },
      };
    }

    const trainingDir = path.join(profileRootResult.path, 'memory/training/personality-surveys');
    fs.mkdirSync(trainingDir, { recursive: true });

    const trainingPath = path.join(trainingDir, `quick-survey-${timestamp}.jsonl`);
    const trainingData = messages
      .map((m) => JSON.stringify({ role: m.role, content: m.content }))
      .join('\n');

    fs.writeFileSync(trainingPath, trainingData, 'utf-8');

    return {
      status: 200,
      data: {
        success: true,
        message: 'Personality data extracted and saved',
        extracted,
        personaPath,
        backupPath,
        trainingDataPath: trainingPath,
        episodicMemorySaved: true,
      },
    };
  } catch (error) {
    return {
      status: 500,
      data: {
        error: 'Failed to extract personality data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}
