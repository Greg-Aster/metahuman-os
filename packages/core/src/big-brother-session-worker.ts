/**
 * Runs one Big Brother request under the shared session owner.
 *
 * This is an execution helper, not a second session owner. The parent session
 * manager owns this process, ttyd, cancellation, job files, UI events, and
 * chat completion. ttyd follows this worker's transcript without gating CLI
 * startup on a browser connection.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  buildBigBrotherCLIInvocation,
  parseBigBrotherTerminalEvent,
  providerLabel,
  type BigBrotherSessionResult,
  type BigBrotherCLIInvocation,
  type ParsedBigBrotherEvent,
  type TerminalBigBrotherProvider,
} from './big-brother-cli.js'

interface WorkerJob {
  provider: TerminalBigBrotherProvider
  prompt: string
  username?: string
  workingDirectory?: string
  timeout?: number
  sessionId?: string
}

const jobPath = process.argv[2]
if (!jobPath) throw new Error('Big Brother worker requires a job file')

const jobDir = path.dirname(jobPath)
const resultPath = path.join(jobDir, 'result.json')
const resultTempPath = path.join(jobDir, 'result.json.tmp')
const eventsPath = path.join(jobDir, 'events.jsonl')
const transcriptPath = path.join(jobDir, 'transcript.log')

function terminalWrite(text: string): void {
  process.stdout.write(text)
  fs.appendFileSync(transcriptPath, text)
}

function emitParsed(event: ParsedBigBrotherEvent): void {
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`)
  if (event.displayLines.length > 0) terminalWrite(`${event.displayLines.join('\n')}\n`)
}

function emitObserverEvent(event: ParsedBigBrotherEvent): void {
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`)
}

function writeResult(result: BigBrotherSessionResult): void {
  fs.writeFileSync(resultTempPath, JSON.stringify(result), { mode: 0o600 })
  fs.renameSync(resultTempPath, resultPath)
  fs.rmSync(jobPath, { force: true })
}

if (fs.existsSync(resultPath)) {
  if (fs.existsSync(transcriptPath)) process.stdout.write(fs.readFileSync(transcriptPath, 'utf8'))
  process.stdout.write('\nThis Big Brother request has already finished. Its final response was sent to chat.\n')
  process.exit(0)
}

const job = JSON.parse(fs.readFileSync(jobPath, 'utf8')) as WorkerJob
const startedAt = Date.now()
let invocation: BigBrotherCLIInvocation | null = null

try {
  invocation = buildBigBrotherCLIInvocation(job.provider, job.prompt, {
    username: job.username,
    workingDirectory: job.workingDirectory,
    timeout: job.timeout,
    sessionId: job.sessionId,
  })
} catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to prepare Big Brother CLI'
  terminalWrite(`\n❌ ${message}\n`)
  writeResult({
    success: false,
    output: '',
    error: message,
    executionTime: Date.now() - startedAt,
    metadata: { provider: job.provider },
  })
  process.exit(1)
}

if (!invocation) throw new Error('Failed to prepare Big Brother CLI')

terminalWrite(`MetaHuman Big Brother\nProvider: ${providerLabel(job.provider)}\nWorking directory: ${job.workingDirectory || process.cwd()}\n\n`)

let child: ChildProcess | null = null
let stdout = ''
let stderr = ''
let lineBuffer = ''
let finalText = ''
let cancellationReason: string | null = null
let settled = false

function signalChild(signal: NodeJS.Signals): void {
  if (!child?.pid) return
  try {
    child.kill(signal)
  } catch {
    // The provider already exited.
  }
}

function cancel(reason: string): void {
  if (cancellationReason) return
  cancellationReason = reason
  signalChild('SIGTERM')
  setTimeout(() => signalChild('SIGKILL'), 3000).unref()
}

process.on('SIGHUP', () => cancel('Big Brother terminal disconnected'))
process.on('SIGTERM', () => cancel('Big Brother terminal closed by user'))
process.on('SIGINT', () => cancel('Big Brother terminal interrupted'))

function consumeLine(line: string): void {
  const parsed = parseBigBrotherTerminalEvent(job.provider, line)
  if (parsed.finalText) finalText = parsed.finalText
  emitParsed(parsed)
}

try {
  child = spawn(invocation.command, invocation.args, {
    cwd: job.workingDirectory || process.cwd(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      NO_COLOR: '1',
      IS_SANDBOX: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  child.stdout?.on('data', (data: Buffer) => {
    const chunk = data.toString()
    stdout += chunk
    lineBuffer += chunk
    const lines = lineBuffer.split(/\r?\n/)
    lineBuffer = lines.pop() || ''
    for (const line of lines) consumeLine(line)
  })

  child.stderr?.on('data', (data: Buffer) => {
    const chunk = data.toString()
    stderr += chunk
    terminalWrite(chunk)
    emitObserverEvent({ displayLines: [chunk], reasoningSteps: [] })
  })

  child.stdin?.end(invocation.stdin)

  const timer = setTimeout(() => cancel(`Timed out after ${invocation.timeout}ms`), invocation.timeout)
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; spawnError?: Error }>(resolve => {
    child!.once('error', spawnError => resolve({ code: null, signal: null, spawnError }))
    child!.once('close', (code, signal) => resolve({ code, signal }))
  })
  clearTimeout(timer)
  settled = true

  if (lineBuffer.trim()) consumeLine(lineBuffer)
  if (invocation.resultFile && fs.existsSync(invocation.resultFile)) {
    const resultFileText = fs.readFileSync(invocation.resultFile, 'utf8').trim()
    if (resultFileText) finalText = resultFileText
  }

  const success = !cancellationReason && !exit.spawnError && exit.code === 0
  const error = cancellationReason
    || exit.spawnError?.message
    || (success ? undefined : stderr.trim() || `${providerLabel(job.provider)} exited with code ${exit.code}`)

  if (!finalText && success) finalText = stdout.trim()
  terminalWrite(success
    ? '\n✅ Big Brother completed. Final response sent to chat.\n'
    : `\n❌ ${error}\n`)

  writeResult({
    success,
    output: finalText,
    error,
    executionTime: Date.now() - startedAt,
    metadata: { provider: job.provider, exitCode: exit.code, signal: exit.signal },
  })
} catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to launch Big Brother CLI'
  terminalWrite(`\n❌ ${message}\n`)
  writeResult({
    success: false,
    output: '',
    error: message,
    executionTime: Date.now() - startedAt,
    metadata: { provider: job.provider },
  })
} finally {
  fs.rmSync(invocation.tempDir, { recursive: true, force: true })
  if (!settled && child) signalChild('SIGKILL')
}
