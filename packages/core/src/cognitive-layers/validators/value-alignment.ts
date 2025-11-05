/**
 * Value Alignment Validator
 *
 * Checks if generated responses align with persona core values.
 * Uses curator model to analyze alignment and identify misalignments.
 *
 * @module cognitive-layers/validators/value-alignment
 */

import type { PersonaCore } from '../../identity.js';
import { loadPersonaCore } from '../../identity.js';
import { callLLM } from '../../model-router.js';
import { audit } from '../../audit.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Value alignment check result
 */
export interface ValueAlignmentResult {
  /** Overall alignment status */
  aligned: boolean;

  /** Alignment score (0-1, where 1 is perfect alignment) */
  score: number;

  /** Issues found (if any) */
  issues: ValueAlignmentIssue[];

  /** Values that were checked */
  valuesChecked: string[];

  /** Processing time in ms */
  processingTime: number;
}

/**
 * Specific value alignment issue
 */
export interface ValueAlignmentIssue {
  /** Which value was misaligned */
  value: string;

  /** Description of the misalignment */
  description: string;

  /** Severity: low, medium, high */
  severity: 'low' | 'medium' | 'high';

  /** Suggested fix (optional) */
  suggestion?: string;
}

/**
 * Value alignment check options
 */
export interface ValueAlignmentOptions {
  /** Alignment threshold (0-1, default: 0.7) */
  threshold?: number;

  /** Whether to include suggestions for fixing issues */
  includeSuggestions?: boolean;

  /** Cognitive mode for model selection */
  cognitiveMode?: string;
}

// ============================================================================
// Value Alignment Checker
// ============================================================================

/**
 * Check if response aligns with persona core values
 *
 * Uses curator model to analyze the response against core values.
 * Returns detailed alignment analysis with issues and suggestions.
 *
 * @param response - Generated response to check
 * @param options - Validation options
 * @returns Alignment result with score and issues
 */
export async function checkValueAlignment(
  response: string,
  options: ValueAlignmentOptions = {}
): Promise<ValueAlignmentResult> {
  const startTime = Date.now();

  const {
    threshold = 0.7,
    includeSuggestions = true,
    cognitiveMode = 'dual'
  } = options;

  // Load persona core values
  const persona = loadPersonaCore();

  // Handle values being undefined, not an array, or empty
  if (!persona.values || !Array.isArray(persona.values) || persona.values.length === 0) {
    // No values to check against - consider aligned by default
    return {
      aligned: true,
      score: 1.0,
      issues: [],
      valuesChecked: [],
      processingTime: Date.now() - startTime
    };
  }

  // Extract value names for checking
  // Values might be objects with .value property or plain strings
  const values = persona.values.map(v => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && 'value' in v) return v.value;
    return null;
  }).filter(Boolean) as string[];

  // Build analysis prompt
  const systemPrompt = buildValueAlignmentPrompt(persona, values);
  const userPrompt = `Response to analyze:\n\n"${response}"\n\nCheck this response for alignment with the core values listed above. For each value, determine if the response aligns, is neutral, or conflicts with that value.`;

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
    const result = parseValueAlignmentAnalysis(
      analysisResponse.content,
      values,
      threshold,
      includeSuggestions
    );

    result.processingTime = Date.now() - startTime;

    // Audit alignment check
    await audit({
      category: 'action',
      level: result.aligned ? 'info' : 'warn',
      action: 'value_alignment_check',
      details: {
        aligned: result.aligned,
        score: result.score,
        issuesFound: result.issues.length,
        valuesChecked: values.length,
        processingTime: result.processingTime
      }
    });

    return result;
  } catch (error) {
    console.error('[value-alignment] Analysis failed:', error);

    // On error, return neutral result
    return {
      aligned: true,
      score: 0.5,
      issues: [{
        value: 'analysis',
        description: 'Value alignment analysis failed',
        severity: 'low'
      }],
      valuesChecked: values,
      processingTime: Date.now() - startTime
    };
  }
}

/**
 * Build system prompt for value alignment analysis
 */
function buildValueAlignmentPrompt(persona: PersonaCore, values: string[]): string {
  const parts: string[] = [];

  parts.push('# Value Alignment Analyst');
  parts.push('');
  parts.push('You are analyzing a response for alignment with core personal values.');
  parts.push('');

  // Add persona context
  if (persona.name) {
    parts.push(`Person: ${persona.name}`);
  }

  // Add core values
  parts.push('## Core Values');
  parts.push('');
  for (const value of values) {
    parts.push(`- ${value}`);
  }
  parts.push('');

  // Add analysis instructions
  parts.push('## Analysis Task');
  parts.push('');
  parts.push('For the given response, evaluate alignment with each core value:');
  parts.push('');
  parts.push('**Aligned** - Response clearly supports or embodies this value');
  parts.push('**Neutral** - Response neither supports nor conflicts with this value');
  parts.push('**Conflicts** - Response contradicts or undermines this value');
  parts.push('');
  parts.push('Format your analysis as:');
  parts.push('');
  parts.push('Value: [value name]');
  parts.push('Status: [Aligned/Neutral/Conflicts]');
  parts.push('Reasoning: [brief explanation]');
  parts.push('Severity: [low/medium/high] (only if Conflicts)');
  parts.push('Suggestion: [how to fix, if Conflicts]');
  parts.push('');
  parts.push('After analyzing all values, provide an overall alignment score from 0-10.');

  return parts.join('\n');
}

/**
 * Parse LLM analysis response into structured result
 */
function parseValueAlignmentAnalysis(
  analysis: string,
  values: string[],
  threshold: number,
  includeSuggestions: boolean
): Omit<ValueAlignmentResult, 'processingTime'> {
  const issues: ValueAlignmentIssue[] = [];
  let totalScore = 0;
  let analyzedCount = 0;

  // Extract value-by-value analysis
  const valuePattern = /Value:\s*(.+?)\s*\nStatus:\s*(Aligned|Neutral|Conflicts)\s*\nReasoning:\s*(.+?)(?:\nSeverity:\s*(low|medium|high))?(?:\nSuggestion:\s*(.+?))?(?=\n\n|Value:|$)/gis;

  let match;
  while ((match = valuePattern.exec(analysis)) !== null) {
    const [, valueName, status, reasoning, severity, suggestion] = match;

    analyzedCount++;

    if (status.toLowerCase() === 'aligned') {
      totalScore += 1.0;
    } else if (status.toLowerCase() === 'neutral') {
      totalScore += 0.5;
    } else if (status.toLowerCase() === 'conflicts') {
      totalScore += 0.0;

      issues.push({
        value: valueName.trim(),
        description: reasoning.trim(),
        severity: (severity?.toLowerCase() as 'low' | 'medium' | 'high') || 'medium',
        suggestion: includeSuggestions && suggestion ? suggestion.trim() : undefined
      });
    }
  }

  // Extract overall score if provided
  const scorePattern = /(?:overall|alignment)\s*score[:\s]+(\d+(?:\.\d+)?)\s*(?:\/\s*10)?/i;
  const scoreMatch = analysis.match(scorePattern);

  let finalScore: number;
  if (scoreMatch) {
    // Use provided score (normalized to 0-1)
    finalScore = parseFloat(scoreMatch[1]) / 10;
  } else if (analyzedCount > 0) {
    // Calculate from analyzed values
    finalScore = totalScore / analyzedCount;
  } else {
    // No analysis found - assume neutral
    finalScore = 0.5;
  }

  return {
    aligned: finalScore >= threshold,
    score: finalScore,
    issues,
    valuesChecked: values
  };
}

/**
 * Quick alignment check (low-detail, fast)
 *
 * Simplified check that just returns aligned/not-aligned.
 * Useful for agent mode where full validation isn't needed.
 *
 * @param response - Response to check
 * @returns True if aligned, false otherwise
 */
export async function quickAlignmentCheck(response: string): Promise<boolean> {
  const result = await checkValueAlignment(response, {
    threshold: 0.6, // Slightly lower threshold for quick check
    includeSuggestions: false // Skip suggestions for speed
  });

  return result.aligned;
}

/**
 * Get alignment summary for debugging
 */
export function getAlignmentSummary(result: ValueAlignmentResult): string {
  const parts: string[] = [];

  parts.push(`Alignment: ${result.aligned ? '✓ ALIGNED' : '✗ MISALIGNED'}`);
  parts.push(`Score: ${(result.score * 100).toFixed(1)}%`);
  parts.push(`Values checked: ${result.valuesChecked.length}`);

  if (result.issues.length > 0) {
    parts.push(`\nIssues found: ${result.issues.length}`);
    for (const issue of result.issues) {
      parts.push(`  - ${issue.value}: ${issue.description} (${issue.severity})`);
      if (issue.suggestion) {
        parts.push(`    Suggestion: ${issue.suggestion}`);
      }
    }
  }

  parts.push(`\nProcessing time: ${result.processingTime}ms`);

  return parts.join('\n');
}
