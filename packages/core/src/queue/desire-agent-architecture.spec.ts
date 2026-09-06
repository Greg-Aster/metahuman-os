import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { ROOT } from '../paths.js'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

test('Desire Agent is the sole public trigger and lifecycle admission owner', () => {
  const configured = JSON.parse(source('etc/agents.json')) as {
    agents: Record<string, { handler?: string; type?: string }>
  }
  assert.equal(configured.agents['desire-agent']?.handler, 'agent.desire-generator')
  assert.equal(configured.agents['desire-agent']?.type, 'manual')
  for (const removedId of [
    'desire-signal',
    'desire-generator',
    'desire-planner',
    'desire-executor',
    'desire-outcome-reviewer',
  ]) {
    assert.equal(configured.agents[removedId], undefined, `${removedId} must not be registered`)
  }

  for (const removedPath of [
    'packages/core/src/agency/desire-signal-service.ts',
    'packages/core/src/queue/desire-signal-handler.ts',
    'brain/agents/desire-executor/core.ts',
    'brain/agents/desire-outcome-reviewer/core.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, removedPath)), false, `${removedPath} must stay removed`)
  }

  const admissionOwner = source('packages/core/src/queue/work-submission.ts')
  const publicQueueExports = source('packages/core/src/queue/index.ts')
  const publicCoreExports = source('packages/core/src/index.ts')
  assert.doesNotMatch(publicQueueExports, /buildDesireAgentTaskInput|isDesireAgentAdmission/)
  assert.doesNotMatch(publicCoreExports, /buildDesireAgentTaskInput|isDesireAgentAdmission/)
  for (const handler of [
    "handler: 'agent.desire-planner'",
    "handler: 'agency.desire-execute'",
    "handler: 'agency.desire-outcome-review'",
    "handler: 'agency.desire-checkin'",
  ]) {
    assert.match(admissionOwner, new RegExp(handler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  for (const caller of [
    'packages/core/src/api/handlers/agency.ts',
    'packages/core/src/api/handlers/agency-workflows.ts',
    'packages/core/src/nodes/response/response-action-router.node.ts',
    'brain/agents/desire-planner/core.ts',
    'packages/core/src/queue/desire-execution-handler.ts',
    'packages/core/src/queue/desire-outcome-handler.ts',
  ]) {
    const contents = source(caller)
    assert.match(contents, /(?:submit|build)DesireAgent/)
    assert.doesNotMatch(contents, /submitDesire(?:Planning|Execution|OutcomeReview)/)
  }

  const conversationBuffer = source('packages/core/src/conversation-buffer.ts')
  assert.doesNotMatch(conversationBuffer, /userInitiated|messageId: appendedUserMessage|observedAt: appendedUserMessage/)
  assert.doesNotMatch(source('packages/core/src/queue/trigger-manager.ts'), /userInitiatedEvent/)
})

test('operator proposals do not expose legacy Desire stage admissions', () => {
  const proposalOwner = source('packages/core/src/active-operator/operator-proposals.ts')
  const proposalHandler = source('packages/core/src/api/handlers/operator-proposals.ts')

  for (const legacyType of ['desire_generate', 'desire_advance', 'desire_execute']) {
    assert.doesNotMatch(proposalOwner, new RegExp(`['"]${legacyType}['"]`))
    assert.doesNotMatch(proposalHandler, new RegExp(`['"]${legacyType}['"]`))
  }
})
