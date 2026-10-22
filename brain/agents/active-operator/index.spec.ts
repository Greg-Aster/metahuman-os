import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Socket } from 'node:net'
import test, { mock } from 'node:test'
import type { QueuedTask, RobotOperatorRuntimeState } from '@metahuman/core'
const sleep = (ms: number) => new Promise(resolve => realSetTimeout(resolve, ms))
const realSetTimeout = globalThis.setTimeout
const realNow = Date.now

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-full-admission-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('No network in Full admission tests') }
mock.method(Socket.prototype, 'connect', function (this: Socket) {
  queueMicrotask(() => this.destroy(Object.assign(new Error('Test transport disabled'), { code: 'ECONNREFUSED' })))
  return this
})
const core = await import('@metahuman/core')
core.setAuditEnabled(false)
const graphs = path.join(root, 'etc/cognitive-graphs')
fs.mkdirSync(path.join(graphs, 'custom'), { recursive: true })
fs.mkdirSync(path.join(root, 'logs/run'), { recursive: true })
const valid = fs.readFileSync(new URL('../../../etc/cognitive-graphs/robot-autonomy-controller-mode.json', import.meta.url), 'utf8')
let selectedGraph = 'controller-a'
let mode: 'reactive' | 'semi' | 'full' = 'reactive'
let items: QueuedTask[] = []
let history: QueuedTask[] = []
let runtime: RobotOperatorRuntimeState | undefined
let executions: ReturnType<typeof core.activeRobotExecutions> = []
let admitted = 0
let inactivityMinutes = 5
let activityAt = 0
const configuration = { ...core.loadRobotOperatorConfig(), enabled: true }
const coreMock = mock.module('@metahuman/core', { namedExports: {
  ...core,
  acquireLock: () => ({ release() {} }),
  initGlobalLogger: () => {},
  getOperatorMode: () => mode,
  readSystemActivityTimestamp: () => activityAt,
  loadActiveOperatorConfig: () => ({ autonomyMode: mode, semiInactivityMinutes: inactivityMinutes }),
  getCurrentlyActiveUser: () => ({ username: 'fixture-owner', role: 'owner' }),
  isRobotOperatorChildEnabled: () => true,
  isSleepRuntimeActive: () => false,
  loadRobotOperatorConfig: () => ({ ...configuration, robotAutonomyControllerGraph: selectedGraph }),
  loadQueueState: () => ({ items, history }),
  activeRobotExecutions: () => executions,
  onAuthenticatedSessionChange: () => () => {},
  writeRobotOperatorRuntimeState: (value: RobotOperatorRuntimeState) => { runtime = value },
} })
const queueMock = mock.module('@metahuman/core/queue', { namedExports: {
  submitCoordinatorWork: async (input: any) => {
    const task = { ...input, id: `fixture-work-${++admitted}`, state: 'queued', createdAt: new Date().toISOString(), attempt: 0 }
    items.push(task)
    return task
  },
} })
const { run } = await import('./index.js')

async function until(predicate: () => boolean): Promise<void> {
  const deadline = realNow() + 3_000
  while (!predicate()) {
    assert.ok(realNow() < deadline, 'Active Operator did not reach expected state')
    await sleep(10)
  }
}
function wakeQueue() { core.persistQueueState({ items, history, inFlightRemote: [], lastUpdated: new Date().toISOString() }) }

test('Semi uses configurable inactivity while Full assesses without waiting for selected operations', async () => {
  fs.writeFileSync(path.join(graphs, 'controller-a-mode.json'), valid)
  const priorSignalHandlers = process.listeners('SIGTERM')
  const running = run()
  try {
    await until(() => runtime?.lifecycle === 'dormant')
    assert.equal(admitted, 0, 'Reactive must not admit autonomous work')
    mock.timers.enable({ apis: ['Date', 'setTimeout'], now: realNow() })
    mode = 'semi'
    fs.writeFileSync(path.join(root, 'etc/active-operator.json'), JSON.stringify({ autonomyMode: mode }))
    await until(() => runtime?.reason.startsWith('Waiting for 5 minutes') === true)
    mock.timers.tick(299_999)
    assert.equal(admitted, 0, 'Entering Semi starts the configured inactivity period')
    activityAt = Date.now()
    core.recordSystemActivity(activityAt)
    await sleep(30)
    mock.timers.tick(1)
    await sleep(30)
    assert.equal(admitted, 0, 'Activity cancels the original deadline')
    for (let i = 0; i < 3; i++) { wakeQueue(); await sleep(20) }
    mock.timers.tick(299_998)
    assert.equal(admitted, 0, 'Queue bookkeeping neither bypasses nor resets inactivity')
    mock.timers.tick(1)
    await until(() => admitted === 1)
    assert.equal(items[0].handler, 'workflow.robot-autonomy-controller')
    assert.equal(items[0].metadata?.producer, 'robot-operator', 'saved work retains its owner identity')
    assert.equal(items[0].source, 'autonomy')
    items = []
    wakeQueue()
    await until(() => runtime?.reason.startsWith('Waiting for 5 minutes') === true)
    mock.timers.tick(299_999)
    assert.equal(admitted, 1, 'Finishing an assessment does not immediately retrigger it')
    mock.timers.tick(1)
    await until(() => admitted === 2)
    items = []
    wakeQueue()
    await until(() => runtime?.reason.startsWith('Waiting for 5 minutes') === true)
    inactivityMinutes = 1
    fs.writeFileSync(path.join(root, 'etc/active-operator.json'), JSON.stringify({ autonomyMode: mode, semiInactivityMinutes: 1 }))
    await until(() => runtime?.reason.startsWith('Waiting for 1 minutes') === true)
    mock.timers.tick(59_999)
    assert.equal(admitted, 2)
    mock.timers.tick(1)
    await until(() => admitted === 3)
    items = []
    wakeQueue()
    await until(() => runtime?.reason.startsWith('Waiting for 1 minutes') === true)
    mode = 'reactive'
    fs.writeFileSync(path.join(root, 'etc/active-operator.json'), JSON.stringify({ autonomyMode: mode }))
    await until(() => runtime?.lifecycle === 'dormant')
    mock.timers.tick(600_000)
    await sleep(30)
    assert.equal(admitted, 3, 'Reactive cancels the inactivity timer')
    mock.timers.reset()
    items = []
    admitted = 0
    fs.writeFileSync(path.join(graphs, 'controller-a-mode.json'), '{invalid json')
    mode = 'full'
    fs.writeFileSync(path.join(root, 'etc/active-operator.json'), JSON.stringify({ autonomyMode: mode }))
    await until(() => runtime?.lifecycle === 'failed')
    assert.equal(admitted, 0)
    // Arbitrary Coordinator changes and history eviction do not admit bad work.
    for (let index = 0; index < 4; index++) {
      wakeQueue()
      await sleep(25)
      assert.equal(admitted, 0)
    }
    // Changing the selected graph recovers even if A itself is still broken.
    selectedGraph = 'controller-b'
    fs.writeFileSync(path.join(graphs, 'controller-b-mode.json'), valid)
    await until(() => admitted === 1)
    assert.equal(items[0].handler, 'workflow.robot-autonomy-controller')
    // A child's failure is an execution outcome, not a blanket autonomy veto.
    history = [{ ...items[0], handler: 'workflow.boredom-observer', state: 'failed',
      error: { code: 'workflow_configuration_invalid', message: 'Selected child unavailable', retryable: false } }]
    items = []
    wakeQueue()
    await until(() => admitted === 2)
    // A missing configured root is an explicit failure, not a fresh queue loop.
    selectedGraph = 'missing'
    items = []
    wakeQueue()
    await until(() => runtime?.lifecycle === 'failed')
    assert.equal(admitted, 2)
    assert.match(runtime!.reason, /Workflow not found: missing/)
    // A valid override rescues the root without altering its invalid base.
    selectedGraph = 'controller-a'
    fs.writeFileSync(path.join(graphs, 'custom/controller-a-mode.json'), valid)
    await until(() => admitted === 3)
    // An unrelated action wait does not block assessment.
    items = [{ id: 'ongoing-motion', username: 'fixture-owner', state: 'waiting', handler: 'environment.command', input: {} }] as QueuedTask[]
    executions = [{ executionId: 'motion-execution', status: 'waiting', stimulusAgent: 'boredom-movement',
      checkpointVersion: 4, waitingReason: 'action_result', resumePending: false }] as typeof executions
    wakeQueue()
    await until(() => admitted === 4)
    assert.equal(items[1].handler, 'workflow.robot-autonomy-controller')
    // A yielded assessment itself is still one live decision, not a new tick.
    items = []
    executions = [{ executionId: 'assessment-execution', status: 'waiting', stimulusAgent: 'robot-autonomy-controller',
      checkpointVersion: 4, waitingReason: 'work_result', resumePending: false }] as typeof executions
    wakeQueue()
    await sleep(50)
    assert.equal(admitted, 4)
    // Releasing that assessment immediately admits the next decision.
    executions = []
    wakeQueue()
    await until(() => admitted === 5)
  } finally {
    for (const handler of process.listeners('SIGTERM')) {
      if (!priorSignalHandlers.includes(handler)) handler.call(process, 'SIGTERM')
    }
    await running
    mock.timers.reset()
    coreMock.restore()
    queueMock.restore()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
