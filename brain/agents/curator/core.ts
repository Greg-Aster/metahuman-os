/**
 * Curator Agent — canonical orchestration.
 *
 * Each batch validates episodic memories into the curated-conversation store.
 * Source memories are marked only after their curated records are durably saved.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  audit,
  getTargetUser,
  listFailedNodes,
  runGraph,
  submitInnerReflection,
  systemPaths,
  validateSvelteFlowGraph,
  withUserContext,
  type SvelteFlowGraph,
} from '@metahuman/core';
import { registerAgent, unregisterAgent } from '@metahuman/core/agent-monitor';

const LOG_PREFIX = '[curator-core]';
const DEFAULT_BATCH_LIMIT = 20;
const DEFAULT_MAX_BATCHES = 100;

export interface CuratorOptions {
  singleUser?: boolean;
  username?: string;
  all?: boolean;
  limit?: number;
  maxBatches?: number;
  temperature?: number;
}

export interface UserCuratorStats {
  memoriesAttempted: number;
  memoriesProcessed: number;
  accepted: number;
  rejected: number;
  saved: number;
  marked: number;
  batches: number;
  hasMore: boolean;
}

export interface CuratorResult {
  success: boolean;
  usersProcessed: number;
  errors: string[];
  stats: Record<string, UserCuratorStats>;
}

function validUsername(username: string): boolean {
  return /^[a-zA-Z0-9_-]{1,50}$/.test(username);
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number, integer = false): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum || (integer && !Number.isInteger(parsed))) {
    const kind = integer ? 'integer' : 'number';
    throw new Error(`${label} must be a ${kind} between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function optionValue(args: string[], index: number, name: string): { value: string; consumed: number } | null {
  const argument = args[index];
  if (argument === name) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    return { value, consumed: 2 };
  }
  if (argument.startsWith(`${name}=`)) {
    const value = argument.slice(name.length + 1);
    if (!value) throw new Error(`${name} requires a value`);
    return { value, consumed: 1 };
  }
  return null;
}

export function normalizeCuratorOptions(options: CuratorOptions): CuratorOptions {
  const normalized: CuratorOptions = {
    singleUser: options.singleUser === true,
    all: options.all === true,
  };
  if (options.username !== undefined) {
    if (!validUsername(options.username)) throw new Error(`Invalid username format: ${options.username}`);
    normalized.username = options.username;
  }
  if (options.limit !== undefined) {
    normalized.limit = boundedNumber(options.limit, 'Curator limit', 1, 500, true);
  }
  if (options.maxBatches !== undefined) {
    normalized.maxBatches = boundedNumber(options.maxBatches, 'Curator max batches', 1, 1000, true);
  }
  if (options.temperature !== undefined) {
    normalized.temperature = boundedNumber(options.temperature, 'Curator temperature', 0, 1);
  }
  return normalized;
}

export function parseCuratorArgs(args: string[], environmentUsername?: string): CuratorOptions {
  const parsed: CuratorOptions = { username: environmentUsername || undefined };

  for (let index = 0; index < args.length;) {
    const argument = args[index];
    if (argument === '--single-user') {
      parsed.singleUser = true;
      index++;
      continue;
    }
    if (argument === '--all') {
      parsed.all = true;
      index++;
      continue;
    }

    const username = optionValue(args, index, '--username');
    if (username) {
      parsed.username = username.value;
      index += username.consumed;
      continue;
    }
    const limit = optionValue(args, index, '--limit');
    if (limit) {
      parsed.limit = Number(limit.value);
      index += limit.consumed;
      continue;
    }
    const maxBatches = optionValue(args, index, '--max-batches');
    if (maxBatches) {
      parsed.maxBatches = Number(maxBatches.value);
      index += maxBatches.consumed;
      continue;
    }
    const temperature = optionValue(args, index, '--temperature');
    if (temperature) {
      parsed.temperature = Number(temperature.value);
      index += temperature.consumed;
      continue;
    }

    throw new Error(`Unknown curator option: ${argument}`);
  }

  return normalizeCuratorOptions(parsed);
}

export async function loadCuratorGraph(
  options: Pick<CuratorOptions, 'limit' | 'temperature'> = {},
): Promise<SvelteFlowGraph> {
  const graphPath = path.join(systemPaths.etc, 'cognitive-graphs', 'curator-mode.json');
  const graph = validateSvelteFlowGraph(JSON.parse(await fs.readFile(graphPath, 'utf-8')));

  for (const node of graph.nodes) {
    if (node.data.nodeType === 'uncurated_memory_loader' && options.limit !== undefined) {
      node.data.properties = { ...node.data.properties, limit: options.limit };
    }
    if (node.data.nodeType === 'curator_llm' && options.temperature !== undefined) {
      node.data.properties = { ...node.data.properties, temperature: options.temperature };
    }
  }

  return graph;
}

function numericOutput(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Curator graph returned invalid ${label}`);
  }
  return value;
}

function emptyStats(): UserCuratorStats {
  return {
    memoriesAttempted: 0,
    memoriesProcessed: 0,
    accepted: 0,
    rejected: 0,
    saved: 0,
    marked: 0,
    batches: 0,
    hasMore: false,
  };
}

function addStats(total: UserCuratorStats, batch: UserCuratorStats): UserCuratorStats {
  return {
    memoriesAttempted: total.memoriesAttempted + batch.memoriesAttempted,
    memoriesProcessed: total.memoriesProcessed + batch.memoriesProcessed,
    accepted: total.accepted + batch.accepted,
    rejected: total.rejected + batch.rejected,
    saved: total.saved + batch.saved,
    marked: total.marked + batch.marked,
    batches: total.batches + batch.batches,
    hasMore: batch.hasMore,
  };
}

export async function runCuratorForUser(
  username: string,
  options: Pick<CuratorOptions, 'limit' | 'temperature'> = {},
): Promise<UserCuratorStats> {
  if (!validUsername(username)) throw new Error(`Invalid username format: ${username}`);

  return withUserContext(
    { userId: username, username, role: 'owner' },
    async () => {
      registerAgent('curator', process.pid);
      try {
        const graph = await loadCuratorGraph(options);
        const graphResult = await runGraph({
          graph,
          context: {
            userId: username,
            allowMemoryWrites: true,
            cognitiveMode: 'dual' as const,
          },
        });

        if (graphResult.status !== 'completed') {
          const failures = listFailedNodes(graphResult);
          const detail = failures.map(failure => `${failure.nodeId}: ${failure.error}`).join('; ');
          throw new Error(`Curator graph failed${detail ? ` (${detail})` : ''}`);
        }

        const loader = graphResult.nodes.get('1')?.outputs;
        const llm = graphResult.nodes.get('4')?.outputs;
        const saver = graphResult.nodes.get('5')?.outputs;
        const marker = graphResult.nodes.get('8')?.outputs;
        if (!loader || !llm || !saver || !marker) throw new Error('Curator graph did not complete its canonical output path');

        const attempted = numericOutput(llm.count, 'attempted count');
        const sourceAttempted = numericOutput(llm.sourceCount ?? llm.count, 'source attempted count');
        const accepted = numericOutput(llm.acceptedCount, 'accepted count');
        const rejected = numericOutput(llm.rejectedCount, 'rejected count');
        const failed = numericOutput(llm.failedCount, 'failed count');
        const saved = numericOutput(saver.savedCount, 'saved count');
        const newlyMarked = numericOutput(marker.markedCount, 'marked count');
        const alreadyMarked = numericOutput(marker.alreadyMarkedCount, 'already-marked count');
        const committed = newlyMarked + alreadyMarked;
        const sourceNewlyMarked = numericOutput(
          marker.sourceMarkedCount ?? marker.markedCount,
          'source marked count',
        );
        const sourceAlreadyMarked = numericOutput(
          marker.sourceAlreadyMarkedCount ?? marker.alreadyMarkedCount,
          'source already-marked count',
        );
        const marked = sourceNewlyMarked + sourceAlreadyMarked;

        if (failed !== 0) throw new Error(`Curator graph completed with ${failed} failed memory record(s)`);
        if (attempted !== accepted + rejected || saved !== attempted || committed !== attempted) {
          throw new Error(
            `Curator commit mismatch: attempted=${attempted}, accepted=${accepted}, rejected=${rejected}, saved=${saved}, committed=${committed}`,
          );
        }

        const stats: UserCuratorStats = {
          memoriesAttempted: sourceAttempted,
          memoriesProcessed: marked,
          accepted,
          rejected,
          saved,
          marked,
          batches: 1,
          hasMore: loader.hasMore === true,
        };

        if (marked > 0) {
          await submitInnerReflection(
            username,
            `📚 Curated ${marked} ${marked === 1 ? 'memory' : 'memories'} (${accepted} accepted, ${rejected} rejected).`,
            {
              type: 'curator_summary',
              tags: ['curator', 'training-data', 'background-task', 'inner'],
              dialogueSource: 'curator',
              curator: { ...stats, timestamp: new Date().toISOString() },
            },
          );
        }

        return stats;
      } finally {
        unregisterAgent('curator');
      }
    },
  );
}

/** Run one target profile, optionally draining all bounded batches. */
export async function runCycle(rawOptions: CuratorOptions = {}): Promise<CuratorResult> {
  const result: CuratorResult = { success: true, usersProcessed: 0, errors: [], stats: {} };

  try {
    const options = normalizeCuratorOptions(rawOptions);
    const username = options.username ?? getTargetUser()?.username;
    if (!username) throw new Error('No target user was provided for Curator');
    if (!validUsername(username)) throw new Error(`Invalid username format: ${username}`);

    const maximumBatches = options.all ? options.maxBatches ?? DEFAULT_MAX_BATCHES : 1;
    let total = emptyStats();

    for (let batchNumber = 0; batchNumber < maximumBatches; batchNumber++) {
      const batch = await runCuratorForUser(username, {
        limit: options.limit ?? DEFAULT_BATCH_LIMIT,
        temperature: options.temperature,
      });
      total = addStats(total, batch);
      if (!options.all || !batch.hasMore) break;
      if (batch.memoriesAttempted === 0) throw new Error('Curator made no progress while more memories remained');
    }

    if (options.all && total.hasMore) {
      throw new Error(`Curator reached the ${maximumBatches}-batch safety limit while memories remained`);
    }

    result.stats[username] = total;
    result.usersProcessed = 1;
    audit({
      category: 'action',
      level: 'info',
      event: 'curator_completed',
      actor: 'curator',
      details: { username, ...total },
    });
  } catch (error) {
    result.success = false;
    const message = (error as Error).message;
    result.errors.push(message);
    audit({
      category: 'action',
      level: 'error',
      event: 'curator_failed',
      actor: 'curator',
      details: { username: rawOptions.username, error: message },
    });
    console.error(`${LOG_PREFIX} ${message}`);
  }

  return result;
}

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  try {
    const argumentOptions = parseCuratorArgs(input.args || []);
    const direct = input.options || {};
    const effectiveUserId = ctx.userId !== 'system' ? ctx.userId : undefined;
    const options = normalizeCuratorOptions({
      ...argumentOptions,
      singleUser: direct.singleUser === true || argumentOptions.singleUser,
      all: direct.all === true || argumentOptions.all,
      username: typeof direct.username === 'string' ? direct.username : argumentOptions.username ?? effectiveUserId,
      limit: direct.limit !== undefined ? Number(direct.limit) : argumentOptions.limit,
      maxBatches: direct.maxBatches !== undefined ? Number(direct.maxBatches) : argumentOptions.maxBatches,
      temperature: direct.temperature !== undefined ? Number(direct.temperature) : argumentOptions.temperature,
    });
    const result = await runCycle(options);
    return {
      success: result.success,
      data: { usersProcessed: result.usersProcessed, stats: result.stats },
      errors: result.errors.length > 0 ? result.errors : undefined,
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
