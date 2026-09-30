import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

interface Identity { pid: number; session: number; started: string; state: string }
interface Receipt extends Identity { boot: string }
function bootIdentity(): string { return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() }
function identity(pid: number): Identity | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return { pid, state: fields[0], session: Number(fields[3]), started: fields[19] }
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code || '')) return null
    throw error
  }
}

/** Linux session identity includes foreground/background job-control groups. */
export class TerminalProcess {
  private stopping?: Promise<void>
  private constructor(private owner: Receipt, private receipt: string) {}

  static record(pid: number, directory: string): TerminalProcess {
    const processIdentity = identity(pid)
    if (!processIdentity) throw new Error('Terminal child exited before ownership could be recorded')
    // forkpty can return before the child finishes setsid(). Record the exact
    // child identity now and its eventual session ID, never the parent's session.
    const owner: Receipt = { ...processIdentity, session: pid, boot: bootIdentity() }
    const receipt = path.join(directory, `${pid}.json`)
    try {
      fs.writeFileSync(receipt, JSON.stringify(owner), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      process.kill(processIdentity.session === pid ? -pid : pid, 'SIGKILL')
      throw error
    }
    return new TerminalProcess(owner, receipt)
  }

  static async recover(directory: string): Promise<void> {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    for (const file of fs.readdirSync(directory)) {
      if (!/^\d+\.json$/.test(file)) continue
      const receipt = path.join(directory, file)
      const owner: Receipt = JSON.parse(fs.readFileSync(receipt, 'utf8'))
      if (!Number.isInteger(owner.pid) || owner.pid < 2 || owner.session !== owner.pid || !/^\d+$/.test(owner.started) || typeof owner.boot !== 'string' || !owner.boot) {
        throw new Error(`Invalid terminal process receipt: ${file}`)
      }
      await new TerminalProcess(owner, receipt).stop()
    }
  }

  private members(): Identity[] {
    if (this.owner.boot !== bootIdentity()) return []
    const leader = identity(this.owner.pid)
    if (leader && leader.started !== this.owner.started) {
      // PID reuse proves the old session has gone; never signal its replacement.
      return []
    }
    if (leader && leader.session !== this.owner.pid && leader.state !== 'Z') return [leader]
    return fs.readdirSync('/proc').filter(name => /^\d+$/.test(name))
      .map(name => identity(Number(name)))
      .filter((item): item is Identity => !!item && item.session === this.owner.pid && item.state !== 'Z')
  }

  stop(): Promise<void> {
    if (!this.stopping) this.stopping = this.terminate().finally(() => { this.stopping = undefined })
    return this.stopping
  }

  private async terminate(): Promise<void> {
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
      const deadline = Date.now() + 1500
      // Recheck membership while shutting down: children can fork during SIGTERM.
      do {
        const members = this.members()
        if (!members.length) {
          fs.rmSync(this.receipt, { force: true })
          return
        }
        for (const member of members) {
          if (identity(member.pid)?.started !== member.started) continue
          try { process.kill(member.pid, signal) } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
          }
        }
        await delay(25)
      } while (Date.now() < deadline)
    }
    if (this.members().length) throw new Error(`Terminal process session ${this.owner.pid} did not stop`)
    fs.rmSync(this.receipt, { force: true })
  }
}
