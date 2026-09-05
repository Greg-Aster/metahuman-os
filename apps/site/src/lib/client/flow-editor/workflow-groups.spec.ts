import assert from 'node:assert/strict'
import test from 'node:test'
import { groupWorkflows, workflowGroupId } from './workflow-groups'

test('groups desire and robot autonomy workflow families by stable filenames', () => {
  assert.equal(workflowGroupId('desire-planner'), 'desires-agency')
  assert.equal(workflowGroupId('boredom-autonomy-mode'), 'robot-autonomy')
  assert.equal(workflowGroupId('robot-status-mode'), 'robot-autonomy')
})

test('keeps unrecognized custom workflows reachable in the fallback group', () => {
  assert.equal(workflowGroupId('my-custom-workflow'), 'other')
})

test('returns every workflow once in the intended display order', () => {
  const workflows = [
    { name: 'my-custom-workflow', title: 'My Custom Workflow' },
    { name: 'desire-reviewer', title: 'Desire Reviewer' },
    { name: 'mood-review', title: 'Mood Review' },
    { name: 'robot-status-mode', title: 'Robot Status' },
  ]

  const groups = groupWorkflows(workflows)

  assert.deepEqual(groups.map(group => group.label), [
    'Robot Autonomy',
    'Desires & Agency',
    'Persona & Preferences',
    'Other Workflows',
  ])
  assert.deepEqual(
    groups.flatMap(group => group.workflows.map(workflow => workflow.name)).sort(),
    workflows.map(workflow => workflow.name).sort(),
  )
})
