/**
 * Response LLM Node (Big Brother Integrated)
 *
 * Generates responses for card-based interactions using Big Brother for full
 * tool execution capabilities (file search, commands, system queries).
 *
 * This node routes through the Big Brother terminal which:
 * - Provides real-time terminal visibility in the UI
 * - Can execute tools (search files, run commands, query system state)
 * - Uses Claude Code for intelligent reasoning
 *
 * Inputs:
 *   - cardType: Type of card for context
 *   - cardContext: Formatted context from context loader
 *   - message: User's message
 *   - desire: Loaded desire object (if applicable)
 *
 * Outputs:
 *   - response: Generated response text
 *   - suggestedAction: What action to take
 *   - actionData: Data for the action
 *   - usedBigBrother: Whether Big Brother was used
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { callLLM } from '../../model-router.js';
import { loadOperatorConfig } from '../../config.js';
import type { Desire } from '../../agency/types.js';
import { renderPromptTemplate } from '../prompt-template.js';

const LOG_PREFIX = '[response-llm]';

// Card type context builders - these provide focused context for each card type
// Big Brother can use tools to gather more information as needed
const CARD_TYPE_INSTRUCTIONS: Record<string, string> = {
  desire_rejection: `## Task: Process User Feedback on Rejected Desire

The user is responding to a desire/goal that was rejected by the system.

Your responsibilities:
1. Understand why the user disagrees with the rejection
2. If they have a valid point, acknowledge it and suggest how the desire could be refined
3. If the rejection was appropriate, explain why gently
4. Use your tools to check system state if needed (e.g., search for related tasks, check calendar)

You have access to tools - use them if the user asks about files, tasks, or system state.

At the end, output a JSON block with your decision:
\`\`\`json
{
  "suggestedAction": "update_critique" | "maintain_rejection" | "request_clarification",
  "actionData": {
    "feedbackSummary": "Brief summary of user's feedback",
    "shouldRetry": true/false,
    "refinementSuggestions": ["suggestion1", "suggestion2"]
  }
}
\`\`\``,

  clarifying_questions: `## CRITICAL: User is Answering Clarifying Questions (NOT requesting help)

The user has been asked clarifying questions about their desire/goal, and they are now PROVIDING ANSWERS to those questions.

**DO NOT**:
- Offer advice or solutions
- Search for resources or help
- Create files or take actions
- Treat this as a help request

**DO**:
- Acknowledge their answer respectfully and empathetically
- Extract the key information they provided
- Determine if their answer is complete enough
- Ask follow-up questions ONLY if critical information is missing

The user's message is their ANSWER to the question(s). Extract what they said and acknowledge it.

Be brief, empathetic, and focused on acknowledging their answer.

At the end, output a JSON block:
\`\`\`json
{
  "suggestedAction": "save_answer" | "request_more_detail" | "move_to_planning",
  "actionData": {
    "answerComplete": true,
    "extractedAnswer": "Summarize what the user told you - this is what gets saved"
  }
}
\`\`\``,

  desire_plan: `## Task: Process User Feedback on Proposed Plan

The user is providing feedback on a plan for their desire/goal.

Your responsibilities:
1. Understand their concerns or approval
2. If they have concerns, suggest specific modifications
3. If they approve, confirm next steps
4. Use your tools to check feasibility if needed (e.g., check files, verify paths)

Be collaborative in refining the approach.

At the end, output a JSON block:
\`\`\`json
{
  "suggestedAction": "revise_plan" | "approve_plan" | "request_clarification" | "abandon_plan",
  "actionData": {
    "feedbackSummary": "Brief summary of their feedback",
    "planModifications": ["modification1", "modification2"],
    "userApproves": true/false
  }
}
\`\`\``,

  curiosity_response: `## Task: Respond to User's Answer to Curiosity Question

The user is answering a curiosity question that you asked them.

Your responsibilities:
1. Acknowledge and appreciate their answer
2. Engage with what they've shared - show genuine interest
3. You may ask follow-up questions to explore further
4. Use your tools if you want to save this as a memory or relate it to other things

Be warm and curious - this is about building connection and understanding.

At the end, output a JSON block:
\`\`\`json
{
  "suggestedAction": "resolve_answer",
  "actionData": {
    "topicExplored": "what the conversation was about",
    "followUpQuestion": "optional follow-up"
  }
}
\`\`\``,

};

const DEFAULT_BIG_BROTHER_PROMPT_TEMPLATE = `{{instructions}}
{{desireContext}}
## Card Context
{{cardContext}}

---

## User's Message
{{message}}

---

Please respond helpfully to the user. Use your tools if you need to check files, system state, or verify information.
Remember to include the JSON block at the end with your suggestedAction and actionData.`;

const DEFAULT_LOCAL_SYSTEM_PROMPT_TEMPLATE = `You are a helpful assistant responding to a card-based interaction.

Card Type: {{cardType}}
{{desireLine}}
{{instructions}}

Respond helpfully to the user's message. Be conversational but focused.

Return only valid JSON with:
{
  "response": "Your conversational response to the user",
  "suggestedAction": "One of the actions allowed by the card instructions",
  "actionData": {}
}`;

const DEFAULT_LOCAL_USER_PROMPT_TEMPLATE = `{{cardContext}}

---
User's message: {{message}}

Please respond with valid JSON containing response, suggestedAction, and actionData fields.`;

interface ResponseLLMOutput {
  response: string;
  suggestedAction: string;
  actionData: Record<string, unknown>;
}

/**
 * Build the full prompt for Big Brother
 */
function buildBigBrotherPrompt(
  cardType: string,
  cardContext: string,
  message: string,
  desire?: Desire,
  properties?: Record<string, any>
): string {
  const cardTypeInstructions = properties?.cardTypeInstructions || CARD_TYPE_INSTRUCTIONS;
  const instructions = cardTypeInstructions[cardType];
  if (!instructions) throw new Error(`Response LLM has no instructions for card type ${cardType}`);

  let desireContext = '';
  if (desire) {
    desireContext = `
## Desire/Goal Context
- **Title**: ${desire.title}
- **Description**: ${desire.description || 'No description'}
- **Status**: ${desire.status}
- **Reason**: ${desire.reason || 'Not specified'}
- **Risk Level**: ${desire.risk || 'unknown'}
${desire.plan?.steps?.length ? `
- **Plan Steps**:
${desire.plan.steps.map((s, i) => `  ${i + 1}. ${s.action}${s.skill ? ` (${s.skill})` : ''}`).join('\n')}` : ''}
${desire.clarifyingQuestions?.questions?.length ? `
- **Clarifying Questions**:
${desire.clarifyingQuestions.questions.map((q, i) => `  ${i + 1}. ${q.text}${q.required ? ' (required)' : ''}`).join('\n')}
- **Answers So Far**: ${desire.clarifyingQuestions.answers?.length || 0} answers collected` : ''}
`;
  }

  return renderPromptTemplate(
    properties?.bigBrotherPromptTemplate ?? DEFAULT_BIG_BROTHER_PROMPT_TEMPLATE,
    {
      instructions,
      desireContext,
      cardType,
      cardContext,
      message,
      desire: desire || null,
    },
  );
}

function requireResponseOutput(value: unknown, responseText: string): ResponseLLMOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Response LLM action output must be an object');
  }
  const record = value as Record<string, unknown>;
  const response = typeof record.response === 'string' && record.response.trim()
    ? record.response.trim()
    : responseText.trim();
  const suggestedAction = typeof record.suggestedAction === 'string'
    ? record.suggestedAction.trim()
    : '';
  const actionData = record.actionData;
  if (!response) throw new Error('Response LLM produced no conversational response');
  if (!suggestedAction) throw new Error('Response LLM produced no suggestedAction');
  if (!actionData || typeof actionData !== 'object' || Array.isArray(actionData)) {
    throw new Error('Response LLM produced invalid actionData');
  }
  return { response, suggestedAction, actionData: actionData as Record<string, unknown> };
}

/** Parse a visible Big Brother response plus its required terminal action block. */
export function parseBigBrotherResponse(rawResponse: string): ResponseLLMOutput {
  const jsonMatch = rawResponse.match(/```json\s*\n?([\s\S]*?)\n?```\s*$/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const response = rawResponse.substring(0, rawResponse.lastIndexOf('```json')).trim();
      return requireResponseOutput(parsed, response);
    } catch (error) {
      throw new Error(`Response LLM returned an invalid JSON action block: ${(error as Error).message}`);
    }
  }

  const bareJsonMatch = rawResponse.match(/\{[\s\S]*"suggestedAction"[\s\S]*\}\s*$/);
  if (bareJsonMatch) {
    try {
      const parsed = JSON.parse(bareJsonMatch[0]);
      const response = rawResponse.substring(0, rawResponse.lastIndexOf(bareJsonMatch[0])).trim();
      return requireResponseOutput(parsed, response);
    } catch (error) {
      throw new Error(`Response LLM returned invalid JSON: ${(error as Error).message}`);
    }
  }

  throw new Error('Response LLM output is missing its required JSON action block');
}

export function parseLocalResponse(rawResponse: string): ResponseLLMOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch (error) {
    throw new Error(`Local Response LLM returned invalid JSON: ${(error as Error).message}`);
  }
  return requireResponseOutput(parsed, '');
}

async function callLocalLLM(
  cardType: string,
  cardContext: string,
  message: string,
  desire?: Desire,
  properties?: Record<string, any>,
  signal?: AbortSignal,
): Promise<ResponseLLMOutput> {
  console.log(`${LOG_PREFIX} Using configured local LLM route`);
  if (signal?.aborted) throw new DOMException('Response LLM cancelled', 'AbortError');

  const cardTypeInstructions = properties?.cardTypeInstructions || CARD_TYPE_INSTRUCTIONS;
  const instructions = cardTypeInstructions[cardType];
  if (!instructions) throw new Error(`Response LLM has no instructions for card type ${cardType}`);

  const systemPrompt = renderPromptTemplate(
    properties?.localSystemPromptTemplate ?? DEFAULT_LOCAL_SYSTEM_PROMPT_TEMPLATE,
    {
      cardType,
      desireLine: desire ? `Desire: ${desire.title} (${desire.status})` : '',
      instructions,
      desire: desire || null,
    },
  );

  const userPrompt = renderPromptTemplate(
    properties?.localUserPromptTemplate ?? DEFAULT_LOCAL_USER_PROMPT_TEMPLATE,
    {
      cardContext,
      message,
      cardType,
      desire: desire || null,
    },
  );

  const result = await callLLM({
    role: 'orchestrator',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    options: {
      temperature: properties?.temperature ?? 0.7,
      maxTokens: properties?.maxTokens ?? 1024,
      json: true,
    },
  });

  const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
  if (signal?.aborted) throw new DOMException('Response LLM cancelled', 'AbortError');
  return parseLocalResponse(content);
}

export const ResponseLLMNode: NodeDefinition = defineNode({
  id: 'response_llm',
  name: 'Response LLM',
  category: 'cognitive',
  inputs: [
    { name: 'cardType', type: 'string', description: 'Type of card' },
    { name: 'cardContext', type: 'string', description: 'Formatted context' },
    { name: 'message', type: 'string', description: 'User message' },
    { name: 'desire', type: 'object', optional: true, description: 'Desire object' },
  ],
  outputs: [
    { name: 'response', type: 'string', description: 'Generated response text' },
    { name: 'suggestedAction', type: 'string', description: 'Suggested action to take' },
    { name: 'actionData', type: 'object', description: 'Data for the action' },
    { name: 'rawOutput', type: 'object', description: 'Raw output including Big Brother status' },
    { name: 'usedBigBrother', type: 'boolean', description: 'Whether Big Brother was used' },
  ],
  properties: {
    temperature: 0.7,
    maxTokens: 1024,
    useBigBrother: true,
    bigBrotherTimeoutMs: 300000,
    cardTypeInstructions: CARD_TYPE_INSTRUCTIONS,
    bigBrotherPromptTemplate: DEFAULT_BIG_BROTHER_PROMPT_TEMPLATE,
    localSystemPromptTemplate: DEFAULT_LOCAL_SYSTEM_PROMPT_TEMPLATE,
    localUserPromptTemplate: DEFAULT_LOCAL_USER_PROMPT_TEMPLATE,
  },
  propertySchemas: {
    temperature: {
      type: 'slider',
      default: 0.7,
      min: 0,
      max: 1,
      step: 0.1,
      label: 'Temperature',
      description: 'LLM temperature for response generation',
    },
    maxTokens: {
      type: 'number',
      default: 1024,
      min: 256,
      max: 4096,
      label: 'Max Tokens',
      description: 'Maximum tokens in response',
    },
    useBigBrother: {
      type: 'boolean',
      default: true,
      label: 'Use Big Brother',
      description: 'Route through Big Brother for tool execution and terminal visibility',
    },
    bigBrotherTimeoutMs: {
      type: 'number',
      default: 300000,
      min: 30000,
      max: 900000,
      step: 10000,
      label: 'Big Brother Timeout (ms)',
      description: 'Maximum time to wait for Big Brother backend execution',
    },
    cardTypeInstructions: {
      type: 'json',
      default: CARD_TYPE_INSTRUCTIONS,
      label: 'Card Type Instructions',
      description: 'Instruction map used to specialize responses by card type',
    },
    bigBrotherPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_BIG_BROTHER_PROMPT_TEMPLATE,
      label: 'Big Brother Prompt Template',
      description: 'Prompt template sent to Big Brother; supports {{instructions}}, {{desireContext}}, {{cardContext}}, and {{message}}',
    },
    localSystemPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_LOCAL_SYSTEM_PROMPT_TEMPLATE,
      label: 'Local System Prompt Template',
      description: 'Configured local LLM system prompt template',
    },
    localUserPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_LOCAL_USER_PROMPT_TEMPLATE,
      label: 'Local User Prompt Template',
      description: 'Configured local LLM user prompt template',
    },
  },
  description: 'Generates a strict card response through the configured Big Brother or local LLM route.',

  execute: async (inputs, context, properties) => {
    const cardType = typeof inputs.cardType === 'string' ? inputs.cardType : '';
    const cardContext = typeof inputs.cardContext === 'string' ? inputs.cardContext : '';
    const message = typeof inputs.message === 'string' ? inputs.message : '';
    const desire = inputs.desire as Desire | undefined;
    const username = context.userId || context.username;
    const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined;

    if (!username || username === 'anonymous') throw new Error('Response LLM requires an authenticated user');
    if (!cardContext.trim()) throw new Error('Response LLM requires card context');
    if (!message.trim()) throw new Error('Response LLM requires a user message');
    if (signal?.aborted) throw new DOMException('Response LLM cancelled', 'AbortError');

    console.log(`${LOG_PREFIX} ========== PROCESSING RESPONSE ==========`);
    console.log(`${LOG_PREFIX} Card type: ${cardType}`);
    console.log(`${LOG_PREFIX} User: ${username}`);
    console.log(`${LOG_PREFIX} Card context length: ${cardContext.length}`);
    console.log(`${LOG_PREFIX} Message: "${message.substring(0, 50)}..."`);

    // Check if Big Brother is enabled
    const operatorConfig = username ? loadOperatorConfig(username, true) : null; // Skip cache for fresh config
    const bigBrotherEnabled = operatorConfig?.bigBrotherMode?.enabled ?? false;
    const useBigBrotherProp = properties?.useBigBrother ?? true;
    const rawProvider = operatorConfig?.bigBrotherMode?.provider;
    const preferredBackend = rawProvider === 'ollama' || rawProvider === 'openai'
      ? 'open-interpreter'
      : rawProvider;

    console.log(`${LOG_PREFIX} Big Brother config: enabled=${bigBrotherEnabled}, property=${useBigBrotherProp}`);
    console.log(`${LOG_PREFIX} Decision: ${bigBrotherEnabled && useBigBrotherProp ? '→ Using Big Brother' : '→ Using local LLM'}`);

    // Use the explicitly configured Big Brother route when enabled.
    if (bigBrotherEnabled && useBigBrotherProp) {
      console.log(`${LOG_PREFIX} 🤖 Routing to Big Brother for tool execution and terminal visibility`);

      const prompt = buildBigBrotherPrompt(cardType, cardContext, message, desire, properties);
      const { escalate } = await import('../../escalation-backend.js');
      console.log(`${LOG_PREFIX} Sending prompt to Big Brother backend (${preferredBackend || 'default'})`);
      const result = await escalate(prompt, {
        timeout: properties?.bigBrotherTimeoutMs ?? 300000,
        username,
        preferredBackend,
        sessionId: context.sessionId,
        signal,
      });
      if (!result.success) throw new Error(result.error || 'Big Brother execution failed');
      if (signal?.aborted) throw new DOMException('Response LLM cancelled', 'AbortError');

      const parsed = parseBigBrotherResponse(result.output);
      return {
        response: parsed.response,
        suggestedAction: parsed.suggestedAction,
        actionData: parsed.actionData,
        rawOutput: { backend: preferredBackend },
        usedBigBrother: true,
      };
    }

    // Big Brother not enabled - use local LLM
    console.log(`${LOG_PREFIX} Big Brother not enabled, using local LLM`);
    const result = await callLocalLLM(cardType, cardContext, message, desire, properties, signal);
    return { ...result, usedBigBrother: false };
  },
});

export default ResponseLLMNode;
