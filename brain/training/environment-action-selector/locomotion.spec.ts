import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDevelopmentRecords, DEVELOPMENT_CASES, EVALUATION_CASES, validateRecordOutput } from './generate-training-data.js'
import { migrateLocomotionReference } from './locomotion-contract.js'

test('locomotion references preserve endpoint units, sensor evidence, source and held-out separation', async () => {
  const rows = await buildDevelopmentRecords([...DEVELOPMENT_CASES, ...EVALUATION_CASES].filter(c => c.suite.startsWith('locomotion-')))
  assert.equal(rows.filter(r => r.metadata.sourceSplit === 'development').length, 408)
  assert.equal(rows.filter(r => r.metadata.sourceSplit === 'evaluation').length, 72)
  const fit = new Set(rows.filter(r => r.metadata.sourceSplit === 'development').map(r => r.user))
  for (const row of rows) {
    assert.deepEqual(validateRecordOutput(row), [], row.metadata.recordId)
    if (row.metadata.sourceSplit === 'evaluation') assert.ok(!fit.has(row.user))
    const input = JSON.parse(row.user), selected = JSON.parse(row.output)
    if (row.metadata.inputSource === 'autonomy') assert.equal(input.plannerDecision.instruction, input.currentInstruction)
    const siblings = rows.filter(r => r.metadata.suite === row.metadata.suite)
    assert.equal(new Set(siblings.map(r => r.metadata.developmentFold)).size, 1)
    const reference = JSON.parse(row.plannerReferenceOutput ?? row.output)
    if (row.plannerReferenceOutput) assert.deepEqual(selected, { delegatePlanning: true })
    const move = reference.program?.steps[0]?.motion ?? reference.program?.steps[0]?.action
    const goal = move?.locomotionGoal
    if (!goal) continue
    assert.notEqual(reference.taskDecision.requiredCompletionBasis, 'command_completion')
    assert.notEqual(reference.taskDecision.outcome, 'complete')
    if (goal.kind === 'distance') {
      assert.ok(input.currentInstruction.includes(String(goal.metres)))
      assert.ok(input.currentInstruction.includes(String(goal.tolerance)))
      if (move.gait === 'crab') assert.equal(move.lateral, goal.direction === 'left' ? move.speed : -move.speed)
    }
    if (goal.kind === 'relativeTurn') assert.ok(input.currentInstruction.includes(String(Math.abs(goal.degrees))))
    if (goal.kind === 'approach' || goal.kind === 'follow') {
      assert.equal(goal.target.frameId, input.taskResultEvidence.acquisition.frame.id)
      assert.deepEqual(goal.target.box, input.taskResultEvidence.acquisition.candidates[0].box)
      assert.equal(goal.target.trackId, undefined)
      if (goal.proximity.kind === 'metric') {
        const selected = input.taskResultEvidence.acquisition.selectedGroundContact
        assert.deepEqual(goal.target.groundContact, selected.point)
        assert.equal(selected.frameId, goal.target.frameId)
        assert.equal(selected.source, 'explicit-user-mark')
        assert.notDeepEqual(selected.point, { x: goal.target.box.x + goal.target.box.width / 2, y: goal.target.box.y + goal.target.box.height })
      }
    }
    if (goal.kind === 'follow' || goal.kind === 'visual') assert.equal(reference.program.steps[0].kind, 'behavior')
  }
})

test('retired cycle-based labels delegate without inventing distance, while visual goals retain their criteria', () => {
  const retired = { program: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'walk', units: 3 } }] } }
  const migration = migrateLocomotionReference(retired)
  assert.deepEqual(migration.output, { delegatePlanning: true })
  assert.ok(migration.reason)
  const visual = { program: { steps: [{ kind: 'behavior', target: 'selected object', completionCriteria: 'selected object fully visible', motion: { type: 'move', continuous: true } }] } }
  const migrated = migrateLocomotionReference(visual)
  assert.deepEqual(migrated.output.program.steps[0].motion.locomotionGoal, { kind: 'visual', target: 'selected object', completionCriteria: 'selected object fully visible' })
})
