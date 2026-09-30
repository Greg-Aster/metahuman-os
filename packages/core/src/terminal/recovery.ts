import fs from 'node:fs'
import { acquireLock } from '../locks.js'
import { TerminalProcess } from './process.js'
import { terminalReceipts, terminalJobs, terminalSocket } from './paths.js'

/** Called only with the Terminal service lock held. Never replays shell commands. */
export async function recoverTerminalProcesses(): Promise<void> {
  await TerminalProcess.recover(terminalReceipts)
  fs.rmSync(terminalJobs, { recursive: true, force: true })
}

export async function stopOfflineTerminal(): Promise<void> {
  const lock = acquireLock('agent-terminal', { exitOnSignal: false })
  try {
    await recoverTerminalProcesses()
    fs.rmSync(terminalSocket, { force: true })
  } finally { lock.release() }
}
