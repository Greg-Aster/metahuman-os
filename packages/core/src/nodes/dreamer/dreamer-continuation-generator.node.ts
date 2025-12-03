/**
 * Dreamer Continuation Generator Node
 * Generates continuation dreams that build on previous dream narrative
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM, type RouterMessage } from '../../model-router.js';
import { audit } from '../../audit.js';
import { captureEvent } from '../../memory.js';
import { recordSystemActivity } from '../../system-activity.js';
import { scheduler } from '../../agent-scheduler.js';

function markBackgroundActivity() {
  try { recordSystemActivity(); } catch {}
  try { scheduler.recordActivity(); } catch {}
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const previousDreamInput = inputs[0];
  let lastDream = previousDreamInput?.dream || previousDreamInput;
  const username = context.userId || context.username;
  const temperature = properties?.temperature || 1.0;
  const continuationChance = properties?.continuationChance || 0.75;
  const maxContinuations = properties?.maxContinuations || 4;
  const delaySeconds = properties?.delaySeconds || 60;

  if (!lastDream || typeof lastDream !== 'string') {
    return {
      dreams: [],
      count: 0,
      error: 'No initial dream provided',
    };
  }

  const dreams: string[] = [];
  let continuationIndex = 0;

  const systemPrompt = `You are continuing a surreal dream sequence. You only see the previous dream fragment—use it as inspiration,
but feel free to drift, fracture, merge, or completely transform. No coherence required.
Let the symbols mutate, emotions shift unexpectedly, logic dissolve. Dreams don't follow rules.
Do not summarize; let one dream bleed into another. No length limits.`.trim();

  try {
    while (continuationIndex < maxContinuations) {
      const roll = Math.random();

      if (roll >= continuationChance) {
        break;
      }

      if (delaySeconds > 0) {
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        markBackgroundActivity();
      }

      const userPrompt = `Previous Dream Fragment:\n${lastDream}\n\nLet the dream continue, building on this fragment alone.`;

      const messages: RouterMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      const response = await callLLM({
        role: 'persona',
        messages,
        options: { temperature },
      });

      const continuation = response.content.trim();
      if (!continuation) break;

      lastDream = continuation;
      dreams.push(continuation);
      continuationIndex++;

      await captureEvent(continuation, {
        type: 'dream',
        metadata: {
          continuation: true,
          confidence: 0.6,
          sources: [],
          parentDream: dreams[dreams.length - 2] || lastDream,
        },
      });

      audit({
        level: 'info',
        category: 'decision',
        event: 'dream_continuation_generated',
        details: {
          continuationIndex,
          length: continuation.length,
          username,
        },
        metadata: { dream: continuation },
        actor: 'dreamer',
      });
    }

    return {
      dreams,
      count: dreams.length,
      username,
    };
  } catch (error) {
    console.error('[DreamerContinuation] Error:', error);
    return {
      dreams,
      count: dreams.length,
      error: (error as Error).message,
      username,
    };
  }
};

export const DreamerContinuationGeneratorNode: NodeDefinition = defineNode({
  id: 'dreamer_continuation_generator',
  name: 'Dreamer Continuation Generator',
  category: 'dreamer',
  inputs: [
    { name: 'previousDream', type: 'object', description: 'Previous dream data' },
  ],
  outputs: [
    { name: 'dreams', type: 'array', description: 'Continuation dreams' },
    { name: 'count', type: 'number' },
  ],
  properties: {
    temperature: 1.0,
    continuationChance: 0.75,
    maxContinuations: 4,
    delaySeconds: 60,
  },
  propertySchemas: {
    temperature: {
      type: 'number',
      default: 1.0,
      label: 'Temperature',
    },
    continuationChance: {
      type: 'number',
      default: 0.75,
      label: 'Continuation Chance',
      description: 'Probability to continue (0-1)',
    },
    maxContinuations: {
      type: 'number',
      default: 4,
      label: 'Max Continuations',
    },
    delaySeconds: {
      type: 'number',
      default: 60,
      label: 'Delay (seconds)',
    },
  },
  description: 'Generates continuation dreams that build on previous narrative',
  execute,
});
