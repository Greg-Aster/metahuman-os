import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ACTION_SELECTOR_DIRECTORY = dirname(fileURLToPath(import.meta.url))
export const REPOSITORY_ROOT = resolve(ACTION_SELECTOR_DIRECTORY, '../../..')
export const PRIOR_HELD_OUT_LOCK_PATH = resolve(
  REPOSITORY_ROOT,
  'brain/training/environment-action-selector/prior-context-router-held-out.lock.json',
)
export const PRIOR_ONE_SHOT_RECEIPT_PATH = resolve(
  REPOSITORY_ROOT,
  'out/environment-classifier/training/qwen3.5-0.8b-final-001/final/locked-evaluation-receipt.json',
)

export interface PriorHeldOutLock {
  version: number
  caseIds: string[]
  digest: string
}

export interface PriorOneShotReceipt {
  status: 'completed'
  heldOutDigest: string
  heldOutCaseCount: number
  completedAt: string
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    )
  }
  return value
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

export async function loadPriorEvaluationEvidence(): Promise<{
  lock: PriorHeldOutLock
  receipt: PriorOneShotReceipt
}> {
  const [lockText, receiptText] = await Promise.all([
    readFile(PRIOR_HELD_OUT_LOCK_PATH, 'utf8'),
    readFile(PRIOR_ONE_SHOT_RECEIPT_PATH, 'utf8'),
  ])
  const lock = JSON.parse(lockText) as PriorHeldOutLock
  const receipt = JSON.parse(receiptText) as PriorOneShotReceipt
  if (
    receipt.status !== 'completed'
    || receipt.heldOutDigest !== lock.digest
    || receipt.heldOutCaseCount !== lock.caseIds.length
  ) {
    throw new Error('The retired classifier one-shot evaluation receipt does not match its lock')
  }
  return { lock, receipt }
}
