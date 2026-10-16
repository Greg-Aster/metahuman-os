// Synthetic corpus migration only. Runtime behavior is selected by the model;
// Core remains the owner of the advertised interface and execution contract.
const retiredGaitCommands = new Set([
  'walk', 'walk_forward', 'walk_backward', 'backward', 'forward', 'left', 'right',
  'turn_left', 'turn_right', 'run', 'crawl', 'crab', 'crab_backward', 'crab_forward',
  'crab_right', 'crab_turn_left', 'crab_turn_right',
])

export function refreshLocomotionFixture(inputs: Record<string, any>): void {
  const capabilities = inputs.observation?.capabilities
  if (!capabilities) return
  const commands = (capabilities.robotCommands ?? []).filter((name: string) => retiredGaitCommands.has(name))
  if (!commands.length && !capabilities.actions.includes('move')) return
  if (!capabilities.actions.includes('move')) capabilities.actions.push('move')
  capabilities.locomotion = { ...capabilities.locomotion, commands, goalKinds: ['distance', 'relativeTurn', 'approach', 'follow', 'visual'] }
}

export function migrateLocomotionReference(expected: Record<string, any>): { output: Record<string, any>; reason?: string } {
  const steps = expected.program?.steps ?? []
  if (steps.some((step: any) => step.action?.type === 'robotCommand' && retiredGaitCommands.has(step.action.command)
    || step.action?.type === 'move' && !step.action.locomotionGoal)) {
    return { output: { delegatePlanning: true }, reason: 'Retired bare gait or cycle-based action requires planning under the goal-directed locomotion contract.' }
  }
  let changed = false
  for (const step of steps) {
    if (step.kind === 'behavior' && step.motion && !step.motion.locomotionGoal) {
      step.motion.locomotionGoal = { kind: 'visual', target: step.target, completionCriteria: step.completionCriteria }
      changed = true
    }
  }
  return { output: expected, ...(changed ? { reason: 'Existing visual behavior target and completion criteria retained as its explicit locomotion goal.' } : {}) }
}
