import { createHash } from 'node:crypto'
import { episodicSourceHash } from '../../memory.js'

import type { EpisodicMemory } from './contracts.js'

export interface CuratorSourceAssembly {
  memories: Array<EpisodicMemory & { path: string }>
  deferredPaths: string[]
}

function cleanRolePrefix(value: string, role: 'user' | 'assistant'): string {
  const prefix = role === 'user'
    ? /^(?:Me|User):\s*/i
    : /^(?:Assistant|AI|MetaHuman):\s*/i
  return value.replace(prefix, '').trim()
}

function sourcePaths(memory: EpisodicMemory & { path: string }): string[] {
  return memory.sourcePaths?.length ? memory.sourcePaths : [memory.path]
}

function sourceIds(memory: EpisodicMemory): string[] {
  return memory.sourceMemoryIds?.length ? memory.sourceMemoryIds : [memory.id]
}

function conversationKey(memory: EpisodicMemory): string | undefined {
  const idempotencyKey = memory.metadata?.idempotencyKey
  if (typeof idempotencyKey === 'string' && idempotencyKey.trim()) {
    return `turn:${idempotencyKey.trim().replace(/:(?:user|assistant)$/i, '')}`
  }
  const sessionId = memory.metadata?.sessionId
  return typeof sessionId === 'string' && sessionId.trim()
    ? `session:${sessionId.trim()}`
    : undefined
}

function normalizeLegacyConversation(
  memory: EpisodicMemory & { path: string },
): EpisodicMemory & { path: string } {
  if (memory.type !== 'conversation' || memory.metadata?.role || memory.response?.trim()) return memory

  const separator = /(?:\r?\n){1,2}(?:Assistant|AI|MetaHuman):\s*/i
  const match = separator.exec(memory.content)
  if (!match || match.index <= 0) return memory

  const user = cleanRolePrefix(memory.content.slice(0, match.index), 'user')
  const assistant = memory.content.slice(match.index + match[0].length).trim()
  if (!user || !assistant) return memory
  return { ...memory, content: user, response: assistant }
}

function pairMode(
  user: EpisodicMemory,
  assistant: EpisodicMemory,
): string | undefined {
  const userMode = user.metadata?.cognitiveMode
  const assistantMode = assistant.metadata?.cognitiveMode
  if (userMode && assistantMode && userMode !== assistantMode) {
    throw new Error(`Conversation pair ${user.id}/${assistant.id} has conflicting cognitive modes`)
  }
  return typeof userMode === 'string'
    ? userMode
    : typeof assistantMode === 'string'
      ? assistantMode
      : undefined
}

function pairConversation(
  user: EpisodicMemory & { path: string },
  assistant: EpisodicMemory & { path: string },
): EpisodicMemory & { path: string } {
  const userIds = sourceIds(user)
  const assistantIds = sourceIds(assistant)
  const pairId = `conversation-pair-${createHash('sha256')
    .update(`${userIds.join('\u0000')}\u0001${assistantIds.join('\u0000')}`)
    .digest('hex')
    .slice(0, 24)}`
  const cognitiveMode = pairMode(user, assistant)
  const sessionId = user.metadata?.sessionId ?? assistant.metadata?.sessionId

  return {
    id: pairId,
    timestamp: user.timestamp,
    content: user.metadata?.idempotencyKey ? user.content : cleanRolePrefix(user.content, 'user'),
    response: assistant.metadata?.idempotencyKey ? assistant.content : cleanRolePrefix(assistant.content, 'assistant'),
    type: 'conversation',
    path: user.path,
    sourcePaths: [...sourcePaths(user), ...sourcePaths(assistant)],
    sourceMemoryIds: [...userIds, ...assistantIds],
    sourceHashes: { ...user.sourceHashes, ...assistant.sourceHashes },
    tags: [...new Set([...(user.tags ?? []), ...(assistant.tags ?? [])])],
    metadata: {
      ...(user.metadata ?? {}),
      ...(cognitiveMode ? { cognitiveMode } : {}),
      ...(sessionId ? { sessionId } : {}),
      pairedRoles: ['user', 'assistant'],
      ...(assistant.metadata?.reinforcementSignal !== undefined
        ? { reinforcementSignal: assistant.metadata.reinforcementSignal } : {}),
    },
  }
}

/**
 * Convert the canonical per-message conversation store into review units.
 * Role-tagged conversation records are held until the matching assistant reply
 * exists; legacy combined conversations and non-conversation memories remain
 * one source unit each.
 */
export function assembleCuratorSources(
  sources: Array<EpisodicMemory & { path: string }>,
): CuratorSourceAssembly {
  const memories: Array<EpisodicMemory & { path: string }> = []
  const deferredPaths: string[] = []
  const conversations = new Map<string, Array<EpisodicMemory & { path: string }>>()
  const ordered = [...sources].sort((left, right) => {
    const time = Date.parse(left.timestamp) - Date.parse(right.timestamp)
    return time || left.path.localeCompare(right.path)
  })

  for (const original of ordered) {
    const source = { ...original, sourceHashes: original.sourceHashes ?? { [original.id]: episodicSourceHash(original) } }
    const role = source.metadata?.role
    if (source.type !== 'conversation' || (role !== 'user' && role !== 'assistant')) {
      memories.push(normalizeLegacyConversation(source))
      continue
    }

    const key = conversationKey(source)
    if (!key) {
      deferredPaths.push(...sourcePaths(source))
      continue
    }
    const group = conversations.get(key) ?? []
    group.push(source)
    conversations.set(key, group)
  }

  for (const [key, group] of conversations) {
    if (key.startsWith('turn:')) {
      const users = group.filter(source => source.metadata?.role === 'user')
      const assistants = group.filter(source => source.metadata?.role === 'assistant')
      if (users.length === 1 && assistants.length === 1
          && Date.parse(users[0]!.timestamp) <= Date.parse(assistants[0]!.timestamp)) {
        memories.push(pairConversation(users[0]!, assistants[0]!))
      } else deferredPaths.push(...group.flatMap(sourcePaths))
      continue
    }
    let pending: (EpisodicMemory & { path: string }) | undefined
    for (const source of group) {
      if (source.metadata?.role === 'user') {
        if (pending) deferredPaths.push(...sourcePaths(pending))
        pending = source
      } else if (pending && Date.parse(pending.timestamp) < Date.parse(source.timestamp)) {
        memories.push(pairConversation(pending, source))
        pending = undefined
      } else deferredPaths.push(...sourcePaths(source))
    }
    if (pending) deferredPaths.push(...sourcePaths(pending))
  }
  memories.sort((left, right) => {
    const time = Date.parse(left.timestamp) - Date.parse(right.timestamp)
    return time || left.path.localeCompare(right.path)
  })
  return { memories, deferredPaths: [...new Set(deferredPaths)] }
}
