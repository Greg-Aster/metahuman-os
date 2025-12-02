/**
 * ReAct Planner Node
 *
 * Plans next action in ReAct loop using LLM reasoning
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { executeSkill, listSkills, type TrustLevel } from '../../skills.js';
import { callLLM } from '../../model-router.js';

const execute: NodeExecutor = async (inputs, context) => {
  if (process.env.DEBUG_GRAPH) console.log(`[ReactPlanner] ENTRY - context.useOperator =`, context.useOperator);

  if (context.useOperator === false) {
    const bypassResult = {
      plan: 'Final Answer: User query is conversational, not requiring operator tools.',
      iteration: 0,
      maxIterations: 10,
      scratchpad: [],
    };
    if (process.env.DEBUG_GRAPH) console.log(`[ReactPlanner] BYPASSING OPERATOR - Returning:`, JSON.stringify(bypassResult, null, 2));
    return bypassResult;
  }

  if (process.env.DEBUG_GRAPH) console.log(`[ReactPlanner] ========== REACT PLANNER ==========`);

  const scratchpadData = inputs[0] || {};
  const iteration = scratchpadData.iteration || 0;
  const maxIterations = scratchpadData.maxIterations || 10;

  let scratchpad: any[] = [];
  const scratchpadInput = scratchpadData.scratchpad;

  if (Array.isArray(scratchpadInput)) {
    scratchpad = scratchpadInput;
  } else if (scratchpadInput && typeof scratchpadInput === 'string') {
    scratchpad = scratchpadInput
      .split(/\n{2,}/)
      .map(entry => ({ thought: entry.trim(), action: '', observation: '' }));
  } else if (scratchpadInput && typeof scratchpadInput === 'object') {
    scratchpad = [scratchpadInput];
  } else if (scratchpadInput === null || scratchpadInput === undefined) {
    scratchpad = [];
  } else {
    console.warn('[ReactPlanner] Unexpected scratchpad type:', typeof scratchpadInput, scratchpadInput);
    scratchpad = [];
  }

  const skills = listSkills();
  const skillDescriptions = skills.map(s => `- ${s.id}: ${s.description}`).join('\n');

  const userMessage = typeof inputs[1] === 'string' ? inputs[1] : (inputs[1]?.message || context.userMessage || '');

  const conversationHistory = context.conversationHistory || [];
  const recentHistory = conversationHistory.slice(-4);
  const historyText = recentHistory.length > 0
    ? recentHistory.map((msg: any) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n')
    : 'No previous conversation';

  const username = context.username || 'anonymous';
  const userRole = context.role || 'anonymous';
  const isOwner = userRole === 'owner';
  const profilePath = username !== 'anonymous' ? `profiles/${username}` : null;

  let searchStrategyGuidance = '';
  if (profilePath) {
    searchStrategyGuidance = `
YOUR PROFILE CONTEXT:
- Username: ${username}
- Role: ${userRole}
- Your profile directory: ${profilePath}/
- Your output directory: ${profilePath}/out/

FILE SEARCH STRATEGY (follow this order):
1. **First**: Search your profile's out directory: {"pattern": "filename", "cwd": "${profilePath}/out"}
2. **Second**: Search your entire profile: {"pattern": "**/filename", "cwd": "${profilePath}"}
${isOwner ? '3. **Third** (owner privilege): Search entire project: {"pattern": "**/filename"}' : ''}

FILE WRITE STRATEGY:
- **Default location**: ALWAYS write files to "${profilePath}/out/" unless user specifies otherwise
- Example: To create "notes.md", use path "${profilePath}/out/notes.md"
- If user provides explicit path (e.g., "docs/file.md"), use that path directly
${isOwner ? '- As owner, you CAN write to system directories (e.g., "out/", "docs/"), but prefer your profile directory' : ''}`;
  } else {
    searchStrategyGuidance = `
FILE SEARCH PATTERNS:
- Files are stored in the "out/" directory
- Use RECURSIVE patterns: "**/filename.md" (searches all subdirectories)
- Or specify directory: {"pattern": "filename.md", "cwd": "out"}`;
  }

  const messages = [
    {
      role: 'system' as const,
      content: `You are a ReAct planner. Your job is to plan the next action to take based on the user's query and available skills.

Available Skills:
${skillDescriptions}

IMPORTANT RULES:
1. Use "Final Answer:" for conversational responses. Only use skills when you need to take an actual action.
2. Do NOT use conversational_response skill - just use Final Answer directly.
3. CRITICAL: If you output "Action:", do NOT include "Final Answer:" in the same response.
4. After an Action, you must WAIT for the Observation before deciding if you can provide a Final Answer.
5. Never assume an action succeeded - wait for the observation to confirm it.
6. MEMORY PERSISTENCE: When you find/create/reference files or data, ALWAYS include specific details in your Final Answer.
7. CONVERSATION CONTEXT: Check the scratchpad for previous actions in THIS turn.
${searchStrategyGuidance}

Output your response in this format:

If you need to use a tool/skill (DO NOT include Final Answer):
Thought: [your reasoning]
Action: [skill_id]
Action Input: {"param": "value"}

If you can answer directly without tools OR after receiving observations:
Thought: [your reasoning]
Final Answer: [your response]`,
    },
    {
      role: 'user' as const,
      content: `Recent Conversation Context:
${historyText}

Current Query: ${userMessage}

Scratchpad (current turn only):
${scratchpad.map((s: any) => `${s.thought}\n${s.action}\n${s.observation}`).join('\n\n')}

What should I do next?`,
    },
  ];

  try {
    console.log(`[ReactPlanner] Calling LLM for planning...`);
    const response = await callLLM({
      role: 'orchestrator',
      messages,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: 1024,
        repeatPenalty: 1.15,
        temperature: 0.5,
      },
      onProgress: context.emitProgress,
    });

    console.log(`[ReactPlanner] LLM response: "${response.content.substring(0, 150)}..."`);

    return {
      plan: response.content,
      iteration,
      maxIterations,
      scratchpad,
    };
  } catch (error) {
    console.error('[ReActPlanner] Error:', error);
    throw new Error(`ReAct planning failed: ${(error as Error).message}`);
  }
};

export const ReActPlannerNode: NodeDefinition = defineNode({
  id: 'react_planner',
  name: 'ReAct Planner',
  category: 'operator',
  inputs: [
    { name: 'goal', type: 'string', description: 'User goal/request' },
    { name: 'context', type: 'context' },
    { name: 'scratchpad', type: 'array', optional: true },
  ],
  outputs: [
    { name: 'thought', type: 'string', description: 'Reasoning about next step' },
    { name: 'action', type: 'object', description: 'Skill to execute' },
  ],
  properties: {
    model: 'default.coder',
    temperature: 0.2,
  },
  propertySchemas: {
    model: {
      type: 'string',
      default: 'default.coder',
      label: 'Model',
      description: 'LLM model to use for planning',
    },
    temperature: {
      type: 'slider',
      default: 0.2,
      label: 'Temperature',
      description: 'Sampling temperature for creativity',
      min: 0,
      max: 1,
      step: 0.1,
    },
  },
  description: 'Plans next action in ReAct loop',
  execute,
});
