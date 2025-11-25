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
    quantization: string
  }
  advancedSettings?: {
    enableS3Upload: boolean
    enablePreprocessing: boolean
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
    const { method, runpodConfig, trainingConfig, advancedSettings } = body

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

    // Save training config to etc/training.json with GGUF conversion settings
    const trainingConfigPath = path.join(systemPaths.root, 'etc', 'training.json')

    // Build config with GGUF conversion settings for the training script
    const fullConfig = {
      ...trainingConfig,
      gguf_conversion: {
        enabled: true,
        quantization_type: trainingConfig.quantization || 'Q4_K_M',
      }
    }

    fs.writeFileSync(trainingConfigPath, JSON.stringify(fullConfig, null, 2))

    // Save RunPod config if provided (for remote methods)
    if ((method === 'remote-lora' || method === 'fine-tune') && runpodConfig) {
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

    // Create log file for training output
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(systemPaths.logs, 'run', `${agentFileName.replace('.ts', '')}-${timestamp}.log`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logStream = fs.openSync(logPath, 'w');

    // Build command-line arguments for the agent
    const agentArgs: string[] = ['--username', user.username]

    // Add training-specific arguments for fine-tune method
    if (method === 'fine-tune') {
      if (trainingConfig.base_model) {
        agentArgs.push('--base-model', trainingConfig.base_model)
      }
      if (trainingConfig.monthly_training) {
        agentArgs.push('--monthly')
      } else {
        if (trainingConfig.days_recent) {
          agentArgs.push('--days-recent', String(trainingConfig.days_recent))
        }
        if (trainingConfig.old_samples) {
          agentArgs.push('--old-samples', String(trainingConfig.old_samples))
        }
      }
      if (trainingConfig.max_samples) {
        agentArgs.push('--max', String(trainingConfig.max_samples))
      }
    }

    // Spawn the training agent
    const tsxPath = path.join(systemPaths.root, 'apps', 'site', 'node_modules', '.bin', 'tsx')

    // Build environment variables with advanced settings
    const trainingEnv = {
      ...process.env,
      NODE_PATH: [
        path.join(systemPaths.root, 'node_modules'),
        path.join(systemPaths.root, 'packages/cli/node_modules'),
        path.join(systemPaths.root, 'apps/site/node_modules'),
      ].join(':'),
    }

    // Add advanced settings via environment variables
    if (advancedSettings) {
      if (advancedSettings.enableS3Upload === false) {
        // Temporarily disable S3 by clearing credentials
        trainingEnv.METAHUMAN_DISABLE_S3 = '1'
      }
      if (advancedSettings.enablePreprocessing === false) {
        trainingEnv.METAHUMAN_SKIP_PREPROCESSING = '1'
      }
    }

    const child = spawn(tsxPath, [agentPath, ...agentArgs], {
      stdio: ['ignore', logStream, logStream], // stdout and stderr to log file
      cwd: systemPaths.root,
      env: trainingEnv,
      detached: true,
    })

    if (!child.pid) {
      fs.closeSync(logStream);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to spawn training agent',
        } as LaunchResponse),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const agentName = agentFileName.replace('.ts', '')

    // Monitor process exit to detect failures
    child.on('exit', (code, signal) => {
      fs.closeSync(logStream);

      if (code !== 0) {
        // Training failed - log to audit
        audit({
          level: 'error',
          category: 'system',
          event: 'training_failed',
          details: {
            agent: agentName,
            method,
            pid: child.pid,
            username: user.username,
            exitCode: code,
            signal,
            logPath: path.basename(logPath),
            timestamp: new Date().toISOString(),
          },
          actor: user.username,
        })

        console.error(`[training-launch] ❌ Training ${agentName} (PID ${child.pid}) failed with exit code ${code}`)
        console.error(`[training-launch] Check logs: ${logPath}`)
      } else {
        // Training succeeded
        audit({
          level: 'info',
          category: 'system',
          event: 'training_completed',
          details: {
            agent: agentName,
            method,
            pid: child.pid,
            username: user.username,
            logPath: path.basename(logPath),
            timestamp: new Date().toISOString(),
          },
          actor: user.username,
        })

        console.log(`[training-launch] ✅ Training ${agentName} (PID ${child.pid}) completed successfully`)
      }

      // Clean up PID file
      const pidPath = path.join(systemPaths.logs, 'run', `${agentName}.pid`);
      if (fs.existsSync(pidPath)) {
        fs.unlinkSync(pidPath);
      }
    })

    // Store PID for status checking
    const pidPath = path.join(systemPaths.logs, 'run', `${agentName}.pid`);
    fs.writeFileSync(pidPath, String(child.pid), 'utf-8');

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
        runpodConfig: runpodConfig ? { templateId: runpodConfig.templateId, gpuType: runpodConfig.gpuType } : undefined,
        commandArgs: agentArgs,
        logPath: path.basename(logPath),
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
