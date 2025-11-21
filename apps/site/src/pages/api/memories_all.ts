import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { getUserOrAnonymous, getProfilePaths, systemPaths } from '@metahuman/core'
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

type CuriosityQuestion = {
  id: string
  question: string
  askedAt: string
  status: 'pending' | 'answered'
  relPath: string
  seedMemories?: string[]
  answeredAt?: string
}

function listEpisodic(profilePaths: ReturnType<typeof getProfilePaths>): EpisodicItem[] {
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
              relPath: path.relative(systemPaths.root, full),
              validation: obj.validation || undefined,
            })
          }
        } catch {}
      }
    }
  }
  walk(profilePaths.episodic)
  items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  return items
}

function listActiveTasks(profilePaths: ReturnType<typeof getProfilePaths>): TaskItem[] {
  const dir = path.join(profilePaths.tasks, 'active')
  const out: TaskItem[] = []
  if (!fs.existsSync(dir)) return out
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const full = path.join(dir, f)
      const obj = JSON.parse(fs.readFileSync(full, 'utf8'))
      out.push({ id: obj.id, title: obj.title, status: obj.status, priority: obj.priority, updated: obj.updated, relPath: path.relative(systemPaths.root, full) })
    } catch {}
  }
  out.sort((a, b) => (a.updated && b.updated && a.updated < b.updated ? 1 : -1))
  return out
}

function listCurated(profilePaths: ReturnType<typeof getProfilePaths>): CuratedItem[] {
  const roots = [profilePaths.semantic, profilePaths.procedural]
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
            out.push({ name: e2.name, relPath: path.relative(systemPaths.root, fp) })
          }
        }
      } else if (entry.isFile() && (full.endsWith('.md') || full.endsWith('.mdx') || full.endsWith('.txt'))) {
        out.push({ name: entry.name, relPath: path.relative(systemPaths.root, full) })
      }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

function listCuriosityQuestions(profilePaths: ReturnType<typeof getProfilePaths>): CuriosityQuestion[] {
  const out: CuriosityQuestion[] = []
  const questionsDir = path.join(profilePaths.curiosity, 'questions')

  if (!fs.existsSync(questionsDir)) {
    return out
  }

  const dirs = [
    { dir: path.join(questionsDir, 'pending'), status: 'pending' as const },
    { dir: path.join(questionsDir, 'answered'), status: 'answered' as const }
  ]

  for (const { dir, status } of dirs) {
    if (!fs.existsSync(dir)) continue

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue

      try {
        const fullPath = path.join(dir, file)
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))

        out.push({
          id: content.id,
          question: content.question,
          askedAt: content.askedAt,
          status,
          relPath: path.relative(systemPaths.root, fullPath),
          seedMemories: content.seedMemories,
          answeredAt: content.answeredAt
        })
      } catch (err) {
        console.warn(`Failed to load curiosity question ${file}:`, err)
      }
    }
  }

  // Sort by askedAt timestamp (newest first)
  out.sort((a, b) => new Date(b.askedAt).getTime() - new Date(a.askedAt).getTime())
  return out
}

const handler: APIRoute = async ({ cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies)

    // Anonymous users cannot access memory data
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required. Please log in to view memories.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require authentication to access memory data
    const policy = getSecurityPolicy({ cookies });
    if (!policy.canReadMemory) {
      return new Response(
        JSON.stringify({ error: 'Access not permitted. Please log in to view memories.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const profilePaths = getProfilePaths(user.username);

    const episodic = listEpisodic(profilePaths)
    const reflections = episodic.filter(item => item.type === 'reflection')
    const dreams = episodic.filter(item => item.type === 'dream')
    const episodicFiltered = episodic.filter(item => item.type !== 'reflection' && item.type !== 'dream')
    const tasks = listActiveTasks(profilePaths)
    const curated = listCurated(profilePaths)
    const curiosityQuestions = listCuriosityQuestions(profilePaths)

    return new Response(JSON.stringify({
      episodic: episodicFiltered,
      reflections,
      dreams,
      tasks,
      curated,
      curiosityQuestions,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

// MIGRATED: explicit authentication (auth required for memory overview)
export const GET = handler
