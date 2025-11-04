/**
 * summarize_file Skill
 * Summarize a text/markdown file using the LLM
 */

import fs from 'node:fs'
import path from 'node:path'
import { paths, llm } from '../../packages/core/src/index'
import { SkillManifest, SkillResult, isPathAllowed } from '../../packages/core/src/skills'

export const manifest: SkillManifest = {
  id: 'summarize_file',
  name: 'Summarize File',
  description: 'Generate a concise summary of a text/markdown file',
  category: 'memory',

  inputs: {
    path: { type: 'string', required: true, description: 'File path (project-relative or absolute)' },
    maxChars: { type: 'number', required: false, description: 'Max chars to read (default 8000)' },
  },

  outputs: {
    summary: { type: 'string', description: 'Concise summary' },
  },

  risk: 'low',
  cost: 'cheap',
  minTrustLevel: 'observe',
  requiresApproval: false,
  allowedDirectories: ['.', 'docs/', 'memory/', 'out/', 'brain/', 'packages/', 'apps/', 'persona/', 'etc/'],
}

export async function execute(inputs: { path: string, maxChars?: number }): Promise<SkillResult> {
  try {
    const abs = path.isAbsolute(inputs.path) ? path.resolve(inputs.path) : path.resolve(paths.root, inputs.path)
    if (!isPathAllowed(abs, manifest.allowedDirectories!)) return { success: false, error: `Path not allowed: ${abs}` }
    const raw = fs.readFileSync(abs, 'utf-8')
    const max = Math.max(100, Math.min(inputs.maxChars ?? 8000, 30000))
    const text = raw.slice(0, max)
    const system = 'You are a helpful assistant that writes concise summaries with key points.'
    const prompt = `Summarize the following content in 5-8 bullet points with a one-line headline.\n\n---\n${text}`
    const resp = await llm.generate([
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ], 'ollama', { temperature: 0.2 })
    return { success: true, outputs: { summary: resp.content } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

