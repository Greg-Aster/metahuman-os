/**
 * Semantic Turn Detection API Handlers
 *
 * Uses a fast LLM call to determine if the user has completed their utterance.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { callLLMText } from '../../model-router.js';

const TURN_DETECTION_PROMPT = `You are a turn-detection classifier for a voice conversation system.
Your task is to determine if the user has COMPLETED their utterance or if they are likely to CONTINUE speaking.

Signs of an INCOMPLETE utterance (user will continue):
- Sentence trails off with "and", "but", "so", "because", "like", "um", "uh"
- Incomplete sentences or fragments
- Lists that seem unfinished ("first... second...")
- Questions that seem to be setting up more context
- Trailing conjunctions or prepositions
- Mid-thought pauses (e.g., "I want to... you know...")

Signs of a COMPLETE utterance (user is done):
- Complete sentence with clear ending
- Direct question that expects a response
- Statement followed by natural pause point
- Commands or requests that are self-contained
- Greetings or short acknowledgments

Respond with ONLY a JSON object (no markdown, no explanation):
{"complete": true/false, "confidence": 0.0-1.0, "reason": "brief reason"}

Examples:
User: "Hey can you help me with"
{"complete": false, "confidence": 0.9, "reason": "incomplete sentence, trailing preposition"}

User: "What's the weather like today?"
{"complete": true, "confidence": 0.95, "reason": "complete question"}

User: "I need you to um"
{"complete": false, "confidence": 0.85, "reason": "filler word suggests continuation"}

User: "Tell me about machine learning"
{"complete": true, "confidence": 0.9, "reason": "complete command"}

User: "So basically what I'm trying to say is"
{"complete": false, "confidence": 0.95, "reason": "setup phrase, expects continuation"}`;

/**
 * POST /api/semantic-turn - Detect if user utterance is complete
 * Body: { transcript: string, context?: string }
 */
export async function handleSemanticTurn(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;

  try {
    const { transcript, context } = body || {};

    if (!transcript || typeof transcript !== 'string') {
      return {
        status: 400,
        error: 'transcript is required',
      };
    }

    // Skip very short transcripts - they're likely incomplete
    if (transcript.trim().length < 3) {
      return successResponse({
        complete: false,
        confidence: 0.9,
        reason: 'too short',
      });
    }

    // Build the prompt
    let userMessage = `User: "${transcript}"`;
    if (context) {
      userMessage = `Previous context: ${context}\n\n${userMessage}`;
    }

    // Use a fast model for quick classification
    const startTime = Date.now();
    const response = await callLLMText({
      role: 'orchestrator', // Fast model for classification
      messages: [
        { role: 'system', content: TURN_DETECTION_PROMPT },
        { role: 'user', content: userMessage },
      ],
      options: {
        temperature: 0.1, // Low temperature for consistent classification
        max_tokens: 100,  // Short response expected
      },
    });
    const elapsed = Date.now() - startTime;

    // Parse the JSON response
    let result: { complete: boolean; confidence: number; reason?: string };
    try {
      // Clean up response - remove any markdown formatting
      let cleanResponse = response.trim();
      if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      }
      result = JSON.parse(cleanResponse);
    } catch {
      // If parsing fails, default to complete (safer to proceed than to wait forever)
      console.warn('[semantic-turn] Failed to parse LLM response:', response);
      result = { complete: true, confidence: 0.5, reason: 'parse_error' };
    }

    console.log(`[semantic-turn] "${transcript.substring(0, 50)}..." → ${result.complete ? 'COMPLETE' : 'INCOMPLETE'} (${result.confidence.toFixed(2)}) [${elapsed}ms]`);

    return successResponse({
      ...result,
      latency_ms: elapsed,
    });
  } catch (error) {
    console.error('[semantic-turn] Error:', error);
    // On error, default to complete (safer to proceed)
    return successResponse({
      complete: true,
      confidence: 0.5,
      reason: 'error',
      error: String(error),
    });
  }
}
