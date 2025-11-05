import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { paths } from '@metahuman/core'
import { getSecurityPolicy } from '../../../../../packages/core/src/security-policy.js'

type EpisodicItem = {
  id: string
  timestamp: string
  content: string
  type?: string
  tags?: string[]
  entities?: string[]
  links?: Array<{ type: string; target: string }>
  relPath: string
  validation?: { status?: 'correct' | 'incorrect'; by?: string; timestamp?: string }
}

type TaskItem = {
  id: string
  title: string
  status: string
  priority?: string
  updated?: string
  relPath: string
}

type CuratedItem = {
  name: string
  relPath: string
}

function listEpisodic(): EpisodicItem[] {
  const items: EpisodicItem[] = []
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(full, 'utf8')
          const obj = JSON.parse(raw)
          if (obj && obj.id && obj.timestamp && obj.content) {
            items.push({
              id: obj.id,
              timestamp: obj.timestamp,
              content: obj.content,
              type: obj.type,
              tags: obj.tags || [],
              entities: Array.isArray(obj.entities) ? obj.entities : [],
              links: Array.isArray(obj.links) ? obj.links : [],
              relPath: path.relative(paths.root, full),
              validation: obj.validation || undefined,
            })
          }
        } catch {}
      }
    }
  }
  walk(paths.episodic)
  items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  return items
}

function listActiveTasks(): TaskItem[] {
  const dir = path.join(paths.tasks, 'active')
  const out: TaskItem[] = []
  if (!fs.existsSync(dir)) return out
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const full = path.join(dir, f)
      const obj = JSON.parse(fs.readFileSync(full, 'utf8'))
      out.push({ id: obj.id, title: obj.title, status: obj.status, priority: obj.priority, updated: obj.updated, relPath: path.relative(paths.root, full) })
    } catch {}
  }
  out.sort((a, b) => (a.updated && b.updated && a.updated < b.updated ? 1 : -1))
  return out
}

function listCurated(): CuratedItem[] {
  const roots = [paths.semantic, paths.procedural]
  const out: CuratedItem[] = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name)
      if (entry.isDirectory()) {
        // Only 1-level deep list: include files in subdir
        for (const e2 of fs.readdirSync(full, { withFileTypes: true })) {
          const fp = path.join(full, e2.name)
          if (e2.isFile() && (fp.endsWith('.md') || fp.endsWith('.mdx') || fp.endsWith('.txt'))) {
            out.push({ name: e2.name, relPath: path.relative(paths.root, fp) })
          }
        }
      } else if (entry.isFile() && (full.endsWith('.md') || full.endsWith('.mdx') || full.endsWith('.txt'))) {
        out.push({ name: entry.name, relPath: path.relative(paths.root, full) })
      }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export const GET: APIRoute = async (context) => {
  try {
    // Require authentication to access memory data
    const policy = getSecurityPolicy(context);
    if (!policy.canReadMemory()) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to access memories' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const episodic = listEpisodic()
    const reflections = episodic.filter(item => item.type === 'reflection')
    const dreams = episodic.filter(item => item.type === 'dream')
    const episodicFiltered = episodic.filter(item => item.type !== 'reflection' && item.type !== 'dream')
    const tasks = listActiveTasks()
    const curated = listCurated()
    return new Response(JSON.stringify({
      episodic: episodicFiltered,
      reflections,
      dreams,
      tasks,
      curated,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
