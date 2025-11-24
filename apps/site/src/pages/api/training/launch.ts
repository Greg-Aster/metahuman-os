import type { APIRoute } from 'astro'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { systemPaths, getAuthenticatedUser, audit } from '@metahuman/core'

interface LaunchRequest {
  method: 'local-lora' | 'remote-lora' | 'fine-tune'
  runpodConfig?: {
    apiKey: string
    templateId: string
    gpuType: string
  }
  trainingConfig: {
    base_model: string
    num_train_epochs: number
    max_samples: number | null
    monthly_training: boolean
    days_recent: number
    old_samples: number
    lora_rank: number
    learning_rate: number
    per_device_train_batch_size: number
    gradient_accumulation_steps: number
    max_seq_length: number
  }
}

interface LaunchResponse {
  success: boolean
  pid?: number
  agentName?: string
  message?: string
  error?: string
}

/**
 * Launches a training agent based on the selected method.
 * Spawns one of:
 * - full-cycle-local.ts (local LoRA training)
 * - full-cycle.ts (remote LoRA training via RunPod)
 * - fine-tune-cycle.ts (full fine-tuning)
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    // Require authentication
    const user = getAuthenticatedUser(cookies)

    const body: LaunchRequest = await request.json()
    const { method, runpodConfig, trainingConfig } = body

    // Validate method
    if (!['local-lora', 'remote-lora', 'fine-tune'].includes(method)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Invalid training method: ${method}`,
        } as LaunchResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Map method to agent file
    const agentMap = {
      'local-lora': 'full-cycle-local.ts',
      'remote-lora': 'full-cycle.ts',
      'fine-tune': 'fine-tune-cycle.ts',
    }

    const agentFileName = agentMap[method]
    const agentPath = path.join(systemPaths.brain, 'agents', agentFileName)

    // Verify agent file exists
    if (!fs.existsSync(agentPath)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Training agent not found: ${agentFileName}`,
        } as LaunchResponse),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Save training config to etc/training.json
    const trainingConfigPath = path.join(systemPaths.root, 'etc', 'training.json')
    fs.writeFileSync(trainingConfigPath, JSON.stringify(trainingConfig, null, 2))

    // Save RunPod config if provided
    if (method === 'remote-lora' && runpodConfig) {
      const runpodConfigPath = path.join(systemPaths.root, 'etc', 'runpod.json')
      fs.writeFileSync(
        runpodConfigPath,
        JSON.stringify(
          {
            apiKey: runpodConfig.apiKey,
            templateId: runpodConfig.templateId,
            gpuType: runpodConfig.gpuType,
          },
          null,
          2
        )
      )
    }

    // Spawn the training agent
    const tsxPath = path.join(systemPaths.root, 'apps', 'site', 'node_modules', '.bin', 'tsx')

    const child = spawn(tsxPath, [agentPath], {
      stdio: 'ignore',
      cwd: systemPaths.root,
      env: {
        ...process.env,
        NODE_PATH: [
          path.join(systemPaths.root, 'node_modules'),
          path.join(systemPaths.root, 'packages/cli/node_modules'),
          path.join(systemPaths.root, 'apps/site/node_modules'),
        ].join(':'),
      },
      detached: true,
    })

    if (!child.pid) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to spawn training agent',
        } as LaunchResponse),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const agentName = agentFileName.replace('.ts', '')

    audit({
      level: 'info',
      category: 'system',
      event: 'training_started',
      details: {
        agent: agentName,
        method,
        pid: child.pid,
        username: user.username,
        config: trainingConfig,
      },
      actor: user.username,
    })

    child.unref()

    return new Response(
      JSON.stringify({
        success: true,
        pid: child.pid,
        agentName,
        message: `Training agent ${agentName} started with PID ${child.pid}`,
      } as LaunchResponse),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    // Handle auth errors
    if (error instanceof Error && error.message.includes('Authentication required')) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Authentication required',
        } as LaunchResponse),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      } as LaunchResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
