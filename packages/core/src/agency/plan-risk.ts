import type { DesirePlan, DesireRisk } from './types.js'

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
