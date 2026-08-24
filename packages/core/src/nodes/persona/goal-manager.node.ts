/**
 * Goal Manager Node
 * Manages goals (short-term, long-term)
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import {
  loadPersonaCore,
  savePersonaCore,
  type GoalEntry,
  type GoalTier,
} from '../../identity.js';

const GOAL_TIERS = new Set<GoalTier>(['shortTerm', 'midTerm', 'longTerm']);

export function getGoalTier(value: unknown): GoalTier {
  return typeof value === 'string' && GOAL_TIERS.has(value as GoalTier)
    ? value as GoalTier
    : 'shortTerm';
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function goalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeGoals(values: unknown): GoalEntry[] {
  if (!Array.isArray(values)) return [];

  return values.flatMap(value => {
    const legacyGoal = nonEmptyString(value);
    if (legacyGoal) return [{ goal: legacyGoal, status: 'active' }];

    const record = goalRecord(value);
    const goal = nonEmptyString(record?.goal);
    if (!record || !goal) return [];

    return [{
      ...record,
      goal,
      status: nonEmptyString(record.status) || 'active',
    } as GoalEntry];
  });
}

export function matchesGoal(goal: GoalEntry, selector: Record<string, unknown>): boolean {
  const id = nonEmptyString(selector.id);
  const name = nonEmptyString(selector.goal);
  return Boolean((id && goal.id === id) || (name && goal.goal === name));
}

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const operation = properties?.operation || 'get';
  const scope = getGoalTier(properties?.scope);
  const goalData = goalRecord(inputs.goalData ?? inputs[0]);

  try {
    const persona = loadPersonaCore();
    const goals = normalizeGoals(persona.goals[scope]);

    switch (operation) {
      case 'get':
        return {
          success: true,
          goals,
          scope,
          count: goals.length,
        };

      case 'add':
        const goal = nonEmptyString(goalData?.goal);
        if (!goalData || !goal) {
          return {
            success: false,
            error: 'Goal data required for add operation',
          };
        }
        goals.push({
          ...goalData,
          goal,
          status: nonEmptyString(goalData.status) || 'active',
        } as GoalEntry);
        persona.goals[scope] = goals;
        savePersonaCore(persona);
        return {
          success: true,
          added: true,
          goals,
        };

      case 'remove':
        if (goalData && (nonEmptyString(goalData.id) || nonEmptyString(goalData.goal))) {
          const filtered = goals.filter(goal => !matchesGoal(goal, goalData));
          persona.goals[scope] = filtered;
          savePersonaCore(persona);
          return {
            success: true,
            removed: true,
            goals: filtered,
          };
        }
        return {
          success: false,
          error: 'Goal identifier required for remove operation',
        };

      case 'update':
        if (!goalData || (!nonEmptyString(goalData.id) && !nonEmptyString(goalData.goal))) {
          return {
            success: false,
            error: 'Goal data required for update operation',
          };
        }
        const index = goals.findIndex(goal => matchesGoal(goal, goalData));
        if (index !== -1) {
          const updatedGoal = nonEmptyString(goalData.goal) || goals[index].goal;
          goals[index] = {
            ...goals[index],
            ...goalData,
            goal: updatedGoal,
            status: nonEmptyString(goalData.status) || goals[index].status,
          } as GoalEntry;
          persona.goals[scope] = goals;
          savePersonaCore(persona);
          return {
            success: true,
            updated: true,
            goals,
          };
        }
        return {
          success: false,
          error: 'Goal not found',
        };

      default:
        return {
          success: false,
          error: `Unknown operation: ${operation}`,
        };
    }
  } catch (error) {
    console.error('[GoalManager] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const GoalManagerNode: NodeDefinition = defineNode({
  id: 'goal_manager',
  name: 'Goal Manager',
  category: 'persona',
  inputs: [
    { name: 'goalData', type: 'object', optional: true, description: 'Goal data for add/update/remove' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'goals', type: 'array', description: 'Current goals' },
    { name: 'scope', type: 'string' },
    { name: 'count', type: 'number' },
  ],
  properties: {
    operation: 'get',
    scope: 'shortTerm',
  },
  propertySchemas: {
    operation: {
      type: 'select',
      default: 'get',
      label: 'Operation',
      options: ['get', 'add', 'remove', 'update'],
    },
    scope: {
      type: 'select',
      default: 'shortTerm',
      label: 'Scope',
      options: ['shortTerm', 'midTerm', 'longTerm'],
    },
  },
  description: 'Manages short-, mid-, and long-term goals',
  execute,
});
