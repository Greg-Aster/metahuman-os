import { cognitiveGraphPath, extractGraphOutput, listFailedNodes, loadGraphFile, runGraph } from '../graph-runtime.js';
import type { WorkHandlerContext } from './execution-engine.js';
import type { QueuedTask } from './types.js';

export async function executeOperatorPolicyWork(
  task: QueuedTask,
  context: WorkHandlerContext,
): Promise<Record<string, any>> {
  if (context.signal.aborted) throw new DOMException('Policy work cancelled', 'AbortError');
  const loaded = await loadGraphFile(cognitiveGraphPath('operator-policy.json'), {
    logPrefix: '[operator-policy]',
  });
  if (!loaded) throw new Error('Operator Policy Graph could not be loaded');
  const state = await runGraph({
    graph: loaded.graph,
    signal: context.signal,
    context: {
      username: task.username,
      userId: task.username,
      autonomyMode: 'full',
      cognitiveMode: task.cognitiveMode || 'dual',
      policyBudget: task.input.policyBudget || {},
    },
  });
  if (context.signal.aborted) throw new DOMException('Policy work cancelled', 'AbortError');
  const failures = listFailedNodes(state);
  if (failures.length > 0) throw new Error(`Operator Policy Graph failed: ${failures[0].error}`);
  return extractGraphOutput(state) || { accepted: false, rejection: 'Policy graph returned no output' };
}
