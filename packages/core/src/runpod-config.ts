import fs from 'node:fs'
import path from 'node:path'
import { getProfilePaths } from './path-builder.js'

export interface RunpodConfig {
  apiKey: string | null
  templateId: string | null
  gpuType: string | null
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`RunPod ${field} must be a string`)
  return value.trim() || null
}

export function loadRunpodConfig(username: string): RunpodConfig {
  const configPath = path.join(getProfilePaths(username).etc, 'runpod.json')
  let profileConfig: Record<string, unknown> = {}

  if (fs.existsSync(configPath)) {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('RunPod profile configuration must be a JSON object')
    }
    profileConfig = parsed as Record<string, unknown>
  }

  return {
    apiKey: optionalString(process.env.RUNPOD_API_KEY, 'API key')
      || optionalString(profileConfig.apiKey, 'API key'),
    templateId: optionalString(process.env.RUNPOD_TEMPLATE_ID, 'template ID')
      || optionalString(profileConfig.templateId, 'template ID'),
    gpuType: optionalString(process.env.RUNPOD_GPU_TYPE, 'GPU type')
      || optionalString(profileConfig.gpuType, 'GPU type'),
  }
}

export function hasRunpodCredentials(username: string): boolean {
  return Boolean(loadRunpodConfig(username).apiKey)
}
