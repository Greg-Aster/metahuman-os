import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';
import { parseThinkingBlocks } from '../output/thinking-stripper.node.js';
import {
  AUTONOMOUS_PROPOSALS,
  parsePolicyDecision,
} from '../../active-operator/policy-contract.js';

const MODE_PROMPTS: Record<string, string> = {
  dual: 'Balance personal reflection, useful system work, and restraint.',
  agent: 'Prefer concrete goal progress and useful bounded actions.',
  emulation: 'Do not propose autonomous work. Wait or request user input.',
  environment: 'Prioritize understanding connected-environment observations. Never propose physical movement.',
};

const execute: NodeExecutor = async (inputs, context, properties) => {
  const policyContext = inputs.policyContext || {};
  const cognitiveMode = String(policyContext.cognitiveMode || context.cognitiveMode || 'dual');
  const availableHandlers = Object.keys(AUTONOMOUS_PROPOSALS);
  const response = await callLLM({
    role: properties?.model || 'orchestrator',
    userId: policyContext.username || context.username || 'system',
    messages: [
      {
        role: 'system',
        content: `You are the bounded policy function for MetaHuman OS full autonomy.
You do not execute work. Return exactly one JSON object.
Allowed decisions:
{"decision":"execute","taskId":"existing queued id","reason":"short reason"}
{"decision":"wait","reason":"short reason","wakeAt":"optional ISO timestamp within one hour"}
{"decision":"request_input","taskId":"existing queued id","reason":"short reason"}
{"decision":"propose","handler":"allowed handler","reason":"short reason"}
Allowed proposal handlers: ${availableHandlers.join(', ')}.
Never propose robot movement, shell commands, code changes, purchases, messages to people, or unlisted handlers.
${MODE_PROMPTS[cognitiveMode] || MODE_PROMPTS.dual}`,
      },
      {
        role: 'user',
        content: JSON.stringify(policyContext),
      },
    ],
    options: {
      temperature: properties?.temperature ?? 0.2,
      maxTokens: properties?.maxTokens ?? 500,
      enableThinking: false,
    },
  });
  const { stripped } = parseThinkingBlocks(response.content);
  const match = stripped.match(/\{[\s\S]*\}/);
  let parsed = null;
  if (match) {
    try {
      parsed = parsePolicyDecision(JSON.parse(match[0]));
    } catch {
      // Invalid model output is an ordinary bounded-policy outcome. The
      // deterministic gate below receives a safe wait decision.
    }
  }
  return {
    decision: parsed || { decision: 'wait', reason: 'Policy output was invalid' },
    validSyntax: Boolean(parsed),
  };
};

export const OperatorPolicyDecisionNode: NodeDefinition = defineNode({
  id: 'operator_policy_decision',
  name: 'Operator Policy Decision',
  category: 'active-operator',
  inputs: [{ name: 'policyContext', type: 'object', description: 'Bounded policy context' }],
  outputs: [
    { name: 'decision', type: 'decision', description: 'One strict bounded policy decision' },
    { name: 'validSyntax', type: 'boolean', description: 'Whether the model returned a valid decision object' },
  ],
  properties: { model: 'orchestrator', temperature: 0.2, maxTokens: 500 },
  description: 'Makes one bounded full-autonomy decision without execution authority',
  execute,
});
