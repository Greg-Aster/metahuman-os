import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { ROOT } from '../../path-builder.js'
import { TerminalProcess } from '../process.js'
import { terminalJobs } from '../paths.js'
import {
  buildBigBrotherCLIInvocation, parseBigBrotherTerminalEvent, providerLabel,
  type BigBrotherSessionResult, type ParsedBigBrotherEvent, type TerminalBigBrotherProvider,
  type TerminalProviderOptions,
} from './cli.js'

const MAX_RESULT = 4 * 1024 * 1024

/** Runs the one provider invocation inside the Terminal agent; no worker or file polling. */
export async function runProvider(
  provider: TerminalBigBrotherProvider, prompt: string, options: TerminalProviderOptions,
  receipts: string, signal: AbortSignal,
  display: (data: string) => Promise<void>, observe: (event: ParsedBigBrotherEvent) => void,
  onOwned: (cleanup: () => Promise<void>) => void,
): Promise<BigBrotherSessionResult> {
  const started = Date.now()
  fs.mkdirSync(terminalJobs, { recursive: true, mode: 0o700 })
  const invocation = buildBigBrotherCLIInvocation(provider, prompt, options, terminalJobs)
  let owned: TerminalProcess | undefined
  let finalText = ''
  let stderr = ''
  let failure: string | undefined
  let timer: NodeJS.Timeout | undefined
  let cancellation: Promise<void> | undefined
  const cleanup = async () => {
    if (owned) await owned.stop()
    fs.rmSync(invocation.tempDir, { recursive: true, force: true })
  }
  const cancel = () => {
    failure ||= signal.reason instanceof Error ? signal.reason.message : 'Big Brother cancelled'
    if (owned && !cancellation) {
      cancellation = owned.stop()
      // The result path awaits this promise and reports cleanup errors.
      cancellation.catch(() => {})
    }
  }
  try {
    signal.throwIfAborted()
    await display(`MetaHuman Big Brother — ${providerLabel(provider)}\r\n\r\n`)
    signal.throwIfAborted()
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.workingDirectory || ROOT, detached: true,
      env: { ...process.env, TERM: 'xterm-256color', NO_COLOR: '1', IS_SANDBOX: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const exit = new Promise<{ code: number | null; error?: Error }>(resolve => {
      child.once('error', error => resolve({ code: null, error }))
      child.once('close', code => resolve({ code }))
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    owned = TerminalProcess.record(child.pid!, receipts)
    onOwned(cleanup)
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    child.stdin.on('error', error => { failure ||= error.message; cancel() })
    child.stdin.end(invocation.stdin)
    if (invocation.timeout > 0) timer = setTimeout(() => { failure = `Timed out after ${invocation.timeout}ms`; cancel() }, invocation.timeout)

    const consume = async (line: string) => {
      const parsed = parseBigBrotherTerminalEvent(provider, line)
      if (parsed.finalText) {
        if (parsed.finalText.length > MAX_RESULT) throw new Error('Big Brother response exceeds 4 MiB')
        finalText = parsed.finalText
      }
      if (parsed.displayLines.length) await display(`${parsed.displayLines.join('\n').replace(/\r?\n/g, '\r\n')}\r\n`)
      observe(parsed)
    }
    const stdoutTask = (async () => {
      const decoder = new StringDecoder('utf8')
      let buffered = ''
      for await (const chunk of child.stdout) {
        buffered += decoder.write(chunk)
        if (buffered.length > MAX_RESULT) throw new Error('Big Brother event exceeds 4 MiB')
        let newline: number
        while ((newline = buffered.indexOf('\n')) !== -1) {
          const line = buffered.slice(0, newline)
          buffered = buffered.slice(newline + 1)
          await consume(line)
        }
      }
      buffered += decoder.end()
      if (buffered.trim()) await consume(buffered)
    })()
    const stderrTask = (async () => {
      child.stderr.setEncoding('utf8')
      for await (const chunk of child.stderr) {
        stderr = (stderr + chunk).slice(-8192)
        await display(String(chunk).replace(/\r?\n/g, '\r\n'))
      }
    })()
    const output = Promise.all([stdoutTask, stderrTask])
    output.catch(error => { failure = error.message; cancel() })
    const result = await exit
    await output
    if (cancellation) await cancellation
    await owned.stop()
    if (invocation.resultFile && fs.existsSync(invocation.resultFile)) {
      if (fs.statSync(invocation.resultFile).size > MAX_RESULT) throw new Error('Big Brother response exceeds 4 MiB')
      finalText = fs.readFileSync(invocation.resultFile, 'utf8').trim() || finalText
    }
    failure ||= result.error?.message || (result.code !== 0 ? stderr.trim() || `Provider exited with code ${result.code}` : undefined)
    return { success: !failure, output: finalText, error: failure, executionTime: Date.now() - started,
      metadata: { provider, exitCode: result.code } }
  } catch (error) {
    return { success: false, output: finalText, error: (error as Error).message,
      executionTime: Date.now() - started, metadata: { provider } }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
    // Keep invocation files and the receipt if cleanup fails, so ownership is not lost.
    await cleanup()
  }
}
