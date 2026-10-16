import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeLocomotionGoal, evaluateLocomotionGoal } from './active-task.js'
import type { EnvironmentLocomotionMeasurement } from './types.js'
import { buildEnvironmentSelectorJsonSchema } from '../nodes/environment/helpers.js'

const observedAt = new Date().toISOString()
const evidence = { available: true, source: 'calibrated-ground-plane', robotId: 'robot', referenceId: 'reference', observedAt }
const start: EnvironmentLocomotionMeasurement = { position: { ...evidence, xMetres: 2, yMetres: 3, headingDegrees: 90, uncertaintyMetres: .03 } }
test('distance uses initial body heading and current position in the same measured reference', () => {
  const goal = normalizeLocomotionGoal({ kind: 'distance', direction: 'forward', metres: 1, tolerance: .05 })
  assert.equal(evaluateLocomotionGoal(goal, start).reached, false)
  const measured = { position: { ...start.position!, yMetres: 4 } }
  const result = evaluateLocomotionGoal(goal, measured, start)
  assert.equal(result.reached, true)
  assert.equal(result.progress.targetY, 4)
  assert.equal(evaluateLocomotionGoal(goal, { position: { ...measured.position, referenceId: 'new-calibration' } }, start).reached, false)
  assert.match(evaluateLocomotionGoal(goal, {}, start).reason!, /unavailable/)
})
test('relative turn uses accumulated orientation with its own reference independently of camera calibration', () => {
  const initial = { yaw: { ...evidence, source: 'imu', degrees: 350, uncertaintyDegrees: null } }
  const goal = normalizeLocomotionGoal({ kind: 'relativeTurn', degrees: 450, tolerance: 2 })
  assert.equal(evaluateLocomotionGoal(goal, { yaw: { ...initial.yaw, degrees: 440 } }, initial).reached, false)
  assert.equal(evaluateLocomotionGoal(goal, { yaw: { ...initial.yaw, degrees: 800 } }, initial).reached, true)
  assert.match(evaluateLocomotionGoal(goal, { yaw: { ...initial.yaw, referenceId: 'reboot' } }, initial).reason!, /reference/)
})
test('metric proximity requires exact selected ground point; follow relationship never claims endpoint completion', () => {
  const target = { frameId: 'frame', frameTimestamp: observedAt, box: { x: .2, y: .2, width: .4, height: .5 }, trackId: 'track', groundContact: { x: .4, y: .7 } }
  const approach = normalizeLocomotionGoal({ kind: 'approach', target, proximity: { kind: 'metric', metres: 1, tolerance: .1 } })
  assert.throws(() => normalizeLocomotionGoal({ ...approach, target: { ...target, groundContact: undefined } }), /ground contact/)
  const measurement = { target: { ...evidence, frameId: 'current', trackId: 'track', groundContact: target.groundContact, rangeMetres: 1, uncertaintyMetres: .05 } }
  assert.equal(evaluateLocomotionGoal(approach, measurement).reached, true)
  assert.equal(evaluateLocomotionGoal({ ...approach, kind: 'follow', endingCondition: 'Explicit termination' } as any, measurement).reached, false)
  assert.match(evaluateLocomotionGoal(approach, { target: { ...measurement.target, trackId: 'other' } }).reason!, /unavailable/)
})
test('stale measurements never establish arrival and unknown uncertainty remains unknown', () => {
  const goal = normalizeLocomotionGoal({ kind: 'relativeTurn', degrees: 20, tolerance: 1 })
  const initial = { yaw: { ...evidence, degrees: 0, uncertaintyDegrees: null } }
  const current = { yaw: { ...initial.yaw, degrees: 20, expiresAt: new Date(0).toISOString() } }
  assert.equal(evaluateLocomotionGoal(goal, current, initial).reached, false)
  assert.equal(current.yaw.uncertaintyDegrees, null)
})
test('schema removes advertised bare locomotion aliases while retaining finite gestures', () => {
  const schema = buildEnvironmentSelectorJsonSchema({ actions: ['move', 'robotCommand', 'captureImage'], robotCommands: ['walk', 'w', 'wave'],
    locomotion: { commands: ['walk', 'w'], goalKinds: ['distance', 'relativeTurn', 'approach', 'follow', 'visual'] } })
  const visit = (value: any): any[] => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(visit)]
  const objects = visit(schema)
  const commands = objects.filter(v => v.properties?.command).flatMap(v => v.properties.command.enum ?? [])
  assert.deepEqual(commands, ['wave'])
  for (const node of objects.filter(v => v.properties?.type?.enum?.includes('move') || v.properties?.type?.const === 'move')) {
    assert.ok(node.required?.includes('locomotionGoal'))
  }
})

test('missing or nonfinite numeric measurements are unavailable rather than endless steering', () => {
  const goal = normalizeLocomotionGoal({ kind: 'distance', direction: 'forward', metres: 1, tolerance: .1 })
  for (const xMetres of [NaN, Infinity, undefined]) {
    assert.match(evaluateLocomotionGoal(goal, { position: { ...start.position!, xMetres } } as any, start).reason!, /unavailable/)
  }
  const turn = normalizeLocomotionGoal({ kind: 'relativeTurn', degrees: 90, tolerance: 2 })
  assert.match(evaluateLocomotionGoal(turn, { yaw: { ...evidence, degrees: NaN, uncertaintyDegrees: null } }).reason!, /unavailable/)
})

test('backward distance preserves reverse traversal without adding a half-turn', () => {
  const goal = normalizeLocomotionGoal({ kind: 'distance', direction: 'back', metres: 1, tolerance: .05 })
  const progress = evaluateLocomotionGoal(goal, start)
  assert.equal(progress.forward, -100)
  assert.equal(progress.turn, 0)
  assert.ok(Math.abs(Number(progress.progress.targetX) - 2) < 1e-12)
  assert.equal(progress.progress.targetY, 2)
  const endpoint = { position: { ...start.position!, yMetres: 2 } }
  assert.equal(evaluateLocomotionGoal(goal, endpoint, start).reached, true)
})

test('Crab projects endpoint correction into body axes and reverses measured overshoot', () => {
  const goal = normalizeLocomotionGoal({ kind: 'distance', direction: 'left', metres: 1, tolerance: .05 })
  const initial: EnvironmentLocomotionMeasurement = { position: { ...evidence, xMetres: 0, yMetres: 0, headingDegrees: 0, uncertaintyMetres: null } }
  const evaluate = (xMetres: number, yMetres: number, headingDegrees = 0) => evaluateLocomotionGoal(goal,
    { position: { ...initial.position!, xMetres, yMetres, headingDegrees } }, initial, Date.now(), 'crab')
  assert.ok(Math.abs(evaluate(0, 0).forward!) < 1e-12)
  assert.equal(evaluate(0, 0).lateral, 100)
  assert.equal(evaluate(0, 1.2).lateral, -100)
  assert.equal(evaluate(0, 1.2).reached, false)
  const displaced = evaluate(.5, .5)
  assert.ok(displaced.forward! < 0 && displaced.lateral! > 0)
  assert.ok(Math.abs(Math.hypot(displaced.forward!, displaced.lateral!) - 100) < 1e-10)
  assert.equal(displaced.turn, 0)
  assert.ok(evaluate(0, 0, 90).forward! > 99)
  assert.ok(Math.abs(evaluate(0, 0, 90).lateral!) < 1e-12)
  assert.equal(evaluate(0, 1).reached, true)
})

test('Crab body projection stays within the transport percentage range at floating point boundaries', () => {
  const dx = 7 / 97, dy = 7 / 113
  const headingDegrees = Math.atan2(dy, dx) * 180 / Math.PI
  const position = { ...evidence, xMetres: 0, yMetres: 0, headingDegrees, uncertaintyMetres: null }
  const goal = normalizeLocomotionGoal({ kind: 'distance', direction: 'forward', metres: Math.hypot(dx, dy), tolerance: .001 })
  const result = evaluateLocomotionGoal(goal, { position }, { position }, Date.now(), 'crab')
  assert.equal(result.forward, 100)
  assert.ok(Math.abs(result.lateral!) <= 100)
})
