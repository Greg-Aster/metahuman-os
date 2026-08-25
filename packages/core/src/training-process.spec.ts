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
