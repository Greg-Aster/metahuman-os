/**
 * Skill Node Executors
 * Factory function for creating skill executor wrappers
 */

import { executeSkill, type TrustLevel } from '../skills.js';
import type { NodeExecutor } from './types.js';

/**
 * Generic skill wrapper
 * Wraps any skill for execution in the graph
 */
export const createSkillExecutor = (skillId: string): NodeExecutor => {
  return async (inputs, context) => {
    try {
      // Load trust level from decision rules instead of hardcoding
      const { loadDecisionRules } = await import('../identity.js');
      const rules = loadDecisionRules();
      const trustLevel: TrustLevel = rules.trustLevel as TrustLevel;

      const result = await executeSkill(skillId, inputs, trustLevel);

      return {
        success: result.success,
        ...result.outputs,
        error: result.error,
      };
    } catch (error) {
      console.error(`[Skill:${skillId}] Error:`, error);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  };
};
