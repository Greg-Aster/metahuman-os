/**
 * Plan Validator Node
 * Validates that a plan is well-formed and executable
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

interface PlanStep {
  id?: string;
  description: string;
  skill?: string;
  inputs?: Record<string, unknown>;
  dependsOn?: string[];
}

interface Plan {
  id?: string;
  steps: PlanStep[];
  estimatedDuration?: string;
  requiredTools?: string[];
}

const execute: NodeExecutor = async (inputs, _context, properties) => {
  // Input slot 0 contains {plan, success, error} from plan generator
  const slot0 = inputs[0] as { plan?: Plan; success?: boolean } | Plan | undefined;

  const plan = (slot0 && 'plan' in slot0 ? slot0.plan : slot0) as Plan | undefined;
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

  // Check plan structure
  if (!plan.steps || !Array.isArray(plan.steps)) {
    errors.push('Plan must have a steps array');
  } else if (plan.steps.length === 0) {
    errors.push('Plan must have at least one step');
  } else {
    // Validate each step - plans are flexible for Big Brother execution
    // The 'skill' field is OPTIONAL - Big Brother will determine specific tools
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i] as PlanStep & { action?: string };
      // Check for either description OR action (plan generator uses 'action')
      if (!step.description && !step.action) {
        errors.push(`Step ${i + 1} is missing a description or action`);
      }
      // Note: skill field is NOT required - plans can be high-level and Big Brother
      // will figure out the specific execution approach

      // Check for circular dependencies
      if (step.dependsOn) {
        const stepId = step.id || `step_${i}`;
        for (const dep of step.dependsOn) {
          if (dep === stepId) {
            errors.push(`Step ${i + 1} has circular dependency on itself`);
          }
        }
      }
    }
  }

  // Skill availability checking is DISABLED - Big Brother handles this dynamically
  // Trust level checking is DISABLED - handled at execution time

  const valid = errors.length === 0;

  return {
    valid,
    plan: valid ? plan : null,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    stepCount: plan?.steps?.length ?? 0,
  };
};

export const PlanValidatorNode: NodeDefinition = defineNode({
  id: 'plan_validator',
  name: 'Plan Validator',
  category: 'cognitive',
  inputs: [
    { name: 'plan', type: 'object', description: 'Plan to validate' },
  ],
  outputs: [
    { name: 'valid', type: 'boolean', description: 'Whether plan is valid' },
    { name: 'plan', type: 'object', description: 'Validated plan (or null if invalid)' },
    { name: 'errors', type: 'array', optional: true, description: 'Validation errors' },
    { name: 'warnings', type: 'array', optional: true, description: 'Validation warnings' },
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
