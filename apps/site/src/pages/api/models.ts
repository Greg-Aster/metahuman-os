import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { paths } from '@metahuman/core'
import { OllamaClient } from '@metahuman/core/ollama'
import { listAdapterDatasets, getActiveAdapter } from '@metahuman/core'

function readAgentConfig(): { model?: string; provider?: string } {
  try {
    const p = path.join(paths.root, 'etc', 'agent.json')
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch { return {} as any }
}

function writeAgentConfig(cfg: any) {
  const p = path.join(paths.root, 'etc', 'agent.json')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2))
}

export const GET: APIRoute = async () => {
  try {
    const agent = readAgentConfig()
    const ollama = new OllamaClient()
    let baseModels: string[] = []
    try {
      const tags = await ollama.listModels()
      baseModels = tags.map(m => m.name)
    } catch {}
    const loras = listAdapterDatasets().map(d => ({ date: d.date, status: d.status, evalScore: d.evalScore }))
    const dualAvailable = fs.existsSync(path.join(paths.out, 'adapters', 'history-merged', 'adapter-merged.gguf'))
    const active = getActiveAdapter()
    return new Response(JSON.stringify({ success: true, agent, baseModels, loras, active, dualAvailable }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json()
    const { baseModel } = body || {}
    if (!baseModel) {
      return new Response(JSON.stringify({ success: false, error: 'baseModel is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    const cfg = { ...readAgentConfig(), model: baseModel }
    writeAgentConfig(cfg)
    return new Response(JSON.stringify({ success: true, agent: cfg }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
