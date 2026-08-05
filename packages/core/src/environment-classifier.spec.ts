import assert from 'node:assert/strict'
import test from 'node:test'
import {
  environmentRouterRouteView,
  parseEnvironmentRouterDecision,
  validateEnvironmentRouterDecision,
  type EnvironmentRouterDecision,
} from './environment-classifier.js'

const validDecision: EnvironmentRouterDecision = {
  needsMemory: false,
  memoryTier: 'facts',
  memoryQuery: '',
  memoryTypes: [],
  needsEnvironment: true,
  needsVision: true,
  needsAction: true,
  actionType: 'environment_action',
  actionParams: {
    continuationPolicy: 'bounded',
    requiredCompletionBasis: 'visual_observation',
  },
  complexity: 0.2,
  responseStyle: 'direct',
  responseLength: 'brief',
  isFollowUp: false,
  emotionalTone: 'neutral',
}

test('accepts the complete Environment Router contract', () => {
  assert.deepEqual(validateEnvironmentRouterDecision(validDecision), {
    valid: true,
    errors: [],
    value: validDecision,
  })
})

test('rejects unknown fields and incomplete action contracts', () => {
  const result = validateEnvironmentRouterDecision({
    ...validDecision,
    explanation: 'extra model prose',
    actionParams: { continuationPolicy: 'bounded' },
  })
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /explanation is not an Environment Router field/)
  assert.match(result.errors.join('\n'), /continuationPolicy and requiredCompletionBasis together/)
})

test('rejects action authority and vision admission contradictions', () => {
  const result = validateEnvironmentRouterDecision({
    ...validDecision,
    needsEnvironment: false,
    needsAction: false,
  })
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /needsAction=false requires actionType=none/)
  assert.match(result.errors.join('\n'), /needsVision=true requires needsEnvironment=true/)
})

test('distinguishes strict JSON validity from contract validity', () => {
  const fenced = parseEnvironmentRouterDecision(`\`\`\`json\n${JSON.stringify(validDecision)}\n\`\`\``)
  assert.equal(fenced.jsonValid, false)
  assert.equal(fenced.valid, false)

  const incomplete = parseEnvironmentRouterDecision(JSON.stringify({ needsMemory: false }))
  assert.equal(incomplete.jsonValid, true)
  assert.equal(incomplete.valid, false)
})

test('produces the exact safety-relevant route comparison view', () => {
  assert.deepEqual(environmentRouterRouteView(validDecision), {
    needsMemory: false,
    needsEnvironment: true,
    needsVision: true,
    needsAction: true,
    actionType: 'environment_action',
    motionClass: null,
    continuationPolicy: 'bounded',
    requiredCompletionBasis: 'visual_observation',
  })
})

test('requires a valid motion class for newly authorized robot movement', () => {
  const missing = validateEnvironmentRouterDecision({
    ...validDecision,
    actionType: 'robot_movement',
  })
  assert.equal(missing.valid, false)
  assert.match(missing.errors.join('\n'), /robot_movement requires actionParams.motionClass/)

  const bodyLocal: EnvironmentRouterDecision = {
    ...validDecision,
    actionType: 'robot_movement',
    actionParams: {
      ...validDecision.actionParams,
      motionClass: 'body_local',
    },
  }
  assert.equal(validateEnvironmentRouterDecision(bodyLocal).valid, true)
  assert.equal(environmentRouterRouteView(bodyLocal).motionClass, 'body_local')
})
