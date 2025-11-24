import type { APIRoute } from 'astro'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { systemPaths } from '@metahuman/core'

const execAsync = promisify(exec)

interface GPUInfo {
  hasLocalGPU: boolean
  gpuModel: string | null
  vramGB: number | null
  hasUnsloth: boolean
  hasRunpodKey: boolean
  hasPreviousModel: boolean
}

/**
 * Detects system capabilities for training:
 * - Local GPU (via nvidia-smi)
 * - GPU model and VRAM
 * - Unsloth installation
 * - RunPod API key
 * - Previous training models
 */
export const GET: APIRoute = async () => {
  const info: GPUInfo = {
    hasLocalGPU: false,
    gpuModel: null,
    vramGB: null,
    hasUnsloth: false,
    hasRunpodKey: false,
    hasPreviousModel: false,
  }

  // 1. Check for NVIDIA GPU
  try {
    const { stdout } = await execAsync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits')
    const lines = stdout.trim().split('\n')
    if (lines.length > 0) {
      const [gpuModel, vramMB] = lines[0].split(', ')
      info.hasLocalGPU = true
      info.gpuModel = gpuModel.trim()
      info.vramGB = Math.round(parseFloat(vramMB) / 1024)
    }
  } catch (e) {
    // nvidia-smi not found or failed, no GPU
  }

  // 2. Check for unsloth Python package
  try {
    await execAsync('python3 -c "import unsloth"')
    info.hasUnsloth = true
  } catch (e) {
    // unsloth not installed
  }

  // 3. Check for RunPod API key
  if (process.env.RUNPOD_API_KEY) {
    info.hasRunpodKey = true
  } else {
    // Check if saved in config
    try {
      const configPath = path.join(systemPaths.root, 'etc', 'runpod.json')
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        if (config.apiKey) {
          info.hasRunpodKey = true
        }
      }
    } catch (e) {
      // No config file
    }
  }

  // 4. Check for previous training models
  try {
    const { loadModelRegistry } = await import('@metahuman/core')
    const registry = loadModelRegistry()

    // Check if there are any fine-tuned models in the registry
    const hasFinetuned = Object.keys(registry.models || {}).some(key =>
      key.includes('finetune') || key.includes('lora') || key.includes('adapter')
    )

    // Also check if there's an active adapter
    const hasActiveAdapter = registry.globalSettings?.useAdapter &&
                            registry.globalSettings?.activeAdapter?.status === 'loaded'

    info.hasPreviousModel = hasFinetuned || hasActiveAdapter
  } catch (e) {
    // Model registry error, assume no previous models
  }

  return new Response(JSON.stringify(info), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
