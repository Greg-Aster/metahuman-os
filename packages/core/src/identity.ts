import fs from 'node:fs';
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
