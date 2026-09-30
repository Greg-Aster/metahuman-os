import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { after, test } from 'node:test'
import { once } from 'node:events'

const originalRoot = process.env.METAHUMAN_ROOT
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-training-process-'))
process.env.METAHUMAN_ROOT = testRoot

const {
  listTrainingProcesses,
  releaseTrainingProcess,
  stopTrainingProcesses,
  trackTrainingProcess,
  finalizeTrainingProcess,
} = await import('./training-process.js')

after(() => {
  stopTrainingProcesses()
  fs.rmSync(testRoot, { recursive: true, force: true })
  if (originalRoot === undefined) delete process.env.METAHUMAN_ROOT
  else process.env.METAHUMAN_ROOT = originalRoot
})

function startOwnedProcess(name: string): ChildProcess {
  return spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)', `${name}.ts`],
    { detached: true, stdio: 'ignore' },
  )
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return

  let timeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      once(child, 'exit'),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Timed out waiting for training process to stop')), 2_000)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

test('tracks, identifies, and stops an owned detached training process', async () => {
  const child = startOwnedProcess('full-cycle')
  await once(child, 'spawn')
  assert.ok(child.pid)

  try {
    trackTrainingProcess('full-cycle', child.pid)
    assert.deepEqual(listTrainingProcesses(), [{ name: 'full-cycle', pid: child.pid }])

    releaseTrainingProcess('full-cycle', child.pid + 1)
    assert.deepEqual(listTrainingProcesses(), [{ name: 'full-cycle', pid: child.pid }])

    const exit = waitForExit(child)
    assert.deepEqual(stopTrainingProcesses(), [{ name: 'full-cycle', pid: child.pid }])
    await exit
    assert.deepEqual(listTrainingProcesses(), [])
  } finally {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  }
})

test('removes a PID file that does not identify the expected training process', () => {
  const runDirectory = path.join(testRoot, 'logs', 'run')
  const file = path.join(runDirectory, 'fine-tune-cycle.pid')
  fs.mkdirSync(runDirectory, { recursive: true })
  fs.writeFileSync(file, `${process.pid}\n`, 'utf8')

  assert.deepEqual(listTrainingProcesses(), [])
  assert.equal(fs.existsSync(file), false)
})

test('rejects invalid PIDs without creating tracking state', () => {
  assert.throws(() => trackTrainingProcess('full-cycle-local', 1), /Invalid training process PID/)
  assert.deepEqual(listTrainingProcesses(), [])
})

test('an independent worker persists completion and a later launcher callback cannot overwrite it', async () => {
  const owner = new URL('./training-process.ts', import.meta.url).href
  const source = `
    const { finalizeTrainingProcess } = await import(${JSON.stringify(owner)});
    process.on('message', () => {
      finalizeTrainingProcess('full-cycle-local', process.pid, { status: 'completed', exitCode: 0 });
      process.disconnect();
    });
    process.send('ready');
  `
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, 'full-cycle-local.ts'],
    { detached: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr!.on('data', data => { stderr += data })
  await once(child, 'message')
  assert.ok(child.pid)
  const logFile = 'full-cycle-local-2030-01-01T00-00-00-000Z.log'
  const logPath = path.join(testRoot, 'logs/run', logFile)
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  fs.writeFileSync(logPath, 'Synthetic training log\n')
  trackTrainingProcess('full-cycle-local', child.pid, { username: 'fixture', runLabel: 'run-one', logFile })
  child.send('finish')
  await waitForExit(child)
  assert.equal(child.exitCode, 0, stderr)
  assert.equal(finalizeTrainingProcess('full-cycle-local', child.pid, { status: 'failed', exitCode: 1 }), false)
  // A cancellation writer holding an earlier process receipt must not replace
  // a terminal outcome that the worker has already published.
  trackTrainingProcess('full-cycle-local', child.pid, { username: 'fixture', runLabel: 'run-one', logFile })
  assert.equal(finalizeTrainingProcess('full-cycle-local', child.pid, { status: 'failed' }), false)
  const markers = fs.readFileSync(logPath, 'utf8').split('\n').filter(line => line.startsWith('[training-lifecycle] '))
  assert.equal(markers.length, 1)
  assert.equal(JSON.parse(markers[0].slice('[training-lifecycle] '.length)).status, 'completed')
  assert.deepEqual(listTrainingProcesses(), [])
})

test('cancellation respects profile ownership and retains the process while cleanup is running', async () => {
  const child = spawn(process.execPath, ['-e',
    "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 200)); setInterval(() => {}, 1000); process.send('ready')", 'full-cycle.ts'],
  { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  await once(child, 'message')
  assert.ok(child.pid)
  try {
    trackTrainingProcess('full-cycle', child.pid, { username: 'owner' })
    assert.deepEqual(stopTrainingProcesses('another-profile'), [])
    assert.equal(listTrainingProcesses().length, 1)
    const exited = waitForExit(child)
    assert.equal(stopTrainingProcesses('owner').length, 1)
    assert.ok(listTrainingProcesses()[0]?.cancelRequestedAt)
    await exited
    assert.deepEqual(listTrainingProcesses(), [])
  } finally {
    try { process.kill(-child.pid, 'SIGKILL') } catch {}
  }
})
