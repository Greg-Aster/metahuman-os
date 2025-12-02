/**
 * Response Synthesizer Node
 *
 * Synthesizes final response from loop controller output or scratchpad
 * Applies persona voice to final output if persona input is connected
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';
import { getIdentitySummary } from '../../identity.js';

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
  emitProgress?: (event: any) => void
): Promise<{ response: string; personaSynthesized: boolean }> {
  const personaPrompt = personaInput?.formatted || personaInput;

  if (!personaPrompt || typeof personaPrompt !== 'string' || personaPrompt.trim().length === 0) {
    console.log('[ResponseSynthesizer] No persona input available, returning original response');
    return { response: responseText, personaSynthesized: false };
  }

  console.log('[ResponseSynthesizer] Applying persona voice to response...');

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
      cognitiveMode,
      options: {
        maxTokens: 2048,
        repeatPenalty: 1.3,
        temperature: 0.8,
      },
      onProgress: emitProgress,
    });

    console.log(`[ResponseSynthesizer] ✅ Applied persona voice successfully`);
    return { response: response.content, personaSynthesized: true };
  } catch (error) {
    console.error('[ResponseSynthesizer] Error applying persona voice:', error);
    return { response: responseText, personaSynthesized: false };
  }
}

const execute: NodeExecutor = async (inputs, context) => {
  console.log(`[ResponseSynthesizer] ========== RESPONSE SYNTHESIZER ==========`);
  console.log(`[ResponseSynthesizer] Received ${inputs.length} inputs`);

  // Store persona input for later synthesis (inputs[4])
  const personaInput = inputs[4];
  const hasPersona = personaInput && (personaInput.formatted || typeof personaInput === 'string');

  // Check if inputs[1] has the SkillExecutor output
  if (inputs[1]) {
    if (inputs[1].finalResponse) {
      console.log(`[ResponseSynthesizer] ✅ Found finalResponse in inputs[1] (SkillExecutor output)`);
      return {
        response: inputs[1].finalResponse,
        skillExecutorOutput: true,
      };
    }

    if (inputs[1].outputs && inputs[1].outputs.response) {
      console.log(`[ResponseSynthesizer] ✅ Found response in inputs[1].outputs (SkillExecutor output)`);
      return {
        response: inputs[1].outputs.response,
        skillExecutorOutput: true,
      };
    }
  }

  // Extract loop result or scratchpad
  let loopResult = inputs[0] || inputs.loopResult || {};

  // Check if this is orchestrator guidance (from ConditionalReroute fallback)
  if (loopResult.needsMemory !== undefined && loopResult.responseStyle && loopResult.instructions) {
    console.log(`[ResponseSynthesizer] ✅ Detected orchestrator guidance format`);

    const userMessageInput = inputs[1] || inputs.userMessage || context.userMessage || {};
    const userMessage = typeof userMessageInput === 'string'
      ? userMessageInput
      : (userMessageInput.message || context.userMessage || '');

    const personaSummary = getIdentitySummary();
    const contextData = inputs[2] || {};
    const conversationHistory = contextData.context?.conversationHistory || context.conversationHistory || [];
    const systemPrompt = `${personaSummary}\n\nInstructions: ${loopResult.instructions}`;

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

    try {
      const response = await callLLM({
        role: 'persona',
        messages,
        cognitiveMode: context.cognitiveMode,
        options: {
          maxTokens: 2048,
          repeatPenalty: 1.3,
          temperature,
        },
        onProgress: context.emitProgress,
      });

      console.log(`[ResponseSynthesizer] ✅ Generated response using orchestrator guidance`);
      return {
        response: response.content,
        orchestratorGuidance: true,
        responseStyle: loopResult.responseStyle,
      };
    } catch (error) {
      console.error('[ResponseSynthesizer] Error generating response from orchestrator guidance:', error);
      return {
        response: 'I encountered an error while processing your request.',
        error: (error as Error).message,
      };
    }
  }

  // Check if this is pre-formatted output from scratchpad_formatter
  if (loopResult.formatted && typeof loopResult.formatted === 'string') {
    console.log(`[ResponseSynthesizer] Received pre-formatted scratchpad from formatter`);

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
              console.log(`[ResponseSynthesizer] ✅ Extracted response from observation`);
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
    console.log(`[ResponseSynthesizer] Unwrapping routedData from conditional_router`);
    loopResult = loopResult.routedData;
  }

  const userMessage = inputs[1] || inputs.userMessage || context.userMessage || '';

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
    console.log('[ResponseSynthesizer] Found finalResponse from loop controller');

    if (loopResult.delegatedTo === 'claude-code' && loopResult.bypassedReActLoop && inputs[4]) {
      console.log('[ResponseSynthesizer] Detected Big Brother delegation with persona input');

      const personaPrompt = inputs[4]?.formatted || inputs[4];

      if (personaPrompt && typeof personaPrompt === 'string' && personaPrompt.trim().length > 0) {
        const contextData = inputs[2] || {};
        const conversationHistory = contextData.context?.conversationHistory || context.conversationHistory || [];

        const userMessageInput = inputs[1] || context.userMessage || {};
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
            cognitiveMode: context.cognitiveMode,
            options: {
              maxTokens: 2048,
              repeatPenalty: 1.3,
              temperature: 0.8,
            },
            onProgress: context.emitProgress,
          });

          console.log(`[ResponseSynthesizer] ✅ Generated persona-infused response for Big Brother`);
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

    console.log('[ResponseSynthesizer] Using final response from loop controller directly');
    return {
      response: finalResponse,
      loopComplete: loopResult.completed,
      iterations: loopResult.iterationCount,
    };
  }

  // Otherwise synthesize from scratchpad
  console.log('[ResponseSynthesizer] Synthesizing from scratchpad:', scratchpad.length, 'steps');

  if (scratchpad.length === 0) {
    console.warn('[ResponseSynthesizer] No scratchpad data available');
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
      console.log('[ResponseSynthesizer] Using response from last observation (fast-path)');
      return {
        response: candidate,
        loopComplete: loopResult.completed,
        iterations: scratchpad.length,
      };
    }
  } catch (error) {
    console.log('[ResponseSynthesizer] Fast-path failed:', (error as Error).message);
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
      const contextData = inputs[2] || {};
      const conversationHistory = contextData.context?.conversationHistory || context.conversationHistory || [];
      const userMessageInput = inputs[1] || context.userMessage || {};
      const userMsgStr = typeof userMessageInput === 'string'
        ? userMessageInput
        : (userMessageInput.message || context.userMessage || '');

      const synthesized = await applyPersonaVoice(
        result.response,
        personaInput,
        userMsgStr,
        conversationHistory,
        context.cognitiveMode || 'dual',
        {},
        context.emitProgress
      );

      if (synthesized.personaSynthesized) {
        result.response = synthesized.response;
        result.personaSynthesized = true;
      }
    }

    return result;
  } catch (error) {
    console.error('[ResponseSynthesizer] Error:', error);
    let result: any = {
      response: finalResponse || 'I encountered an error while processing your request.',
      error: (error as Error).message,
    };

    if (hasPersona && result.response) {
      const contextData = inputs[2] || {};
      const conversationHistory = contextData.context?.conversationHistory || context.conversationHistory || [];
      const userMessageInput = inputs[1] || context.userMessage || {};
      const userMsgStr = typeof userMessageInput === 'string'
        ? userMessageInput
        : (userMessageInput.message || context.userMessage || '');

      try {
        const synthesized = await applyPersonaVoice(
          result.response,
          personaInput,
          userMsgStr,
          conversationHistory,
          context.cognitiveMode || 'dual',
          {},
          context.emitProgress
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
  description: 'Synthesizes final response from scratchpad',
  execute,
});
