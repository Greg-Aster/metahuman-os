/**
 * Response Synthesizer Node
 *
 * Synthesizes final response from loop controller output or scratchpad
 * Applies persona voice to final output if persona input is connected
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';
// NOTE: getIdentitySummary import REMOVED (2025-12-18)
// Persona injection should ONLY come from graph nodes (persona_loader → persona_formatter)
// Hidden fallbacks bypass the graph editor workflow and cause unexpected behavior

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
  userId?: string
): Promise<{ response: string; personaSynthesized: boolean }> {
  const personaPrompt = personaInput?.formatted || personaInput;

  if (!personaPrompt || typeof personaPrompt !== 'string' || personaPrompt.trim().length === 0) {
    return { response: responseText, personaSynthesized: false };
  }

  const systemPrompt = `${personaPrompt}

You are responding based on information that was gathered or generated. Your task is to deliver this information in your natural voice while:
1. Maintaining your personality and communication style
2. Being conversational and natural (not robotic or formal)
3. Preserving all factual content and technical details
4. NOT repeating technical output verbatim - translate into your speaking voice`;

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
      role: 'persona',
      messages,
      userId,
      cognitiveMode,
      options: {
        maxTokens: 2048,
        repeatPenalty: 1.3,
        temperature: 0.8,
      },
      onProgress: emitProgress,
    });

    return { response: response.content, personaSynthesized: true };
  } catch (error) {
    console.error('[ResponseSynthesizer] Error applying persona voice:', error);
    return { response: responseText, personaSynthesized: false };
  }
}

const execute: NodeExecutor = async (inputs, context) => {
  // Extract username for LLM calls
  const username = context.userId || context.username;

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
      const stepsText = desireContext.plan?.steps?.length > 0
        ? desireContext.plan.steps.map((s: any, i: number) =>
            `${i + 1}. ${s.action}${s.skill ? ` (${s.skill})` : ''}${s.expectedOutcome ? ` - ${s.expectedOutcome}` : ''}`
          ).join('\n')
        : 'No plan steps yet';
      const strengthPct = ((desireContext.strength || 0) * 100).toFixed(0);
      desireSection = `\n\n## Goal Context\nThe user is discussing this goal: "${desireContext.title}"\nDescription: ${desireContext.description || 'No description'}\nStatus: ${desireContext.status || 'unknown'}\nStrength: ${strengthPct}%\n\nPlan Steps:\n${stepsText}\n\nThe user can approve, reject, or provide feedback to revise this goal.\n---\n`;
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
      systemPrompt = `${currentQuerySection}${desireSection}${memoryContext}\n\n---\n\n## Your Identity\n${personaSummary}${feedbackSection}`;
    } else {
      // No memories: persona-first (unknownInstruction already handles "I don't know")
      systemPrompt = `${currentQuerySection}${desireSection}${unknownInstruction}${personaSummary}${feedbackSection}`;
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
    const contextLimit = 4096;
    const maxTokens = Math.min(1024, Math.max(256, contextLimit - estimatedInputTokens - 100));

    // Lower temperature when we have factual memories to prioritize accuracy over creativity
    const temperature = hasFactualMemories ? 0.4 : 0.7;

    try {
      const response = await callLLM({
        role: 'persona',
        messages,
        userId: username,
        cognitiveMode: context.cognitiveMode,
        options: {
          maxTokens,
          repeatPenalty: 1.3,
          temperature,
        },
        onProgress: context.emitProgress,
      });

      return {
        response: response.content,
        contextBased: true,
        unknownSignal,
        memoriesUsed: memories.length,
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
    const systemPrompt = `${personaSummary}${memoryContext}`;

    let temperature = 0.7;
    if (loopResult.responseStyle === 'verbose') {
      temperature = 0.8;
    } else if (loopResult.responseStyle === 'concise') {
      temperature = 0.5;
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
    const contextLimit = 4096;
    const maxTokens = Math.min(1024, Math.max(256, contextLimit - estimatedInputTokens - 100));

    try {
      const response = await callLLM({
        role: 'persona',
        messages,
        userId: username,
        cognitiveMode: context.cognitiveMode,
        options: {
          maxTokens,
          repeatPenalty: 1.3,
          temperature,
        },
        onProgress: context.emitProgress,
      });

      return {
        response: response.content,
        orchestratorGuidance: true,
        responseStyle: loopResult.responseStyle,
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

        const systemPrompt = `${personaPrompt}

You are responding to the user based on work that was completed by your autonomous capabilities. Review what was done and provide a response in your natural voice that:
1. Acknowledges what was accomplished
2. Maintains your personality and communication style
3. Is conversational and natural (not robotic or overly formal)

DO NOT repeat the technical details verbatim - translate them into your natural speaking voice.`;

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
            role: 'persona',
            messages,
            userId: username,
            cognitiveMode: context.cognitiveMode,
            options: {
              maxTokens: 2048,
              repeatPenalty: 1.3,
              temperature: 0.8,
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
        const systemPrompt = `${personaPrompt}

[No relevant memories found for this query]`;

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
            role: 'persona',
            messages,
            userId: username,
            cognitiveMode: context.cognitiveMode,
            options: {
              maxTokens: 512,
              repeatPenalty: 1.2,
              temperature: 0.7,
            },
            onProgress: context.emitProgress,
          });

          return {
            response: response.content,
            unknownResponse: true,
            personaSynthesized: true,
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

  const messages = [
    {
      role: 'system' as const,
      content: 'You are a response synthesizer. Create a natural, conversational response based on the observations gathered during task execution.',
    },
    {
      role: 'user' as const,
      content: `Original Query: ${userMessage}

Execution Steps:
${scratchpad.map((s: any, i: number) => `Step ${i + 1}:
Thought: ${s.thought || s.plan || 'N/A'}
Action: ${s.action || 'none'}
Observation: ${s.observation || 'N/A'}
`).join('\n')}

Based on these execution steps, provide a clear, helpful response to the user's original query:`,
    },
  ];

  try {
    const response = await callLLM({
      role: 'persona',
      messages,
      userId: username,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: 2048,
        repeatPenalty: 1.2,
        temperature: 0.7,
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
          username
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
          username
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
  },
  description: 'Synthesizes final response using persona context',
  execute,
});
