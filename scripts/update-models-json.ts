#!/usr/bin/env npx tsx
/**
 * Update all models.json files with Big Brother, vLLM provider, and cloud models
 *
 * Run with: pnpm tsx scripts/update-models-json.ts
 */

import fs from 'node:fs'
import path from 'node:path'

// Files to update
const MODEL_FILES = [
  '/home/greggles/metahuman/profiles/guest/etc/models.json',
  '/home/greggles/metahuman/profiles/mutant-super-intelligence/etc/models.json',
  '/home/greggles/metahuman/profiles/TheSK/etc/models.json',
  '/home/greggles/metahuman/profiles/Friendly-Robot-Will-Not-Kill-You/etc/models.json',
  '/home/greggles/metahuman/profiles/blueaprilk/etc/models.json',
  '/home/greggles/metahuman/profiles/anonymous/etc/models.json',
  '/media/greggles/STACK/metahuman-profiles/greggles/etc/models.json',
]

// Big Brother model entry
const BIG_BROTHER_MODEL = {
  "provider": "claude-code",
  "model": "claude-sonnet-4",
  "adapters": [],
  "roles": ["orchestrator", "planner", "coder"],
  "description": "Claude Code escalation for complex tasks - use when local models are stuck",
  "options": {
    "contextWindow": 200000,
    "temperature": 0.7,
    "timeout": 300000
  },
  "metadata": {
    "priority": "low",
    "alwaysLoaded": false,
    "estimatedLatency": "slow",
    "source": "big-brother",
    "purpose": "Escalation path for operator when local models fail repeatedly",
    "autoEscalate": true,
    "escalationThreshold": 3
  }
}

// Cloud models
const CLOUD_MODELS = {
  "cloud.qwen3-coder-30b": {
    "provider": "runpod_serverless",
    "model": "Qwen3-Coder-30B-A3B-Instruct-AWQ",
    "adapters": [],
    "roles": ["coder", "orchestrator", "persona", "planner", "curator", "psychotherapist"],
    "description": "Cloud-hosted Qwen3 Coder 30B via RunPod Serverless - high-performance coding and reasoning",
    "options": {
      "contextWindow": 8192,
      "temperature": 0.7,
      "topP": 0.95,
      "repeatPenalty": 1.1
    },
    "metadata": {
      "priority": "high",
      "alwaysLoaded": false,
      "estimatedLatency": "medium",
      "source": "runpod-serverless",
      "endpointTier": "default",
      "coldStartWarning": "First request may take 30-60s if GPU is cold",
      "purpose": "Cloud GPU inference for high-capability tasks"
    }
  },
  "cloud.qwen3-14b": {
    "provider": "runpod_serverless",
    "model": "Qwen3-14B-Instruct",
    "adapters": [],
    "roles": ["orchestrator", "persona", "summarizer", "fallback"],
    "description": "Cloud-hosted Qwen3 14B via RunPod Serverless - balanced performance model",
    "options": {
      "contextWindow": 8192,
      "temperature": 0.7,
      "topP": 0.95,
      "repeatPenalty": 1.1
    },
    "metadata": {
      "priority": "medium",
      "alwaysLoaded": false,
      "estimatedLatency": "fast",
      "source": "runpod-serverless",
      "endpointTier": "14b",
      "coldStartWarning": "First request may take 20-30s if GPU is cold",
      "purpose": "Cloud GPU inference for general tasks"
    }
  }
}

// Provider configs
const PROVIDERS = {
  "runpod_serverless": {
    "baseUrl": "https://api.runpod.ai/v2",
    "timeout": 120000,
    "retries": 2
  },
  "claude-code": {
    "baseUrl": "local",
    "timeout": 300000,
    "retries": 1
  }
}

function updateModelFile(filePath: string): { updated: boolean; changes: string[] } {
  const changes: string[] = []

  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠️  File not found: ${filePath}`)
    return { updated: false, changes: [] }
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const registry = JSON.parse(content)

    // Ensure models object exists
    if (!registry.models) {
      registry.models = {}
    }

    // Ensure providers object exists
    if (!registry.providers) {
      registry.providers = {}
    }

    // Add Big Brother if missing
    if (!registry.models['big-brother.claude']) {
      registry.models['big-brother.claude'] = BIG_BROTHER_MODEL
      changes.push('Added big-brother.claude model')
    }

    // Add cloud models if missing
    for (const [modelId, modelConfig] of Object.entries(CLOUD_MODELS)) {
      if (!registry.models[modelId]) {
        registry.models[modelId] = modelConfig
        changes.push(`Added ${modelId} model`)
      }
    }

    // Add providers if missing
    for (const [providerId, providerConfig] of Object.entries(PROVIDERS)) {
      if (!registry.providers[providerId]) {
        registry.providers[providerId] = providerConfig
        changes.push(`Added ${providerId} provider config`)
      }
    }

    // Write back if changes were made
    if (changes.length > 0) {
      fs.writeFileSync(filePath, JSON.stringify(registry, null, 2))
      return { updated: true, changes }
    }

    return { updated: false, changes: [] }

  } catch (error) {
    console.error(`  ❌ Error processing ${filePath}:`, error)
    return { updated: false, changes: [] }
  }
}

// Main
console.log('🔄 Updating models.json files...\n')

let totalUpdated = 0
let totalChanges = 0

for (const filePath of MODEL_FILES) {
  const shortPath = filePath.replace('/home/greggles/metahuman/', '').replace('/media/greggles/STACK/metahuman-profiles/', 'external:')
  console.log(`📄 ${shortPath}`)

  const result = updateModelFile(filePath)

  if (result.updated) {
    totalUpdated++
    totalChanges += result.changes.length
    for (const change of result.changes) {
      console.log(`   ✅ ${change}`)
    }
  } else if (result.changes.length === 0) {
    console.log(`   ✓ Already up to date`)
  }
  console.log()
}

console.log(`\n📊 Summary: Updated ${totalUpdated} files with ${totalChanges} total changes`)
