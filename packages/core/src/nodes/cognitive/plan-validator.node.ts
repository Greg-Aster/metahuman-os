/**
 * Plan Validator Node
 * Validates that a plan is well-formed and executable
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type {
  DesireGoalProgress,
  DesireGoalType,
  DesireMilestone,
  DesirePlan,
  DesireRisk,
} from '../../agency/types.js';
import { getCatalogEntries } from '../../tool-catalog.js';
import { loadTrustLevel, type TrustLevel } from '../../skills.js';
import { meetsMinimumTrust } from '../../policy.js';
import { highestPlanStepRisk, planRiskCoversEveryStep } from '../../agency/plan-risk.js';

const DESIRE_RISKS = new Set<DesireRisk>(['none', 'low', 'medium', 'high', 'critical']);
const DESIRE_GOAL_TYPES = new Set<DesireGoalType>(['one_time', 'recurring', 'long_running']);
const MILESTONE_STATUSES = new Set(['pending', 'in_progress', 'completed', 'skipped']);
const TRUST_LEVELS = new Set<TrustLevel>([
  'observe',
  'suggest',
  'supervised_auto',
  'bounded_auto',
  'adaptive_auto',
]);
const GENERIC_SKILLS = new Set(['general', 'manual', 'none']);

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const plan = inputs.plan as DesirePlan | undefined;
  const goalType = inputs.goalType as DesireGoalType | undefined;
  const completionCriteria = inputs.completionCriteria as string | undefined;
  const milestones = inputs.milestones as DesireMilestone[] | undefined;
  const goalProgress = inputs.goalProgress as DesireGoalProgress | undefined;

  const checkSkillAvailability = properties?.checkSkillAvailability ?? true;
  const checkTrustLevel = properties?.checkTrustLevel ?? true;

  if (!plan) {
    return {
      valid: false,
      plan: null,
      errors: ['No plan provided'],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(plan.steps)) {
    errors.push('Plan must have a steps array');
  } else if (plan.steps.length === 0) {
    errors.push('Plan must have at least one step');
  } else if (plan.steps.length > 10) {
    errors.push('Plan must not have more than 10 steps');
  } else {
    const orders = new Set<number>();
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (!Number.isInteger(step.order) || step.order < 1 || orders.has(step.order)) {
        errors.push(`Step ${i + 1} has an invalid or duplicate order`);
      } else {
        orders.add(step.order);
      }
      if (typeof step.action !== 'string' || !step.action.trim()) {
        errors.push(`Step ${i + 1} is missing an action`);
      }
      if (typeof step.expectedOutcome !== 'string' || !step.expectedOutcome.trim()) {
        errors.push(`Step ${i + 1} is missing an expected outcome`);
      }
      if (!DESIRE_RISKS.has(step.risk)) {
        errors.push(`Step ${i + 1} has unsupported risk '${String(step.risk)}'`);
      }
      if (typeof step.requiresApproval !== 'boolean') {
        errors.push(`Step ${i + 1} requires an explicit requiresApproval decision`);
      }
    }
  }

  if (!DESIRE_RISKS.has(plan.estimatedRisk)) {
    errors.push(`Plan has unsupported estimated risk '${String(plan.estimatedRisk)}'`);
  } else if (Array.isArray(plan.steps)
      && plan.steps.every(step => DESIRE_RISKS.has(step.risk))
      && !planRiskCoversEveryStep(plan)) {
    errors.push(
      `Plan estimated risk '${plan.estimatedRisk}' is lower than highest step risk '${highestPlanStepRisk(plan)}'`,
    );
  }
  if (typeof plan.operatorGoal !== 'string' || !plan.operatorGoal.trim()) {
    errors.push('Plan requires a non-empty operator goal');
  }
  if (!Array.isArray(plan.requiredSkills)
      || plan.requiredSkills.some(skill => typeof skill !== 'string' || !skill.trim())) {
    errors.push('Plan requiredSkills must be an array of non-empty strings');
  }
  if (!TRUST_LEVELS.has(plan.requiredTrustLevel)) {
    errors.push(`Plan has unsupported trust level '${String(plan.requiredTrustLevel)}'`);
  }

  if (goalType !== undefined && !DESIRE_GOAL_TYPES.has(goalType)) {
    errors.push(`Plan has unsupported goal type '${String(goalType)}'`);
  }
  if (completionCriteria !== undefined
      && (typeof completionCriteria !== 'string' || !completionCriteria.trim())) {
    errors.push('Plan completion criteria must be a non-empty string when supplied');
  }
  if (milestones !== undefined && !Array.isArray(milestones)) {
    errors.push('Plan milestones must be an array when supplied');
  } else if (Array.isArray(milestones)) {
    const orders = new Set<number>();
    for (let index = 0; index < milestones.length; index++) {
      const milestone = milestones[index];
      if (!milestone?.id?.trim() || !milestone.title?.trim()) {
        errors.push(`Milestone ${index + 1} requires an id and title`);
      }
      if (!Number.isInteger(milestone?.order) || milestone.order < 1 || orders.has(milestone.order)) {
        errors.push(`Milestone ${index + 1} has an invalid or duplicate order`);
      } else {
        orders.add(milestone.order);
      }
      if (!MILESTONE_STATUSES.has(milestone?.status)) {
        errors.push(`Milestone ${index + 1} has unsupported status '${String(milestone?.status)}'`);
      }
    }
  }

  if (goalType === 'long_running') {
    if (!completionCriteria?.trim()) errors.push('Long-running plans require completion criteria');
    if (!Array.isArray(milestones) || milestones.length === 0) {
      errors.push('Long-running plans require milestones');
    }
    if (!goalProgress
      || !Number.isInteger(goalProgress.currentMilestone)
      || goalProgress.currentMilestone < 0
      || goalProgress.totalMilestones !== milestones?.length
      || !Number.isInteger(goalProgress.completedMilestones)
      || goalProgress.completedMilestones < 0
      || !Number.isFinite(goalProgress.progressPercent)
      || goalProgress.progressPercent < 0
      || goalProgress.progressPercent > 100) {
      errors.push('Long-running plans require consistent initialized goal progress');
    }
  }

  if (checkSkillAvailability) {
    const availableSkills = new Set(getCatalogEntries().map(entry => entry.skill));
    const claimedSkills = new Set([
      ...(Array.isArray(plan.requiredSkills) ? plan.requiredSkills : []),
      ...(Array.isArray(plan.steps) ? plan.steps.map(step => step.skill).filter(Boolean) as string[] : []),
    ]);
    for (const skill of claimedSkills) {
      if (!GENERIC_SKILLS.has(skill) && !availableSkills.has(skill)) {
        errors.push(`Plan requires unavailable skill '${skill}'`);
      }
    }
  }

  if (checkTrustLevel && TRUST_LEVELS.has(plan.requiredTrustLevel)) {
    const currentTrust = loadTrustLevel({ strict: true });
    if (!meetsMinimumTrust(currentTrust, plan.requiredTrustLevel)) {
      warnings.push(
        `Current trust level '${currentTrust}' does not meet plan requirement '${plan.requiredTrustLevel}'; user approval is required`,
      );
    }
  }

  const valid = errors.length === 0;

  return {
    valid,
    plan: valid ? plan : null,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    stepCount: plan?.steps?.length ?? 0,
    // Pass through long-running goal fields
    goalType,
    completionCriteria,
    milestones,
    goalProgress,
  };
};

export const PlanValidatorNode: NodeDefinition = defineNode({
  id: 'plan_validator',
  name: 'Plan Validator',
  category: 'cognitive',
  inputs: [
    { name: 'plan', type: 'object', description: 'Plan to validate' },
    { name: 'goalType', type: 'string', optional: true, description: 'Generated desire goal type' },
    { name: 'completionCriteria', type: 'string', optional: true, description: 'Generated completion criteria' },
    { name: 'milestones', type: 'array', optional: true, description: 'Generated long-running milestones' },
    { name: 'goalProgress', type: 'object', optional: true, description: 'Initialized long-running goal progress' },
  ],
  outputs: [
    { name: 'valid', type: 'boolean', description: 'Whether plan is valid' },
    { name: 'plan', type: 'object', description: 'Validated plan (or null if invalid)' },
    { name: 'errors', type: 'array', optional: true, description: 'Validation errors' },
    { name: 'warnings', type: 'array', optional: true, description: 'Validation warnings' },
    { name: 'goalType', type: 'string', optional: true, description: 'Goal type (one_time, recurring, long_running)' },
    { name: 'completionCriteria', type: 'string', optional: true, description: 'Verifiable completion condition' },
    { name: 'milestones', type: 'array', optional: true, description: 'Milestones for long_running goals' },
    { name: 'goalProgress', type: 'object', optional: true, description: 'Progress tracking for long_running goals' },
    { name: 'stepCount', type: 'number', description: 'Number of validated plan steps' },
  ],
  properties: {
    checkSkillAvailability: true,
    checkTrustLevel: true,
  },
  propertySchemas: {
    checkSkillAvailability: {
      type: 'toggle',
      default: true,
      label: 'Check Skill Availability',
      description: 'Verify that referenced skills exist',
    },
    checkTrustLevel: {
      type: 'toggle',
      default: true,
      label: 'Check Trust Level',
      description: 'Verify trust requirements are met',
    },
  },
  description: 'Validates that a plan is well-formed and executable',
  execute,
});
