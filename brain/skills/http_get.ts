/**
 * http_get Skill
 * Perform a GET request to an allowlisted host and return JSON/text
 */

import fs from 'node:fs'
import path from 'node:path'
import { paths } from '../../packages/core/src/paths'
import { SkillManifest, SkillResult, TrustLevel } from '../../packages/core/src/skills'

type NetworkConfig = {
  allowHosts: Set<string>
  minTrustLevel: TrustLevel
  apiKeys?: Record<string, string>
}

const DEFAULT_HOSTS = ['localhost', '127.0.0.1'] as const
const CONFIG_PATH = path.join(paths.etc, 'network.json')
const VALID_TRUST_LEVELS: TrustLevel[] = ['observe', 'suggest', 'supervised_auto', 'bounded_auto', 'adaptive_auto']

function loadNetworkConfig(): NetworkConfig {
  const defaults: NetworkConfig = {
    allowHosts: new Set<string>(DEFAULT_HOSTS),
    minTrustLevel: 'supervised_auto',
  }

  try {
    if (!fs.existsSync(CONFIG_PATH)) return defaults
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))

    const hosts = Array.isArray(raw?.allowHosts)
      ? raw.allowHosts.map((h: unknown) => String(h || '').trim().toLowerCase()).filter(Boolean)
      : []

    const minTrust = typeof raw?.minTrustLevel === 'string' && VALID_TRUST_LEVELS.includes(raw.minTrustLevel)
      ? (raw.minTrustLevel as TrustLevel)
      : defaults.minTrustLevel

    const apiKeys: Record<string, string> = {}
    if (raw?.apiKeys && typeof raw.apiKeys === 'object') {
      for (const [name, value] of Object.entries(raw.apiKeys)) {
        if (typeof value === 'string' && value.trim()) {
          apiKeys[name] = value.trim()
        }
      }
    }

    return {
      allowHosts: new Set<string>([...DEFAULT_HOSTS, ...hosts]),
      minTrustLevel: minTrust,
      apiKeys,
    }
  } catch (error) {
    console.warn('[http_get] Failed to load network config, using defaults:', (error as Error).message)
    return defaults
  }
}

export const NETWORK_CONFIG = loadNetworkConfig()
const ALLOW_HOSTS = NETWORK_CONFIG.allowHosts

export const manifest: SkillManifest = {
  id: 'http_get',
  name: 'HTTP GET',
  description: 'GET JSON or text from an allowlisted host',
  category: 'network',

  inputs: {
    url: { type: 'string', required: true, description: 'URL to fetch (allowlisted host only)' },
    expectJson: { type: 'boolean', required: false, description: 'Parse response as JSON (default true)' },
    headers: { type: 'object', required: false, description: 'Optional HTTP headers (limited allowlist)' },
  },

  outputs: {
    status: { type: 'number', description: 'HTTP status code' },
    body: { type: 'object', description: 'JSON or text response' },
  },

  risk: 'low',
  cost: 'free',
  minTrustLevel: NETWORK_CONFIG.minTrustLevel,
  requiresApproval: false,
}

const ALLOW_HEADERS = new Set<string>(['accept', 'authorization', 'user-agent', 'x-subscription-token']);

export async function execute(inputs: { url: string, expectJson?: boolean, headers?: Record<string, string> }): Promise<SkillResult> {
  try {
    const u = new URL(inputs.url)
    const hostname = u.hostname.toLowerCase()
    if (!['http:', 'https:'].includes(u.protocol)) {
      return { success: false, error: `Unsupported protocol: ${u.protocol}` }
    }
    if (!ALLOW_HOSTS.has(hostname)) return { success: false, error: `Host not allowed: ${hostname}` }
    const headers: Record<string, string> = {}
    if (inputs.headers && typeof inputs.headers === 'object') {
      for (const [key, value] of Object.entries(inputs.headers)) {
        const name = key.toLowerCase().trim()
        if (!ALLOW_HEADERS.has(name)) continue
        if (typeof value === 'string' && value.trim()) {
          headers[name] = value.trim()
        }
      }
    }
    const res = await fetch(u.toString(), { method: 'GET', headers })
    const expectJson = inputs.expectJson ?? true
    const body = expectJson ? await res.json().catch(async () => ({ text: await res.text() })) : await res.text()
    return { success: true, outputs: { status: res.status, body } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}
