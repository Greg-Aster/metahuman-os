/**
 * Persona Merger
 *
 * Merges extracted persona drafts with existing persona data.
 * Generates human-readable diffs for review before applying changes.
 */

import type { PersonaDraft } from './extractor.js';
import fs from 'node:fs';

/**
 * Merge strategy
 */
export type MergeStrategy = 'replace' | 'merge' | 'append';

/**
 * Persona diff entry
 */
export interface DiffEntry {
  field: string;
  oldValue: any;
  newValue: any;
  action: 'add' | 'update' | 'remove' | 'no-change';
}

/**
 * Persona diff result
 */
export interface PersonaDiff {
  changes: DiffEntry[];
  summary: {
    additions: number;
    updates: number;
    removals: number;
    noChanges: number;
  };
}

/**
 * Load existing persona from file
 */
export function loadExistingPersona(personaPath: string): any {
  if (!fs.existsSync(personaPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(personaPath, 'utf-8'));
  } catch (error) {
    console.warn('[merger] Failed to load existing persona, starting fresh');
    return {};
  }
}

/**
 * Merge persona draft with existing persona
 *
 * @param currentPersona - Existing persona data
 * @param draft - Extracted persona draft
 * @param strategy - How to merge (replace, merge, append)
 * @returns Updated persona and diff
 */
export function mergePersonaDraft(
  currentPersona: any,
  draft: PersonaDraft,
  strategy: MergeStrategy = 'merge'
): { updated: any; diff: PersonaDiff } {
  const updated = JSON.parse(JSON.stringify(currentPersona)); // Deep clone
  const changes: DiffEntry[] = [];

  // Merge Big Five traits
  if (draft.bigFive) {
    updated.personality = updated.personality || {};
    const oldBigFive = updated.personality.bigFive || {};
    const newBigFive = { ...oldBigFive };

    for (const [trait, score] of Object.entries(draft.bigFive)) {
      if (score !== undefined) {
        const oldScore = oldBigFive[trait];
        const action = oldScore === undefined ? 'add' : oldScore === score ? 'no-change' : 'update';

        changes.push({
          field: `personality.bigFive.${trait}`,
          oldValue: oldScore,
          newValue: score,
          action,
        });

        if (strategy === 'replace' || strategy === 'merge') {
          newBigFive[trait] = score;
        }
      }
    }

    updated.personality.bigFive = newBigFive;
  }

  // Merge values
  if (draft.values && draft.values.length > 0) {
    updated.values = updated.values || {};
    const oldValues = updated.values.core || [];

    if (strategy === 'replace') {
      updated.values.core = draft.values;
      changes.push({
        field: 'values.core',
        oldValue: oldValues,
        newValue: draft.values,
        action: oldValues.length === 0 ? 'add' : 'update',
      });
    } else if (strategy === 'merge') {
      // Merge by replacing existing values with same name
      const merged = [...draft.values];
      for (const oldVal of oldValues) {
        if (!draft.values.some((v) => v.value === oldVal.value)) {
          merged.push(oldVal);
        }
      }
      updated.values.core = merged;
      changes.push({
        field: 'values.core',
        oldValue: oldValues,
        newValue: merged,
        action: 'update',
      });
    } else if (strategy === 'append') {
      updated.values.core = [...oldValues, ...draft.values];
      changes.push({
        field: 'values.core',
        oldValue: oldValues,
        newValue: updated.values.core,
        action: 'update',
      });
    }
  }

  // Merge communication style
  if (draft.communicationStyle) {
    updated.personality = updated.personality || {};
    const oldStyle = updated.personality.communicationStyle || {};

    if (strategy === 'replace') {
      updated.personality.communicationStyle = draft.communicationStyle;
    } else {
      updated.personality.communicationStyle = {
        ...oldStyle,
        ...draft.communicationStyle,
      };
    }

    changes.push({
      field: 'personality.communicationStyle',
      oldValue: oldStyle,
      newValue: updated.personality.communicationStyle,
      action: Object.keys(oldStyle).length === 0 ? 'add' : 'update',
    });
  }

  // Merge interests
  if (draft.interests && draft.interests.length > 0) {
    updated.personality = updated.personality || {};
    const oldInterests = updated.personality.interests || [];

    if (strategy === 'replace') {
      updated.personality.interests = draft.interests;
    } else if (strategy === 'merge' || strategy === 'append') {
      // Combine and deduplicate
      const combined = [...new Set([...oldInterests, ...draft.interests])];
      updated.personality.interests = combined;
    }

    changes.push({
      field: 'personality.interests',
      oldValue: oldInterests,
      newValue: updated.personality.interests,
      action: oldInterests.length === 0 ? 'add' : 'update',
    });
  }

  // Merge goals
  if (draft.goals) {
    const oldGoals = updated.goals || {};

    if (strategy === 'replace') {
      updated.goals = draft.goals;
    } else {
      updated.goals = {
        ...oldGoals,
        ...draft.goals,
      };
    }

    changes.push({
      field: 'goals',
      oldValue: oldGoals,
      newValue: updated.goals,
      action: Object.keys(oldGoals).length === 0 ? 'add' : 'update',
    });
  }

  // Add background if present
  if (draft.background) {
    const oldBackground = updated.background;
    updated.background = draft.background;
    changes.push({
      field: 'background',
      oldValue: oldBackground,
      newValue: draft.background,
      action: oldBackground ? 'update' : 'add',
    });
  }

  // Add current focus if present
  if (draft.currentFocus && draft.currentFocus.length > 0) {
    const oldFocus = updated.currentFocus || [];

    if (strategy === 'replace') {
      updated.currentFocus = draft.currentFocus;
    } else {
      updated.currentFocus = [...new Set([...oldFocus, ...draft.currentFocus])];
    }

    changes.push({
      field: 'currentFocus',
      oldValue: oldFocus,
      newValue: updated.currentFocus,
      action: oldFocus.length === 0 ? 'add' : 'update',
    });
  }

  // Update timestamp
  updated.lastUpdated = new Date().toISOString();

  // Generate summary
  const summary = {
    additions: changes.filter((c) => c.action === 'add').length,
    updates: changes.filter((c) => c.action === 'update').length,
    removals: changes.filter((c) => c.action === 'remove').length,
    noChanges: changes.filter((c) => c.action === 'no-change').length,
  };

  return {
    updated,
    diff: { changes, summary },
  };
}

/**
 * Generate human-readable diff text
 */
export function generateDiffText(diff: PersonaDiff): string {
  const lines: string[] = [];

  lines.push('Persona Changes Summary');
  lines.push('='.repeat(50));
  lines.push(`Additions: ${diff.summary.additions}`);
  lines.push(`Updates: ${diff.summary.updates}`);
  lines.push(`Removals: ${diff.summary.removals}`);
  lines.push(`Unchanged: ${diff.summary.noChanges}`);
  lines.push('');

  if (diff.changes.length === 0) {
    lines.push('No changes detected.');
    return lines.join('\n');
  }

  lines.push('Detailed Changes:');
  lines.push('-'.repeat(50));

  for (const change of diff.changes) {
    if (change.action === 'no-change') continue;

    lines.push('');
    lines.push(`Field: ${change.field}`);
    lines.push(`Action: ${change.action.toUpperCase()}`);

    if (change.action === 'add') {
      lines.push(`New Value: ${formatValue(change.newValue)}`);
    } else if (change.action === 'update') {
      lines.push(`Old Value: ${formatValue(change.oldValue)}`);
      lines.push(`New Value: ${formatValue(change.newValue)}`);
    } else if (change.action === 'remove') {
      lines.push(`Removed: ${formatValue(change.oldValue)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format value for display
 */
function formatValue(value: any): string {
  if (value === undefined || value === null) {
    return '(empty)';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

/**
 * Save merged persona to file
 */
export function savePersona(personaPath: string, persona: any): void {
  const dir = personaPath.substring(0, personaPath.lastIndexOf('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(personaPath, JSON.stringify(persona, null, 2), 'utf-8');
}
