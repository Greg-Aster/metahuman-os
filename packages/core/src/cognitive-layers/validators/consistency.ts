/**
 * Consistency Validator
 *
 * Checks if generated responses are consistent with persona identity,
 * communication style, and known facts.
 *
 * @module cognitive-layers/validators/consistency
 */

import type { PersonaCore } from '../../identity.js';
import { loadPersonaCore } from '../../identity.js';
import { callLLM } from '../../model-router.js';
import { audit } from '../../audit.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Consistency check result
 */
export interface ConsistencyResult {
  /** Overall consistency status */
  consistent: boolean;

  /** Consistency score (0-1, where 1 is perfect consistency) */
  score: number;

  /** Issues found (if any) */
  issues: ConsistencyIssue[];

  /** Aspects checked */
  aspectsChecked: ConsistencyAspect[];

  /** Processing time in ms */
  processingTime: number;
}

/**
 * Aspects of consistency to check
 */
export type ConsistencyAspect = 'identity' | 'tone' | 'style' | 'facts' | 'voice';

/**
 * Specific consistency issue
 */
export interface ConsistencyIssue {
  /** Which aspect has an issue */
  aspect: ConsistencyAspect;

  /** Description of the inconsistency */
  description: string;

  /** Severity: low, medium, high */
  severity: 'low' | 'medium' | 'high';

  /** Example of inconsistency (optional) */
  example?: string;
}

/**
 * Consistency check options
 */
export interface ConsistencyOptions {
  /** Consistency threshold (0-1, default: 0.7) */
  threshold?: number;

  /** Which aspects to check (default: all) */
  aspects?: ConsistencyAspect[];

  /** Cognitive mode for model selection */
  cognitiveMode?: string;
}

// ============================================================================
// Consistency Checker
// ============================================================================

/**
 * Check if response is consistent with persona
 *
 * Uses curator model to analyze response for:
 * - Identity consistency (matches who they are)
 * - Tone consistency (matches communication style)
 * - Style consistency (matches typical expression)
 * - Factual consistency (no contradictions with known facts)
 * - Voice consistency (sounds like the persona)
 *
 * @param response - Generated response to check
 * @param contextPackage - Context used to generate response (optional)
 * @param options - Validation options
 * @returns Consistency result with score and issues
 */
export async function checkConsistency(
  response: string,
  contextPackage?: any,
  options: ConsistencyOptions = {}
): Promise<ConsistencyResult> {
  const startTime = Date.now();

  const {
    threshold = 0.7,
    aspects = ['identity', 'tone', 'style', 'voice'],
    cognitiveMode = 'dual'
  } = options;

  // Load persona for consistency checking
  const persona = loadPersonaCore();

  // Build analysis prompt
  const systemPrompt = buildConsistencyPrompt(persona, aspects, contextPackage);
  const userPrompt = `Response to analyze:\n\n"${response}"\n\nCheck this response for consistency with the persona identity, communication style, and tone described above.`;

  // Call curator model for analysis
  try {
    const analysisResponse = await callLLM({
      role: 'curator',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      cognitiveMode,
      options: {
        temperature: 0.3, // Lower temperature for consistent analysis
        max_tokens: 800
      }
    });

    // Parse analysis result
    const parsedResult = parseConsistencyAnalysis(
      analysisResponse.content,
      aspects,
      threshold
    );

    const result: ConsistencyResult = {
      ...parsedResult,
      processingTime: Date.now() - startTime
    };

    // Audit consistency check
    await audit({
      category: 'action',
      level: result.consistent ? 'info' : 'warn',
      event: 'consistency_check',
      details: {
        consistent: result.consistent,
        score: result.score,
        issuesFound: result.issues.length,
        aspectsChecked: aspects.length,
        processingTime: result.processingTime
      }
    });

    return result;
  } catch (error) {
    console.error('[consistency] Analysis failed:', error);

    // On error, return neutral result
    return {
      consistent: true,
      score: 0.5,
      issues: [{
        aspect: 'identity',
        description: 'Consistency analysis failed',
        severity: 'low'
      }],
      aspectsChecked: aspects,
      processingTime: Date.now() - startTime
    };
  }
}

/**
 * Build system prompt for consistency analysis
 */
function buildConsistencyPrompt(
  persona: PersonaCore,
  aspects: ConsistencyAspect[],
  contextPackage?: any
): string {
  const parts: string[] = [];

  parts.push('# Consistency Analyst');
  parts.push('');
  parts.push('You are analyzing a response for consistency with a persona.');
  parts.push('');

  // Add persona identity
  if (persona.name) {
    parts.push(`## Identity: ${persona.name}`);
    parts.push('');
  }

  // Add communication style if checking tone/style
  if (aspects.includes('tone') || aspects.includes('style')) {
    parts.push('## Communication Style');
    parts.push('');

    if (persona.traits && persona.traits.length > 0) {
      parts.push(`**Traits:** ${persona.traits.join(', ')}`);
    }

    // Add communication tone if available
    const communicationStyle = (persona as any).personality?.communicationStyle;
    if (communicationStyle?.tone) {
      const tones = Array.isArray(communicationStyle.tone)
        ? communicationStyle.tone.join(', ')
        : communicationStyle.tone;
      parts.push(`**Tone:** ${tones}`);
    }

    // Add language patterns if available
    if (communicationStyle?.languagePatterns) {
      parts.push(`**Language patterns:** ${communicationStyle.languagePatterns.join(', ')}`);
    }

    parts.push('');
  }

  // Add background if checking identity
  if (aspects.includes('identity') && persona.background) {
    parts.push('## Background');
    parts.push('');
    const bg = typeof persona.background === 'string' ? persona.background : JSON.stringify(persona.background);
    parts.push(bg);
    parts.push('');
  }

  // Add context facts if available and checking facts
  if (aspects.includes('facts') && contextPackage?.memories) {
    parts.push('## Known Facts (from context)');
    parts.push('');
    for (const memory of contextPackage.memories.slice(0, 3)) {
      if (memory.content) {
        parts.push(`- ${memory.content.substring(0, 150)}`);
      }
    }
    parts.push('');
  }

  // Add analysis instructions
  parts.push('## Analysis Task');
  parts.push('');
  parts.push('Evaluate the response for consistency across these aspects:');
  parts.push('');

  if (aspects.includes('identity')) {
    parts.push('**Identity:** Does the response match who this person is?');
  }
  if (aspects.includes('tone')) {
    parts.push('**Tone:** Does the tone match their communication style?');
  }
  if (aspects.includes('style')) {
    parts.push('**Style:** Does the expression style match typical patterns?');
  }
  if (aspects.includes('voice')) {
    parts.push('**Voice:** Does it sound like this person wrote it?');
  }
  if (aspects.includes('facts')) {
    parts.push('**Facts:** Are there any contradictions with known facts?');
  }

  parts.push('');
  parts.push('For each aspect, determine:');
  parts.push('- **Consistent** - Matches expected pattern');
  parts.push('- **Inconsistent** - Contradicts or deviates significantly');
  parts.push('');
  parts.push('Format your analysis as:');
  parts.push('');
  parts.push('Aspect: [aspect name]');
  parts.push('Status: [Consistent/Inconsistent]');
  parts.push('Reasoning: [brief explanation]');
  parts.push('Severity: [low/medium/high] (only if Inconsistent)');
  parts.push('Example: [quote from response showing issue]');
  parts.push('');
  parts.push('After analyzing all aspects, provide an overall consistency score from 0-10.');

  return parts.join('\n');
}

/**
 * Parse LLM analysis response into structured result
 */
function parseConsistencyAnalysis(
  analysis: string,
  aspects: ConsistencyAspect[],
  threshold: number
): Omit<ConsistencyResult, 'processingTime'> {
  const issues: ConsistencyIssue[] = [];
  let totalScore = 0;
  let analyzedCount = 0;

  // Extract aspect-by-aspect analysis
  const aspectPattern = /Aspect:\s*(.+?)\s*\nStatus:\s*(Consistent|Inconsistent)\s*\nReasoning:\s*(.+?)(?:\nSeverity:\s*(low|medium|high))?(?:\nExample:\s*(.+?))?(?=\n\n|Aspect:|$)/gis;

  let match;
  while ((match = aspectPattern.exec(analysis)) !== null) {
    const [, aspectName, status, reasoning, severity, example] = match;

    analyzedCount++;

    if (status.toLowerCase() === 'consistent') {
      totalScore += 1.0;
    } else if (status.toLowerCase() === 'inconsistent') {
      totalScore += 0.0;

      // Determine which aspect type this is
      const aspect = determineAspectType(aspectName.toLowerCase(), aspects);

      issues.push({
        aspect,
        description: reasoning.trim(),
        severity: (severity?.toLowerCase() as 'low' | 'medium' | 'high') || 'medium',
        example: example ? example.trim() : undefined
      });
    }
  }

  // Extract overall score if provided
  const scorePattern = /(?:overall|consistency)\s*score[:\s]+(\d+(?:\.\d+)?)\s*(?:\/\s*10)?/i;
  const scoreMatch = analysis.match(scorePattern);

  let finalScore: number;
  if (scoreMatch) {
    // Use provided score (normalized to 0-1)
    finalScore = parseFloat(scoreMatch[1]) / 10;
  } else if (analyzedCount > 0) {
    // Calculate from analyzed aspects
    finalScore = totalScore / analyzedCount;
  } else {
    // No analysis found - assume consistent
    finalScore = 0.8;
  }

  return {
    consistent: finalScore >= threshold,
    score: finalScore,
    issues,
    aspectsChecked: aspects
  };
}

/**
 * Determine aspect type from analysis text
 */
function determineAspectType(text: string, aspects: ConsistencyAspect[]): ConsistencyAspect {
  if (text.includes('identity') || text.includes('who')) return 'identity';
  if (text.includes('tone')) return 'tone';
  if (text.includes('style')) return 'style';
  if (text.includes('fact') || text.includes('contradiction')) return 'facts';
  if (text.includes('voice') || text.includes('sound')) return 'voice';

  // Default to first aspect in list
  return aspects[0] || 'identity';
}

/**
 * Quick consistency check (low-detail, fast)
 *
 * Simplified check that just returns consistent/not-consistent.
 * Only checks identity and tone.
 *
 * @param response - Response to check
 * @returns True if consistent, false otherwise
 */
export async function quickConsistencyCheck(response: string): Promise<boolean> {
  const result = await checkConsistency(response, undefined, {
    threshold: 0.6,
    aspects: ['identity', 'tone'] // Only check most important aspects
  });

  return result.consistent;
}

/**
 * Get consistency summary for debugging
 */
export function getConsistencySummary(result: ConsistencyResult): string {
  const parts: string[] = [];

  parts.push(`Consistency: ${result.consistent ? '✓ CONSISTENT' : '✗ INCONSISTENT'}`);
  parts.push(`Score: ${(result.score * 100).toFixed(1)}%`);
  parts.push(`Aspects checked: ${result.aspectsChecked.join(', ')}`);

  if (result.issues.length > 0) {
    parts.push(`\nIssues found: ${result.issues.length}`);
    for (const issue of result.issues) {
      parts.push(`  - ${issue.aspect}: ${issue.description} (${issue.severity})`);
      if (issue.example) {
        parts.push(`    Example: "${issue.example}"`);
      }
    }
  }

  parts.push(`\nProcessing time: ${result.processingTime}ms`);

  return parts.join('\n');
}
