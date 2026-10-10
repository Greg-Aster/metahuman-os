import fs from 'node:fs'
import path from 'node:path'
import { systemPaths } from '../path-builder.js'

export const bigBrotherRepairLog = path.join(systemPaths.logs, 'big-brother', 'repairs.md')

export function appendDiagnosticLog(id: string, status: string, details: string): void {
  fs.mkdirSync(path.dirname(bigBrotherRepairLog), { recursive: true, mode: 0o700 })
  fs.appendFileSync(bigBrotherRepairLog,
    `\n## ${new Date().toISOString()} · ${id} · ${status}\n\n${details}\n`, { mode: 0o600 })
}
