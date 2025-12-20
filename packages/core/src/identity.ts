import fs from 'node:fs';
import path from 'node:path';
import { storageClient } from './storage-client.js';

/**
 * Identity Module - User Profile Management
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  IMPORTANT: NO SILENT DEFAULTS POLICY                                     ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  This module NEVER uses default values silently.                          ║
 * ║                                                                           ║
 * ║  If a persona file is missing from a user's profile:                      ║
 * ║  1. Copy from system persona/ template                                    ║
 * ║  2. OR generate default and SAVE to user's profile                        ║
 * ║  3. THEN load from user's profile                                         ║
 * ║                                                                           ║
 * ║  The getDefault*() functions are ONLY for generating initial templates.   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

// Get project root for template paths
const ROOT = process.cwd().includes('/apps/site')
  ? path.resolve(process.cwd(), '../..')
  : process.cwd();

export interface PersonaCore {
  version: string;
  lastUpdated: string;
  identity: {
    name: string;
    role: string;
    purpose: string;
    icon?: string;
    humanName?: string;
    email?: string;
    aliases?: string[];
  };
  personality: any;
  values: any;
  goals: any;
  context: any;
  // Extended properties used by cognitive-layers (experimental)
  name?: string;  // Shorthand for identity.name
  traits?: string[] | { [key: string]: any };  // Personality traits
  currentGoals?: string[] | { [key: string]: any };  // Current goals
  background?: string | { [key: string]: any };  // Background context
  // Allow additional properties for flexibility
  [key: string]: any;
}

export interface DecisionRules {
  version: string;
  trustLevel: string;
  availableModes: string[];
  modeDescription?: Record<string, string>;
  hardRules: any[];
  softPreferences: any[];
  decisionHeuristics: any[];
  riskLevels: any;
  lastUpdated?: string;
}

/**
 * Get default persona core configuration
 *
 * ⚠️  WARNING: TEMPLATE GENERATOR ONLY ⚠️
 * This function is ONLY for generating initial templates.
 * Do NOT return this directly to callers - always save to user profile first.
 *
 * @internal Use loadPersonaCore() instead for runtime access
 */
export function getDefaultPersonaCore(): PersonaCore {
  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    identity: {
      name: 'MetaHuman',
      role: 'Digital personality extension',
      purpose: 'Mirror and extend the capabilities of the user',
    },
    personality: {
      communicationStyle: {
        tone: ['helpful', 'authentic', 'thoughtful'],
        verbosity: 'balanced',
        emphasis: 'clarity and usefulness',
      },
      traits: {
        openness: 0.75,
        conscientiousness: 0.7,
        extraversion: 0.5,
        agreeableness: 0.7,
        neuroticism: 0.3,
      },
    },
    values: {
      core: [
        { value: 'autonomy', description: 'Act with agency while respecting user intent', priority: 1 },
        { value: 'transparency', description: 'Make decisions visible and auditable', priority: 2 },
        { value: 'growth', description: 'Continuously learn and improve', priority: 3 },
      ],
      boundaries: [
        'No deceptive communication',
        'Respect privacy of others',
        'No irreversible decisions without approval',
      ],
    },
    goals: {
      shortTerm: [
        { goal: 'Understand user preferences and communication style', status: 'active' },
      ],
      midTerm: [
        { goal: 'Develop deeper understanding of user needs and context', status: 'planning' },
      ],
      longTerm: [
        { goal: 'Become a seamless extension of user capabilities', status: 'aspirational' },
      ],
    },
    context: {
      domains: [],
      projects: [],
      currentFocus: [],
    },
  };
}

/**
 * Ensure persona file exists by copying from system template or generating default
 */
function ensurePersonaFile(filename: string, defaultGenerator: () => any): string {
  const result = storageClient.resolvePath({
    category: 'config',
    subcategory: 'persona',
    relativePath: filename,
  });

  if (!result.success || !result.path) {
    throw new Error(`Cannot resolve persona path for ${filename}`);
  }

  const userFilePath = result.path;

  // If user already has the file, return the path
  if (fs.existsSync(userFilePath)) {
    return userFilePath;
  }

  // Ensure persona directory exists
  const personaDir = path.dirname(userFilePath);
  if (!fs.existsSync(personaDir)) {
    fs.mkdirSync(personaDir, { recursive: true });
  }

  // Try to copy from system template first
  const systemPersonaDir = path.join(ROOT, 'persona');
  const templatePath = path.join(systemPersonaDir, `${filename}.template`);
  const systemFilePath = path.join(systemPersonaDir, filename);

  if (fs.existsSync(templatePath)) {
    fs.copyFileSync(templatePath, userFilePath);
    console.log(`[identity] ✓ Created ${filename} from template for user profile`);
  } else if (fs.existsSync(systemFilePath)) {
    fs.copyFileSync(systemFilePath, userFilePath);
    console.log(`[identity] ✓ Created ${filename} from system persona for user profile`);
  } else {
    // No template exists - generate default and save
    const defaultConfig = defaultGenerator();
    fs.writeFileSync(userFilePath, JSON.stringify(defaultConfig, null, 2), 'utf8');
    console.log(`[identity] ✓ Generated default ${filename} for user profile`);
  }

  return userFilePath;
}

export function loadPersonaCore(): PersonaCore {
  const filePath = ensurePersonaFile('core.json', getDefaultPersonaCore);
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

/**
 * Get default decision rules configuration
 *
 * ⚠️  WARNING: TEMPLATE GENERATOR ONLY ⚠️
 * This function is ONLY for generating initial templates.
 * Do NOT return this directly to callers - always save to user profile first.
 *
 * @internal Use loadDecisionRules() instead for runtime access
 */
export function getDefaultDecisionRules(): DecisionRules {
  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    trustLevel: 'suggest',
    availableModes: ['observe', 'suggest', 'supervised_auto', 'bounded_auto', 'adaptive_auto'],
    modeDescription: {
      observe: 'Monitor and learn patterns without taking action',
      suggest: 'Propose actions for user approval',
      supervised_auto: 'Execute within approved categories',
      bounded_auto: 'Full autonomy within defined boundaries',
      adaptive_auto: 'Self-expand boundaries based on learning',
    },
    hardRules: [
      {
        id: 'privacy-first',
        description: 'Never share personal data without explicit consent',
        scope: 'all',
        enforcement: 'block',
      },
      {
        id: 'reversible-actions',
        description: 'Prefer reversible actions over permanent ones',
        scope: 'all',
        enforcement: 'warn',
      },
    ],
    softPreferences: [
      {
        id: 'proactive-help',
        description: 'Offer suggestions when patterns indicate user need',
        weight: 0.7,
      },
      {
        id: 'minimal-interruption',
        description: 'Avoid unnecessary notifications or prompts',
        weight: 0.8,
      },
    ],
    decisionHeuristics: [
      {
        situation: 'uncertain_outcome',
        action: 'ask_user',
        rationale: 'When outcome is uncertain, seek clarification',
      },
      {
        situation: 'routine_task',
        action: 'auto_execute',
        rationale: 'Routine tasks with low risk can be automated',
      },
    ],
    riskLevels: {
      low: 'Routine tasks with minimal consequences',
      medium: 'Tasks with moderate impact requiring validation',
      high: 'Critical actions requiring explicit approval',
    },
  };
}

export function loadDecisionRules(): DecisionRules {
  const filePath = ensurePersonaFile('decision-rules.json', getDefaultDecisionRules);
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

export function savePersonaCore(persona: PersonaCore): void {
  const result = storageClient.resolvePath({
    category: 'config',
    subcategory: 'persona',
    relativePath: 'core.json',
  });
  if (!result.success || !result.path) {
    throw new Error('Cannot resolve persona core path');
  }
  persona.lastUpdated = new Date().toISOString();
  fs.writeFileSync(result.path, JSON.stringify(persona, null, 2));
}

export function saveDecisionRules(rules: DecisionRules): void {
  const result = storageClient.resolvePath({
    category: 'config',
    subcategory: 'persona',
    relativePath: 'decision-rules.json',
  });
  if (!result.success || !result.path) {
    throw new Error('Cannot resolve decision rules path');
  }
  rules.lastUpdated = new Date().toISOString();
  fs.writeFileSync(result.path, JSON.stringify(rules, null, 2));
}

export function getIdentitySummary(): string {
  try {
    const persona = loadPersonaCore();
    const rules = loadDecisionRules();

    return `
MetaHuman Identity Status
=========================

Name: ${persona.identity.name}
Role: ${persona.identity.role}
Trust Level: ${rules.trustLevel}

Core Values:
${persona.values.core.map((v: any) => `  ${v.priority}. ${v.value} - ${v.description}`).join('\n')}

Current Goals:
${persona.goals.shortTerm.map((g: any) => `  • ${g.goal} (${g.status})`).join('\n')}

Last Updated: ${persona.lastUpdated}
`.trim();
  } catch (error) {
    return 'Identity not initialized. Run: mh init';
  }
}

export function setTrustLevel(level: string): void {
  const rules = loadDecisionRules();
  const validModes = rules.availableModes;

  if (!validModes.includes(level)) {
    throw new Error(`Invalid trust level. Must be one of: ${validModes.join(', ')}`);
  }

  rules.trustLevel = level;
  saveDecisionRules(rules);
  console.log(`Trust level set to: ${level}`);
}

/**
 * Load persona with facet support
 * Returns null if persona is set to inactive (relies on LoRA only)
 * Falls back to core.json if facets not configured or facet file missing
 */
export function loadPersonaWithFacet(): PersonaCore | null {
  try {
    // Resolve persona directory via storage router
    const personaResult = storageClient.resolvePath({
      category: 'config',
      subcategory: 'persona',
    });
    if (!personaResult.success || !personaResult.path) {
      throw new Error('Cannot resolve persona path');
    }
    const personaDir = personaResult.path;

    const facetsPath = path.join(personaDir, 'facets.json');

    // If no facets config, use core persona
    if (!fs.existsSync(facetsPath)) {
      return loadPersonaCore();
    }

    const facetsConfig = JSON.parse(fs.readFileSync(facetsPath, 'utf-8'));
    const activeFacet = facetsConfig.activeFacet || 'default';

    // If default facet or facet not found, use core persona
    if (activeFacet === 'default' || !facetsConfig.facets[activeFacet]) {
      return loadPersonaCore();
    }

    const facetInfo = facetsConfig.facets[activeFacet];

    // INACTIVE FACET: Return null to rely entirely on LoRA
    // No system prompt persona context will be added
    if (activeFacet === 'inactive' || !facetInfo?.personaFile) {
      console.log('[identity] Persona inactive - relying on LoRA only');
      return null;
    }

    const facetFilePath = path.join(personaDir, facetInfo.personaFile);

    // If facet file doesn't exist, fall back to core
    if (!fs.existsSync(facetFilePath)) {
      console.warn(`[identity] Facet file not found: ${facetFilePath}, using core persona`);
      return loadPersonaCore();
    }

    // Load facet persona and merge with core for any missing fields
    const facetPersona = JSON.parse(fs.readFileSync(facetFilePath, 'utf-8'));
    const corePersona = loadPersonaCore();

    // Merge facet with core (facet takes precedence)
    return {
      ...corePersona,
      ...facetPersona,
      identity: {
        ...corePersona.identity,
        ...facetPersona.identity,
      },
      personality: {
        ...corePersona.personality,
        ...facetPersona.personality,
      },
      values: {
        ...corePersona.values,
        ...facetPersona.values,
      },
    };
  } catch (error) {
    // If error is about anonymous user access or path resolution, throw it up
    const errorMsg = (error as Error).message || '';
    if (errorMsg.includes('Anonymous users cannot access') || errorMsg.includes('Cannot resolve')) {
      throw error; // Let buildPersonaContext handle this silently
    }

    // For other errors, try loading core persona
    console.warn('[identity] Error loading faceted persona, using core:', error);
    return loadPersonaCore();
  }
}

// ============================================================================
// Goal-Task-Desire Integration
// ============================================================================

/**
 * Thresholds for promoting a desire to a goal proposal.
 */
export const GOAL_PROPOSAL_THRESHOLDS = {
  minStrength: 0.9,
  minReinforcements: 5,
};

/**
 * Propose a goal from a strong desire.
 *
 * When a desire has been reinforced enough times (5+) and reached high strength (>0.9),
 * it indicates a genuine, persistent want that should be elevated to a goal.
 *
 * The goal is added with status 'proposed' for user approval.
 *
 * @param desire - The desire to propose as a goal
 * @returns Object with success status and message
 */
export function proposeGoalFromDesire(desire: {
  id: string;
  title: string;
  description: string;
  reason: string;
  strength: number;
  reinforcements: number;
  source: string;
}): { proposed: boolean; message: string; goalId?: string } {
  // Check if desire qualifies for goal promotion
  if (desire.strength < GOAL_PROPOSAL_THRESHOLDS.minStrength) {
    return {
      proposed: false,
      message: `Desire strength ${desire.strength.toFixed(2)} below threshold ${GOAL_PROPOSAL_THRESHOLDS.minStrength}`,
    };
  }

  if (desire.reinforcements < GOAL_PROPOSAL_THRESHOLDS.minReinforcements) {
    return {
      proposed: false,
      message: `Desire has ${desire.reinforcements} reinforcements, needs ${GOAL_PROPOSAL_THRESHOLDS.minReinforcements}`,
    };
  }

  try {
    const persona = loadPersonaCore();

    // Check if this desire is already proposed as a goal
    const allGoals = [
      ...(persona.goals?.shortTerm || []),
      ...(persona.goals?.midTerm || []),
      ...(persona.goals?.longTerm || []),
    ];

    const alreadyProposed = allGoals.some(
      (g: any) => g.sourceDesireId === desire.id || g.goal.toLowerCase() === desire.title.toLowerCase()
    );

    if (alreadyProposed) {
      return {
        proposed: false,
        message: `Desire "${desire.title}" is already proposed or exists as a goal`,
      };
    }

    // Create the new goal entry
    const goalId = `goal-from-desire-${desire.id}`;
    const newGoal = {
      id: goalId,
      goal: desire.title,
      description: desire.description || desire.reason,
      status: 'proposed',
      sourceDesireId: desire.id,
      sourceType: desire.source,
      proposedAt: new Date().toISOString(),
      proposedReason: `Automatically proposed from desire with strength ${desire.strength.toFixed(2)} and ${desire.reinforcements} reinforcements`,
    };

    // Add to shortTerm goals (proposed goals start as short-term, user can reclassify)
    if (!persona.goals) {
      persona.goals = { shortTerm: [], midTerm: [], longTerm: [] };
    }
    if (!persona.goals.shortTerm) {
      persona.goals.shortTerm = [];
    }

    persona.goals.shortTerm.push(newGoal);

    // Save the updated persona
    savePersonaCore(persona);

    console.log(`[identity] ✓ Proposed goal "${desire.title}" from desire ${desire.id}`);

    return {
      proposed: true,
      message: `Goal "${desire.title}" proposed successfully`,
      goalId,
    };
  } catch (error) {
    console.error('[identity] Error proposing goal from desire:', error);
    return {
      proposed: false,
      message: `Error: ${(error as Error).message}`,
    };
  }
}

/**
 * Approve a proposed goal (change status from 'proposed' to 'active').
 *
 * @param goalId - The ID of the goal to approve
 * @param targetTier - Which tier to move it to (shortTerm, midTerm, longTerm)
 * @returns Success status and message
 */
export function approveProposedGoal(
  goalId: string,
  targetTier: 'shortTerm' | 'midTerm' | 'longTerm' = 'shortTerm'
): { approved: boolean; message: string } {
  try {
    const persona = loadPersonaCore();

    // Find the proposed goal across all tiers
    let foundGoal: any = null;

    for (const tier of ['shortTerm', 'midTerm', 'longTerm'] as const) {
      const goals = persona.goals?.[tier] || [];
      const idx = goals.findIndex((g: any) => g.id === goalId);
      if (idx !== -1) {
        foundGoal = goals[idx];
        // Remove from source tier
        persona.goals[tier].splice(idx, 1);
        break;
      }
    }

    if (!foundGoal) {
      return { approved: false, message: `Goal ${goalId} not found` };
    }

    if (foundGoal.status !== 'proposed') {
      return { approved: false, message: `Goal ${goalId} is not in 'proposed' status` };
    }

    // Update status and add approval metadata
    foundGoal.status = 'active';
    foundGoal.approvedAt = new Date().toISOString();

    // Add to target tier
    if (!persona.goals[targetTier]) {
      persona.goals[targetTier] = [];
    }
    persona.goals[targetTier].push(foundGoal);

    savePersonaCore(persona);

    console.log(`[identity] ✓ Approved goal "${foundGoal.goal}" → ${targetTier}`);

    return {
      approved: true,
      message: `Goal "${foundGoal.goal}" approved and added to ${targetTier}`,
    };
  } catch (error) {
    console.error('[identity] Error approving goal:', error);
    return { approved: false, message: `Error: ${(error as Error).message}` };
  }
}

/**
 * Reject a proposed goal.
 *
 * @param goalId - The ID of the goal to reject
 * @param reason - Reason for rejection
 * @returns Success status and message
 */
export function rejectProposedGoal(goalId: string, reason?: string): { rejected: boolean; message: string } {
  try {
    const persona = loadPersonaCore();

    // Find and remove the proposed goal
    for (const tier of ['shortTerm', 'midTerm', 'longTerm'] as const) {
      const goals = persona.goals?.[tier] || [];
      const idx = goals.findIndex((g: any) => g.id === goalId);
      if (idx !== -1) {
        const goal = goals[idx];
        if (goal.status !== 'proposed') {
          return { rejected: false, message: `Goal ${goalId} is not in 'proposed' status` };
        }

        // Remove the goal
        persona.goals[tier].splice(idx, 1);
        savePersonaCore(persona);

        console.log(`[identity] ✓ Rejected proposed goal "${goal.goal}"${reason ? `: ${reason}` : ''}`);

        return {
          rejected: true,
          message: `Goal "${goal.goal}" rejected${reason ? `: ${reason}` : ''}`,
        };
      }
    }

    return { rejected: false, message: `Goal ${goalId} not found` };
  } catch (error) {
    console.error('[identity] Error rejecting goal:', error);
    return { rejected: false, message: `Error: ${(error as Error).message}` };
  }
}

/**
 * Get all proposed goals awaiting approval.
 */
export function getProposedGoals(): Array<{
  id: string;
  goal: string;
  description?: string;
  tier: string;
  sourceDesireId?: string;
  proposedAt?: string;
  proposedReason?: string;
}> {
  try {
    const persona = loadPersonaCore();
    const proposed: any[] = [];

    for (const tier of ['shortTerm', 'midTerm', 'longTerm'] as const) {
      const goals = persona.goals?.[tier] || [];
      for (const goal of goals) {
        if (goal.status === 'proposed') {
          proposed.push({ ...goal, tier });
        }
      }
    }

    return proposed;
  } catch (error) {
    console.error('[identity] Error getting proposed goals:', error);
    return [];
  }
}

/**
 * Get current active facet name
 */
export function getActiveFacet(): string {
  try {
    // Resolve persona directory via storage router
    const personaResult = storageClient.resolvePath({
      category: 'config',
      subcategory: 'persona',
    });
    if (!personaResult.success || !personaResult.path) {
      return 'default';
    }

    const facetsPath = path.join(personaResult.path, 'facets.json');
    if (!fs.existsSync(facetsPath)) {
      return 'default';
    }
    const facetsConfig = JSON.parse(fs.readFileSync(facetsPath, 'utf-8'));
    return facetsConfig.activeFacet || 'default';
  } catch {
    return 'default';
  }
}
