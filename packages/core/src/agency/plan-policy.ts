import type {
  DesireGoalProgress,
  DesireGoalType,
  DesireMilestone,
  DesirePlan,
  DesireRisk,
} from './types.js';
import type { TrustLevel } from '../skills.js';


const RISK_ORDER: Record<DesireRisk, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

export function highestPlanStepRisk(plan: DesirePlan): DesireRisk {
  return plan.steps.reduce<DesireRisk>(
    (highest, step) => RISK_ORDER[step.risk] > RISK_ORDER[highest] ? step.risk : highest,
    'none',
  )
}

export function planRiskCoversEveryStep(plan: DesirePlan): boolean {
  return RISK_ORDER[plan.estimatedRisk] >= RISK_ORDER[highestPlanStepRisk(plan)]
}

export function planRequiresManualApproval(plan: DesirePlan): boolean {
  return plan.steps.some(step => step.requiresApproval)
}

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

export function desirePlanExecutionErrors(plan: DesirePlan): string[] {
  const errors: string[] = [];
  if (typeof plan.id !== 'string' || !plan.id.trim()) errors.push('Plan requires an id');
  if (!Number.isInteger(plan.version) || plan.version < 1) errors.push('Plan requires a positive version');

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
      if (!['operator', 'robot'].includes(String(step.executionTarget))) {
        errors.push(`Step ${i + 1} requires an explicit execution target`);
      }
      if (step.order !== i + 1) errors.push(`Step ${i + 1} must have contiguous execution order`);
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

  if (typeof plan.completionCriteria !== 'string' || !plan.completionCriteria.trim()) errors.push('Every plan version requires non-empty completion criteria');
  return errors
}

export async function validateDesirePlan(inputs: Record<string, unknown>, properties: Record<string, unknown> = {}) {
  const plan = inputs.plan as DesirePlan | undefined;
  const goalType = inputs.goalType as DesireGoalType | undefined;
  const completionCriteria = plan?.completionCriteria;
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

  const errors = desirePlanExecutionErrors(plan);
  const warnings: string[] = [];

  if (goalType !== undefined && !DESIRE_GOAL_TYPES.has(goalType)) {
    errors.push(`Plan has unsupported goal type '${String(goalType)}'`);
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
    const { getCatalogEntries } = await import('../tool-catalog.js')
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
    const { loadTrustLevel } = await import('../skills.js')
    const { meetsMinimumTrust } = await import('../policy.js')
    const currentTrust = loadTrustLevel({ strict: true });
    if (!meetsMinimumTrust(currentTrust, plan.requiredTrustLevel)) {
      warnings.push(
        `Current trust level '${currentTrust}' is below '${plan.requiredTrustLevel}'; Agency review determines approval using the configured reduced-inhibition policy`,
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
