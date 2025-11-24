import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { getAuthenticatedUser, getProfilePaths } from '@metahuman/core'

interface DatasetStats {
  totalMemories: number
  episodicMemories: number
  therapySessions: number
  chatConversations: number
  recentMemories: number // Last 30 days
  oldestMemory: string | null
  newestMemory: string | null
  cognitiveModeCounts: {
    dual: number
    agent: number
    emulation: number
  }
  estimatedTrainingSamples: number
}

/**
 * Returns statistics about available training data.
 * Scans episodic memories, therapy sessions, and chat conversations.
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies)
    const profilePaths = getProfilePaths(user.username)

    const stats: DatasetStats = {
      totalMemories: 0,
      episodicMemories: 0,
      therapySessions: 0,
      chatConversations: 0,
      recentMemories: 0,
      oldestMemory: null,
      newestMemory: null,
      cognitiveModeCounts: {
        dual: 0,
        agent: 0,
        emulation: 0,
      },
      estimatedTrainingSamples: 0,
    }

    const now = Date.now()
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

    // 1. Count episodic memories
    const episodicPath = path.join(profilePaths.root, 'memory', 'episodic')
    if (fs.existsSync(episodicPath)) {
      const years = fs.readdirSync(episodicPath).filter(name => /^\d{4}$/.test(name))

      for (const year of years) {
        const yearPath = path.join(episodicPath, year)
        const files = fs.readdirSync(yearPath).filter(f => f.endsWith('.json'))

        for (const file of files) {
          try {
            const content = fs.readFileSync(path.join(yearPath, file), 'utf-8')
            const memory = JSON.parse(content)

            stats.episodicMemories++

            // Track cognitive mode
            const mode = memory.metadata?.cognitiveMode || 'emulation'
            if (mode in stats.cognitiveModeCounts) {
              stats.cognitiveModeCounts[mode as keyof typeof stats.cognitiveModeCounts]++
            }

            // Track timestamps
            const timestamp = new Date(memory.timestamp).getTime()
            if (!stats.oldestMemory || timestamp < new Date(stats.oldestMemory).getTime()) {
              stats.oldestMemory = memory.timestamp
            }
            if (!stats.newestMemory || timestamp > new Date(stats.newestMemory).getTime()) {
              stats.newestMemory = memory.timestamp
            }

            // Count recent memories
            if (timestamp > thirtyDaysAgo) {
              stats.recentMemories++
            }
          } catch (err) {
            // Skip invalid files
          }
        }
      }
    }

    // 2. Count therapy sessions
    const therapyPath = path.join(profilePaths.persona, 'therapy')
    if (fs.existsSync(therapyPath)) {
      const files = fs.readdirSync(therapyPath).filter(
        f => f.startsWith('session-') && f.endsWith('.json')
      )
      stats.therapySessions = files.length
    }

    // 3. Count chat conversations (JSONL files in training directory)
    const trainingPath = path.join(profilePaths.root, 'memory', 'training')
    if (fs.existsSync(trainingPath)) {
      function countConversationsRecursive(dir: string): number {
        let count = 0
        const files = fs.readdirSync(dir)

        for (const file of files) {
          const filePath = path.join(dir, file)
          const stat = fs.statSync(filePath)

          if (stat.isDirectory()) {
            count += countConversationsRecursive(filePath)
          } else if (file.endsWith('.jsonl')) {
            // Count lines in JSONL file
            try {
              const content = fs.readFileSync(filePath, 'utf-8')
              const lines = content.trim().split('\n').filter(l => l.trim())
              count += lines.length
            } catch (err) {
              // Skip invalid files
            }
          }
        }

        return count
      }

      stats.chatConversations = countConversationsRecursive(trainingPath)
    }

    // Calculate total and estimated samples
    stats.totalMemories = stats.episodicMemories + stats.therapySessions + stats.chatConversations

    // Rough estimate: Each memory/conversation can generate 1-3 training samples
    // Conservative estimate: 1.5 samples per memory
    stats.estimatedTrainingSamples = Math.floor(stats.totalMemories * 1.5)

    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    // If not authenticated, return 401
    if (error instanceof Error && error.message.includes('Authentication required')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
