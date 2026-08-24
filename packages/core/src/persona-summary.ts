import type { PersonaCore } from './identity.js';

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function getPersonaName(persona: PersonaCore): string {
  return nonEmptyString(persona.identity?.name) || 'MetaHuman';
}

export function getPersonaTraitDescriptions(persona: PersonaCore): string[] {
  const traits = persona.personality?.traits;
  if (!traits || typeof traits !== 'object') return [];

  return Object.entries(traits)
    .filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => `${name}: ${value}`);
}

export function getPersonaValueNames(persona: PersonaCore): string[] {
  const values = persona.values?.core;
  if (!Array.isArray(values)) return [];

  return values
    .map(value => typeof value === 'string' ? value : nonEmptyString(value?.value))
    .filter((value): value is string => Boolean(value));
}

export function getActivePersonaGoals(persona: PersonaCore): string[] {
  const tiers = [
    persona.goals?.shortTerm,
    persona.goals?.midTerm,
    persona.goals?.longTerm,
  ];

  return tiers
    .flatMap(goals => Array.isArray(goals) ? goals : [])
    .map(goal => {
      if (typeof goal === 'string') return goal;
      return goal?.status === 'active' ? nonEmptyString(goal.goal) : null;
    })
    .filter((goal): goal is string => Boolean(goal));
}

export function getPersonaBackground(persona: PersonaCore): string | null {
  const background = persona.background;
  const direct = nonEmptyString(background);
  if (direct) return direct;
  if (!background || typeof background !== 'object') return null;

  const narrative = nonEmptyString((background as Record<string, unknown>).narrative);
  return narrative || JSON.stringify(background);
}
