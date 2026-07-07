/**
 * Response Synthesizer Node
 *
 * Synthesizes final response from loop controller output or scratchpad
 * Applies persona voice to final output if persona input is connected
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';
import { loadFreshOperatorConfig } from '../../config.js';
import { renderPromptTemplate } from '../prompt-template.js';
// NOTE: getIdentitySummary import REMOVED (2025-12-18)
// Persona injection should ONLY come from graph nodes (persona_loader → persona_formatter)
// Hidden fallbacks bypass the graph editor workflow and cause unexpected behavior

const DEFAULT_PERSONA_VOICE_SYSTEM_PROMPT_TEMPLATE = `{{personaPrompt}}

You are responding based on information that was gathered or generated. Your task is to deliver this information in your natural voice while:
1. Maintaining your personality and communication style
2. Being conversational and natural (not robotic or formal)
3. Preserving all factual content and technical details
4. NOT repeating technical output verbatim - translate into your speaking voice`;

const DEFAULT_CONTEXT_FACTS_FIRST_SYSTEM_PROMPT_TEMPLATE = `{{currentQuerySection}}{{desireSection}}{{memoryContext}}

---

## Your Identity
{{personaSummary}}{{feedbackSection}}`;

const DEFAULT_CONTEXT_PERSONA_FIRST_SYSTEM_PROMPT_TEMPLATE = `{{currentQuerySection}}{{desireSection}}{{unknownInstruction}}{{personaSummary}}{{feedbackSection}}`;

const DEFAULT_LEGACY_GUIDANCE_SYSTEM_PROMPT_TEMPLATE = `{{personaSummary}}{{memoryContext}}`;

const DEFAULT_DELEGATED_WORK_PERSONA_PROMPT_TEMPLATE = `{{personaPrompt}}

You are responding to the user based on work that was completed by your autonomous capabilities. Review what was done and provide a response in your natural voice that:
1. Acknowledges what was accomplished
2. Maintains your personality and communication style
3. Is conversational and natural (not robotic or overly formal)

DO NOT repeat the technical details verbatim - translate them into your natural speaking voice.`;

const DEFAULT_UNKNOWN_RESPONSE_SYSTEM_PROMPT_TEMPLATE = `{{personaPrompt}}

[No relevant memories found for this query]`;

const DEFAULT_SCRATCHPAD_SYSTEM_PROMPT_TEMPLATE = `You are a response synthesizer. Create a natural, conversational response based on the observations gathered during task execution.`;

const DEFAULT_SCRATCHPAD_USER_PROMPT_TEMPLATE = `Original Query: {{userMessage}}

Execution Steps:
{{scratchpadSteps}}

Based on these execution steps, provide a clear, helpful response to the user's original query:`;

/**
 * Helper: Apply persona voice to a response if persona input is available
 */
async function applyPersonaVoice(
  responseText: string,
  personaInput: any,
  userMessage: string,
  conversationHistory: any[],
  cognitiveMode: string,
  metadata: Record<string, any> = {},
  emitProgress?: (event: any) => void,
  userId?: string,
  properties: Record<string, any> = {}
): Promise<{ response: string; personaSynthesized: boolean }> {
  const personaPrompt = personaInput?.formatted || personaInput;

  if (!personaPrompt || typeof personaPrompt !== 'string' || personaPrompt.trim().length === 0) {
    return { response: responseText, personaSynthesized: false };
  }

  const systemPrompt = renderPromptTemplate(
    properties.personaVoiceSystemPromptTemplate ?? DEFAULT_PERSONA_VOICE_SYSTEM_PROMPT_TEMPLATE,
    { personaPrompt, responseText, userMessage, metadata },
  );

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...conversationHistory.slice(-10).map((msg: any) => ({
      role: msg.role || 'user',
      content: msg.content || msg.message || '',
    })).filter((msg: any) => {
      return typeof msg.content === 'string' && msg.content.trim().length > 0;
    }),
    { role: 'user' as const, content: userMessage },
    { role: 'assistant' as const, content: `[Generated response]\n\n${responseText}` },
    { role: 'user' as const, content: 'Please respond naturally in your own voice based on the information above.' },
  ].filter((msg) => {
    return typeof msg.content === 'string' && msg.content.trim().length > 0;
  });

  try {
    const response = await callLLM({
      role: properties.model ?? 'persona',
      messages,
      userId,
      cognitiveMode,
      options: {
        maxTokens: properties.personaVoiceMaxTokens ?? 2048,
        repeatPenalty: properties.personaVoiceRepeatPenalty ?? 1.3,
        temperature: properties.personaVoiceTemperature ?? 0.8,
      },
      onProgress: emitProgress,
    });

    return { response: response.content, personaSynthesized: true };
  } catch (error) {
    console.error('[ResponseSynthesizer] Error applying persona voice:', error);
    return { response: responseText, personaSynthesized: false };
  }
}

const execute: NodeExecutor = async (inputs, context, properties = {}) => {
  // Extract username for LLM calls
  const username = context.username || context.userId;

  // Check Big Brother hybrid mode - use Big Brother for central thinking when enabled but not delegateAll
  const operatorConfig = username ? loadFreshOperatorConfig(username) : null;
  const bigBrotherEnabled = operatorConfig?.bigBrotherMode?.enabled ?? false;
  const bigBrotherDelegateAll = operatorConfig?.bigBrotherMode?.delegateAll ?? false;
  // If Big Brother is enabled, request Big Brother for central thinking
  const useBigBrother = bigBrotherEnabled;

  // Named inputs from graph edges:
  // - goal: from orchestrator_llm (node 24)
  // - scratchpad: from input_message (node 1)
  // - context: from context_builder (node 8)
  // - persona: raw persona object from persona_loader or context_builder
  // - personaText: from persona_formatter (node 30)
  const goalInput = inputs.goal || inputs[0];
  const scratchpadInput = inputs.scratchpad || inputs[1];
  const contextInput = inputs.context || inputs[2];
  // Raw persona object (for context/values) - from persona_loader or context_builder passthrough
  const personaObjectInput = inputs.persona ?? inputs[3];
  // Use nullish coalescing to preserve empty strings
  const personaInputRaw = inputs.personaText ?? inputs[4];

  // Extract persona text (could be object with .formatted or direct string)
  const personaText = personaInputRaw?.formatted || (typeof personaInputRaw === 'string' && personaInputRaw.trim() ? personaInputRaw : null);
  // Check if persona is inactive (LoRA-only mode):
  // - If personaInputRaw has inactive: true flag (full object passed)
  // - If personaText is empty/falsy (persona_formatter returns '' when persona is inactive)
  // - If persona object has inactive: true
  const personaInactive = personaInputRaw?.inactive === true || personaObjectInput?.inactive === true || !personaText;
  // We can proceed with PRIMARY PATH even without persona - either use persona text, identity summary, or nothing (LoRA-only)
  const hasPersona = true; // Always allow PRIMARY PATH when we have context

  // Check if goalInput has Claude Full Task output (Big Brother mode)
  // In Big Brother graph, claude_full_task output goes to 'goal' input
  if (goalInput && typeof goalInput === 'object') {
    if (goalInput.finalResponse) {
      console.log(`[ResponseSynthesizer] ✅ Found finalResponse in goal (Claude Full Task output)`);
      return {
        response: goalInput.finalResponse,
        claudeFullTaskOutput: true,
        bypassedReActLoop: goalInput.bypassedReActLoop,
      };
    }
  }

  // Check if scratchpad input has the SkillExecutor output
  if (scratchpadInput) {
    if (scratchpadInput.finalResponse) {
      console.log(`[ResponseSynthesizer] ✅ Found finalResponse in scratchpad (SkillExecutor output)`);
      return {
        response: scratchpadInput.finalResponse,
        skillExecutorOutput: true,
      };
    }

    if (scratchpadInput.outputs && scratchpadInput.outputs.response) {
      console.log(`[ResponseSynthesizer] ✅ Found response in scratchpad.outputs (SkillExecutor output)`);
      return {
        response: scratchpadInput.outputs.response,
        skillExecutorOutput: true,
      };
    }
  }

  // Extract loop result or scratchpad
  let loopResult = goalInput || inputs.loopResult || {};

  // PRIMARY PATH: Context-based generation
  // When we have context from context_builder (with memories or unknownSignal) and persona, generate directly
  const contextData = contextInput || {};

  // Check multiple locations for context data (handles different output formats)
  // - Direct: contextData.memories, contextData.unknownSignal (from context_builder's context output)
  // - Nested: contextData.context?.memories (if whole output object passed)
  const hasMemories = contextData.memories !== undefined ||
                      contextData.context?.memories !== undefined;
  const hasUnknownSignal = contextData.unknownSignal !== undefined ||
                           contextData.context?.unknownSignal !== undefined;
  const hasContextPackage = hasMemories || hasUnknownSignal;

  if (hasContextPackage && hasPersona) {

    const userMsgInput = scratchpadInput || inputs.userMessage || context.userMessage || {};
    const userMsgStr = typeof userMsgInput === 'string'
      ? userMsgInput
      : (userMsgInput.message || context.userMessage || '');

    // When persona is inactive (LoRA-only mode), skip persona text - let the LoRA provide personality
    // Otherwise use ONLY personaText from graph - NO hidden fallbacks
    // If persona isn't connected in graph, don't inject it (graph is single source of truth)
    const personaSummary = personaInactive ? '' : (personaText || '');
    const conversationHistory = contextData.conversationHistory || contextData.context?.conversationHistory || context.conversationHistory || [];

    // Extract memories, unknownSignal, and feedbackContext from context
    const memories = contextData.memories ?? contextData.context?.memories ?? [];
    const unknownSignal = contextData.unknownSignal ?? contextData.context?.unknownSignal ?? false;
    const feedbackContext = contextData.feedbackContext ?? contextData.context?.feedbackContext ?? null;

    // Build memory context
    let memoryContext = '';
    let unknownInstruction = '';

    // CRITICAL: unknownSignal means search found NO direct answers
    // Even if we have partial memories, they don't answer the question
    if (unknownSignal) {
      console.log(`[ResponseSynthesizer] unknownSignal=true - no direct answer found in memories`);
      if (memories.length > 0) {
        // We have related memories but NO direct answer
        const memoryTexts = memories.slice(0, 3).map((m: any, i: number) => {
          const text = m.content || m.item?.text || m.text || '';
          console.log(`[ResponseSynthesizer] Context memory ${i + 1}: "${text.substring(0, 60)}..."`);
          return text;
        }).filter((t: string) => t.length > 0);

        unknownInstruction = `\n\n## Memory Search Result\nNo direct answer found. Related content:\n${memoryTexts.map((t: string) => `- ${t.substring(0, 100)}...`).join('\n')}\n\nSay you don't know or don't have a memory of this.\n`;
      } else {
        unknownInstruction = `\n\n## Memory Search Result\nNo relevant memories found. Say you don't know or don't have a memory of this.\n`;
      }
    } else if (memories.length > 0) {
      // We have actual answers - use them
      console.log(`[ResponseSynthesizer] Processing ${memories.length} memories with direct answers`);
      const memoryTexts = memories.slice(0, 5).map((m: any, i: number) => {
        const text = m.content || m.item?.text || m.text || '';
        console.log(`[ResponseSynthesizer] Memory ${i + 1} (${m.relevanceLevel || 'unknown'}): "${text.substring(0, 80)}..."`);
        return text;
      }).filter((t: string) => t.length > 0);
      if (memoryTexts.length > 0) {
        memoryContext = `\n\n## Relevant Memories\n${memoryTexts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')}\n`;
      }
    }

    // Build feedback section if this is a refinement iteration
    let feedbackSection = '';
    if (feedbackContext && feedbackContext.specificFeedback) {
      feedbackSection = `\n\n## Previous Attempt Failed\nIteration: ${feedbackContext.iteration}\n${feedbackContext.specificFeedback}`;
    }

    // Build desire context section if user is replying to a goal/desire
    let desireSection = '';
    const desireContext = context.desireContext;
    if (desireContext && desireContext.title) {
      console.log(`[ResponseSynthesizer] Including desire context: ${desireContext.title} (${desireContext.status})`);
      const strengthPct = ((desireContext.strength || 0) * 100).toFixed(0);

      // Check if desire is in questioning phase - provide conversational instructions
      if (desireContext.status === 'questioning') {
        // Questioning phase: be conversational, gather information
        const questionsText = desireContext.clarifyingQuestions?.questions?.length > 0
          ? desireContext.clarifyingQuestions.questions.map((q: any, i: number) =>
              `${i + 1}. ${q.text}${q.required ? ' (required)' : ''}`
            ).join('\n')
          : 'Gather more details about what the user wants to achieve.';

        const answersText = desireContext.clarifyingQuestions?.answers?.length > 0
          ? desireContext.clarifyingQuestions.answers.map((a: any) =>
              `- ${a.answer}`
            ).join('\n')
          : 'No answers yet.';

        desireSection = `\n\n## QUESTIONING PHASE - Be Conversational
**IMPORTANT**: You are in the QUESTIONING phase for this goal. Your task is to have a helpful CONVERSATION to gather more information.

**Goal**: "${desireContext.title}"
**Description**: ${desireContext.description || 'No description'}
**User's Reason**: ${desireContext.reason || 'Not specified'}

**Questions to explore**:
${questionsText}

**Answers gathered so far**:
${answersText}

**Instructions**:
- Be conversational and helpful - this is a discussion, not task execution
- Ask follow-up questions if the user's answer needs clarification
- Help the user think through their goal
- DO NOT execute any plans or take actions yet
- DO NOT create detailed implementation plans yet
- The user will click "Ready to Plan" when they've shared enough information

Respond conversationally to help refine this goal.
---\n`;
      } else {
        // Other statuses: provide standard goal context
        const stepsText = desireContext.plan?.steps?.length > 0
          ? desireContext.plan.steps.map((s: any, i: number) =>
              `${i + 1}. ${s.action}${s.skill ? ` (${s.skill})` : ''}${s.expectedOutcome ? ` - ${s.expectedOutcome}` : ''}`
            ).join('\n')
          : 'No plan steps yet';

        desireSection = `\n\n## Goal Context\nThe user is discussing this goal: "${desireContext.title}"\nDescription: ${desireContext.description || 'No description'}\nStatus: ${desireContext.status || 'unknown'}\nStrength: ${strengthPct}%\n\nPlan Steps:\n${stepsText}\n\nThe user can approve, reject, or provide feedback to revise this goal.\n---\n`;
      }
    }

    // IMPORTANT: User's current message is the PRIMARY focus
    // Put it at the TOP of the system prompt so the LLM doesn't lose sight of it
    const currentQuerySection = `## Current Question\n${userMsgStr}\n\n---\n`;

    // Check if we have factual information that should override persona style
    const hasFactualMemories = memories.length > 0 && !unknownSignal;

    // Build system prompt: Question first, then GOAL CONTEXT, then FACTS (before persona), then persona for style
    // This ensures factual answers aren't filtered through persona's philosophical tendencies
    let systemPrompt: string;
    if (hasFactualMemories) {
      // Facts-first prompt: memories come BEFORE persona so facts take priority
      systemPrompt = renderPromptTemplate(
        properties.contextFactsFirstSystemPromptTemplate ?? DEFAULT_CONTEXT_FACTS_FIRST_SYSTEM_PROMPT_TEMPLATE,
        {
          currentQuerySection,
          desireSection,
          memoryContext,
          personaSummary,
          feedbackSection,
          unknownInstruction,
          userMessage: userMsgStr,
        },
      );
    } else {
      // No memories: persona-first (unknownInstruction already handles "I don't know")
      systemPrompt = renderPromptTemplate(
        properties.contextPersonaFirstSystemPromptTemplate ?? DEFAULT_CONTEXT_PERSONA_FIRST_SYSTEM_PROMPT_TEMPLATE,
        {
          currentQuerySection,
          desireSection,
          memoryContext,
          personaSummary,
          feedbackSection,
          unknownInstruction,
          userMessage: userMsgStr,
        },
      );
    }

    // Limit conversation history to 6 messages (not 10) to reduce context overload
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...conversationHistory.slice(-6).map((msg: any) => ({
        role: msg.role || 'user',
        content: msg.content || msg.message || '',
      })).filter((msg: any) => typeof msg.content === 'string' && msg.content.trim().length > 0),
      { role: 'user' as const, content: userMsgStr },
    ].filter((msg) => typeof msg.content === 'string' && msg.content.trim().length > 0);

    const inputChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    const estimatedInputTokens = Math.ceil(inputChars / 3.5);
    const contextLimit = properties.contextLimit ?? 4096;
    const maxTokens = Math.min(properties.contextMaxTokens ?? 1024, Math.max(256, contextLimit - estimatedInputTokens - 100));

    // Lower temperature when we have factual memories to prioritize accuracy over creativity
    const temperature = hasFactualMemories
      ? properties.contextFactualTemperature ?? 0.4
      : properties.contextDefaultTemperature ?? 0.7;

    try {
      const response = await callLLM({
        role: properties.model ?? 'persona',
        messages,
        userId: username,
        cognitiveMode: context.cognitiveMode,
        options: {
          maxTokens,
          repeatPenalty: properties.contextRepeatPenalty ?? 1.3,
          temperature,
          useBigBrother, // Use Big Brother in hybrid mode for central thinking
        },
        onProgress: context.emitProgress,
      });

      return {
        response: response.content,
        contextBased: true,
        unknownSignal,
        memoriesUsed: memories.length,
        usedBigBrother: useBigBrother,
      };
    } catch (error) {
      console.error('[ResponseSynthesizer] Error in context-based generation:', error);
      const errorMsg = (error as Error).message;
      let fallbackMsg = 'I encountered an error while processing your request.';
      if (errorMsg.includes('offline') || errorMsg.includes('not running') || errorMsg.includes('No remote provider')) {
        fallbackMsg = 'LLM backend is unavailable. Please configure a working LLM in Settings.';
      }
      return {
        response: fallbackMsg,
        error: errorMsg,
      };
    }
  }

  // LEGACY PATH: Orchestrator guidance format (from ConditionalReroute fallback)
  if (loopResult.needsMemory !== undefined && loopResult.responseStyle) {

    const userMessageInput = scratchpadInput || inputs.userMessage || context.userMessage || {};
    const userMessage = typeof userMessageInput === 'string'
      ? userMessageInput
      : (userMessageInput.message || context.userMessage || '');

    // Use ONLY persona from graph - NO hidden fallbacks (graph is single source of truth)
    const personaSummary = personaText || '';
    const contextData = contextInput || {};
    const conversationHistory = contextData.context?.conversationHistory || context.conversationHistory || [];

    // Extract memories from context and format them for the prompt
    const memories = contextData.context?.memories || context.contextPackage?.memories || [];
    let memoryContext = '';
    if (memories.length > 0) {
      // Include full memory content - the LoRA should learn to use these naturally
      const memoryTexts = memories.slice(0, 5).map((m: any) => {
        const text = m.content || m.item?.text || m.text || '';
        return text;  // Full text, no truncation
      }).filter((t: string) => t.length > 0);
      if (memoryTexts.length > 0) {
        memoryContext = `\n\n## Memories\n${memoryTexts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')}`;
      }
    }

    // Persona receives identity + memories only - NO orchestrator instructions
    // The LoRA should be trained to naturally use memories in responses
    const systemPrompt = renderPromptTemplate(
      properties.legacyGuidanceSystemPromptTemplate ?? DEFAULT_LEGACY_GUIDANCE_SYSTEM_PROMPT_TEMPLATE,
      { personaSummary, memoryContext, userMessage, responseStyle: loopResult.responseStyle },
    );

    let temperature = properties.legacyDefaultTemperature ?? 0.7;
    if (loopResult.responseStyle === 'verbose') {
      temperature = properties.legacyVerboseTemperature ?? 0.8;
    } else if (loopResult.responseStyle === 'concise') {
      temperature = properties.legacyConciseTemperature ?? 0.5;
    }

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...conversationHistory.slice(-10).map((msg: any) => ({
        role: msg.role || 'user',
        content: msg.content || msg.message || '',
      })).filter((msg: any) => {
        return typeof msg.content === 'string' && msg.content.trim().length > 0;
      }),
      { role: 'user' as const, content: userMessage },
    ].filter((msg) => {
      return typeof msg.content === 'string' && msg.content.trim().length > 0;
    });

    // Estimate input tokens and dynamically set max_tokens to fit context
    const inputChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    const estimatedInputTokens = Math.ceil(inputChars / 3.5); // ~3.5 chars per token
    const contextLimit = properties.contextLimit ?? 4096;
    const maxTokens = Math.min(properties.legacyMaxTokens ?? 1024, Math.max(256, contextLimit - estimatedInputTokens - 100));

    try {
      const response = await callLLM({
        role: properties.model ?? 'persona',
        messages,
        userId: username,
        cognitiveMode: context.cognitiveMode,
        options: {
          maxTokens,
          repeatPenalty: properties.legacyRepeatPenalty ?? 1.3,
          temperature,
          useBigBrother, // Use Big Brother in hybrid mode for central thinking
        },
        onProgress: context.emitProgress,
      });

      return {
        response: response.content,
        orchestratorGuidance: true,
        responseStyle: loopResult.responseStyle,
        usedBigBrother: useBigBrother,
      };
    } catch (error) {
      console.error('[ResponseSynthesizer] Error generating response from orchestrator guidance:', error);
      const errorMsg = (error as Error).message;
      // Provide helpful message for common errors
      let userMessage = 'I encountered an error while processing your request.';
      if (errorMsg.includes('offline') || errorMsg.includes('not running') || errorMsg.includes('No remote provider')) {
        userMessage = 'LLM backend is unavailable. Please configure a working LLM in Settings.';
      } else if (errorMsg.includes('API key')) {
        userMessage = 'API key is missing or invalid. Please configure your LLM credentials in Settings.';
      }
      return {
        response: userMessage,
        error: errorMsg,
      };
    }
  }

  // Check if this is pre-formatted output from scratchpad_formatter
  if (loopResult.formatted && typeof loopResult.formatted === 'string') {

    const obsIndex = loopResult.formatted.indexOf('Observation: ');
    if (obsIndex !== -1) {
      const jsonStart = loopResult.formatted.indexOf('{', obsIndex);
      if (jsonStart !== -1) {
        let braceCount = 0;
        let jsonEnd = -1;
        for (let i = jsonStart; i < loopResult.formatted.length; i++) {
          if (loopResult.formatted[i] === '{') braceCount++;
          if (loopResult.formatted[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              jsonEnd = i + 1;
              break;
            }
          }
        }

        if (jsonEnd !== -1) {
          try {
            const jsonStr = loopResult.formatted.substring(jsonStart, jsonEnd);
            const observation = JSON.parse(jsonStr);
            if (observation.success && observation.outputs && observation.outputs.response) {
              return {
                response: observation.outputs.response,
                formatted: loopResult.formatted,
                entries: loopResult.entries,
              };
            }
          } catch (err) {
            console.warn(`[ResponseSynthesizer] Failed to parse observation JSON`);
          }
        }
      }
    }
  }

  // Unwrap routedData if present (from conditional_router)
  if (loopResult.routedData) {
    loopResult = loopResult.routedData;
  }

  const userMessage = scratchpadInput || inputs.userMessage || context.userMessage || '';

  // Handle loop controller output format
  let scratchpad: any[] = [];
  let finalResponse = '';

  if (loopResult.scratchpad && Array.isArray(loopResult.scratchpad)) {
    scratchpad = loopResult.scratchpad;
    finalResponse = loopResult.finalResponse || '';
  } else if (Array.isArray(loopResult)) {
    scratchpad = loopResult;
  } else if (loopResult.iterations && Array.isArray(loopResult.iterations)) {
    scratchpad = loopResult.iterations;
    finalResponse = loopResult.finalResponse || '';
  }

  // If loop controller already has a finalResponse, check if it needs persona synthesis
  if (finalResponse && finalResponse.trim().length > 0) {
    if (loopResult.delegatedTo === 'claude-code' && loopResult.bypassedReActLoop && personaInputRaw && !personaInactive) {

      const personaPrompt = personaInputRaw?.formatted || personaInputRaw;

      if (personaPrompt && typeof personaPrompt === 'string' && personaPrompt.trim().length > 0) {
        const contextData = contextInput || {};
        const conversationHistory = contextData.context?.conversationHistory || context.conversationHistory || [];

        const userMessageInput = scratchpadInput || context.userMessage || {};
        const userMsgStr = typeof userMessageInput === 'string'
          ? userMessageInput
          : (userMessageInput.message || context.userMessage || '');

        const systemPrompt = renderPromptTemplate(
          properties.delegatedWorkPersonaPromptTemplate ?? DEFAULT_DELEGATED_WORK_PERSONA_PROMPT_TEMPLATE,
          { personaPrompt, finalResponse, userMessage: userMsgStr },
        );

        const messages = [
          { role: 'system' as const, content: systemPrompt },
          ...conversationHistory.slice(-10).map((msg: any) => ({
            role: msg.role || 'user',
            content: msg.content || msg.message || '',
          })).filter((msg: any) => {
            return typeof msg.content === 'string' && msg.content.trim().length > 0;
          }),
          { role: 'user' as const, content: userMsgStr },
          { role: 'assistant' as const, content: `[Work completed]\n\n${finalResponse}` },
          { role: 'user' as const, content: 'Please respond naturally in your own voice based on what was accomplished.' },
        ].filter((msg) => {
          return typeof msg.content === 'string' && msg.content.trim().length > 0;
        });

        try {
          const response = await callLLM({
            role: properties.model ?? 'persona',
            messages,
            userId: username,
            cognitiveMode: context.cognitiveMode,
            options: {
              maxTokens: properties.delegatedWorkMaxTokens ?? 2048,
              repeatPenalty: properties.delegatedWorkRepeatPenalty ?? 1.3,
              temperature: properties.delegatedWorkTemperature ?? 0.8,
            },
            onProgress: context.emitProgress,
          });

          return {
            response: response.content,
            bigBrotherDelegation: true,
            originalResponse: finalResponse,
            personaSynthesized: true,
          };
        } catch (error) {
          console.error('[ResponseSynthesizer] Error synthesizing persona response:', error);
          return {
            response: finalResponse,
            loopComplete: loopResult.completed,
            iterations: loopResult.iterationCount,
            personaSynthesisFailed: true,
          };
        }
      }
    }

    return {
      response: finalResponse,
      loopComplete: loopResult.completed,
      iterations: loopResult.iterationCount,
    };
  }

  // Otherwise synthesize from scratchpad
  if (scratchpad.length === 0) {

    // Check context for unknownSignal or empty memories - this is valid conversation, not an error
    const contextData = contextInput || {};
    const unknownSignal = contextData.unknownSignal ?? contextData.context?.unknownSignal ?? false;
    const memories = contextData.memories ?? contextData.context?.memories ?? [];

    if (unknownSignal || memories.length === 0) {

      // Just give the persona the context and let it respond naturally (skip if persona inactive)
      const personaPrompt = personaInactive ? '' : (personaInputRaw?.formatted || personaInputRaw || '');
      const conversationHistory = contextData.context?.conversationHistory || context.conversationHistory || [];
      const userMsgStr = typeof userMessage === 'string'
        ? userMessage
        : (userMessage?.message || context.userMessage || '');

      if (personaPrompt && typeof personaPrompt === 'string' && personaPrompt.trim().length > 0) {
        // Minimal context: persona + fact that no memories were found
        const systemPrompt = renderPromptTemplate(
          properties.unknownResponseSystemPromptTemplate ?? DEFAULT_UNKNOWN_RESPONSE_SYSTEM_PROMPT_TEMPLATE,
          { personaPrompt, userMessage: userMsgStr },
        );

        const messages = [
          { role: 'system' as const, content: systemPrompt },
          ...conversationHistory.slice(-10).map((msg: any) => ({
            role: msg.role || 'user',
            content: msg.content || msg.message || '',
          })).filter((msg: any) => typeof msg.content === 'string' && msg.content.trim().length > 0),
          { role: 'user' as const, content: userMsgStr },
        ].filter((msg) => typeof msg.content === 'string' && msg.content.trim().length > 0);

        try {
          const response = await callLLM({
            role: properties.model ?? 'persona',
            messages,
            userId: username,
            cognitiveMode: context.cognitiveMode,
            options: {
              maxTokens: properties.unknownResponseMaxTokens ?? 512,
              repeatPenalty: properties.unknownResponseRepeatPenalty ?? 1.2,
              temperature: properties.unknownResponseTemperature ?? 0.7,
              useBigBrother, // Use Big Brother in hybrid mode for central thinking
            },
            onProgress: context.emitProgress,
          });

          return {
            response: response.content,
            unknownResponse: true,
            personaSynthesized: true,
            usedBigBrother: useBigBrother,
          };
        } catch (error) {
          console.error('[ResponseSynthesizer] Error generating response:', error);
        }
      }
    }

    // Actual error case - no scratchpad, no persona, no context
    console.warn('[ResponseSynthesizer] No scratchpad data available and no context');
    return {
      response: 'I was unable to process your request.',
      error: 'Empty scratchpad',
    };
  }

  // Fast-path: extract the latest observation response without calling an LLM
  const latest = scratchpad[scratchpad.length - 1] || {};
  const obsText = latest.observation || '';

  try {
    const parsed = typeof obsText === 'string' ? JSON.parse(obsText) : obsText;
    const candidate = parsed?.outputs?.response || parsed?.response || parsed?.finalResponse;
    if (candidate && typeof candidate === 'string') {
      return {
        response: candidate,
        loopComplete: loopResult.completed,
        iterations: scratchpad.length,
      };
    }
  } catch (_) {
    // Fast-path failed, continue to LLM synthesis
  }

  const scratchpadSteps = scratchpad.map((s: any, i: number) => `Step ${i + 1}:
Thought: ${s.thought || s.plan || 'N/A'}
Action: ${s.action || 'none'}
Observation: ${s.observation || 'N/A'}
`).join('\n');

  const messages = [
    {
      role: 'system' as const,
      content: properties.scratchpadSystemPromptTemplate ?? DEFAULT_SCRATCHPAD_SYSTEM_PROMPT_TEMPLATE,
    },
    {
      role: 'user' as const,
      content: renderPromptTemplate(
        properties.scratchpadUserPromptTemplate ?? DEFAULT_SCRATCHPAD_USER_PROMPT_TEMPLATE,
        { userMessage, scratchpadSteps, scratchpad },
      ),
    },
  ];

  try {
    const response = await callLLM({
      role: properties.model ?? 'persona',
      messages,
      userId: username,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: properties.scratchpadMaxTokens ?? 2048,
        repeatPenalty: properties.scratchpadRepeatPenalty ?? 1.2,
        temperature: properties.scratchpadTemperature ?? 0.7,
        useBigBrother, // Hybrid mode: use Big Brother for central thinking
      },
      onProgress: context.emitProgress,
    });

    let result: any = {
      response: response.content,
      loopComplete: loopResult.completed,
      iterations: scratchpad.length,
    };

    // Apply persona voice if persona input is available
    if (hasPersona) {
      const contextData = contextInput || {};
      const conversationHistory = contextData.context?.conversationHistory || context.conversationHistory || [];
      const userMessageInput = scratchpadInput || context.userMessage || {};
      const userMsgStr = typeof userMessageInput === 'string'
        ? userMessageInput
        : (userMessageInput.message || context.userMessage || '');

      // Skip persona voice if inactive (LoRA-only mode)
      if (!personaInactive) {
        const synthesized = await applyPersonaVoice(
          result.response,
          personaInputRaw,
          userMsgStr,
          conversationHistory,
          context.cognitiveMode || 'dual',
          {},
          context.emitProgress,
          username,
          properties
        );

        if (synthesized.personaSynthesized) {
          result.response = synthesized.response;
          result.personaSynthesized = true;
        }
      }
    }

    return result;
  } catch (error) {
    console.error('[ResponseSynthesizer] Error:', error);
    const errorMsg = (error as Error).message;
    // Provide helpful message for common errors
    let userMessage = finalResponse || 'I encountered an error while processing your request.';
    if (!finalResponse) {
      if (errorMsg.includes('offline') || errorMsg.includes('not running') || errorMsg.includes('No remote provider')) {
        userMessage = 'LLM backend is unavailable. Please configure a working LLM in Settings.';
      } else if (errorMsg.includes('API key')) {
        userMessage = 'API key is missing or invalid. Please configure your LLM credentials in Settings.';
      }
    }
    let result: any = {
      response: userMessage,
      error: errorMsg,
    };

    // Skip persona voice if inactive (LoRA-only mode)
    if (!personaInactive && result.response) {
      const contextData = contextInput || {};
      const conversationHistory = contextData.context?.conversationHistory || context.conversationHistory || [];
      const userMessageInput = scratchpadInput || context.userMessage || {};
      const userMsgStr = typeof userMessageInput === 'string'
        ? userMessageInput
        : (userMessageInput.message || context.userMessage || '');

      try {
        const synthesized = await applyPersonaVoice(
          result.response,
          personaInputRaw,
          userMsgStr,
          conversationHistory,
          context.cognitiveMode || 'dual',
          {},
          context.emitProgress,
          username,
          properties
        );

        if (synthesized.personaSynthesized) {
          result.response = synthesized.response;
          result.personaSynthesized = true;
        }
      } catch (personaError) {
        console.error('[ResponseSynthesizer] Error applying persona to error response:', personaError);
      }
    }

    return result;
  }
};

export const ResponseSynthesizerNode: NodeDefinition = defineNode({
  id: 'response_synthesizer',
  name: 'Response Synthesizer',
  category: 'operator',
  inputs: [
    { name: 'goal', type: 'string' },
    { name: 'scratchpad', type: 'array' },
    { name: 'context', type: 'context' },
    { name: 'persona', type: 'object', optional: true, description: 'Raw persona object (values, personality, identity)' },
    { name: 'personaText', type: 'object', optional: true, description: 'Formatted persona text for voice synthesis' },
  ],
  outputs: [
    { name: 'response', type: 'string', description: 'Final natural language response' },
  ],
  properties: {
    model: 'persona',
    style: 'default',
    personaVoiceSystemPromptTemplate: DEFAULT_PERSONA_VOICE_SYSTEM_PROMPT_TEMPLATE,
    personaVoiceMaxTokens: 2048,
    personaVoiceRepeatPenalty: 1.3,
    personaVoiceTemperature: 0.8,
    contextFactsFirstSystemPromptTemplate: DEFAULT_CONTEXT_FACTS_FIRST_SYSTEM_PROMPT_TEMPLATE,
    contextPersonaFirstSystemPromptTemplate: DEFAULT_CONTEXT_PERSONA_FIRST_SYSTEM_PROMPT_TEMPLATE,
    contextLimit: 4096,
    contextMaxTokens: 1024,
    contextRepeatPenalty: 1.3,
    contextFactualTemperature: 0.4,
    contextDefaultTemperature: 0.7,
    legacyGuidanceSystemPromptTemplate: DEFAULT_LEGACY_GUIDANCE_SYSTEM_PROMPT_TEMPLATE,
    legacyMaxTokens: 1024,
    legacyRepeatPenalty: 1.3,
    legacyDefaultTemperature: 0.7,
    legacyVerboseTemperature: 0.8,
    legacyConciseTemperature: 0.5,
    delegatedWorkPersonaPromptTemplate: DEFAULT_DELEGATED_WORK_PERSONA_PROMPT_TEMPLATE,
    delegatedWorkMaxTokens: 2048,
    delegatedWorkRepeatPenalty: 1.3,
    delegatedWorkTemperature: 0.8,
    unknownResponseSystemPromptTemplate: DEFAULT_UNKNOWN_RESPONSE_SYSTEM_PROMPT_TEMPLATE,
    unknownResponseMaxTokens: 512,
    unknownResponseRepeatPenalty: 1.2,
    unknownResponseTemperature: 0.7,
    scratchpadSystemPromptTemplate: DEFAULT_SCRATCHPAD_SYSTEM_PROMPT_TEMPLATE,
    scratchpadUserPromptTemplate: DEFAULT_SCRATCHPAD_USER_PROMPT_TEMPLATE,
    scratchpadMaxTokens: 2048,
    scratchpadRepeatPenalty: 1.2,
    scratchpadTemperature: 0.7,
  },
  propertySchemas: {
    model: {
      type: 'string',
      default: 'persona',
      label: 'Model',
      description: 'LLM model for synthesis',
    },
    style: {
      type: 'select',
      default: 'default',
      label: 'Response Style',
      description: 'How to synthesize the response',
      options: ['default', 'strict', 'summary'],
    },
    personaVoiceSystemPromptTemplate: {
      type: 'textarea',
      default: DEFAULT_PERSONA_VOICE_SYSTEM_PROMPT_TEMPLATE,
      label: 'Persona Voice Prompt',
      description: 'System prompt used when re-voicing generated content through the persona',
    },
    personaVoiceMaxTokens: {
      type: 'number',
      default: 2048,
      min: 256,
      max: 4096,
      label: 'Persona Voice Max Tokens',
      description: 'Maximum tokens for persona re-voice calls',
    },
    personaVoiceRepeatPenalty: {
      type: 'slider',
      default: 1.3,
      min: 1,
      max: 2,
      step: 0.05,
      label: 'Persona Voice Repeat Penalty',
      description: 'Repeat penalty for persona re-voice calls',
    },
    personaVoiceTemperature: {
      type: 'slider',
      default: 0.8,
      min: 0,
      max: 1,
      step: 0.1,
      label: 'Persona Voice Temperature',
      description: 'Temperature for persona re-voice calls',
    },
    contextFactsFirstSystemPromptTemplate: {
      type: 'textarea',
      default: DEFAULT_CONTEXT_FACTS_FIRST_SYSTEM_PROMPT_TEMPLATE,
      label: 'Context Facts-First Prompt',
      description: 'System prompt used when relevant memories should take priority over persona style',
    },
    contextPersonaFirstSystemPromptTemplate: {
      type: 'textarea',
      default: DEFAULT_CONTEXT_PERSONA_FIRST_SYSTEM_PROMPT_TEMPLATE,
      label: 'Context Persona-First Prompt',
      description: 'System prompt used when no direct factual memories are available',
    },
    contextLimit: {
      type: 'number',
      default: 4096,
      min: 1024,
      max: 32768,
      label: 'Context Limit',
      description: 'Token budget used when estimating context path output allowance',
    },
    contextMaxTokens: {
      type: 'number',
      default: 1024,
      min: 256,
      max: 4096,
      label: 'Context Max Tokens',
      description: 'Maximum output tokens for context-based synthesis',
    },
    contextRepeatPenalty: {
      type: 'slider',
      default: 1.3,
      min: 1,
      max: 2,
      step: 0.05,
      label: 'Context Repeat Penalty',
      description: 'Repeat penalty for context-based synthesis',
    },
    contextFactualTemperature: {
      type: 'slider',
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.1,
      label: 'Context Factual Temperature',
      description: 'Temperature when direct factual memories are present',
    },
    contextDefaultTemperature: {
      type: 'slider',
      default: 0.7,
      min: 0,
      max: 1,
      step: 0.1,
      label: 'Context Default Temperature',
      description: 'Temperature when no direct factual memories are present',
    },
    legacyGuidanceSystemPromptTemplate: {
      type: 'textarea',
      default: DEFAULT_LEGACY_GUIDANCE_SYSTEM_PROMPT_TEMPLATE,
      label: 'Legacy Guidance Prompt',
      description: 'System prompt for legacy orchestrator guidance responses',
    },
    legacyMaxTokens: {
      type: 'number',
      default: 1024,
      min: 256,
      max: 4096,
      label: 'Legacy Max Tokens',
      description: 'Maximum output tokens for legacy guidance responses',
    },
    legacyRepeatPenalty: {
      type: 'slider',
      default: 1.3,
      min: 1,
      max: 2,
      step: 0.05,
      label: 'Legacy Repeat Penalty',
      description: 'Repeat penalty for legacy guidance responses',
    },
    legacyDefaultTemperature: {
      type: 'slider',
      default: 0.7,
      min: 0,
      max: 1,
      step: 0.1,
      label: 'Legacy Default Temperature',
      description: 'Default temperature for legacy guidance responses',
    },
    legacyVerboseTemperature: {
      type: 'slider',
      default: 0.8,
      min: 0,
      max: 1,
      step: 0.1,
      label: 'Legacy Verbose Temperature',
      description: 'Temperature when legacy response style is verbose',
    },
    legacyConciseTemperature: {
      type: 'slider',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.1,
      label: 'Legacy Concise Temperature',
      description: 'Temperature when legacy response style is concise',
    },
    delegatedWorkPersonaPromptTemplate: {
      type: 'textarea',
      default: DEFAULT_DELEGATED_WORK_PERSONA_PROMPT_TEMPLATE,
      label: 'Delegated Work Persona Prompt',
      description: 'System prompt used when summarizing delegated autonomous work in persona voice',
    },
    delegatedWorkMaxTokens: {
      type: 'number',
      default: 2048,
      min: 256,
      max: 4096,
      label: 'Delegated Work Max Tokens',
      description: 'Maximum tokens for delegated work persona synthesis',
    },
    delegatedWorkRepeatPenalty: {
      type: 'slider',
      default: 1.3,
      min: 1,
      max: 2,
      step: 0.05,
      label: 'Delegated Work Repeat Penalty',
      description: 'Repeat penalty for delegated work persona synthesis',
    },
    delegatedWorkTemperature: {
      type: 'slider',
      default: 0.8,
      min: 0,
      max: 1,
      step: 0.1,
      label: 'Delegated Work Temperature',
      description: 'Temperature for delegated work persona synthesis',
    },
    unknownResponseSystemPromptTemplate: {
      type: 'textarea',
      default: DEFAULT_UNKNOWN_RESPONSE_SYSTEM_PROMPT_TEMPLATE,
      label: 'Unknown Response Prompt',
      description: 'System prompt used when no relevant memories are found',
    },
    unknownResponseMaxTokens: {
      type: 'number',
      default: 512,
      min: 128,
      max: 2048,
      label: 'Unknown Response Max Tokens',
      description: 'Maximum tokens for unknown-memory responses',
    },
    unknownResponseRepeatPenalty: {
      type: 'slider',
      default: 1.2,
      min: 1,
      max: 2,
      step: 0.05,
      label: 'Unknown Response Repeat Penalty',
      description: 'Repeat penalty for unknown-memory responses',
    },
    unknownResponseTemperature: {
      type: 'slider',
      default: 0.7,
      min: 0,
      max: 1,
      step: 0.1,
      label: 'Unknown Response Temperature',
      description: 'Temperature for unknown-memory responses',
    },
    scratchpadSystemPromptTemplate: {
      type: 'textarea',
      default: DEFAULT_SCRATCHPAD_SYSTEM_PROMPT_TEMPLATE,
      label: 'Scratchpad System Prompt',
      description: 'System prompt used when synthesizing from task execution observations',
    },
    scratchpadUserPromptTemplate: {
      type: 'textarea',
      default: DEFAULT_SCRATCHPAD_USER_PROMPT_TEMPLATE,
      label: 'Scratchpad User Prompt',
      description: 'User prompt template used when synthesizing from task execution observations',
    },
    scratchpadMaxTokens: {
      type: 'number',
      default: 2048,
      min: 256,
      max: 4096,
      label: 'Scratchpad Max Tokens',
      description: 'Maximum tokens for scratchpad synthesis',
    },
    scratchpadRepeatPenalty: {
      type: 'slider',
      default: 1.2,
      min: 1,
      max: 2,
      step: 0.05,
      label: 'Scratchpad Repeat Penalty',
      description: 'Repeat penalty for scratchpad synthesis',
    },
    scratchpadTemperature: {
      type: 'slider',
      default: 0.7,
      min: 0,
      max: 1,
      step: 0.1,
      label: 'Scratchpad Temperature',
      description: 'Temperature for scratchpad synthesis',
    },
  },
  description: 'Synthesizes final response using persona context',
  execute,
});
