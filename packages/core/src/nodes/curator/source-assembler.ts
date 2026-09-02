import { createHash } from 'node:crypto'

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

function conversationKey(memory: EpisodicMemory): string {
  const idempotencyKey = memory.metadata?.idempotencyKey
  if (typeof idempotencyKey === 'string' && idempotencyKey.trim()) {
    return `turn:${idempotencyKey.trim().replace(/:(?:user|assistant)$/i, '')}`
  }
  const sessionId = memory.metadata?.sessionId
  return typeof sessionId === 'string' && sessionId.trim()
    ? `session:${sessionId.trim()}`
    : 'session:__sessionless__'
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
    content: cleanRolePrefix(user.content, 'user'),
    response: cleanRolePrefix(assistant.content, 'assistant'),
    type: 'conversation',
    path: user.path,
    sourcePaths: [...sourcePaths(user), ...sourcePaths(assistant)],
    sourceMemoryIds: [...userIds, ...assistantIds],
    tags: [...new Set([...(user.tags ?? []), ...(assistant.tags ?? [])])],
    metadata: {
      ...(user.metadata ?? {}),
      ...(cognitiveMode ? { cognitiveMode } : {}),
      ...(sessionId ? { sessionId } : {}),
      pairedRoles: ['user', 'assistant'],
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
  const conversations = new Map<string, {
    users: Array<EpisodicMemory & { path: string }>
    assistants: Array<EpisodicMemory & { path: string }>
  }>()
  const ordered = [...sources].sort((left, right) => {
    const time = Date.parse(left.timestamp) - Date.parse(right.timestamp)
    return time || left.path.localeCompare(right.path)
  })

  for (const source of ordered) {
    const role = source.metadata?.role
    if (source.type !== 'conversation' || (role !== 'user' && role !== 'assistant')) {
      memories.push(normalizeLegacyConversation(source))
      continue
    }

    const key = conversationKey(source)
    const group = conversations.get(key) ?? { users: [], assistants: [] }
    group[role === 'user' ? 'users' : 'assistants'].push(source)
    conversations.set(key, group)
  }

  for (const group of conversations.values()) {
    const pairCount = Math.min(group.users.length, group.assistants.length)
    for (let index = 0; index < pairCount; index++) {
      memories.push(pairConversation(group.users[index]!, group.assistants[index]!))
    }
    deferredPaths.push(...group.users.slice(pairCount).flatMap(sourcePaths))
    deferredPaths.push(...group.assistants.slice(pairCount).flatMap(sourcePaths))
  }
  memories.sort((left, right) => {
    const time = Date.parse(left.timestamp) - Date.parse(right.timestamp)
    return time || left.path.localeCompare(right.path)
  })
  return { memories, deferredPaths: [...new Set(deferredPaths)] }
}
