import { MODEL_ROLE_OPTIONS, type ModelRole } from '@metahuman/core/model-roles';

export interface WorkflowModelSummary {
  key: string;
  name: string;
  error?: string;
  models: Array<{
    nodeId: string;
    label: string;
    role: string;
    selection: string;
    error?: string;
  }>;
}

export interface ModelRolePresentation {
  role: ModelRole;
  label: string;
  description: string;
}

/** One editable row per saved role, with usage from the configured graphs. */
export function buildModelRoleSections(workflows: WorkflowModelSummary[], mode: string) {
  const workflow = workflows.find(item => item.key === mode);
  const primaryRoles = new Set(workflow?.models
    .filter(binding => binding.selection === 'role').map(binding => binding.role));
  const roles: ModelRolePresentation[] = MODEL_ROLE_OPTIONS.map(({ value, label }) => {
    const usage = workflows.flatMap(item => item.models
      .filter(binding => binding.role === value && binding.selection === 'role')
      .map(binding => `${item.name}: ${binding.label}`));
    return {
      role: value,
      label: value === 'environmentIntent' ? 'Intent orchestrator'
        : value === 'orchestrator' ? 'General orchestrator' : label,
      description: [
        `Choose the model assigned to the ${value} role for this mode.`,
        ...new Set(usage),
      ].join('\n'),
    };
  });
  return [
    {
      label: workflow?.name || 'Workflow roles',
      description: 'Roles selected by this workflow. Hover over a role to see its node usage.',
      roles: [...primaryRoles].flatMap(role => roles.filter(item => item.role === role)),
    },
    {
      label: 'Other saved roles',
      description: 'Assignments for other nodes and workflows in this mode.',
      roles: roles.filter(item => !primaryRoles.has(item.role)),
    },
  ].filter(section => section.roles.length > 0);
}
