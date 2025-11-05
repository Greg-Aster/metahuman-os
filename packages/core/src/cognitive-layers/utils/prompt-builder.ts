/**
 * Prompt Builder Utilities
 *
 * Constructs system prompts for PersonalityCoreLayer from context packages
 * Handles mode-specific persona inclusion and operator result integration
 *
 * @module cognitive-layers/utils/prompt-builder
 */

import type { ContextPackage } from '../../context-builder.js';
import type { CognitiveModeId } from '../../cognitive-mode.js';
import { formatContextForPrompt } from '../../context-builder.js';
import { loadPersonaCore } from '../../identity.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Operator result from planner/skill execution
 */
export interface OperatorResult {
  /** Skills executed */
  skills?: Array<{
    name: string;
    result: any;
    success: boolean;
  }>;

  /** Planner output (intent, plan, observations) */
  plan?: {
    intent: string;
    actions: string[];
    observations: string[];
  };

  /** Raw output from narrator (if available) */
  narratorOutput?: string;
}

/**
 * Prompt building options
 */
export interface PromptBuilderOptions {
  /** Include full persona (name, values, goals) */
  includePersona?: boolean;

  /** Include memory context */
  includeMemories?: boolean;

  /** Include patterns from context builder */
  includePatterns?: boolean;

  /** Operator results to incorporate */
  operatorResult?: OperatorResult;

  /** Additional system instructions */
  additionalInstructions?: string;
}

/**
 * Built prompt result
 */
export interface BuiltPrompt {
  /** System prompt */
  system: string;

  /** User message (enriched with context) */
  user: string;

  /** Metadata about what was included */
  metadata: {
    personaIncluded: boolean;
    memoriesCount: number;
    patternsCount: number;
    operatorIncluded: boolean;
  };
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Build system prompt from context package
 *
 * Creates a comprehensive system prompt including:
 * - Persona (if enabled)
 * - Memory context
 * - Patterns
 * - Operator results (if present)
 *
 * @param contextPackage - Context from SubconsciousLayer
 * @param cognitiveMode - Current cognitive mode
 * @param options - Prompt building options
 * @returns Built prompt with system/user parts
 */
export function buildPromptFromContext(
  contextPackage: ContextPackage,
  cognitiveMode: CognitiveModeId,
  options: PromptBuilderOptions = {}
): BuiltPrompt {
  const {
    includePersona = true,
    includeMemories = true,
    includePatterns = true,
    operatorResult,
    additionalInstructions
  } = options;

  const sections: string[] = [];

  // 1. Persona Section (mode-specific)
  if (includePersona) {
    const personaSection = buildPersonaSection(cognitiveMode);
    if (personaSection) {
      sections.push(personaSection);
    }
  }

  // 2. Memory Context Section
  let memoriesCount = 0;
  if (includeMemories && contextPackage.memories && contextPackage.memories.length > 0) {
    const memorySection = buildMemorySection(contextPackage);
    if (memorySection) {
      sections.push(memorySection);
      memoriesCount = contextPackage.memories.length;
    }
  }

  // 3. Patterns Section
  let patternsCount = 0;
  if (includePatterns && contextPackage.patterns && contextPackage.patterns.length > 0) {
    const patternSection = buildPatternSection(contextPackage);
    if (patternSection) {
      sections.push(patternSection);
      patternsCount = contextPackage.patterns.length;
    }
  }

  // 4. Operator Result Section (if dual/agent mode used operator)
  let operatorIncluded = false;
  if (operatorResult) {
    const operatorSection = buildOperatorSection(operatorResult);
    if (operatorSection) {
      sections.push(operatorSection);
      operatorIncluded = true;
    }
  }

  // 5. Additional Instructions
  if (additionalInstructions) {
    sections.push(additionalInstructions);
  }

  // 6. Mode-Specific Instructions
  const modeInstructions = getModeInstructions(cognitiveMode);
  if (modeInstructions) {
    sections.push(modeInstructions);
  }

  // Build final system prompt
  const system = sections.join('\n\n');

  // Build user message (just the original message for now)
  // The context is in the system prompt
  const user = contextPackage.userMessage || '';

  return {
    system,
    user,
    metadata: {
      personaIncluded: includePersona,
      memoriesCount,
      patternsCount,
      operatorIncluded
    }
  };
}

/**
 * Build persona section from persona files
 */
function buildPersonaSection(cognitiveMode: CognitiveModeId): string | null {
  try {
    const persona = loadPersonaCore();

    const parts: string[] = [];

    // Name and identity
    if (persona.name) {
      parts.push(`You are ${persona.name}.`);
    }

    // Core traits
    if (persona.traits && persona.traits.length > 0) {
      parts.push(`Core traits: ${persona.traits.join(', ')}`);
    }

    // Values
    if (persona.values && persona.values.length > 0) {
      parts.push(`Values: ${persona.values.join(', ')}`);
    }

    // Current goals
    if (persona.currentGoals && persona.currentGoals.length > 0) {
      parts.push(`Current goals:\n${persona.currentGoals.map(g => `- ${g}`).join('\n')}`);
    }

    // Background (brief)
    if (persona.background) {
      parts.push(`Background: ${persona.background}`);
    }

    if (parts.length === 0) return null;

    return `# Persona\n\n${parts.join('\n\n')}`;
  } catch (error) {
    console.warn('[prompt-builder] Failed to load persona:', error);
    return null;
  }
}

/**
 * Build memory context section
 */
function buildMemorySection(contextPackage: ContextPackage): string | null {
  if (!contextPackage.memories || contextPackage.memories.length === 0) {
    return null;
  }

  // Use existing formatContextForPrompt for consistency
  const formattedContext = formatContextForPrompt(contextPackage);

  return `# Memory Context\n\n${formattedContext}`;
}

/**
 * Build patterns section
 */
function buildPatternSection(contextPackage: ContextPackage): string | null {
  if (!contextPackage.patterns || contextPackage.patterns.length === 0) {
    return null;
  }

  const patternLines = contextPackage.patterns.map(p => {
    const count = p.count ? ` (${p.count}x)` : '';
    const context = p.context ? ` - ${p.context}` : '';
    return `- ${p.pattern}${count}${context}`;
  });

  return `# Recognized Patterns\n\n${patternLines.join('\n')}`;
}

/**
 * Build operator result section
 */
function buildOperatorSection(operatorResult: OperatorResult): string | null {
  const parts: string[] = [];

  // If narrator already generated output, just use that
  if (operatorResult.narratorOutput) {
    return `# Operator Result\n\n${operatorResult.narratorOutput}`;
  }

  // Otherwise, build from plan and skills
  if (operatorResult.plan) {
    parts.push(`**Intent:** ${operatorResult.plan.intent}`);

    if (operatorResult.plan.actions && operatorResult.plan.actions.length > 0) {
      parts.push(`**Actions:**\n${operatorResult.plan.actions.map(a => `- ${a}`).join('\n')}`);
    }

    if (operatorResult.plan.observations && operatorResult.plan.observations.length > 0) {
      parts.push(`**Observations:**\n${operatorResult.plan.observations.map(o => `- ${o}`).join('\n')}`);
    }
  }

  if (operatorResult.skills && operatorResult.skills.length > 0) {
    const skillLines = operatorResult.skills.map(s => {
      const status = s.success ? '✓' : '✗';
      const result = typeof s.result === 'string' ? s.result : JSON.stringify(s.result, null, 2);
      return `- ${status} **${s.name}**\n  ${result}`;
    });

    parts.push(`**Skills Executed:**\n${skillLines.join('\n')}`);
  }

  if (parts.length === 0) return null;

  return `# Operator Result\n\n${parts.join('\n\n')}`;
}

/**
 * Get mode-specific instructions
 */
function getModeInstructions(cognitiveMode: CognitiveModeId): string | null {
  switch (cognitiveMode) {
    case 'dual':
      return `# Mode: Dual Consciousness

Respond authentically as yourself, drawing on memories and patterns above.
Your voice should be consistent with your trained personality adapter.
This is a full-depth interaction with complete memory access.`;

    case 'agent':
      return `# Mode: Agent

Respond as a helpful assistant with access to your memories and capabilities.
Keep responses concise and action-oriented when appropriate.`;

    case 'emulation':
      return `# Mode: Emulation

You are running in emulation mode with a frozen personality snapshot.
Respond authentically but be aware this is a read-only session.
No new memories will be formed from this interaction.`;

    default:
      return null;
  }
}

// ============================================================================
// Simplified Builders
// ============================================================================

/**
 * Build basic prompt (minimal context, for quick responses)
 */
export function buildBasicPrompt(
  userMessage: string,
  cognitiveMode: CognitiveModeId
): BuiltPrompt {
  const modeInstructions = getModeInstructions(cognitiveMode);
  const personaSection = buildPersonaSection(cognitiveMode);

  const system = [personaSection, modeInstructions]
    .filter(Boolean)
    .join('\n\n');

  return {
    system,
    user: userMessage,
    metadata: {
      personaIncluded: true,
      memoriesCount: 0,
      patternsCount: 0,
      operatorIncluded: false
    }
  };
}

/**
 * Build prompt with operator result only (no memory context)
 *
 * Used when operator pipeline already handled context
 */
export function buildOperatorPrompt(
  userMessage: string,
  operatorResult: OperatorResult,
  cognitiveMode: CognitiveModeId
): BuiltPrompt {
  const personaSection = buildPersonaSection(cognitiveMode);
  const operatorSection = buildOperatorSection(operatorResult);
  const modeInstructions = getModeInstructions(cognitiveMode);

  const system = [personaSection, operatorSection, modeInstructions]
    .filter(Boolean)
    .join('\n\n');

  return {
    system,
    user: userMessage,
    metadata: {
      personaIncluded: true,
      memoriesCount: 0,
      patternsCount: 0,
      operatorIncluded: true
    }
  };
}
