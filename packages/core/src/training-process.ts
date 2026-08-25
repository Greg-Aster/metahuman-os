import fs from 'node:fs'
import path from 'node:path'
import { systemPaths } from './paths.js'

export const TRAINING_PROCESS_NAMES = [
  'full-cycle',
  'full-cycle-local',
  'fine-tune-cycle',
] as const

export type TrainingProcessName = (typeof TRAINING_PROCESS_NAMES)[number]

export interface TrackedTrainingProcess {
  name: TrainingProcessName
  pid: number
}

function pidPath(name: TrainingProcessName): string {
  return path.join(systemPaths.logs, 'run', `${name}.pid`)
}

function removePidFile(name: TrainingProcessName): void {
  fs.rmSync(pidPath(name), { force: true })
}

function isExpectedTrainingProcess(name: TrainingProcessName, pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false

  try {
    process.kill(pid, 0)
  } catch {
    return false
  }

  // A stale PID file can outlive its process and the PID can later be reused.
  // Linux exposes enough identity to avoid signalling an unrelated process.
  const commandPath = `/proc/${pid}/cmdline`
  if (process.platform === 'linux' && fs.existsSync(commandPath)) {
    try {
      const command = fs.readFileSync(commandPath, 'utf8').split('\0').join(' ')
      return command.includes(`${name}.ts`)
    } catch {
      return false
    }
  }

  return true
}

export function listTrainingProcesses(): TrackedTrainingProcess[] {
  const running: TrackedTrainingProcess[] = []

  for (const name of TRAINING_PROCESS_NAMES) {
    const file = pidPath(name)
    if (!fs.existsSync(file)) continue

    let pid: number
    try {
      pid = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10)
    } catch {
      removePidFile(name)
      continue
    }
    if (!isExpectedTrainingProcess(name, pid)) {
      removePidFile(name)
      continue
    }

    running.push({ name, pid })
  }

  return running
}

export function trackTrainingProcess(name: TrainingProcessName, pid: number): void {
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new Error(`Invalid training process PID: ${pid}`)
  }

  const runDirectory = path.join(systemPaths.logs, 'run')
  const destination = pidPath(name)
  const temporary = `${destination}.tmp.${process.pid}`

  fs.mkdirSync(runDirectory, { recursive: true })
  try {
    fs.writeFileSync(temporary, `${pid}\n`, { encoding: 'utf8', flag: 'wx' })
    fs.renameSync(temporary, destination)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
}

export function releaseTrainingProcess(name: TrainingProcessName, pid: number): void {
  const file = pidPath(name)
  if (!fs.existsSync(file)) return

  const trackedPid = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10)
  if (trackedPid === pid) removePidFile(name)
}

export function stopTrainingProcesses(): TrackedTrainingProcess[] {
  const stopped: TrackedTrainingProcess[] = []

  for (const trainingProcess of listTrainingProcesses()) {
    try {
      // Training jobs are launched detached, so the PID is also their process
      // group ID. Stopping the group includes trainer and converter children.
      process.kill(-trainingProcess.pid, 'SIGTERM')
    } catch {
      try {
        process.kill(trainingProcess.pid, 'SIGTERM')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }

    releaseTrainingProcess(trainingProcess.name, trainingProcess.pid)
    stopped.push(trainingProcess)
  }

  return stopped
}
