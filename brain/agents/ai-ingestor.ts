#!/usr/bin/env node
/**
 * AI Ingestor Agent — Classifies and summarizes inbox files before saving
 * - Reads raw files from `memory/inbox/`
 * - Uses local LLM (Ollama) to classify {type,title,summary,tags,entities}
 * - Saves compact episodic events (content = summary)
 * - Links back to source filename; archives originals to `memory/inbox/_archive/YYYY-MM-DD/`
 */

import fs from 'node:fs'
import path from 'node:path'
import { paths, audit, auditAction, captureEvent, acquireLock, isLocked, callLLMJSON } from '@metahuman/core'

const INBOX = paths.inbox
const ARCHIVE_ROOT = paths.inboxArchive

function ensureDirs() {
  fs.mkdirSync(INBOX, { recursive: true })
  fs.mkdirSync(ARCHIVE_ROOT, { recursive: true })
}

function readFileAsText(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  try {
    if (ext === '.json') {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (typeof data === 'string') return data
      if (data && typeof data.content === 'string') return data.content
      return JSON.stringify(data, null, 2)
    }
    return fs.readFileSync(filePath, 'utf8')
  } catch (e) {
    throw new Error(`Failed to read ${path.basename(filePath)}: ${(e as Error).message}`)
  }
}

async function classifyAndSummarize(text: string): Promise<{
  type: 'conversation' | 'journal' | 'search' | 'fragment' | 'observation' | 'inner_dialogue' | 'reflection'
  title: string
  summary: string
  tags: string[]
  entities: string[]
  quality: number
}> {
  const sys = `You are a data ingestion assistant. Classify and summarize text.
Return strict JSON with keys: type, title, summary, tags, entities, quality.
Types: conversation | journal | search | fragment | observation | inner_dialogue | reflection.
Rules:
- title: short (≤10 words)
- summary: 1–3 sentences, faithful, compact
- tags: ≤6 lowercase keywords
- entities: names/orgs/places if present
- quality: 0..1 (skip spam/garbage with <0.4)`
  const user = `Text:\n---\n${text}\n---`;
  try {
    const json = await callLLMJSON<any>(
      'curator',
      [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      { temperature: 0.2, maxTokens: 512 }
    )

    // Basic sanitization
    const type = (json?.type || 'observation').toString().trim()
    const title = (json?.title || '').toString().trim().slice(0, 120)
    const summary = (json?.summary || '').toString().trim()
    const tags = Array.isArray(json?.tags) ? json.tags.map((t: any) => String(t).toLowerCase()).slice(0, 8) : []
    const entities = Array.isArray(json?.entities) ? json.entities.map((e: any) => String(e)).slice(0, 12) : []
    const quality = Math.max(0, Math.min(1, Number(json?.quality ?? 0.7)))
    return { type, title, summary, tags, entities, quality }
  } catch (e) {
    // Fallback: treat as observation with trimmed content
    const first = text.trim().split(/\n+/)[0].slice(0, 80)
    return { type: 'observation', title: first || 'note', summary: text.slice(0, 400), tags: ['ingested'], entities: [], quality: 0.6 }
  }
}

async function generateOutlineHighlights(text: string): Promise<{ outline: string[]; highlights: string[] }> {
  const sys = `You create outlines and highlights.
Return strict JSON: { outline: string[], highlights: string[] }.
Rules: outline 5-12 items max; highlights 5-12 bullets; no markdown.`
  const user = `Text to organize:\n---\n${text}\n---`
  try {
    const json = await callLLMJSON<any>(
      'curator',
      [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      { temperature: 0.2, maxTokens: 700 }
    )
    const outline = Array.isArray(json?.outline) ? json.outline.map((s: any) => String(s)).slice(0, 20) : []
    const highlights = Array.isArray(json?.highlights) ? json.highlights.map((s: any) => String(s)).slice(0, 30) : []
    return { outline, highlights }
  } catch {
    return { outline: [], highlights: [] }
  }
}

function loadIngestorConfig(): { mode: 'organize' | 'summarize' | 'hybrid'; longFileThresholdChars: number; curatedDir: string } {
  try {
    const p = path.join(paths.etc, 'ingestor.json')
    if (fs.existsSync(p)) {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'))
      return {
        mode: (cfg.mode || 'organize'),
        longFileThresholdChars: Number(cfg.longFileThresholdChars || 4000),
        curatedDir: String(cfg.curatedDir || 'memory/semantic/curated'),
      }
    }
  } catch {}
  return { mode: 'organize', longFileThresholdChars: 4000, curatedDir: 'memory/semantic/curated' }
}

function slugify(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'doc' }

async function ingestFileAI(filePath: string) {
  const fileName = path.basename(filePath)
  const raw = readFileAsText(filePath)

  const cfg = loadIngestorConfig()
  const res = await classifyAndSummarize(raw)

  if (res.quality < 0.4) {
    auditAction({ skill: 'ai-ingestor:skip', inputs: { file: fileName }, success: true, output: { reason: 'low_quality', quality: res.quality } })
    return { created: 0 }
  }

  const long = raw.length >= cfg.longFileThresholdChars
  if (cfg.mode === 'organize' && long) {
    // Curate: store raw, add meta/outline/highlights sidecars, create index event
    const curatedRoot = path.isAbsolute(cfg.curatedDir) ? cfg.curatedDir : path.join(paths.root, cfg.curatedDir)
    fs.mkdirSync(curatedRoot, { recursive: true })
    const base = `${new Date().toISOString().slice(0,10)}-${slugify(res.title || fileName)}`
    const rawPath = path.join(curatedRoot, `${base}.txt`)
    fs.writeFileSync(rawPath, raw, 'utf-8')

    // Outline + highlights
    const oh = await generateOutlineHighlights(raw)
    const meta = {
      title: res.title || fileName,
      abstract: res.summary || raw.slice(0, 400),
      tags: res.tags || [],
      entities: res.entities || [],
      source: fileName,
    }
    fs.writeFileSync(path.join(curatedRoot, `${base}.meta.json`), JSON.stringify(meta, null, 2))
    fs.writeFileSync(path.join(curatedRoot, `${base}.outline.json`), JSON.stringify(oh.outline, null, 2))
    fs.writeFileSync(path.join(curatedRoot, `${base}.highlights.json`), JSON.stringify(oh.highlights, null, 2))

    // Index event
    const content = meta.abstract
    const tags = Array.from(new Set([...(res.tags || []), 'ingested', 'ai', 'curated']))
    const links = [{ type: 'source', target: fileName }, { type: 'curated', target: path.relative(paths.root, rawPath) }]
    const type = 'observation' as any
    const filepath = captureEvent(content, { type, tags, entities: res.entities || [], links })
    auditAction({ skill: 'ai-ingestor:curated', inputs: { file: fileName }, success: true, output: { path: filepath, curated: path.relative(paths.root, rawPath) } })
  } else {
    // Short doc or summarize mode: compact event
    const content = res.summary || raw.slice(0, 400)
    const tags = Array.from(new Set([...(res.tags || []), 'ingested', 'ai']))
    const links = [{ type: 'source', target: fileName }]
    const type = res.type as any
    const filepath = captureEvent(content, { type, tags, entities: res.entities || [], links })
    auditAction({ skill: 'ai-ingestor:capture', inputs: { file: fileName }, success: true, output: { path: filepath, type, tags } })
  }

  // Archive original
  const date = new Date().toISOString().slice(0, 10)
  const archiveDir = path.join(ARCHIVE_ROOT, date)
  fs.mkdirSync(archiveDir, { recursive: true })
  const dest = path.join(archiveDir, fileName)
  fs.renameSync(filePath, dest)
  auditAction({ skill: 'ai-ingestor:archive', inputs: { source: fileName }, success: true, output: { archivePath: dest } })
  return { created: 1 }
}

async function main() {
  try {
    if (isLocked('agent-ai-ingestor')) {
      console.log('[ai-ingestor] Another instance is already running. Exiting.')
      return
    }
    acquireLock('agent-ai-ingestor')
  } catch {
    console.log('[ai-ingestor] Failed to acquire lock. Exiting.')
    return
  }

  ensureDirs()
  audit({ level: 'info', category: 'action', event: 'agent_started', details: { agent: 'ai-ingestor' }, actor: 'agent' })

  const entries = fs.existsSync(INBOX) ? fs.readdirSync(INBOX, { withFileTypes: true }) : []
  const files = entries.filter(e => e.isFile()).map(e => path.join(INBOX, e.name))
  if (files.length === 0) { console.log('Inbox is empty.'); return }

  let total = 0
  for (const file of files) {
    try {
      const { created } = await ingestFileAI(file)
      if (created) { total += created; console.log(`✓ Ingested (AI): ${path.basename(file)}`) }
      else { console.log(`• Skipped (low quality): ${path.basename(file)}`) }
    } catch (e) {
      console.error(`✗ Failed: ${path.basename(file)} — ${(e as Error).message}`)
      auditAction({ skill: 'ai-ingestor:capture', inputs: { file: path.basename(file) }, success: false, error: (e as Error).message })
    }
  }

  audit({ level: 'info', category: 'action', event: 'agent_completed', details: { agent: 'ai-ingestor', processed: files.length, created: total }, actor: 'agent' })
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1) })
