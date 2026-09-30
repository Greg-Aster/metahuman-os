import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-terminal-test-'))
process.env.METAHUMAN_ROOT = root
process.env.SHELL = '/bin/bash'
const { TerminalRuntime } = await import('./runtime.js')
const { TerminalProcess } = await import('./process.js')
const { TerminalScreen } = await import('./screen.js')
const receipts = path.join(root, 'receipts')
await TerminalProcess.recover(receipts)
test.after(() => fs.rmSync(root, { recursive: true, force: true }))

async function eventually(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) { if (await check()) return; await delay(25) }
  assert.fail('Timed out waiting for terminal evidence')
}
async function screenText(runtime: InstanceType<typeof TerminalRuntime>, id: string) {
  const event = await runtime.snapshot(id)
  assert.equal(event.type, 'screen')
  return event.type === 'screen' ? event.data : ''
}

test('real PTY survives viewer disposal, retains shell state, resizes, and stops job-control children', async () => {
  const runtime = new TerminalRuntime(receipts)
  try {
    assert.deepEqual(runtime.state().sessions, [])
    const session = runtime.create('shell')
    const listener = () => {}
    runtime.on('event', listener)
    runtime.input(session.id, "export MH_TERMINAL_PROBE=retained\nprintf 'first-%s\\n' \"$MH_TERMINAL_PROBE\"\n")
    await eventually(async () => (await screenText(runtime, session.id)).includes('first-retained'))
    runtime.off('event', listener)
    runtime.input(session.id, "printf 'hidden-%s\\n' \"$MH_TERMINAL_PROBE\"\n")
    await eventually(async () => (await screenText(runtime, session.id)).includes('hidden-retained'))
    runtime.resize(session.id, 101, 37)
    runtime.input(session.id, 'stty size\n')
    await eventually(async () => (await screenText(runtime, session.id)).includes('37 101'))
    const childFile = path.join(root, 'background.pid')
    runtime.input(session.id, `sleep 120 & echo $! > '${childFile}'\n`)
    await eventually(() => fs.existsSync(childFile))
    const pid = Number(fs.readFileSync(childFile, 'utf8'))
    process.kill(pid, 0)
    await Promise.all([runtime.close(session.id), runtime.close(session.id)])
    assert.deepEqual(runtime.state().sessions, [])
    const live = fs.existsSync(`/proc/${pid}/stat`) && !fs.readFileSync(`/proc/${pid}/stat`, 'utf8').includes(') Z ')
    assert.equal(live, false, 'background job must stop along with the shell')
    assert.deepEqual(fs.readdirSync(receipts), [])
  } finally { await runtime.stop() }
})

test('screen snapshots retain alternate screen and bound scrollback', async () => {
  const screen = new TerminalScreen(80, 24)
  const restored = new TerminalScreen(80, 24)
  try {
    await screen.write('base\r\n\x1b[?1049h\x1b[2J\x1b[Hinteractive screen')
    const snapshot = await screen.snapshot()
    await restored.write(snapshot)
    assert.equal(await restored.snapshot(), snapshot)
    assert.match(snapshot, /interactive screen/)
    await screen.write('\x1b[?1049l' + Array.from({ length: 5000 }, (_, i) => `line-${i}\r\n`).join(''))
    const bounded = await screen.snapshot()
    assert.ok(bounded.length < 40000)
    assert.doesNotMatch(bounded, /line-0\r/)
    assert.match(bounded, /line-4999/)
  } finally { screen.dispose(); restored.dispose() }
})

test('failed termination retains the session and receipt for retry; stop fences new work', async () => {
  const runtime = new TerminalRuntime(receipts)
  const session = runtime.create('shell')
  const kill = process.kill
  try {
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 'SIGTERM' || signal === 'SIGKILL') throw Object.assign(new Error('permission denied'), { code: 'EPERM' })
      return kill(pid, signal)
    }) as typeof process.kill
    await assert.rejects(runtime.close(session.id), /permission denied/)
    assert.equal(runtime.state().sessions[0].phase, 'failed')
    assert.equal(fs.readdirSync(receipts).length, 1)
    await assert.rejects(runtime.stop(), /Failed to stop/)
    assert.throws(() => runtime.create('shell'), /stopping/)
  } finally { process.kill = kill; await runtime.stop() }
  assert.deepEqual(fs.readdirSync(receipts), [])
})

test('recovery terminates only saved process sessions and leaves no receipt', async () => {
  const runtime = new TerminalRuntime(receipts)
  runtime.create('shell')
  await TerminalProcess.recover(receipts)
  await eventually(() => runtime.state().sessions[0].phase !== 'running')
  await runtime.stop()
  assert.deepEqual(fs.readdirSync(receipts), [])
})

test('invalid sizes and input do not mutate or remove a session', async () => {
  const runtime = new TerminalRuntime(receipts)
  try {
    assert.throws(() => runtime.create('shell', 0, 24), /Terminal size/)
    const session = runtime.create('shell')
    assert.throws(() => runtime.resize(session.id, 10000, 40), /Terminal size/)
    assert.throws(() => runtime.input(session.id, 'x'.repeat(65537)), /64 KiB/)
    assert.equal(runtime.state().sessions[0].cols, 80)
  } finally { await runtime.stop() }
})

test('recovery never signals a PID saved by a previous operating-system boot', async () => {
  fs.writeFileSync(path.join(receipts, `${process.pid}.json`), JSON.stringify({
    pid: process.pid, session: process.pid, started: '1', state: 'S', boot: 'previous-boot',
  }))
  const kill = process.kill
  try {
    process.kill = (() => { assert.fail('a receipt from another boot must never signal a process') }) as typeof process.kill
    await TerminalProcess.recover(receipts)
  } finally { process.kill = kill }
  assert.deepEqual(fs.readdirSync(receipts), [])
})

test('a child still in its parent session can be stopped without signaling its sibling or parent', async () => {
  const launch = async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    return { child, owner: TerminalProcess.record(child.pid!, receipts) }
  }
  const first = await launch()
  const sibling = await launch()
  try {
    await first.owner.stop()
    assert.equal(process.kill(sibling.child.pid!, 0), true)
    assert.equal(process.kill(process.pid, 0), true)
  } finally { await first.owner.stop(); await sibling.owner.stop() }
  assert.deepEqual(fs.readdirSync(receipts), [])
})
