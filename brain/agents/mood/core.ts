import {
  audit,
  cognitiveGraphPath,
  getTargetUser,
  listFailedNodes,
  loadGraphFile,
  runGraph,
  withUserContext,
  type GraphExecutionState,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';

export interface MoodOptions {
  baseline?: boolean;
  triggerData?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface MoodReviewResult {
  success: boolean;
  changed: boolean;
  activeFacet?: string;
  result?: Record<string, unknown>;
  error?: string;
}

export function parseMoodTriggerData(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Mood triggerData must contain an object');
  }
  return value as Record<string, unknown>;
}

export function parseMoodArgs(args: string[]): Pick<MoodOptions, 'baseline'> {
  const unknown = args.find(arg => arg !== '--baseline');
  if (unknown) throw new Error(`Unknown Mood option: ${unknown}`);
  return { baseline: args.includes('--baseline') };
}

interface MoodGraphNode {
  id?: unknown;
  data?: { nodeType?: unknown };
}

export function resolveMoodResultNodeId(graph: { nodes?: MoodGraphNode[] }): string {
  const matches = Array.isArray(graph.nodes)
    ? graph.nodes.filter(node => node?.data?.nodeType === 'mood_persona_switch')
    : [];
  if (matches.length !== 1 || typeof matches[0]?.id !== 'string' || !matches[0].id) {
    throw new Error('Mood Review graph must contain exactly one mood_persona_switch result node');
  }
  return matches[0].id;
}

export function evaluateMoodGraph(
  graph: { nodes?: MoodGraphNode[] },
  state: GraphExecutionState,
): MoodReviewResult {
  const failed = listFailedNodes(state);
  if (failed.length > 0) {
    return { success: false, changed: false, error: failed.map(item => `${item.nodeId}: ${item.error}`).join('; ') };
  }
  let resultNodeId: string;
  try {
    resultNodeId = resolveMoodResultNodeId(graph);
  } catch (error) {
    return { success: false, changed: false, error: (error as Error).message };
  }
  const resultNode = state.nodes.get(resultNodeId);
  if (!resultNode || resultNode.status !== 'completed') {
    return {
      success: false,
      changed: false,
      error: `Mood Review result node did not complete${resultNode ? `: ${resultNode.status}` : ''}`,
    };
  }
  const output = resultNode.outputs;
  if (
    !output
    || typeof output.changed !== 'boolean'
    || typeof output.activeFacet !== 'string'
    || !output.result
    || typeof output.result !== 'object'
    || Array.isArray(output.result)
  ) {
    return { success: false, changed: false, error: 'Mood Review graph did not produce its required result contract' };
  }
  return {
    success: true,
    changed: output.changed,
    activeFacet: output.activeFacet,
    result: output.result as Record<string, unknown>,
  };
}

async function reviewMoodForUser(
  target: { userId: string; username: string },
  options: MoodOptions = {},
): Promise<MoodReviewResult> {
  const loaded = await loadGraphFile(cognitiveGraphPath('mood-review.json'), { logPrefix: '[mood]' });
  if (!loaded) return { success: false, changed: false, error: 'Mood Review graph could not be loaded' };
  try {
    resolveMoodResultNodeId(loaded.graph);
  } catch (error) {
    return { success: false, changed: false, error: (error as Error).message };
  }
  const state = await runGraph({
    graph: loaded.graph,
    signal: options.signal,
    context: {
      userId: target.userId,
      username: target.username,
      cognitiveMode: 'agent',
      allowMemoryWrites: false,
      forceBaseline: options.baseline === true,
      triggerData: options.triggerData || {},
      abortSignal: options.signal,
    },
  });
  return evaluateMoodGraph(loaded.graph, state);
}

async function runForTarget(
  target: { userId: string; username: string; role: string },
  options: MoodOptions,
): Promise<MoodReviewResult> {
  return withUserContext(
    { userId: target.userId, username: target.username, role: target.role },
    () => reviewMoodForUser(target, options),
  );
}

export async function runCycle(options: MoodOptions = {}): Promise<MoodReviewResult> {
  const target = getTargetUser();
  if (!target) return { success: false, changed: false, error: 'Mood requires a registered target user' };
  try {
    return await runForTarget(target, options);
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
  try {
    const args = input.args || [];
    const parsedArgs = parseMoodArgs(args);
    const structured = input.options || {};
    const unknownOption = Object.keys(structured).find(key => key !== 'baseline' && key !== 'triggerData');
    if (unknownOption) throw new Error(`Unknown Mood input option: ${unknownOption}`);
    if (structured.baseline !== undefined && typeof structured.baseline !== 'boolean') {
      throw new Error('Mood baseline option must be boolean');
    }
    const options: MoodOptions = {
      baseline: parsedArgs.baseline || structured.baseline === true,
      triggerData: parseMoodTriggerData(structured.triggerData),
      signal: ctx.signal,
    };
    const target = getTargetUser({ username: ctx.username });
    const result = target
      ? await runForTarget(target, options)
      : { success: false, changed: false, error: `Mood target user is not registered: ${ctx.username}` };
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
