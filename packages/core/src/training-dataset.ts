import fs from 'node:fs'
import path from 'node:path'

import { getProfilePaths } from './path-builder.js'
import {
  isTrainingCuratedMemory,
  parseStoredCuratedMemory,
} from './nodes/curator/contracts.js'

export interface TrainingDatasetStats {
  totalMemories: number
  episodicMemories: number
  therapySessions: number
  chatConversations: number
  recentMemories: number
  oldestMemory: string | null
  newestMemory: string | null
  cognitiveModeCounts: {
    dual: number
    agent: number
    emulation: number
    environment: number
  }
  organizedMemories: number
  pendingOrganization: number
  curatedMemories: number
  pendingCuration: number
  curatedRecords: number
  validCuratedRecords: number
  invalidCuratedRecords: number
  trainableSamples: number
  estimatedTrainingSamples: number
  latestCuratedAt: string | null
}

export interface TrainingDatasetInspection {
  stats: TrainingDatasetStats
  trainableCuratedAt: string[]
}

function jsonFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return jsonFiles(target)
    return entry.isFile() && entry.name.endsWith('.json') ? [target] : []
  })
}

function countJsonlRecords(directory: string): number {
  if (!fs.existsSync(directory)) return 0
  let count = 0
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) count += countJsonlRecords(target)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      count += fs.readFileSync(target, 'utf8').split('\n').filter(line => line.trim()).length
    }
  }
  return count
}

export function inspectTrainingDataset(username: string, now = Date.now()): TrainingDatasetInspection {
  const profilePaths = getProfilePaths(username)
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
  const stats: TrainingDatasetStats = {
    totalMemories: 0,
    episodicMemories: 0,
    therapySessions: 0,
    chatConversations: 0,
    recentMemories: 0,
    oldestMemory: null,
    newestMemory: null,
    cognitiveModeCounts: { dual: 0, agent: 0, emulation: 0, environment: 0 },
    organizedMemories: 0,
    pendingOrganization: 0,
    curatedMemories: 0,
    pendingCuration: 0,
    curatedRecords: 0,
    validCuratedRecords: 0,
    invalidCuratedRecords: 0,
    trainableSamples: 0,
    estimatedTrainingSamples: 0,
    latestCuratedAt: null,
  }

  for (const file of jsonFiles(path.join(profilePaths.memory, 'episodic'))) {
    try {
      const memory = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>
      stats.episodicMemories++
      if (memory.metadata?.processed === true) stats.organizedMemories++
      if (memory.metadata?.curated === true) stats.curatedMemories++

      const rawMode: unknown = memory.metadata?.cognitiveMode ?? 'emulation'
      const mode = typeof rawMode === 'string' ? rawMode : 'emulation'
      if (mode === 'dual' || mode === 'agent' || mode === 'emulation' || mode === 'environment') {
        stats.cognitiveModeCounts[mode]++
      }

      const timestamp = Date.parse(memory.timestamp)
      if (Number.isFinite(timestamp)) {
        if (!stats.oldestMemory || timestamp < Date.parse(stats.oldestMemory)) stats.oldestMemory = memory.timestamp
        if (!stats.newestMemory || timestamp > Date.parse(stats.newestMemory)) stats.newestMemory = memory.timestamp
        if (timestamp > thirtyDaysAgo) stats.recentMemories++
      }
    } catch {
      // Invalid episodic files are excluded from readiness and remain visible to Curator validation.
    }
  }

  stats.pendingOrganization = stats.episodicMemories - stats.organizedMemories
  stats.pendingCuration = stats.episodicMemories - stats.curatedMemories

  const therapyPath = path.join(profilePaths.persona, 'therapy')
  if (fs.existsSync(therapyPath)) {
    stats.therapySessions = fs.readdirSync(therapyPath)
      .filter(file => file.startsWith('session-') && file.endsWith('.json')).length
  }
  stats.chatConversations = countJsonlRecords(path.join(profilePaths.memory, 'training'))
  stats.totalMemories = stats.episodicMemories + stats.therapySessions + stats.chatConversations

  const trainableCuratedAt: string[] = []
  const curatedDirectory = path.join(profilePaths.memory, 'curated', 'conversations')
  for (const file of jsonFiles(curatedDirectory)) {
    stats.curatedRecords++
    try {
      const record = parseStoredCuratedMemory(
        JSON.parse(fs.readFileSync(file, 'utf8')),
        `Curator record ${path.basename(file)}`,
      )
      stats.validCuratedRecords++
      if (!stats.latestCuratedAt || Date.parse(record.curatedAt) > Date.parse(stats.latestCuratedAt)) {
        stats.latestCuratedAt = record.curatedAt
      }
      if (isTrainingCuratedMemory(record)) {
        stats.trainableSamples++
        trainableCuratedAt.push(record.curatedAt)
      }
    } catch {
      stats.invalidCuratedRecords++
    }
  }

  // Kept for current clients, but now reports validated trainable records rather than a multiplier.
  stats.estimatedTrainingSamples = stats.trainableSamples
  return { stats, trainableCuratedAt }
}
