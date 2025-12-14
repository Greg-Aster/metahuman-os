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
 * Falls back to core.json if facets not configured or facet file missing
 */
export function loadPersonaWithFacet(): PersonaCore {
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
