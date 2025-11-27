/**
 * Model Warmup API
 *
 * Pre-loads models into Ollama's memory to avoid first-message latency.
 * This endpoint runs a tiny inference on each critical model to ensure
 * they're loaded and ready before the user sends their first message.
 */

import type { APIRoute } from 'astro';
import { callLLM } from '@metahuman/core/model-router';
import { audit } from '@metahuman/core/audit';

export const GET: APIRoute = async () => {
  const startTime = Date.now();
  const warmedModels: string[] = [];
  const errors: string[] = [];

  // Warm up critical models with minimal inference
  const criticalRoles: Array<'orchestrator' | 'persona'> = ['orchestrator', 'persona'];

  for (const role of criticalRoles) {
    try {
      // Send a tiny warmup message (just to load model into memory)
      await callLLM({
        role,
        messages: [{ role: 'user', content: 'hi' }],
        options: {
          maxTokens: 1, // Minimal tokens
          temperature: 0,
        },
      });

      warmedModels.push(role);
    } catch (error) {
      errors.push(`${role}: ${(error as Error).message}`);
    }
  }

  const duration = Date.now() - startTime;

  audit({
    level: 'info',
    category: 'system',
    event: 'models_warmed_up',
    details: {
      warmedModels,
      errors,
      durationMs: duration,
    },
    actor: 'system',
  });

  return new Response(
    JSON.stringify({
      success: errors.length === 0,
      warmedModels,
      errors,
      durationMs: duration,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  );
};
