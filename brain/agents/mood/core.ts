import {
  audit,
  cognitiveGraphPath,
  getTargetUser,
  listFailedNodes,
  loadGraphFile,
  runGraph,
  withUserContext,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';

export interface MoodOptions {
  baseline?: boolean;
  triggerData?: Record<string, unknown>;
}

export interface MoodReviewResult {
  success: boolean;
  changed: boolean;
  activeFacet?: string;
  result?: Record<string, unknown>;
  error?: string;
}

export async function reviewMoodForUser(username: string, options: MoodOptions = {}): Promise<MoodReviewResult> {
  const loaded = await loadGraphFile(cognitiveGraphPath('mood-review.json'), { logPrefix: '[mood]' });
  if (!loaded) return { success: false, changed: false, error: 'Mood Review graph could not be loaded' };
  const state = await runGraph({
    graph: loaded.graph,
    context: {
      userId: username,
      username,
      cognitiveMode: 'agent',
      allowMemoryWrites: false,
      forceBaseline: options.baseline === true,
      triggerData: options.triggerData || {},
    },
  });
  const failed = listFailedNodes(state);
  if (failed.length > 0) {
    return { success: false, changed: false, error: failed.map(item => `${item.nodeId}: ${item.error}`).join('; ') };
  }
  const output = state.nodes.get('3')?.outputs || {};
  return {
    success: true,
    changed: output.changed === true,
    activeFacet: typeof output.activeFacet === 'string' ? output.activeFacet : undefined,
    result: output.result,
  };
}

export async function runCycle(options: MoodOptions = {}): Promise<MoodReviewResult> {
  const target = getTargetUser();
  if (!target) return { success: true, changed: false, error: 'No active user' };
  try {
    return await withUserContext(
      { userId: target.userId, username: target.username, role: target.role },
      () => reviewMoodForUser(target.username, options),
    );
  } catch (error) {
    const message = (error as Error).message;
    audit({
      level: 'error',
      category: 'system',
      event: 'mood_agent_failed',
      actor: 'mood',
      details: { username: target.username, error: message },
    });
    return { success: false, changed: false, error: message };
  }
}
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const started = Date.now();
  const args = input.args || [];
  const options: MoodOptions = {
    baseline: args.includes('--baseline') || input.options?.baseline === true,
    triggerData: input.options?.triggerData as Record<string, unknown> | undefined,
  };
  try {
    const result = ctx.username
      ? await withUserContext(
          { userId: ctx.username, username: ctx.username, role: 'owner' },
          () => reviewMoodForUser(ctx.username!, options),
        )
      : await runCycle(options);
    return {
      success: result.success,
      data: result,
      error: result.error,
      duration: Date.now() - started,
      itemsProcessed: result.changed ? 1 : 0,
    };
  } catch (error) {
    return { success: false, error: (error as Error).message, duration: Date.now() - started };
  }
}
