/**
 * Persona draft merger.
 *
 * Extraction produces a bounded draft. This module previews or applies that draft
 * while identity.ts remains the sole owner of persona persistence and archives.
 */

import {
  archivePersonaCore,
  loadPersonaCore,
  savePersonaCore,
  type GoalEntry,
  type PersonaCore,
} from '../identity.js';
import {
  validatePersonaDraft,
  type BigFive,
  type PersonaDraft,
} from '../nodes/persona/persona-profile-extractor.node.js';

export type MergeStrategy = 'replace' | 'merge' | 'append';

export interface DiffEntry {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  action: 'add' | 'update' | 'remove' | 'no-change';
}

export interface PersonaDiff {
  changes: DiffEntry[];
  summary: {
    additions: number;
    updates: number;
    removals: number;
    noChanges: number;
  };
}

const MERGE_STRATEGIES = new Set<MergeStrategy>(['replace', 'merge', 'append']);

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function recordChange(
  changes: DiffEntry[],
  field: string,
  oldValue: unknown,
  newValue: unknown,
): void {
  const missing = oldValue === undefined || oldValue === null
    || (Array.isArray(oldValue) && oldValue.length === 0);
  changes.push({
    field,
    oldValue,
    newValue,
    action: valuesEqual(oldValue, newValue) ? 'no-change' : missing ? 'add' : 'update',
  });
}

function mergeStrings(current: string[], proposed: string[], strategy: MergeStrategy): string[] {
  if (strategy === 'replace') return proposed;
  return [...new Set([...current, ...proposed])];
}

function goalEntries(goals: string[], status: string): GoalEntry[] {
  return goals.map(goal => ({ goal, status }));
}

function mergeGoals(
  current: GoalEntry[],
  proposed: GoalEntry[],
  strategy: MergeStrategy,
): GoalEntry[] {
  if (strategy === 'replace') return proposed;
  const known = new Set(current.map(goal => goal.goal.trim().toLocaleLowerCase()));
  return [...current, ...proposed.filter(goal => !known.has(goal.goal.trim().toLocaleLowerCase()))];
}

export function mergePersonaDraft(
  currentPersona: PersonaCore,
  draft: PersonaDraft,
  strategy: MergeStrategy = 'merge',
): { updated: PersonaCore; diff: PersonaDiff } {
  if (!MERGE_STRATEGIES.has(strategy)) {
    throw new Error(`Unsupported persona merge strategy: ${strategy}`);
  }

  const updated = structuredClone(currentPersona);
  const changes: DiffEntry[] = [];

  if (draft.traits) {
    const oldTraits = updated.personality?.traits;
    if (!oldTraits) {
      throw new Error('Cannot merge extracted traits because persona personality.traits is missing');
    }
    const nextTraits = { ...oldTraits };
    for (const [trait, score] of Object.entries(draft.traits) as Array<[keyof BigFive, number]>) {
      if (score === undefined) continue;
      const oldScore = oldTraits[trait];
      const nextScore = strategy === 'append' && oldScore !== undefined ? oldScore : score;
      nextTraits[trait] = nextScore;
      recordChange(changes, `personality.traits.${trait}`, oldScore, nextScore);
    }
    updated.personality.traits = nextTraits;
  }

  if (draft.values?.length) {
    const oldValues = updated.values?.core;
    if (!Array.isArray(oldValues)) {
      throw new Error('Cannot merge values because persona values.core is missing');
    }
    let nextValues: typeof oldValues;
    if (strategy === 'replace') {
      nextValues = draft.values;
    } else if (strategy === 'merge') {
      const proposedNames = new Set(draft.values.map(value => value.value.toLocaleLowerCase()));
      nextValues = [
        ...draft.values,
        ...oldValues.filter(value => !proposedNames.has(value.value.toLocaleLowerCase())),
      ];
    } else {
      const existingNames = new Set(oldValues.map(value => value.value.toLocaleLowerCase()));
      nextValues = [
        ...oldValues,
        ...draft.values.filter(value => !existingNames.has(value.value.toLocaleLowerCase())),
      ];
    }
    updated.values.core = nextValues;
    recordChange(changes, 'values.core', oldValues, nextValues);
  }

  if (draft.communicationStyle) {
    const oldStyle = updated.personality?.communicationStyle;
    if (!oldStyle
      || !Array.isArray(oldStyle.tone)
      || typeof oldStyle.verbosity !== 'string'
      || typeof oldStyle.emphasis !== 'string') {
      throw new Error('Cannot merge communication style because persona communicationStyle is incomplete');
    }
    const nextStyle = { ...oldStyle };
    const nextRecord = nextStyle as unknown as Record<string, unknown>;
    for (const [field, value] of Object.entries(draft.communicationStyle)) {
      if (field === 'tone' || value === undefined) continue;
      if (strategy !== 'append' || nextRecord[field] === undefined || nextRecord[field] === '') {
        nextRecord[field] = value;
      }
    }
    if (draft.communicationStyle.tone) {
      nextStyle.tone = mergeStrings(oldStyle.tone, draft.communicationStyle.tone, strategy);
    }
    updated.personality.communicationStyle = nextStyle;
    recordChange(changes, 'personality.communicationStyle', oldStyle, nextStyle);
  }

  if (draft.interests?.length) {
    const oldInterests = updated.personality?.interests || [];
    updated.personality.interests = mergeStrings(oldInterests, draft.interests, strategy);
    recordChange(changes, 'personality.interests', oldInterests, updated.personality.interests);
  }

  if (draft.goals) {
    if (!updated.goals) throw new Error('Cannot merge goals because persona goals are missing');
    const goalUpdates = [
      ['shortTerm', draft.goals.shortTerm, 'active'],
      ['midTerm', draft.goals.midTerm, 'planning'],
      ['longTerm', draft.goals.longTerm, 'aspirational'],
    ] as const;
    for (const [tier, proposed, status] of goalUpdates) {
      if (!proposed?.length) continue;
      const current = updated.goals[tier];
      if (!Array.isArray(current)) {
        throw new Error(`Cannot merge goals because persona goals.${tier} is missing`);
      }
      const next = mergeGoals(current, goalEntries(proposed, status), strategy);
      updated.goals[tier] = next;
      recordChange(changes, `goals.${tier}`, current, next);
    }
  }

  if (draft.background) {
    const existing = updated.background;
    const oldNarrative = typeof existing === 'string' ? existing : existing?.narrative;
    if (strategy !== 'append' || !oldNarrative) {
      updated.background = strategy === 'merge' && existing && typeof existing === 'object'
        ? { ...existing, narrative: draft.background }
        : draft.background;
    }
    const nextNarrative = typeof updated.background === 'string'
      ? updated.background
      : updated.background?.narrative;
    recordChange(
      changes,
      existing && typeof existing === 'object' ? 'background.narrative' : 'background',
      oldNarrative,
      nextNarrative,
    );
  }

  if (draft.currentFocus?.length) {
    if (!updated.context) {
      throw new Error('Cannot merge current focus because persona context is missing');
    }
    const oldFocus = updated.context.currentFocus;
    if (!Array.isArray(oldFocus)) {
      throw new Error('Cannot merge current focus because persona context.currentFocus is missing');
    }
    updated.context.currentFocus = mergeStrings(oldFocus, draft.currentFocus, strategy);
    recordChange(changes, 'context.currentFocus', oldFocus, updated.context.currentFocus);
  }

  updated.lastUpdated = new Date().toISOString();
  const summary = {
    additions: changes.filter(change => change.action === 'add').length,
    updates: changes.filter(change => change.action === 'update').length,
    removals: changes.filter(change => change.action === 'remove').length,
    noChanges: changes.filter(change => change.action === 'no-change').length,
  };
  return { updated, diff: { changes, summary } };
}

export function applyPersonaDraft(
  draft: unknown,
  strategy: MergeStrategy = 'merge',
): { updated: PersonaCore; diff: PersonaDiff; archiveFilename: string } {
  const validatedDraft = validatePersonaDraft(draft);
  const currentPersona = loadPersonaCore();
  const { updated, diff } = mergePersonaDraft(currentPersona, validatedDraft, strategy);
  const archiveFilename = archivePersonaCore(currentPersona);
  savePersonaCore(updated);
  return { updated, diff, archiveFilename };
}

export function generateDiffText(diff: PersonaDiff): string {
  const lines = [
    'Persona Changes Summary',
    '='.repeat(50),
    `Additions: ${diff.summary.additions}`,
    `Updates: ${diff.summary.updates}`,
    `Removals: ${diff.summary.removals}`,
    `Unchanged: ${diff.summary.noChanges}`,
    '',
  ];
  if (diff.changes.every(change => change.action === 'no-change')) {
    lines.push('No changes detected.');
    return lines.join('\n');
  }

  lines.push('Detailed Changes:', '-'.repeat(50));
  for (const change of diff.changes) {
    if (change.action === 'no-change') continue;
    lines.push('', `Field: ${change.field}`, `Action: ${change.action.toUpperCase()}`);
    if (change.action === 'add') {
      lines.push(`New Value: ${formatValue(change.newValue)}`);
    } else if (change.action === 'update') {
      lines.push(`Old Value: ${formatValue(change.oldValue)}`);
      lines.push(`New Value: ${formatValue(change.newValue)}`);
    } else {
      lines.push(`Removed: ${formatValue(change.oldValue)}`);
    }
  }
  return lines.join('\n');
}

function formatValue(value: unknown): string {
  return value && typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '(empty)');
}
