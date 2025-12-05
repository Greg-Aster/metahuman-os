/**
 * Desire Detector Node
 *
 * Uses LLM to identify and extract desires from user input.
 * Analyzes conversation context to determine if user is expressing a goal,
 * wish, or intention that should become an autonomous desire.
 *
 * Inputs:
 *   - userInput: User message to analyze
 *   - conversationContext: Optional recent conversation for context
 *
 * Outputs:
 *   - detected: boolean - whether a desire was detected
 *   - desire: Partial Desire object if detected
 *   - confidence: 0-1 score of detection confidence
 *   - reasoning: LLM's explanation
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM, type RouterMessage } from '../../model-router.js';
import { generateDesireId } from '../../agency/types.js';
import { findSimilarDesires, reinforceDesire } from '../../agency/storage.js';

interface DetectionResult {
  isDesire: boolean;
  confidence: number;
  title: string;
  description: string;
  reason: string;
  risk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  category: string;
  isRecurring: boolean;
  suggestedPriority: 'low' | 'medium' | 'high' | 'critical';
  reasoning: string;
}

const SYSTEM_PROMPT = `You are the Desire Detection module of MetaHuman OS. Your job is to analyze user input and determine if it expresses a desire, goal, or intention that should become an autonomous action.

## What Counts as a Desire?

A desire is something the user wants to achieve, experience, or have happen. It should be:
- **Actionable**: Something that can be worked toward
- **Specific enough**: Has a clear goal or outcome
- **User-initiated**: Comes from the user's wishes (not system tasks)

Examples of desires:
- "I want to learn Italian"
- "I need to organize my photo library"
- "I'd like to get better at cooking"
- "Help me find a new apartment"
- "I should exercise more regularly"

NOT desires (regular conversation):
- "What's the weather?"
- "Tell me about React hooks"
- "Thanks for your help"
- "How do I use this feature?"

## Risk Assessment

- **none**: Information gathering, learning, research
- **low**: Local file operations, notes, reminders
- **medium**: Communications, purchases under $50, schedule changes
- **high**: Financial transactions, account changes, external system modifications
- **critical**: Security-sensitive, irreversible actions, high-value transactions

## Output Format

Respond with JSON:
{
  "isDesire": true/false,
  "confidence": 0.0-1.0,
  "title": "Short desire title (5-10 words)",
  "description": "Detailed description of what the user wants",
  "reason": "Why this matters to the user",
  "risk": "none|low|medium|high|critical",
  "category": "learning|health|productivity|creative|social|financial|technical|other",
  "isRecurring": true/false,
  "suggestedPriority": "low|medium|high|critical",
  "reasoning": "Your analysis of why this is/isn't a desire"
}`;

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Extract inputs
  const slot0 = inputs[0] as { message?: string; userInput?: string } | string | undefined;
  const slot1 = inputs[1] as { context?: string } | string | undefined;

  let userInput: string;
  if (typeof slot0 === 'string') {
    userInput = slot0;
  } else if (slot0?.message) {
    userInput = slot0.message;
  } else if (slot0?.userInput) {
    userInput = slot0.userInput;
  } else {
    userInput = context.userMessage as string || '';
  }

  const conversationContext = typeof slot1 === 'string' ? slot1 : slot1?.context || '';
  const username = context.userId as string | undefined;

  if (!userInput || userInput.trim().length < 3) {
    return {
      detected: false,
      desire: null,
      confidence: 0,
      reasoning: 'No meaningful input provided',
    };
  }

  const minConfidence = (properties?.minConfidence as number) || 0.7;
  const detectExplicit = properties?.detectExplicit !== false;
  const detectImplicit = properties?.detectImplicit !== false;
  const checkSimilar = properties?.checkSimilarDesires !== false;
  const similarityThreshold = (properties?.similarityThreshold as number) || 0.4;
  const reinforcementBoost = (properties?.reinforcementBoost as number) || 0.1;

  console.log(`[desire-detector] Analyzing: "${userInput.substring(0, 50)}..."`);

  const userPrompt = `## User Input
"${userInput}"

${conversationContext ? `## Recent Conversation Context\n${conversationContext}\n` : ''}

## Instructions
${detectExplicit ? '- Look for explicit desires ("I want...", "I need...", "I wish...")' : ''}
${detectImplicit ? '- Also detect implicit desires (complaints that imply desire for change, repeated mentions)' : ''}

Analyze whether this input contains a desire that should become an autonomous goal.`;

  const messages: RouterMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  try {
    const response = await callLLM({
      role: 'orchestrator',
      messages,
      options: {
        temperature: 0.2,
        responseFormat: 'json',
      },
    });

    if (!response.content) {
      return {
        detected: false,
        desire: null,
        confidence: 0,
        reasoning: 'Empty response from LLM',
      };
    }

    // Parse JSON response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        detected: false,
        desire: null,
        confidence: 0,
        reasoning: 'Could not parse LLM response',
      };
    }

    const result = JSON.parse(jsonMatch[0]) as DetectionResult;

    console.log(`[desire-detector] Result: isDesire=${result.isDesire}, confidence=${result.confidence}`);

    // Check if detection meets threshold
    const meetsThreshold = result.isDesire && result.confidence >= minConfidence;

    if (!meetsThreshold) {
      return {
        detected: false,
        desire: null,
        confidence: result.confidence,
        reasoning: result.isDesire
          ? `Confidence ${result.confidence} below threshold ${minConfidence}`
          : result.reasoning,
      };
    }

    // Check for similar existing desires to upgrade instead of creating duplicate
    if (checkSimilar) {
      try {
        const similarDesires = await findSimilarDesires(
          result.title,
          result.description,
          username,
          { minSimilarity: similarityThreshold }
        );

        if (similarDesires.length > 0) {
          const bestMatch = similarDesires[0];
          console.log(`[desire-detector] Found similar desire: "${bestMatch.desire.title}" (similarity: ${bestMatch.similarity.toFixed(2)})`);

          // Reinforce existing desire instead of creating new one
          const reinforcedDesire = await reinforceDesire(
            bestMatch.desire.id,
            {
              boost: reinforcementBoost,
              reason: `Reinforced by similar input: "${result.title}"`,
              sourceInput: userInput,
            },
            username
          );

          if (reinforcedDesire) {
            console.log(`[desire-detector] ♻️ Reinforced existing desire: "${reinforcedDesire.title}" (${reinforcedDesire.strength.toFixed(2)})`);

            return {
              detected: true,
              desire: reinforcedDesire,
              confidence: result.confidence,
              reasoning: `Reinforced existing desire "${reinforcedDesire.title}" (similarity: ${bestMatch.similarity.toFixed(2)}) instead of creating duplicate`,
              category: result.category,
              risk: result.risk,
              action: 'reinforced',
              similarityScore: bestMatch.similarity,
            };
          }
        }
      } catch (error) {
        console.warn(`[desire-detector] Error checking similar desires:`, error);
        // Continue to create new desire if similarity check fails
      }
    }

    // Build new desire object
    const now = new Date().toISOString();
    const desireId = generateDesireId();

    const desire = {
      id: desireId,
      title: result.title,
      description: result.description,
      reason: result.reason,
      risk: result.risk,
      source: 'detected' as const,
      priority: result.suggestedPriority,
      isRecurring: result.isRecurring,
      category: result.category,
      detectedAt: now,
      rawInput: userInput,
    };

    console.log(`[desire-detector] ✅ Created new desire: "${result.title}"`);

    return {
      detected: true,
      desire,
      confidence: result.confidence,
      reasoning: result.reasoning,
      category: result.category,
      risk: result.risk,
      action: 'created',
    };
  } catch (error) {
    console.error(`[desire-detector] ❌ Error:`, error);
    return {
      detected: false,
      desire: null,
      confidence: 0,
      reasoning: `Detection error: ${(error as Error).message}`,
    };
  }
};

export const DesireDetectorNode: NodeDefinition = defineNode({
  id: 'desire_detector',
  name: 'Detect Desire',
  category: 'agency',
  description: 'Uses LLM to identify and extract desires from user input. Checks for similar existing desires and upgrades them instead of creating duplicates.',
  inputs: [
    { name: 'userInput', type: 'any', description: 'User message to analyze' },
    { name: 'context', type: 'string', optional: true, description: 'Conversation context' },
  ],
  outputs: [
    { name: 'detected', type: 'boolean', description: 'Whether a desire was detected' },
    { name: 'desire', type: 'object', description: 'Extracted or reinforced desire data' },
    { name: 'confidence', type: 'number', description: 'Detection confidence (0-1)' },
    { name: 'reasoning', type: 'string', description: 'LLM reasoning for detection' },
    { name: 'category', type: 'string', optional: true, description: 'Desire category' },
    { name: 'risk', type: 'string', optional: true, description: 'Assessed risk level' },
    { name: 'action', type: 'string', optional: true, description: '"created" for new desire, "reinforced" for upgraded existing' },
    { name: 'similarityScore', type: 'number', optional: true, description: 'Similarity score if reinforced' },
  ],
  properties: {
    minConfidence: 0.7,
    detectExplicit: true,
    detectImplicit: false,
    checkSimilarDesires: true,
    similarityThreshold: 0.4,
    reinforcementBoost: 0.1,
  },
  propertySchemas: {
    minConfidence: {
      type: 'slider',
      default: 0.7,
      min: 0.1,
      max: 1.0,
      step: 0.1,
      label: 'Minimum Confidence',
      description: 'Minimum confidence score to report a detection',
    },
    detectExplicit: {
      type: 'boolean',
      default: true,
      label: 'Detect Explicit Desires',
      description: 'Look for explicit statements like "I want..."',
    },
    detectImplicit: {
      type: 'boolean',
      default: false,
      label: 'Detect Implicit Desires',
      description: 'Also detect implied desires from complaints or patterns',
    },
    checkSimilarDesires: {
      type: 'boolean',
      default: true,
      label: 'Check Similar Desires',
      description: 'Check for existing similar desires and reinforce them instead of creating duplicates',
    },
    similarityThreshold: {
      type: 'slider',
      default: 0.4,
      min: 0.1,
      max: 0.9,
      step: 0.1,
      label: 'Similarity Threshold',
      description: 'Minimum similarity score to consider desires as similar',
    },
    reinforcementBoost: {
      type: 'slider',
      default: 0.1,
      min: 0.05,
      max: 0.3,
      step: 0.05,
      label: 'Reinforcement Boost',
      description: 'Amount to boost strength when reinforcing existing desire',
    },
  },
  execute,
});

export default DesireDetectorNode;
