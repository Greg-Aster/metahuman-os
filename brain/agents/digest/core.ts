/**
 * Digest Agent — Core Logic
 *
 * Builds long-term thematic understanding from memories:
 * - Analyzes recent memories for recurring themes
 * - Extracts frequently referenced facts and patterns
 * - Identifies catchphrases and quirks
 * - Updates persona cache for quick reference
 *
 * This module provides:
 * - runCycle() for CLI usage
 * - run() for agent-runtime (mobile) usage
 */

import fs from 'node:fs';
import path from 'node:path';

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  audit,
  auditAction,
  callLLM,
  type RouterMessage,
  loadPersonaCache,
  savePersonaCache,
  trackTheme,
  addCatchphrase,
  updateFrequentFact,
  getProfilePaths,
  getTargetUser,
  withUserContext,
} from '@metahuman/core';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

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

export interface DigestOutput {
  themes: Array<{ theme: string; description: string; frequency: number }>;
  facts: Record<string, any>;
  catchphrases: string[];
  patterns: string[];
}

export interface DigestOptions {
  singleUser?: boolean;
  days?: number;
}

export interface DigestResult {
  success: boolean;
  usersProcessed: number;
  errors: string[];
  stats: Record<string, UserDigestStats>;
}

export interface UserDigestStats {
  memoriesAnalyzed: number;
  themesIdentified: number;
  factsExtracted: number;
  catchphrases: number;
  patterns: number;
}

// ─────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────

/**
 * Load recent memories (last N days) for a user
 */
export async function loadRecentMemories(username: string, days = 14): Promise<EpisodicMemory[]> {
  const profilePaths = getProfilePaths(username);
  const episodicPath = profilePaths.episodic;
  const memories: EpisodicMemory[] = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  if (!fs.existsSync(episodicPath)) {
    return memories;
  }

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
export async function analyzeMemories(memories: EpisodicMemory[]): Promise<DigestOutput> {
  console.log(`[digest] Analyzing ${memories.length} recent memories for themes...`);

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
    console.error(`[digest] Failed to analyze memories:`, error);
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
export function updatePersonaCacheFromDigest(digest: DigestOutput): void {
  console.log(`[digest] Updating persona cache with ${digest.themes.length} themes...`);

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

  console.log('[digest] Persona cache updated successfully');
}

/**
 * Generate digest for a single user
 */
export async function generateUserDigest(
  username: string,
  days: number = 14
): Promise<UserDigestStats> {
  return await withUserContext(username, async () => {
    console.log(`[digest] Processing user: ${username}`);

    // Load recent memories
    const memories = await loadRecentMemories(username, days);
    console.log(`[digest] Found ${memories.length} recent memories`);

    if (memories.length === 0) {
      console.log('[digest] No recent memories to process');
      return {
        memoriesAnalyzed: 0,
        themesIdentified: 0,
        factsExtracted: 0,
        catchphrases: 0,
        patterns: 0,
      };
    }

    // Analyze memories for themes and patterns
    const digest = await analyzeMemories(memories);

    console.log(`[digest] Analysis complete:`);
    console.log(`  - ${digest.themes.length} themes identified`);
    console.log(`  - ${Object.keys(digest.facts).length} frequent facts`);
    console.log(`  - ${digest.catchphrases.length} catchphrases`);
    console.log(`  - ${digest.patterns.length} patterns`);

    // Update persona cache
    updatePersonaCacheFromDigest(digest);

    return {
      memoriesAnalyzed: memories.length,
      themesIdentified: digest.themes.length,
      factsExtracted: Object.keys(digest.facts).length,
      catchphrases: digest.catchphrases.length,
      patterns: digest.patterns.length,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Run digest cycle for all users (CLI usage)
 */
export async function runCycle(options: DigestOptions = {}): Promise<DigestResult> {
  const result: DigestResult = {
    success: true,
    usersProcessed: 0,
    errors: [],
    stats: {},
  };

  const days = options.days ?? 14;

  try {
    // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
    let username: string | null = null;
    if (options.singleUser) {
      username = 'default';
    } else {
      const activeUser = getTargetUser();
      if (activeUser) {
        username = activeUser.username;
      }
    }

    if (!username) {
      console.log('[digest] No active user found');
      return result;
    }

    auditAction({
      event: 'digest_started',
      details: {
        timestamp: new Date().toISOString(),
        username,
        days,
      },
    });

    console.log(`[digest] Processing user: ${username}`);

    try {
      const stats = await generateUserDigest(username, days);
      result.stats[username] = stats;
      result.usersProcessed++;

      audit({
        category: 'system',
        level: 'info',
        message: `Digest completed for ${username}: ${stats.memoriesAnalyzed} memories analyzed`,
        actor: 'digest',
        metadata: stats,
      });
    } catch (error) {
      const errorMsg = `Error processing ${username}: ${(error as Error).message}`;
      result.errors.push(errorMsg);
      console.error(`[digest] ${errorMsg}`);
    }

    auditAction({
      event: 'digest_completed',
      details: {
        usersProcessed: result.usersProcessed,
        errors: result.errors.length,
      },
    });
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);
    console.error('[digest] Fatal error:', error);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// Agent Runtime Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Agent runtime entry point for mobile execution
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  const options: DigestOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    days: opts.days ?? 14,
  };

  // If context has a specific user, process only that user
  if (ctx.userId) {
    try {
      const stats = await generateUserDigest(ctx.userId, options.days ?? 14);

      return {
        success: true,
        data: {
          user: ctx.userId,
          stats,
        },
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // Otherwise run full cycle
  const result = await runCycle(options);

  return {
    success: result.success,
    data: {
      usersProcessed: result.usersProcessed,
      stats: result.stats,
    },
    errors: result.errors.length > 0 ? result.errors : undefined,
    durationMs: Date.now() - startTime,
  };
}
