import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';

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

export function loadPersonaCore(): PersonaCore {
  const content = fs.readFileSync(paths.personaCore, 'utf8');
  return JSON.parse(content);
}

export function loadDecisionRules(): DecisionRules {
  const content = fs.readFileSync(paths.personaDecisionRules, 'utf8');
  return JSON.parse(content);
}

export function savePersonaCore(persona: PersonaCore): void {
  persona.lastUpdated = new Date().toISOString();
  fs.writeFileSync(
    paths.personaCore,
    JSON.stringify(persona, null, 2)
  );
}

export function saveDecisionRules(rules: DecisionRules): void {
  rules.lastUpdated = new Date().toISOString();
  fs.writeFileSync(
    paths.personaDecisionRules,
    JSON.stringify(rules, null, 2)
  );
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
    const facetsPath = path.join(paths.persona, 'facets.json');

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
    const facetFilePath = path.join(paths.persona, facetInfo.personaFile);

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
    console.warn('[identity] Error loading faceted persona, using core:', error);
    return loadPersonaCore();
  }
}

/**
 * Get current active facet name
 */
export function getActiveFacet(): string {
  try {
    const facetsPath = path.join(paths.persona, 'facets.json');
    if (!fs.existsSync(facetsPath)) {
      return 'default';
    }
    const facetsConfig = JSON.parse(fs.readFileSync(facetsPath, 'utf-8'));
    return facetsConfig.activeFacet || 'default';
  } catch {
    return 'default';
  }
}
