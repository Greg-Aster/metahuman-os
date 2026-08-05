/** Provider-specific invocation and event parsing for the shared Big Brother terminal. */

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadFreshOperatorConfig } from './config.js'
import type { EscalationOptions, ReasoningStep } from './escalation-backend.js'
import { DEFAULT_PROVIDER_IMAGE_POLICY, parseProviderImageDataUrl } from './providers/types.js'
import { loadToolExecutorConfig, type CLIBackendConfig } from './tool-executor-config.js'

export type TerminalBigBrotherProvider = 'claude-code' | 'codex'

export interface BigBrotherSessionResult {
  success: boolean
  output: string
  error?: string
  executionTime: number
  metadata: Record<string, unknown>
}

export interface ParsedBigBrotherEvent {
  displayLines: string[]
  finalText?: string
  reasoningSteps: ReasoningStep[]
}

export interface BigBrotherCLIInvocation {
  command: string
  args: string[]
  stdin: string
  resultFile?: string
  tempDir: string
  timeout: number
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (typeof block === 'string') return block
      if (!block || typeof block !== 'object') return ''
      const value = block as Record<string, unknown>
      if (typeof value.text === 'string') return value.text
      return typeof value.content === 'string' ? value.content : ''
    })
    .filter(Boolean)
    .join('\n')
}

function reasoningStep(type: ReasoningStep['type'], content: string, toolName?: string): ReasoningStep {
  return { type, content, toolName, timestamp: new Date().toISOString() }
}

export function parseBigBrotherTerminalEvent(
  provider: TerminalBigBrotherProvider,
  line: string,
): ParsedBigBrotherEvent {
  const trimmed = line.trim()
  if (!trimmed) return { displayLines: [], reasoningSteps: [] }

  let event: Record<string, any>
  try {
    event = JSON.parse(trimmed)
  } catch {
    return { displayLines: [line], reasoningSteps: [] }
  }

  if (provider === 'claude-code') {
    if (event.type === 'system' && event.subtype === 'init') {
      return { displayLines: [`[Claude] Session ${event.session_id || 'initialized'}`], reasoningSteps: [] }
    }

    if (event.type === 'assistant' || event.type === 'user') {
      const blocks = Array.isArray(event.message?.content) ? event.message.content : [event.message?.content]
      const displayLines: string[] = []
      const reasoningSteps: ReasoningStep[] = []
      const answerParts: string[] = []

      for (const block of blocks) {
        if (typeof block === 'string') {
          displayLines.push(block)
          if (event.type === 'assistant') answerParts.push(block)
          continue
        }
        if (!block || typeof block !== 'object') continue
        if (block.type === 'text' && typeof block.text === 'string') {
          displayLines.push(block.text)
          if (event.type === 'assistant') answerParts.push(block.text)
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          displayLines.push(`💭 ${block.thinking}`)
          reasoningSteps.push(reasoningStep('thought', block.thinking))
        } else if (block.type === 'tool_use') {
          const toolName = String(block.name || 'tool')
          const input = JSON.stringify(block.input || {}, null, 2)
          displayLines.push(`🔧 ${toolName}\n${input}`)
          reasoningSteps.push(reasoningStep('tool_use', input.slice(0, 1000), toolName))
        } else if (block.type === 'tool_result') {
          displayLines.push(`↳ ${textFromContent(block.content)}`)
        }
      }

      const finalText = answerParts.join('\n').trim()
      return { displayLines, finalText: finalText || undefined, reasoningSteps }
    }

    if (event.type === 'result') {
      const finalText = typeof event.result === 'string' ? event.result.trim() : ''
      const error = typeof event.error === 'string' ? event.error : ''
      return {
        displayLines: error
          ? [`❌ ${error}`]
          : [`[Claude] ${event.subtype === 'success' ? 'Completed' : event.subtype || 'Finished'}`],
        finalText: finalText || undefined,
        reasoningSteps: [],
      }
    }

    return { displayLines: [`[Claude] ${event.type || 'event'}`], reasoningSteps: [] }
  }

  // Codex has shipped both msg-based and item-based JSONL schemas. Schema
  // drift stays here instead of creating another backend execution path.
  const legacyMessage = event.msg
  if (legacyMessage && typeof legacyMessage === 'object') {
    if (legacyMessage.type === 'agent_reasoning' && typeof legacyMessage.text === 'string') {
      return {
        displayLines: [`💭 ${legacyMessage.text}`],
        reasoningSteps: [reasoningStep('thought', legacyMessage.text)],
      }
    }
    if (legacyMessage.type === 'agent_message' && typeof legacyMessage.message === 'string') {
      return {
        displayLines: [legacyMessage.message],
        finalText: legacyMessage.message.trim(),
        reasoningSteps: [],
      }
    }
    if (legacyMessage.type === 'tool_use') {
      const toolName = String(legacyMessage.tool || 'tool')
      const content = String(legacyMessage.input || '')
      return {
        displayLines: [`🔧 ${toolName}\n${content}`],
        reasoningSteps: [reasoningStep('tool_use', content, toolName)],
      }
    }
  }

  const item = event.item && typeof event.item === 'object' ? event.item : null
  if (item) {
    const itemType = String(item.type || 'item')
    if (itemType === 'agent_message') {
      const message = String(item.text || item.message || textFromContent(item.content)).trim()
      return { displayLines: message ? [message] : [], finalText: message || undefined, reasoningSteps: [] }
    }
    if (itemType === 'reasoning') {
      const text = String(item.text || item.summary || textFromContent(item.content)).trim()
      return {
        displayLines: text ? [`💭 ${text}`] : [],
        reasoningSteps: text ? [reasoningStep('thought', text)] : [],
      }
    }
    if (itemType === 'command_execution') {
      const command = String(item.command || 'command')
      const output = String(item.aggregated_output || item.output || '').trim()
      return {
        displayLines: [`$ ${command}${output ? `\n${output}` : ''}`],
        reasoningSteps: [reasoningStep('tool_use', command, 'shell')],
      }
    }
    if (itemType.includes('tool')) {
      const toolName = String(item.name || item.tool || itemType)
      const content = JSON.stringify(item.arguments || item.input || {}, null, 2)
      return {
        displayLines: [`🔧 ${toolName}\n${content}`],
        reasoningSteps: [reasoningStep('tool_use', content, toolName)],
      }
    }
  }

  if (event.type === 'thread.started') {
    return { displayLines: [`[Codex] Thread ${event.thread_id || 'started'}`], reasoningSteps: [] }
  }
  if (event.type === 'turn.started') return { displayLines: ['[Codex] Working…'], reasoningSteps: [] }
  if (event.type === 'turn.completed') return { displayLines: ['[Codex] Completed'], reasoningSteps: [] }
  if (event.type === 'error') {
    return { displayLines: [`❌ ${event.message || event.error || 'Codex error'}`], reasoningSteps: [] }
  }
  return { displayLines: [`[Codex] ${event.type || 'event'}`], reasoningSteps: [] }
}

export function providerLabel(provider: TerminalBigBrotherProvider): string {
  return provider === 'claude-code' ? 'Claude Code' : 'Codex'
}

function providerCommand(provider: TerminalBigBrotherProvider, username?: string): string {
  const config = loadToolExecutorConfig(username)
  const backend = config.backends[provider] as CLIBackendConfig
  return backend.command || (provider === 'claude-code' ? 'claude' : 'codex')
}

export function isTerminalBigBrotherProviderInstalled(provider: TerminalBigBrotherProvider, username?: string): boolean {
  try {
    execFileSync('which', [providerCommand(provider, username)], { stdio: 'ignore', timeout: 2000 })
    return true
  } catch {
    return false
  }
}

function ensureArg(args: string[], arg: string, value?: string): void {
  if (args.includes(arg)) return
  args.push(arg)
  if (value !== undefined) args.push(value)
}

function ensureConfigOverride(args: string[], key: string, value: string): void {
  for (let index = 0; index < args.length - 1; index += 1) {
    if ((args[index] === '--config' || args[index] === '-c')
      && args[index + 1]?.startsWith(`${key}=`)) return
  }
  args.push('--config', `${key}=${JSON.stringify(value)}`)
}

function materializeCodexImages(tempDir: string, options: EscalationOptions): string[] {
  const images = options.images || []
  if (images.length === 0) return []
  if (images.length > DEFAULT_PROVIDER_IMAGE_POLICY.maxImages) {
    throw new Error(`Codex Big Brother accepts at most ${DEFAULT_PROVIDER_IMAGE_POLICY.maxImages} images per request`)
  }

  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }

  return images.map((image, index) => {
    const parsed = parseProviderImageDataUrl(
      `data:${image.mimeType};base64,${image.base64}`,
      DEFAULT_PROVIDER_IMAGE_POLICY,
    )
    const extension = extensions[parsed.mimeType]
    if (!extension) throw new Error(`Codex Big Brother does not support ${parsed.mimeType} attachments`)
    const imagePath = path.join(tempDir, `image-${index + 1}.${extension}`)
    fs.writeFileSync(imagePath, Buffer.from(parsed.base64, 'base64'), { mode: 0o600 })
    return imagePath
  })
}

export function buildBigBrotherCLIInvocation(
  provider: TerminalBigBrotherProvider,
  prompt: string,
  options: EscalationOptions,
): BigBrotherCLIInvocation {
  const config = loadToolExecutorConfig(options.username)
  const backend = config.backends[provider] as CLIBackendConfig
  if (!backend.enabled) throw new Error(`${providerLabel(provider)} is disabled in tool-executor configuration`)

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-big-brother-cli-'))
  const args = [...(backend.args || [])]

  if (provider === 'claude-code') {
    if (!args.includes('--print') && !args.includes('-p')) args.unshift('--print')
    ensureArg(args, '--output-format', 'stream-json')
    ensureArg(args, '--verbose')
    if (backend.dangerouslySkipPermissions) ensureArg(args, '--dangerously-skip-permissions')

    try {
      const model = options.username
        ? loadFreshOperatorConfig(options.username).bigBrotherMode?.model
        : undefined
      if (model && !args.includes('--model')) ensureArg(args, '--model', model)
    } catch {
      // The CLI's configured model remains authoritative if the profile cannot load.
    }

    return {
      command: backend.command || 'claude',
      args,
      stdin: prompt,
      tempDir,
      timeout: options.timeout || backend.timeout || 300000,
    }
  }

  if (args.length === 0 || (args[0] !== 'exec' && args[0] !== 'e')) args.unshift('exec')
  ensureArg(args, '--json')
  ensureConfigOverride(args, 'model_reasoning_effort', backend.reasoningEffort || 'low')
  const colorIndex = args.indexOf('--color')
  if (colorIndex >= 0 && colorIndex + 1 < args.length) args[colorIndex + 1] = 'never'
  else args.push('--color', 'never')

  const resultFile = path.join(tempDir, 'last-message.txt')
  ensureArg(args, '--output-last-message', resultFile)
  if (backend.dangerouslySkipPermissions) ensureArg(args, '--dangerously-bypass-approvals-and-sandbox')

  try {
    const imagePaths = materializeCodexImages(tempDir, options)
    // Keep this variadic option last so no later flags can be mistaken for image paths.
    if (imagePaths.length > 0) args.push('--image', ...imagePaths)
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true })
    throw error
  }

  return {
    command: backend.command || 'codex',
    args,
    stdin: prompt,
    resultFile,
    tempDir,
    timeout: options.timeout || backend.timeout || 300000,
  }
}
