import fs from 'node:fs'
import path from 'node:path'
import { paths } from './paths.js'

export type AutonomyMode = 'off' | 'supervised' | 'bounded'

export interface AutonomyConfig {
  mode: AutonomyMode
  schedules: {
    reflectionSeconds: number
    maintenanceSeconds: number
  }
  riskGuards: {
    dryRunDefault: boolean
    requireConfirmFor: string[]
  }
}

const DEFAULT_CONFIG: AutonomyConfig = {
  mode: 'supervised',
  schedules: { reflectionSeconds: 3600, maintenanceSeconds: 21600 },
  riskGuards: { dryRunDefault: true, requireConfirmFor: ['fs_delete','git_commit'] },
}

export function readAutonomyConfig(): AutonomyConfig {
  try {
    const p = path.join(paths.root, 'etc', 'autonomy.json')
    const raw = fs.readFileSync(p, 'utf-8')
    const cfg = JSON.parse(raw)
    return { ...DEFAULT_CONFIG, ...cfg }
  } catch {
    return DEFAULT_CONFIG
  }
}

