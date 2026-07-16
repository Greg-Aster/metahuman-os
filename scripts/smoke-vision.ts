#!/usr/bin/env tsx

import fs from 'node:fs'
import path from 'node:path'
import { withUserContext } from '../packages/core/src/context.js'
import { loadBackendConfig } from '../packages/core/src/llm-backend.js'
import { callLLM } from '../packages/core/src/model-router.js'
import { resolveModelForCognitiveMode } from '../packages/core/src/model-resolver.js'
import { getUsers } from '../packages/core/src/users.js'

const args = process.argv.slice(2)

function option(name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function usage(exitCode = 2): never {
  console.error([
    'Usage:',
    '  pnpm smoke:vision -- --user <username> --image <jpeg|png|webp> [--prompt <text>]',
    '  pnpm smoke:vision -- --user <username> --resolve-only',
    '',
    'This smoke uses the normal Environment Mode persona assignment, model resolver,',
    'active backend, and provider bridge. It never selects a model or backend itself.',
  ].join('\n'))
  process.exit(exitCode)
}

function imageMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    default:
      throw new Error('Smoke image must be JPEG, PNG, or WebP.')
  }
}

async function main(): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) usage(0)

  const username = option('--user')
  if (!username) usage()

  const user = getUsers().find(candidate => candidate.username === username)
  if (!user) throw new Error(`Authenticated user not found: ${username}`)

  const resolved = resolveModelForCognitiveMode('environment', 'persona', username)
  const backend = loadBackendConfig()

  if (args.includes('--resolve-only')) {
    console.log(JSON.stringify({
      ready: resolved.capabilities.includes('image'),
      cognitiveMode: 'environment',
      role: 'persona',
      modelId: resolved.id,
      provider: resolved.provider,
      model: resolved.model,
      capabilities: resolved.capabilities,
      activeBackend: backend.activeBackend,
    }, null, 2))
    return
  }

  const imagePath = option('--image')
  if (!imagePath) usage()

  const absoluteImagePath = path.resolve(imagePath)
  const mimeType = imageMimeType(absoluteImagePath)
  const base64 = fs.readFileSync(absoluteImagePath).toString('base64')
  const prompt = option('--prompt') || 'Describe this image briefly and identify the most important visible object.'

  const response = await withUserContext(
    { userId: user.id, username: user.username, role: user.role },
    () => callLLM({
      role: 'persona',
      cognitiveMode: 'environment',
      userId: user.username,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      }],
    }),
  )

  console.log(JSON.stringify({
    ok: true,
    cognitiveMode: 'environment',
    role: response.role,
    modelId: response.modelId,
    provider: response.provider,
    model: response.model,
    response: response.content,
  }, null, 2))
}

main().catch(error => {
  console.error(`[smoke-vision] ${(error as Error).message}`)
  process.exitCode = 1
})
