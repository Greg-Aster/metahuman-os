/**
 * Memory Pruner Agent — Core Logic
 *
 * Cleans up memory storage by removing duplicates and low-quality entries:
 * - Detects exact duplicate memories
 * - Detects near-duplicates using content similarity
 * - Removes low-quality memories (too short, error messages, etc.)
 * - Provides statistics on what was removed
 * - Supports dry-run mode for preview
 *
 * Usage (CLI):
 *   tsx brain/agents/memory-pruner/cli.ts --username <name> [--dry-run] [--verbose]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  audit,
  getTargetUser,
  withUserContext,
  getUserContext,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';

// ============================================================================
// Types
// ============================================================================

export interface EpisodicMemory {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  response?: string;
  metadata?: {
    cognitiveMode?: string;
    processed?: boolean;
    curated?: boolean;
    [key: string]: any;
  };
}

export interface PruneReason {
  type: 'exact-duplicate' | 'near-duplicate' | 'low-quality' | 'contamination' | 'empty';
  description: string;
  duplicateOf?: string;
}

export interface PrunedMemory {
  id: string;
  path: string;
  reason: PruneReason;
  content: string;
  timestamp: string;
}

export interface PrunerOptions {
  dryRun?: boolean;
  verbose?: boolean;
  minContentLength?: number;
  similarityThreshold?: number;
  username?: string;
}

export interface PrunerResult {
  success: boolean;
  memoriesScanned: number;
  memoriesPruned: number;
  duplicatesFound: number;
  lowQualityFound: number;
  contaminationFound: number;
  prunedMemories: PrunedMemory[];
  errors: string[];
}

// ============================================================================
// Quality Detection
// ============================================================================

/**
 * Contamination patterns to detect and remove
 */
const CONTAMINATION_PATTERNS = [
  /\byou\s+ok\s+home\b/i,
  /\btest\s+test\s+test\b/i,
  /^(hello|hi|hey)[\s,.!?]*$/i, // Single greeting with no content
  /^(ok|okay|yes|no|sure|fine)[\s,.!?]*$/i, // Single word replies
  /\b(as an ai|as a language model|i cannot|i don't have the ability)\b/i,
  /\berror:\s*[A-Z_]+\b/i, // Error codes
  /\bstack\s*trace\b/i,
  /\bundefined\b.*\bundefined\b.*\bundefined\b/i, // Multiple undefined
  /^\s*\{[\s\S]*\}\s*$/m, // Pure JSON response
  /^<\?xml/i, // XML response
];

/**
 * Check if content is low quality
 */
function isLowQuality(content: string, minLength: number = 10): PruneReason | null {
  // Too short
  if (!content || content.trim().length < minLength) {
    return { type: 'low-quality', description: `Content too short (< ${minLength} chars)` };
  }

  // Empty or whitespace only
  if (!content.trim()) {
    return { type: 'empty', description: 'Empty or whitespace-only content' };
  }

  // Single repeated character
  const uniqueChars = new Set(content.replace(/\s/g, '').toLowerCase());
  if (uniqueChars.size < 3 && content.length > 5) {
    return { type: 'low-quality', description: 'Content is mostly repeated characters' };
  }

  return null;
}

/**
 * Check if content matches contamination patterns
 */
function hasContamination(content: string): PruneReason | null {
  for (const pattern of CONTAMINATION_PATTERNS) {
    if (pattern.test(content)) {
      return {
        type: 'contamination',
        description: `Matches contamination pattern: ${pattern.source.substring(0, 30)}...`,
      };
    }
  }
  return null;
}

/**
 * Generate content hash for exact duplicate detection
 */
function getContentHash(content: string): string {
  // Normalize: lowercase, collapse whitespace, trim
  const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Simple similarity check (Jaccard on word sets)
 */
function getSimilarity(content1: string, content2: string): number {
  const words1 = new Set(content1.toLowerCase().match(/\w+/g) || []);
  const words2 = new Set(content2.toLowerCase().match(/\w+/g) || []);

  if (words1.size === 0 && words2.size === 0) return 1;
  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

// ============================================================================
// Memory Operations
// ============================================================================

/**
 * Load all episodic memories for a user
 */
async function loadMemories(episodicDir: string): Promise<Array<EpisodicMemory & { path: string }>> {
  const memories: Array<EpisodicMemory & { path: string }> = [];

  if (!fs.existsSync(episodicDir)) {
    return memories;
  }

  // Walk the year directories
  const years = fs.readdirSync(episodicDir).filter(d => /^\d{4}$/.test(d));

  for (const year of years) {
    const yearDir = path.join(episodicDir, year);
    const files = fs.readdirSync(yearDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(yearDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const memory = JSON.parse(content) as EpisodicMemory;
        memories.push({ ...memory, path: filePath });
      } catch (err) {
        console.warn(`[memory-pruner] Failed to load ${file}: ${(err as Error).message}`);
      }
    }
  }

  return memories;
}

/**
 * Delete a memory file (or move to archive)
 */
function deleteMemory(memoryPath: string, dryRun: boolean): boolean {
  if (dryRun) {
    console.log(`[memory-pruner] [DRY RUN] Would delete: ${memoryPath}`);
    return true;
  }

  try {
    // Move to _pruned directory instead of deleting
    const dir = path.dirname(memoryPath);
    const prunedDir = path.join(dir, '_pruned');
    if (!fs.existsSync(prunedDir)) {
      fs.mkdirSync(prunedDir, { recursive: true });
    }

    const newPath = path.join(prunedDir, path.basename(memoryPath));
    fs.renameSync(memoryPath, newPath);
    console.log(`[memory-pruner] Moved to pruned: ${path.basename(memoryPath)}`);
    return true;
  } catch (err) {
    console.error(`[memory-pruner] Failed to delete ${memoryPath}: ${(err as Error).message}`);
    return false;
  }
}

// ============================================================================
// Main Pruning Logic
// ============================================================================

/**
 * Run pruner for a specific user
 */
export async function runPrunerForUser(
  username: string,
  options: PrunerOptions = {}
): Promise<PrunerResult> {
  return await withUserContext({ userId: username, username, role: 'owner' }, async () => {
    const ctx = getUserContext();
    if (!ctx?.profilePaths) {
      throw new Error('User context not available');
    }

    const {
      dryRun = false,
      verbose = false,
      minContentLength = 10,
      similarityThreshold = 0.85,
    } = options;

    const episodicDir = ctx.profilePaths.episodic;
    console.log(`[memory-pruner] Scanning memories for user: ${username}`);
    console.log(`[memory-pruner] Episodic dir: ${episodicDir}`);
    if (dryRun) {
      console.log(`[memory-pruner] ⚠️  DRY RUN MODE - no changes will be made`);
    }

    const memories = await loadMemories(episodicDir);
    console.log(`[memory-pruner] Loaded ${memories.length} memories`);

    const result: PrunerResult = {
      success: true,
      memoriesScanned: memories.length,
      memoriesPruned: 0,
      duplicatesFound: 0,
      lowQualityFound: 0,
      contaminationFound: 0,
      prunedMemories: [],
      errors: [],
    };

    // Track seen content hashes for duplicate detection
    const seenHashes = new Map<string, { id: string; path: string }>();
    // Track content for similarity comparison (sample for efficiency)
    const contentSamples: Array<{ id: string; content: string }> = [];

    // Sort by timestamp (oldest first - keep oldest, prune newer duplicates)
    memories.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    for (const memory of memories) {
      let shouldPrune = false;
      let pruneReason: PruneReason | null = null;

      const combinedContent = memory.content + (memory.response || '');

      // Check 1: Low quality
      const lowQualityCheck = isLowQuality(combinedContent, minContentLength);
      if (lowQualityCheck) {
        shouldPrune = true;
        pruneReason = lowQualityCheck;
        result.lowQualityFound++;
        if (verbose) console.log(`[memory-pruner] Low quality: ${memory.id} - ${lowQualityCheck.description}`);
      }

      // Check 2: Contamination patterns
      if (!shouldPrune) {
        const contaminationCheck = hasContamination(combinedContent);
        if (contaminationCheck) {
          shouldPrune = true;
          pruneReason = contaminationCheck;
          result.contaminationFound++;
          if (verbose) console.log(`[memory-pruner] Contamination: ${memory.id} - ${contaminationCheck.description}`);
        }
      }

      // Check 3: Exact duplicate
      if (!shouldPrune) {
        const hash = getContentHash(combinedContent);
        const existing = seenHashes.get(hash);
        if (existing) {
          shouldPrune = true;
          pruneReason = {
            type: 'exact-duplicate',
            description: 'Exact duplicate of another memory',
            duplicateOf: existing.id,
          };
          result.duplicatesFound++;
          if (verbose) console.log(`[memory-pruner] Exact duplicate: ${memory.id} of ${existing.id}`);
        } else {
          seenHashes.set(hash, { id: memory.id, path: memory.path });
        }
      }

      // Check 4: Near-duplicate (expensive, so only check against sample)
      if (!shouldPrune && contentSamples.length > 0 && combinedContent.length > 50) {
        // Only check last 100 samples for efficiency
        const recentSamples = contentSamples.slice(-100);
        for (const sample of recentSamples) {
          const similarity = getSimilarity(combinedContent, sample.content);
          if (similarity >= similarityThreshold) {
            shouldPrune = true;
            pruneReason = {
              type: 'near-duplicate',
              description: `${Math.round(similarity * 100)}% similar to another memory`,
              duplicateOf: sample.id,
            };
            result.duplicatesFound++;
            if (verbose) console.log(`[memory-pruner] Near-duplicate: ${memory.id} (${Math.round(similarity * 100)}% similar to ${sample.id})`);
            break;
          }
        }
      }

      // Add to samples for future comparison (if not pruned)
      if (!shouldPrune && combinedContent.length > 50) {
        contentSamples.push({ id: memory.id, content: combinedContent });
      }

      // Prune if flagged
      if (shouldPrune && pruneReason) {
        result.prunedMemories.push({
          id: memory.id,
          path: memory.path,
          reason: pruneReason,
          content: combinedContent.substring(0, 100) + '...',
          timestamp: memory.timestamp,
        });

        const deleted = deleteMemory(memory.path, dryRun);
        if (deleted) {
          result.memoriesPruned++;
        } else {
          result.errors.push(`Failed to delete ${memory.path}`);
        }
      }
    }

    // Log summary
    console.log(`\n[memory-pruner] === PRUNING SUMMARY ===`);
    console.log(`[memory-pruner] Memories scanned: ${result.memoriesScanned}`);
    console.log(`[memory-pruner] Memories pruned: ${result.memoriesPruned}`);
    console.log(`[memory-pruner]   - Duplicates: ${result.duplicatesFound}`);
    console.log(`[memory-pruner]   - Low quality: ${result.lowQualityFound}`);
    console.log(`[memory-pruner]   - Contamination: ${result.contaminationFound}`);
    if (dryRun) {
      console.log(`[memory-pruner] (DRY RUN - no changes made)`);
    } else if (result.memoriesPruned > 0) {
      console.log(`\n[memory-pruner] 💡 IMPORTANT: Rebuild the search index to remove pruned memories from search results.`);
      console.log(`[memory-pruner]    Run: ./bin/mh index build --username ${username}`);
      console.log(`[memory-pruner]    Or use the "Rebuild" button in the Memory Controls UI.`);
    }

    // Audit
    audit({
      category: 'action',
      level: 'info',
      event: dryRun ? 'memory_pruner_dry_run' : 'memory_pruner_completed',
      actor: 'memory-pruner',
      details: {
        username,
        memoriesScanned: result.memoriesScanned,
        memoriesPruned: result.memoriesPruned,
        duplicatesFound: result.duplicatesFound,
        lowQualityFound: result.lowQualityFound,
        contaminationFound: result.contaminationFound,
        dryRun,
      },
    });

    return result;
  });
}

// ============================================================================
// CLI Cycle (for all users)
// ============================================================================

/**
 * Run pruner cycle for all users
 */
export async function runCycle(options: PrunerOptions = {}): Promise<{
  success: boolean;
  usersProcessed: number;
  results: Record<string, PrunerResult>;
  errors: string[];
}> {
  const result = {
    success: true,
    usersProcessed: 0,
    results: {} as Record<string, PrunerResult>,
    errors: [] as string[],
  };

  try {
    // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
    let username: string | null = null;

    if (options.username) {
      username = options.username;
    } else {
      const activeUser = getTargetUser();
      if (activeUser) {
        username = activeUser.username;
      }
    }

    if (!username) {
      console.log('[memory-pruner] No active user found');
      return result;
    }

    console.log(`[memory-pruner] Processing user: ${username}`);

    try {
      const userResult = await runPrunerForUser(username, options);
      result.results[username] = userResult;
      result.usersProcessed++;
    } catch (error) {
      const errorMsg = `Error processing ${username}: ${(error as Error).message}`;
      result.errors.push(errorMsg);
      console.error(`[memory-pruner] ${errorMsg}`);
    }
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);
    console.error('[memory-pruner] Fatal error:', error);
  }

  return result;
}

// ============================================================================
// Agent Runtime Entry Point
// ============================================================================

/**
 * Agent runtime entry point for mobile/Trigger Manager execution
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  let username = opts.username as string | undefined;
  let dryRun = args.includes('--dry-run') || opts.dryRun === true;
  let verbose = args.includes('--verbose') || opts.verbose === true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
    }
  }

  const effectiveUserId = ctx.userId !== 'system' ? ctx.userId : undefined;

  const options: PrunerOptions = {
    dryRun,
    verbose,
    username: username || effectiveUserId,
  };

  if (options.username) {
    try {
      const result = await runPrunerForUser(options.username, options);

      return {
        success: true,
        data: {
          user: options.username,
          ...result,
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

  const result = await runCycle(options);

  return {
    success: result.success,
    data: {
      usersProcessed: result.usersProcessed,
      results: result.results,
    },
    errors: result.errors.length > 0 ? result.errors : undefined,
    durationMs: Date.now() - startTime,
  };
}
