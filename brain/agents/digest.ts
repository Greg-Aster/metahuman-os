#!/usr/bin/env node
/**
 * Digest Agent - Builds Long-Term Thematic Understanding
 *
 * This agent:
 * - Analyzes recent memories for recurring themes
 * - Extracts frequently referenced facts and patterns
 * - Identifies catchphrases and quirks
 * - Updates persona cache for quick reference
 * - Builds long-term thematic digest for persona model
 *
 * Part of Phase 5: Conscious/Unconscious State
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// For ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

// Import from core
import {
  paths,
  audit,
  auditAction,
  callLLM,
  type RouterMessage,
  acquireLock,
  isLocked,
  initGlobalLogger,
  loadPersonaCache,
  savePersonaCache,
  trackTheme,
  addCatchphrase,
  updateFrequentFact,
} from '@metahuman/core';

interface EpisodicMemory {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  entities?: string[];
  tags?: string[];
  response?: string;
  metadata?: Record<string, any>;
}

interface DigestOutput {
  themes: Array<{ theme: string; description: string; frequency: number }>;
  facts: Record<string, any>;
  catchphrases: string[];
  patterns: string[];
}

/**
 * Load recent memories (last N days)
 */
async function loadRecentMemories(days = 14): Promise<EpisodicMemory[]> {
  const episodicPath = path.join(ROOT, 'memory', 'episodic');
  const memories: EpisodicMemory[] = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  // Get all year directories
  const years = fs.readdirSync(episodicPath).filter(f => /^\d{4}$/.test(f));

  for (const year of years.sort().reverse()) {
    const yearPath = path.join(episodicPath, year);
    const files = fs.readdirSync(yearPath).filter(f => f.endsWith('.json'));

    for (const file of files.sort().reverse()) {
      const filePath = path.join(yearPath, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const memory = JSON.parse(content) as EpisodicMemory;

        // Check if memory is within date range
        const memoryDate = new Date(memory.timestamp);
        if (memoryDate < cutoffDate) continue;

        // Skip inner dialogues (those are internal reflections)
        if (memory.type === 'inner_dialogue') continue;

        memories.push(memory);
      } catch (error) {
        console.error(`[digest] Failed to load ${filePath}:`, error);
      }
    }
  }

  return memories;
}

/**
 * Analyze memories for themes, facts, and patterns using curator model
 */
async function analyzeMemories(memories: EpisodicMemory[]): Promise<DigestOutput> {
  console.log(`[Digest] Analyzing ${memories.length} recent memories for themes...`);

  // Prepare memory summary for LLM
  const memorySummary = memories
    .slice(0, 100) // Limit to 100 most recent
    .map(m => {
      const parts: string[] = [];
      if (m.content) parts.push(m.content);
      if (m.tags && m.tags.length > 0) parts.push(`[Tags: ${m.tags.join(', ')}]`);
      if (m.entities && m.entities.length > 0) parts.push(`[Entities: ${m.entities.join(', ')}]`);
      return parts.join(' ');
    })
    .join('\n\n');

  const systemPrompt = `You are a thematic analyst extracting long-term patterns from episodic memories.

Your task:
1. Identify recurring themes across memories (3-5 major themes)
2. Extract frequently referenced facts (people, places, projects, preferences)
3. Detect catchphrases or distinctive language patterns
4. Note behavioral patterns or quirks

Respond with JSON:
{
  "themes": [
    { "theme": "Theme name", "description": "Brief description", "frequency": 5 }
  ],
  "facts": {
    "name": "Value",
    "currentProject": "Project name"
  },
  "catchphrases": ["phrase1", "phrase2"],
  "patterns": ["pattern1", "pattern2"]
}`;

  const messages: RouterMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: `Recent memories:\n\n${memorySummary}`,
    },
  ];

  try {
    const response = await callLLM({
      role: 'curator',
      messages,
      options: {
        temperature: 0.3,
      },
    });

    // Parse the JSON response
    const result = JSON.parse(response.content);

    return {
      themes: result.themes || [],
      facts: result.facts || {},
      catchphrases: result.catchphrases || [],
      patterns: result.patterns || [],
    };
  } catch (error) {
    console.error(`[Digest] Failed to analyze memories:`, error);
    return {
      themes: [],
      facts: {},
      catchphrases: [],
      patterns: [],
    };
  }
}

/**
 * Update persona cache with digest results
 */
function updatePersonaCacheFromDigest(digest: DigestOutput) {
  console.log(`[Digest] Updating persona cache with ${digest.themes.length} themes...`);

  // Track themes
  for (const t of digest.themes) {
    for (let i = 0; i < t.frequency; i++) {
      trackTheme(t.theme, 'digest_agent');
    }
  }

  // Add catchphrases
  for (const phrase of digest.catchphrases) {
    addCatchphrase(phrase, 'digest_agent');
  }

  // Update frequent facts
  for (const [key, value] of Object.entries(digest.facts)) {
    updateFrequentFact(key, value, 'digest_agent');
  }

  // Add patterns as quirks
  const cache = loadPersonaCache();
  for (const pattern of digest.patterns) {
    if (!cache.quirks.includes(pattern)) {
      cache.quirks.push(pattern);
    }
  }
  // Keep only last 30 quirks
  if (cache.quirks.length > 30) {
    cache.quirks = cache.quirks.slice(-30);
  }
  savePersonaCache(cache, 'digest_agent');

  console.log('[Digest] Persona cache updated successfully');
}

/**
 * Main digest process
 */
async function main() {
  initGlobalLogger();

  const lockName = 'digest';
  if (isLocked(lockName)) {
    console.log('[Digest] Another instance is already running. Exiting.');
    process.exit(0);
  }

  let lockHandle;
  try {
    lockHandle = acquireLock(lockName);

    auditAction({
      event: 'digest_started',
      details: { timestamp: new Date().toISOString() },
    });

    // Load recent memories (last 14 days)
    console.log('[Digest] Loading recent memories (last 14 days)...');
    const memories = await loadRecentMemories(14);
    console.log(`[Digest] Found ${memories.length} recent memories`);

    if (memories.length === 0) {
      console.log('[Digest] No recent memories to process. Exiting.');
      auditAction({
        event: 'digest_completed',
        details: { processed: 0 },
      });
      return;
    }

    // Analyze memories for themes and patterns
    const digest = await analyzeMemories(memories);

    console.log(`[Digest] Analysis complete:`);
    console.log(`  - ${digest.themes.length} themes identified`);
    console.log(`  - ${Object.keys(digest.facts).length} frequent facts`);
    console.log(`  - ${digest.catchphrases.length} catchphrases`);
    console.log(`  - ${digest.patterns.length} patterns`);

    // Update persona cache
    updatePersonaCacheFromDigest(digest);

    auditAction({
      event: 'digest_completed',
      details: {
        memoriesAnalyzed: memories.length,
        themesIdentified: digest.themes.length,
        factsExtracted: Object.keys(digest.facts).length,
        catchphrases: digest.catchphrases.length,
        patterns: digest.patterns.length,
      },
    });

    console.log('[Digest] Complete!');

  } catch (error) {
    console.error('[Digest] Fatal error:', error);
    auditAction({
      event: 'digest_error',
      details: { error: (error as Error).message },
    });
    process.exit(1);
  } finally {
    if (lockHandle) {
      lockHandle.release();
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main as runDigest };
