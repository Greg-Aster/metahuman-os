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
    warnings.push('Plan has no steps');
  } else {
    // Validate each step
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (!step.description) {
        errors.push(`Step ${i + 1} is missing a description`);
      }

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

  // TODO: If checkSkillAvailability, verify skills exist
  // TODO: If checkTrustLevel, verify trust requirements

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
