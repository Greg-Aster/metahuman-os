import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const ROOT = path.resolve(import.meta.dirname, '../../../..')

test('sleep workflow admits exactly one ordered stage at a time', async () => {
  const runtimeFile = path.join('/tmp', `metahuman-sleep-runtime-${randomUUID()}.json`)
  process.env.MH_SLEEP_RUNTIME_FILE = runtimeFile
  const [{ SLEEP_WORKFLOW_STAGES, advanceSleepWorkflow, beginSleepWorkflow }, { UnifiedQueueManager }, runtime] = await Promise.all([
    import('./sleep-workflow.js'),
    import('./unified-queue-manager.js'),
    import('../sleep-runtime.js'),
  ])

  try {
    const manager = new UnifiedQueueManager()
    const result = beginSleepWorkflow({
      id: 'sleep-parent-test',
      username: 'test-owner',
      source: 'user',
      input: { force: true },
    } as any, manager.enqueue.bind(manager))
    assert.equal('skipped' in result, false)

    for (const stage of SLEEP_WORKFLOW_STAGES) {
      const active = manager.getAllTasks()
      assert.equal(active.length, 1)
      assert.equal(active[0].handler, stage.handler)
      if (stage.handler === 'vector.index-build') assert.equal(active[0].input.agentId, undefined)
      const task = manager.claim(active[0].id)
      assert.ok(task)
      manager.complete(task.id, true, {})
      advanceSleepWorkflow(manager, task, 'completed')
    }

    const state = runtime.readSleepRuntimeState()
    assert.equal(state.phase, 'awake')
    assert.equal(state.currentSession, undefined)
    assert.equal(state.recentSessions[0]?.state, 'completed')
    assert.ok(state.recentSessions[0]?.stages.every(stage => stage.state === 'completed'))
  } finally {
    fs.rmSync(runtimeFile, { force: true })
    delete process.env.MH_SLEEP_RUNTIME_FILE
  }
})

test('sleep-owned agents have no independent autonomy schedules', async () => {
  const { SLEEP_WORKFLOW_STAGES } = await import('./sleep-workflow.js')
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc', 'agents.json'), 'utf8'))
  const sleepOwned = [
    'organizer',
    'curator',
    'desire-generator',
    'desire-executor',
    'desire-planner',
    'desire-outcome-reviewer',
  ]
  for (const id of sleepOwned) assert.equal(config.agents[id].type, 'manual', id)

  const scheduledAwake = Object.values(config.agents).filter((agent: any) =>
    agent.enabled && !['manual', 'event'].includes(agent.type) && agent.id !== 'sleep-workflow') as any[]
  assert.ok(scheduledAwake.length > 0)
  assert.ok(scheduledAwake.every(agent => JSON.stringify(agent.allowedModes) === JSON.stringify(['semi'])))
  assert.deepEqual(config.agents['sleep-workflow'].allowedModes, ['semi', 'full'])
  assert.equal(SLEEP_WORKFLOW_STAGES.at(-1)?.handler, 'vector.index-build')
})

test('Full autonomy proposal set excludes sleep-owned work', async () => {
  const { AUTONOMOUS_PROPOSALS } = await import('../active-operator/policy-contract.js')
  for (const handler of ['agent.dreamer', 'agent.organizer', 'agent.desire-generator']) {
    assert.equal(AUTONOMOUS_PROPOSALS[handler], undefined, handler)
  }
})
