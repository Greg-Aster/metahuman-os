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
 * Falls back to local LLM if Big Brother is unavailable.
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

  clarifying_question: `## CRITICAL: User is Answering Clarifying Questions (NOT requesting help)

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

  desire_awaiting_input: `## Task: Respond to User Interaction with Desire Status

The user is responding to a desire that's waiting for their input.
This could be a desire in questioning, planning, or approval status.

Your responsibilities:
1. Acknowledge their message and understand what they want
2. Check the current state of the desire using your tools if needed
3. Provide helpful information or take appropriate action
4. If they're asking about progress, system state, or files - USE YOUR TOOLS to get accurate information

You have full access to tools - search files, check status, verify information.

At the end, output a JSON block:
\`\`\`json
{
  "suggestedAction": "provide_info" | "advance_desire" | "request_clarification" | "take_action",
  "actionData": {
    "desireStatus": "current status or next status",
    "actionTaken": "description of what you did",
    "needsFollowUp": true/false
  }
}
\`\`\``,

  agency_notification: `## Task: Respond to User Interaction with System Notification

The user is responding to a system notification (agency message, status update, etc.).

Your responsibilities:
1. Acknowledge their response
2. Take appropriate action based on their input
3. Use your tools if they ask about system state, files, or tasks

Keep the interaction focused and efficient.

At the end, output a JSON block:
\`\`\`json
{
  "suggestedAction": "acknowledge" | "create_task" | "dismiss" | "escalate",
  "actionData": {
    "notificationHandled": true/false,
    "taskToCreate": "string if applicable"
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
  "suggestedAction": "engage" | "follow_up" | "save_memory" | "thank_and_close",
  "actionData": {
    "topicExplored": "what the conversation was about",
    "shouldSaveMemory": true/false,
    "followUpQuestion": "optional follow-up"
  }
}
\`\`\``,

  selected_card: `## Task: Respond to User Interaction with Selected Message

The user has selected a message/card in the chat and is responding to it directly.

Your responsibilities:
1. Read and understand the context of the selected card
2. Process their message in that specific context
3. Provide a helpful, relevant response
4. Use your tools if they ask about files, system state, or need verification

You have full access to tools - search files, check status, verify information.

At the end, output a JSON block:
\`\`\`json
{
  "suggestedAction": "respond" | "clarify" | "take_action" | "search",
  "actionData": {
    "contextUnderstood": true/false,
    "actionTaken": "description if applicable"
  }
}
\`\`\``,

  assistant_message: `## Task: Respond to User Reply to Your Previous Message

The user has selected one of your previous messages and is responding to it.

Your responsibilities:
1. Understand what specific part of your message they're responding to
2. Continue the conversation naturally from that point
3. Use your tools if they ask questions that need verification

At the end, output a JSON block:
\`\`\`json
{
  "suggestedAction": "continue" | "clarify" | "correct" | "expand",
  "actionData": {
    "topicContinued": "the topic being discussed"
  }
}
\`\`\``,

  reflection_card: `## Task: Respond to User Interaction with Reflection

The user is responding to one of your reflections or inner thoughts.

Your responsibilities:
1. Acknowledge that they're engaging with your inner dialogue
2. Expand on your thinking if they're curious
3. Be authentic about your thought processes

At the end, output a JSON block:
\`\`\`json
{
  "suggestedAction": "expand" | "acknowledge" | "discuss",
  "actionData": {
    "reflectionTopic": "what the reflection was about"
  }
}
\`\`\``,

  dream_card: `## Task: Respond to User Interaction with Dream

The user is responding to one of your dreams or daydreams.

Your responsibilities:
1. Engage with their curiosity about your dream
2. Explore the imagery or themes if they're interested
3. Be playful and imaginative

At the end, output a JSON block:
\`\`\`json
{
  "suggestedAction": "explore" | "interpret" | "acknowledge",
  "actionData": {
    "dreamElement": "the element they're asking about"
  }
}
\`\`\``,

  default: `## Task: Respond to Card-Based Interaction

The user is interacting with a card in the chat interface.

Your responsibilities:
1. Process their message in the context of the selected card
2. Provide a helpful, focused response
3. Use your tools if they ask about files, system state, or need verification

You have full access to tools - use them to provide accurate, helpful responses.

At the end, output a JSON block:
\`\`\`json
{
  "suggestedAction": "acknowledge" | "request_clarification" | "take_action",
  "actionData": {}
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

Respond helpfully to the user's message. Be conversational but focused.

Output JSON with:
{
  "response": "Your conversational response to the user",
  "suggestedAction": "acknowledge" | "request_clarification" | "take_action",
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
  const instructions = cardTypeInstructions[cardType] || cardTypeInstructions.default || CARD_TYPE_INSTRUCTIONS.default;

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

/**
 * Parse Big Brother response to extract text response and JSON action
 */
function parseBigBrotherResponse(rawResponse: string): ResponseLLMOutput {
  console.log(`${LOG_PREFIX} ========== PARSING BIG BROTHER RESPONSE ==========`);
  console.log(`${LOG_PREFIX} Raw response length: ${rawResponse.length} chars`);
  console.log(`${LOG_PREFIX} First 500 chars:\n${rawResponse.substring(0, 500)}`);
  console.log(`${LOG_PREFIX} Last 500 chars:\n${rawResponse.substring(Math.max(0, rawResponse.length - 500))}`);

  // Try to find JSON block at the end
  const jsonMatch = rawResponse.match(/```json\s*\n?([\s\S]*?)\n?```\s*$/);

  if (jsonMatch) {
    console.log(`${LOG_PREFIX} ✅ Found JSON code block at end`);
    console.log(`${LOG_PREFIX} JSON block content:\n${jsonMatch[1]}`);
    try {
      const actionData = JSON.parse(jsonMatch[1]);
      // Response is everything before the JSON block
      const response = rawResponse.substring(0, rawResponse.lastIndexOf('```json')).trim();

      console.log(`${LOG_PREFIX} ✅ Parsed JSON successfully`);
      console.log(`${LOG_PREFIX} Response text length: ${response.length} chars`);
      console.log(`${LOG_PREFIX} Suggested action: ${actionData.suggestedAction}`);

      return {
        response: response || rawResponse,
        suggestedAction: actionData.suggestedAction || 'acknowledge',
        actionData: actionData.actionData || actionData,
      };
    } catch (e) {
      console.error(`${LOG_PREFIX} ❌ Failed to parse JSON action block:`, e);
      console.error(`${LOG_PREFIX} JSON content was:\n${jsonMatch[1]}`);
    }
  } else {
    console.log(`${LOG_PREFIX} ⚠️  No JSON code block found at end of response`);
  }

  // Try to find bare JSON at the end (without code fence)
  const bareJsonMatch = rawResponse.match(/\{[\s\S]*"suggestedAction"[\s\S]*\}\s*$/);
  if (bareJsonMatch) {
    console.log(`${LOG_PREFIX} ✅ Found bare JSON at end`);
    try {
      const actionData = JSON.parse(bareJsonMatch[0]);
      const response = rawResponse.substring(0, rawResponse.lastIndexOf(bareJsonMatch[0])).trim();

      console.log(`${LOG_PREFIX} ✅ Parsed bare JSON successfully`);
      console.log(`${LOG_PREFIX} Response text length: ${response.length} chars`);

      return {
        response: response || rawResponse,
        suggestedAction: actionData.suggestedAction || 'acknowledge',
        actionData: actionData.actionData || actionData,
      };
    } catch (e) {
      console.error(`${LOG_PREFIX} ❌ Failed to parse bare JSON:`, e);
    }
  } else {
    console.log(`${LOG_PREFIX} ⚠️  No bare JSON with suggestedAction found`);
  }

  // Fallback: return raw response with default action
  console.log(`${LOG_PREFIX} ⚠️  FALLBACK: Using raw response as-is`);
  console.log(`${LOG_PREFIX} Returning ${rawResponse.length} chars with 'acknowledge' action`);
  return {
    response: rawResponse,
    suggestedAction: 'acknowledge',
    actionData: {},
  };
}

/**
 * Fallback to local LLM when Big Brother is unavailable
 */
async function fallbackToLocalLLM(
  cardType: string,
  cardContext: string,
  message: string,
  desire?: Desire,
  properties?: Record<string, any>
): Promise<ResponseLLMOutput> {
  console.log(`${LOG_PREFIX} Falling back to local LLM`);

  const systemPrompt = renderPromptTemplate(
    properties?.localSystemPromptTemplate ?? DEFAULT_LOCAL_SYSTEM_PROMPT_TEMPLATE,
    {
      cardType,
      desireLine: desire ? `Desire: ${desire.title} (${desire.status})` : '',
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

  try {
    const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    const parsed = JSON.parse(content);
    return {
      response: parsed.response || content,
      suggestedAction: parsed.suggestedAction || 'acknowledge',
      actionData: parsed.actionData || {},
    };
  } catch {
    const content = typeof result.content === 'string' ? result.content : String(result.content);
    return {
      response: content,
      suggestedAction: 'acknowledge',
      actionData: {},
    };
  }
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
      type: 'textarea',
      default: DEFAULT_BIG_BROTHER_PROMPT_TEMPLATE,
      label: 'Big Brother Prompt Template',
      description: 'Prompt template sent to Big Brother; supports {{instructions}}, {{desireContext}}, {{cardContext}}, and {{message}}',
    },
    localSystemPromptTemplate: {
      type: 'textarea',
      default: DEFAULT_LOCAL_SYSTEM_PROMPT_TEMPLATE,
      label: 'Local System Prompt Template',
      description: 'Fallback local LLM system prompt template',
    },
    localUserPromptTemplate: {
      type: 'textarea',
      default: DEFAULT_LOCAL_USER_PROMPT_TEMPLATE,
      label: 'Local User Prompt Template',
      description: 'Fallback local LLM user prompt template',
    },
  },
  description: 'Generates focused response using Big Brother for tool execution. Falls back to local LLM if unavailable.',

  execute: async (inputs, context, properties) => {
    const slot0 = inputs[0] as {
      cardType?: string;
      cardContext?: string;
      message?: string;
      desire?: Desire;
    } | undefined;

    const structuredInput = slot0 && typeof slot0 === 'object' && 'cardType' in slot0
      ? slot0
      : undefined;

    const cardType = structuredInput?.cardType || (inputs[0] as string | undefined) || context.cardType || 'default';
    const cardContext = structuredInput?.cardContext || (inputs[1] as string | undefined) || '';
    const message = structuredInput?.message || (inputs[2] as string | undefined) || context.userMessage || '';
    const desire = structuredInput?.desire || (inputs[3] as Desire | undefined);
    const username = context.userId || context.username;

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

    // Attempt Big Brother route if enabled
    if (bigBrotherEnabled && useBigBrotherProp) {
      console.log(`${LOG_PREFIX} 🤖 Routing to Big Brother for tool execution and terminal visibility`);

      try {
        const prompt = buildBigBrotherPrompt(cardType, cardContext, message, desire, properties);

        if (preferredBackend === 'claude-code') {
          // Dynamic import to avoid circular dependencies
          const { bigBrotherTerminal, ensureBigBrotherTerminal, isBigBrotherReady } = await import('../../big-brother-terminal.js');

          // Ensure Big Brother is running
          const started = await ensureBigBrotherTerminal(username);
          if (!started || !isBigBrotherReady()) {
            console.warn(`${LOG_PREFIX} Big Brother not available, falling back to local LLM`);
            const fallback = await fallbackToLocalLLM(cardType, cardContext, message, desire, properties);
            return { ...fallback, usedBigBrother: false, fallbackReason: 'Big Brother not available' };
          }

          console.log(`${LOG_PREFIX} Sending prompt to Big Brother terminal (${prompt.length} chars)`);
          const rawResponse = await bigBrotherTerminal.sendPromptAndWait(prompt, username);
          console.log(`${LOG_PREFIX} Received response from Big Brother terminal (${rawResponse.length} chars)`);

          const parsed = parseBigBrotherResponse(rawResponse);
          console.log(`${LOG_PREFIX} ✅ Big Brother response parsed, action: ${parsed.suggestedAction}`);

          return {
            response: parsed.response,
            suggestedAction: parsed.suggestedAction,
            actionData: parsed.actionData,
            rawOutput: { bigBrotherResponse: rawResponse, parsed, backend: 'claude-code' },
            usedBigBrother: true,
          };
        }

        const { escalate } = await import('../../escalation-backend.js');
        console.log(`${LOG_PREFIX} Sending prompt to Big Brother backend (${preferredBackend || 'default'})`);

        const result = await escalate(prompt, {
          timeout: properties?.bigBrotherTimeoutMs ?? 300000,
          username,
          preferredBackend,
        });

        if (!result.success) {
          throw new Error(result.error || 'Big Brother execution failed');
        }

        console.log(`${LOG_PREFIX} Received response from Big Brother backend (${result.output.length} chars)`);
        const parsed = parseBigBrotherResponse(result.output);
        console.log(`${LOG_PREFIX} ✅ Big Brother response parsed, action: ${parsed.suggestedAction}`);

        return {
          response: parsed.response,
          suggestedAction: parsed.suggestedAction,
          actionData: parsed.actionData,
          rawOutput: { bigBrotherResponse: result.output, parsed, backend: preferredBackend },
          usedBigBrother: true,
        };
      } catch (err) {
        console.error(`${LOG_PREFIX} Big Brother error, falling back to local LLM:`, err);
        const fallback = await fallbackToLocalLLM(cardType, cardContext, message, desire, properties);
        return { ...fallback, usedBigBrother: false, fallbackReason: String(err) };
      }
    }

    // Big Brother not enabled - use local LLM
    console.log(`${LOG_PREFIX} Big Brother not enabled, using local LLM`);
    try {
      const result = await fallbackToLocalLLM(cardType, cardContext, message, desire, properties);
      return { ...result, usedBigBrother: false };
    } catch (err) {
      console.error(`${LOG_PREFIX} LLM call failed:`, err);
      return {
        response: 'I apologize, but I encountered an error processing your message. Please try again.',
        suggestedAction: 'error',
        actionData: { error: String(err) },
        rawOutput: null,
        usedBigBrother: false,
      };
    }
  },
});

export default ResponseLLMNode;
