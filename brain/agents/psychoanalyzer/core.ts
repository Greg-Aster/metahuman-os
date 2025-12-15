/**
 * Psychoanalyzer Agent — Core Logic
 *
 * Reviews recent episodic memories using the psychotherapist model,
 * extracts personality insights, and incrementally updates persona files.
 * Creates archives for version tracking and change history.
 *
 * This module provides:
 * - runPsychoanalysis() for single-user processing
 * - runCycle() for CLI usage
 * - run() for agent-runtime (mobile) usage
 */

import fs from 'node:fs';
import path from 'node:path';

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  storageClient,
  systemPaths,
  ROOT,
  listAllUsers,
  withUserContext,
  audit,
} from '@metahuman/core';
import { callLLM } from '@metahuman/core/model-router';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface PsychoanalyzerConfig {
  enabled: boolean;
  memorySelection: {
    strategy: string;
    daysBack: number;
    maxMemories: number;
    minMemories: number;
    excludeTypes: string[];
    priorityTags: string[];
  };
  analysis: {
    model: string;
    temperature: number;
    focusAreas: string[];
    confidenceThreshold: number;
  };
  updateStrategy: {
    mode: string;
    preserveUserEdits: boolean;
    mergeStrategy: string;
    fields: Record<string, boolean>;
  };
  reconciliation: {
    enabled: boolean;
    removeStaleGoals: boolean;
    removeStaleInterests: boolean;
    updateGoalStatuses: boolean;
    removeContradictedValues: boolean;
    removeUnusedHeuristics: boolean;
  };
  archival: {
    enabled: boolean;
    path: string;
    format: string;
    keepVersions: number;
    generateChangelog: boolean;
    changelogPath: string;
  };
  notifications: {
    createMemory: boolean;
    memoryType: string;
    title: string;
    includeChangeSummary: boolean;
  };
}

interface Memory {
  id: string;
  timestamp: string;
  content: string;
  type: string;
  tags?: string[];
  entities?: string[];
  importance?: number;
}

export interface AnalysisResult {
  insights: {
    values?: Array<{ value: string; description: string; evidence: string[] }>;
    goals?: {
      shortTerm?: Array<{ goal: string; status: string }>;
      midTerm?: Array<{ goal: string; status: string }>;
      longTerm?: Array<{ goal: string; status: string }>;
    };
    interests?: string[];
    communicationPatterns?: string[];
    decisionHeuristics?: Array<{ signal: string; response: string; evidence: string }>;
    personalityShifts?: string[];
    aesthetic?: string[];
    motifs?: string[];
  };
  reconciliation?: {
    staleGoals?: Array<{ goal: string; timeframe: string; reason: string }>;
    staleInterests?: Array<{ interest: string; reason: string }>;
    updatedGoals?: Array<{ goal: string; timeframe: string; newStatus: string; reason: string }>;
    removedValues?: Array<{ value: string; reason: string }>;
    removedHeuristics?: Array<{ signal: string; reason: string }>;
  };
  confidence: number;
  summary: string;
  memoriesAnalyzed: number;
  dateRange: { start: string; end: string };
}

export interface PsychoanalyzerOptions {
  singleUser?: boolean;
  username?: string;
}

export interface PsychoanalyzerResult {
  success: boolean;
  usersProcessed: number;
  errors: string[];
  stats: Record<string, UserPsychoanalyzerStats>;
}

export interface UserPsychoanalyzerStats {
  memoriesAnalyzed: number;
  confidence: number;
  changesApplied: number;
  skipped?: boolean;
  skipReason?: string;
}

// ─────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<PsychoanalyzerConfig> {
  const configPath = path.join(systemPaths.etc, 'psychoanalyzer.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Psychoanalyzer configuration not found at etc/psychoanalyzer.json');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

export async function selectMemories(config: PsychoanalyzerConfig): Promise<Memory[]> {
  console.log('[psychoanalyzer] Selecting memories for analysis...');

  const episodicResult = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' });
  const episodicPath = episodicResult.success && episodicResult.path ? episodicResult.path : null;
  if (!episodicPath) {
    throw new Error('Cannot resolve episodic memory path');
  }
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.memorySelection.daysBack);

  const memories: Memory[] = [];
  const years = fs.readdirSync(episodicPath).filter(f => f.match(/^\d{4}$/));

  for (const year of years.sort().reverse()) {
    const yearPath = path.join(episodicPath, year);
    const files = fs.readdirSync(yearPath)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();

    for (const file of files) {
      if (memories.length >= config.memorySelection.maxMemories) break;

      const filePath = path.join(yearPath, file);
      try {
        const memory: Memory = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        const memoryDate = new Date(memory.timestamp);
        if (memoryDate < cutoffDate) continue;
        if (config.memorySelection.excludeTypes.includes(memory.type)) continue;

        const hasPriorityTag = memory.tags?.some(tag =>
          config.memorySelection.priorityTags.includes(tag)
        );

        if (hasPriorityTag) {
          memories.unshift(memory);
        } else {
          memories.push(memory);
        }
      } catch {
        // Skip malformed files
      }
    }

    if (memories.length >= config.memorySelection.maxMemories) break;
  }

  const selected = memories.slice(0, config.memorySelection.maxMemories);
  console.log(`[psychoanalyzer] Selected ${selected.length} memories from last ${config.memorySelection.daysBack} days`);

  return selected;
}

export async function analyzeMemories(memories: Memory[], config: PsychoanalyzerConfig): Promise<AnalysisResult> {
  console.log('[psychoanalyzer] Analyzing memories with psychotherapist model...');

  const personaResult = storageClient.resolvePath({ category: 'config', subcategory: 'persona', relativePath: 'core.json' });
  const personaPath = personaResult.success && personaResult.path ? personaResult.path : null;
  if (!personaPath) {
    throw new Error('Cannot resolve persona core path');
  }
  const currentPersona = JSON.parse(fs.readFileSync(personaPath, 'utf-8'));

  const transcript = memories.map((m, i) =>
    `[${i + 1}] ${m.timestamp} (${m.type})\n${m.content}\n${m.tags ? `Tags: ${m.tags.join(', ')}` : ''}`
  ).join('\n\n---\n\n');

  const dateRange = {
    start: memories[memories.length - 1].timestamp,
    end: memories[0].timestamp,
  };

  const analysisPrompt = `You are a psychotherapist analyzing episodic memories to extract personality insights.

# Current Persona
${JSON.stringify({
  values: currentPersona.values?.core || [],
  goals: currentPersona.goals || {},
  interests: currentPersona.personality?.interests || [],
}, null, 2)}

# Recent Memories (${memories.length} total)
${transcript}

Return a JSON object analyzing values, goals, interests, and personality patterns. Include confidence score 0-1.`;

  const messages = [{ role: 'user' as const, content: analysisPrompt }];

  const response = await callLLM({
    role: 'psychotherapist',
    messages,
    options: { temperature: config.analysis.temperature },
  });

  let analysisResult: AnalysisResult;
  try {
    const content = typeof response === 'string' ? response : response.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const parsed = JSON.parse(jsonMatch[0]);
    analysisResult = {
      ...parsed,
      memoriesAnalyzed: memories.length,
      dateRange,
    };
  } catch {
    throw new Error('Failed to parse psychotherapist analysis');
  }

  console.log(`[psychoanalyzer] Analysis complete (confidence: ${analysisResult.confidence.toFixed(2)})`);
  return analysisResult;
}

export async function updatePersona(
  analysis: AnalysisResult,
  config: PsychoanalyzerConfig
): Promise<{ updated: any; changes: string[] }> {
  console.log('[psychoanalyzer] Updating persona with new insights...');

  if (analysis.confidence < config.analysis.confidenceThreshold) {
    console.log(`[psychoanalyzer] Confidence ${analysis.confidence.toFixed(2)} below threshold, skipping update`);
    return { updated: null, changes: [] };
  }

  const personaResult = storageClient.resolvePath({ category: 'config', subcategory: 'persona', relativePath: 'core.json' });
  const personaPath = personaResult.success && personaResult.path ? personaResult.path : null;
  if (!personaPath) {
    throw new Error('Cannot resolve persona core path');
  }
  const currentPersona = JSON.parse(fs.readFileSync(personaPath, 'utf-8'));
  const changes: string[] = [];

  const insights = analysis.insights;

  // Update values
  if (config.updateStrategy.fields['values.core'] && insights.values) {
    const existingValues = currentPersona.values?.core || [];
    const newValues = insights.values.filter(v =>
      !existingValues.some((ev: any) => ev.value === v.value)
    );
    if (newValues.length > 0) {
      currentPersona.values = currentPersona.values || {};
      currentPersona.values.core = [...existingValues, ...newValues];
      changes.push(`Added ${newValues.length} new value(s)`);
    }
  }

  // Update interests
  if (config.updateStrategy.fields['personality.interests'] && insights.interests) {
    currentPersona.personality = currentPersona.personality || {};
    const existing = currentPersona.personality.interests || [];
    const newInterests = insights.interests.filter(i => !existing.includes(i));
    if (newInterests.length > 0) {
      currentPersona.personality.interests = [...existing, ...newInterests];
      changes.push(`Added ${newInterests.length} new interest(s)`);
    }
  }

  currentPersona.lastUpdated = new Date().toISOString();

  if (changes.length > 0) {
    fs.writeFileSync(personaPath, JSON.stringify(currentPersona, null, 2), 'utf-8');
    console.log(`[psychoanalyzer] Applied ${changes.length} update(s) to persona`);
  }

  return { updated: currentPersona, changes };
}

/**
 * Run psychoanalysis for a single user
 */
export async function runPsychoanalysis(username: string): Promise<UserPsychoanalyzerStats> {
  return await withUserContext(username, async () => {
    console.log(`[psychoanalyzer] Processing user: ${username}`);

    const config = await loadConfig();

    if (!config.enabled) {
      return { memoriesAnalyzed: 0, confidence: 0, changesApplied: 0, skipped: true, skipReason: 'disabled' };
    }

    const memories = await selectMemories(config);

    if (memories.length < config.memorySelection.minMemories) {
      return {
        memoriesAnalyzed: memories.length,
        confidence: 0,
        changesApplied: 0,
        skipped: true,
        skipReason: `Insufficient memories (${memories.length}/${config.memorySelection.minMemories})`,
      };
    }

    const analysis = await analyzeMemories(memories, config);
    const { changes } = await updatePersona(analysis, config);

    return {
      memoriesAnalyzed: analysis.memoriesAnalyzed,
      confidence: analysis.confidence,
      changesApplied: changes.length,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────────────────────

export async function runCycle(options: PsychoanalyzerOptions = {}): Promise<PsychoanalyzerResult> {
  const result: PsychoanalyzerResult = {
    success: true,
    usersProcessed: 0,
    errors: [],
    stats: {},
  };

  try {
    let users: string[];

    if (options.username) {
      users = [options.username];
    } else if (options.singleUser) {
      users = ['default'];
    } else {
      users = listAllUsers();
    }

    for (const username of users) {
      try {
        const stats = await runPsychoanalysis(username);
        result.stats[username] = stats;
        result.usersProcessed++;

        audit({
          category: 'action',
          level: 'info',
          event: 'psychoanalyzer_completed',
          actor: 'psychoanalyzer',
          details: {
            username,
            memoriesAnalyzed: stats.memoriesAnalyzed,
            confidence: stats.confidence,
            changesApplied: stats.changesApplied,
          },
        });
      } catch (error) {
        const errorMsg = `Error processing ${username}: ${(error as Error).message}`;
        result.errors.push(errorMsg);
        console.error(`[psychoanalyzer] ${errorMsg}`);
      }
    }

    return result;
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);
    return result;
  }
}

// ─────────────────────────────────────────────────────────────
// Agent Runtime Entry Point
// ─────────────────────────────────────────────────────────────

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  let username = opts.username as string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
      break;
    }
  }

  const options: PsychoanalyzerOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    username: username || ctx.userId,
  };

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
