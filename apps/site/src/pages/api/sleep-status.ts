import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { paths, isLocked } from '@metahuman/core'

type SleepState = 'awake' | 'sleeping' | 'dreaming'

function determineState(): SleepState {
  if (isLocked('agent-dreamer')) return 'dreaming'
  if (isLocked('service-sleep')) return 'sleeping'
  return 'awake'
}

export const GET: APIRoute = async () => {
  try {
    const status = determineState()
    let learningsFile: string | null = null
    let learningsContent: string | null = null

    const overnightDir = paths.proceduralOvernight
    if (fs.existsSync(overnightDir)) {
      const files = fs.readdirSync(overnightDir)
        .filter(file => file.startsWith('overnight-learnings-') && file.endsWith('.md'))
        .sort()
        .reverse()

      if (files.length > 0) {
        learningsFile = files[0]
        const filepath = path.join(overnightDir, learningsFile)
        learningsContent = fs.readFileSync(filepath, 'utf-8')
      }
    }

    const payload = {
      status,
      learningsFile,
      learningsContent,
      lastChecked: new Date().toISOString(),
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[sleep-status] Failed to build response:', error)
    return new Response(JSON.stringify({ error: 'Failed to read sleep status' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
