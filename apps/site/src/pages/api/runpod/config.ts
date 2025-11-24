import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { systemPaths, getAuthenticatedUser } from '@metahuman/core'

interface RunpodConfig {
  apiKey: string | null
  templateId: string | null
  gpuType: string | null
}

/**
 * Returns the existing RunPod configuration for owner users.
 * Checks both .env file and etc/runpod.json.
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies)

    // Only owner can access RunPod config
    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Owner role required' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const config: RunpodConfig = {
      apiKey: null,
      templateId: null,
      gpuType: null,
    }

    // 1. Check environment variables
    if (process.env.RUNPOD_API_KEY) {
      config.apiKey = process.env.RUNPOD_API_KEY
    }
    if (process.env.RUNPOD_GPU_TYPE) {
      config.gpuType = process.env.RUNPOD_GPU_TYPE
    }
    if (process.env.RUNPOD_TEMPLATE_ID) {
      config.templateId = process.env.RUNPOD_TEMPLATE_ID
    }

    // 2. Check etc/runpod.json
    const configPath = path.join(systemPaths.root, 'etc', 'runpod.json')
    if (fs.existsSync(configPath)) {
      try {
        const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        config.apiKey = config.apiKey || fileConfig.apiKey || null
        config.templateId = fileConfig.templateId || null
        config.gpuType = fileConfig.gpuType || null
      } catch (err) {
        // Invalid JSON, ignore
      }
    }

    // 3. Check .env file in root directory
    const envPath = path.join(systemPaths.root, '.env')
    if (fs.existsSync(envPath)) {
      try {
        const envContent = fs.readFileSync(envPath, 'utf-8')
        const lines = envContent.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (!config.apiKey && trimmed.startsWith('RUNPOD_API_KEY=')) {
            const value = trimmed.substring('RUNPOD_API_KEY='.length).trim()
            // Remove quotes if present
            config.apiKey = value.replace(/^["']|["']$/g, '')
          }
          if (!config.gpuType && trimmed.startsWith('RUNPOD_GPU_TYPE=')) {
            const value = trimmed.substring('RUNPOD_GPU_TYPE='.length).trim()
            // Remove quotes if present
            config.gpuType = value.replace(/^["']|["']$/g, '')
          }
          if (!config.templateId && trimmed.startsWith('RUNPOD_TEMPLATE_ID=')) {
            const value = trimmed.substring('RUNPOD_TEMPLATE_ID='.length).trim()
            // Remove quotes if present
            config.templateId = value.replace(/^["']|["']$/g, '')
          }
        }
      } catch (err) {
        // Can't read .env, ignore
      }
    }

    return new Response(JSON.stringify(config), {
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
