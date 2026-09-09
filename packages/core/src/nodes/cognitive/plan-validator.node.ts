import { defineNode, type NodeDefinition } from '../types.js'
import { validateDesirePlan } from '../../agency/plan-policy.js'

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
  execute: (inputs, _context, properties) => validateDesirePlan(inputs, properties),
});
