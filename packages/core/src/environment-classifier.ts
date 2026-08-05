import {
  ENVIRONMENT_MOTION_CLASSES,
  type EnvironmentMotionClass,
} from './environment-interface/types.js'

export const ENVIRONMENT_MEMORY_TIERS = ['hot', 'warm', 'cold', 'facts', 'all'] as const
export const ENVIRONMENT_ACTION_TYPES = ['none', 'robot_movement', 'environment_action'] as const
export const ENVIRONMENT_CONTINUATION_POLICIES = ['none', 'bounded'] as const
export const ENVIRONMENT_COMPLETION_BASES = [
  'response',
  'action_result',
  'visual_observation',
  'environment_state',
  'user_input',
] as const
export const ENVIRONMENT_RESPONSE_LENGTHS = ['brief', 'medium', 'detailed'] as const

export type EnvironmentMemoryTier = typeof ENVIRONMENT_MEMORY_TIERS[number]
export type EnvironmentClassifierActionType = typeof ENVIRONMENT_ACTION_TYPES[number]
export type EnvironmentContinuationPolicy = typeof ENVIRONMENT_CONTINUATION_POLICIES[number]
export type EnvironmentCompletionBasis = typeof ENVIRONMENT_COMPLETION_BASES[number]
export type EnvironmentResponseLength = typeof ENVIRONMENT_RESPONSE_LENGTHS[number]

export interface EnvironmentRouterActionParams {
  continuationPolicy?: EnvironmentContinuationPolicy
  requiredCompletionBasis?: EnvironmentCompletionBasis
  motionClass?: EnvironmentMotionClass
  [key: string]: unknown
}

export interface EnvironmentRouterDecision {
  needsMemory: boolean
  memoryTier: EnvironmentMemoryTier
  memoryQuery: string
  memoryTypes: string[]
  needsEnvironment: boolean
  needsVision: boolean
  needsAction: boolean
  actionType: EnvironmentClassifierActionType
  actionParams: EnvironmentRouterActionParams
  complexity: number
  responseStyle: string
  responseLength: EnvironmentResponseLength
  isFollowUp: boolean
  emotionalTone: string
}

export interface EnvironmentRouterRouteView {
  needsMemory: boolean
  needsEnvironment: boolean
  needsVision: boolean
  needsAction: boolean
  actionType: EnvironmentClassifierActionType
  motionClass: EnvironmentMotionClass | null
  continuationPolicy: EnvironmentContinuationPolicy | null
  requiredCompletionBasis: EnvironmentCompletionBasis | null
}

export interface EnvironmentRouterValidationResult {
  valid: boolean
  errors: string[]
  value?: EnvironmentRouterDecision
}

export interface ParsedEnvironmentRouterDecision extends EnvironmentRouterValidationResult {
  jsonValid: boolean
  rawValue?: unknown
  parseError?: string
}

const REQUIRED_KEYS = [
  'needsMemory',
  'memoryTier',
  'memoryQuery',
  'memoryTypes',
  'needsEnvironment',
  'needsVision',
  'needsAction',
  'actionType',
  'actionParams',
  'complexity',
  'responseStyle',
  'responseLength',
  'isFollowUp',
  'emotionalTone',
] as const

const REQUIRED_KEY_SET = new Set<string>(REQUIRED_KEYS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isEnumValue<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}

function requireType(
  errors: string[],
  record: Record<string, unknown>,
  key: string,
  type: 'boolean' | 'string' | 'number',
): void {
  if (typeof record[key] !== type) errors.push(`${key} must be ${type}`)
}

/**
 * The single strict output contract for the Environment Context Router.
 * Runtime routing and system-classifier evaluation both consume this validator.
 */
export function validateEnvironmentRouterDecision(value: unknown): EnvironmentRouterValidationResult {
  if (!isRecord(value)) {
    return { valid: false, errors: ['router output must be one JSON object'] }
  }

  const errors: string[] = []
  for (const key of REQUIRED_KEYS) {
    if (!(key in value)) errors.push(`${key} is required`)
  }
  for (const key of Object.keys(value)) {
    if (!REQUIRED_KEY_SET.has(key)) errors.push(`${key} is not an Environment Router field`)
  }

  requireType(errors, value, 'needsMemory', 'boolean')
  requireType(errors, value, 'memoryQuery', 'string')
  requireType(errors, value, 'needsEnvironment', 'boolean')
  requireType(errors, value, 'needsVision', 'boolean')
  requireType(errors, value, 'needsAction', 'boolean')
  requireType(errors, value, 'complexity', 'number')
  requireType(errors, value, 'responseStyle', 'string')
  requireType(errors, value, 'isFollowUp', 'boolean')
  requireType(errors, value, 'emotionalTone', 'string')

  if (!isEnumValue(ENVIRONMENT_MEMORY_TIERS, value.memoryTier)) {
    errors.push(`memoryTier must be one of ${ENVIRONMENT_MEMORY_TIERS.join(', ')}`)
  }
  if (!Array.isArray(value.memoryTypes) || value.memoryTypes.some(item => typeof item !== 'string')) {
    errors.push('memoryTypes must be an array of strings')
  }
  if (!isEnumValue(ENVIRONMENT_ACTION_TYPES, value.actionType)) {
    errors.push(`actionType must be one of ${ENVIRONMENT_ACTION_TYPES.join(', ')}`)
  }
  if (!isRecord(value.actionParams)) {
    errors.push('actionParams must be an object')
  }
  if (!isEnumValue(ENVIRONMENT_RESPONSE_LENGTHS, value.responseLength)) {
    errors.push(`responseLength must be one of ${ENVIRONMENT_RESPONSE_LENGTHS.join(', ')}`)
  }
  if (typeof value.complexity === 'number' && (!Number.isFinite(value.complexity) || value.complexity < 0 || value.complexity > 1)) {
    errors.push('complexity must be a finite number from 0 to 1')
  }

  const actionParams = isRecord(value.actionParams) ? value.actionParams : {}
  const continuationPolicy = actionParams.continuationPolicy
  const requiredCompletionBasis = actionParams.requiredCompletionBasis
  const motionClass = actionParams.motionClass
  const hasContinuationPolicy = continuationPolicy !== undefined
  const hasCompletionBasis = requiredCompletionBasis !== undefined

  if (hasContinuationPolicy && !isEnumValue(ENVIRONMENT_CONTINUATION_POLICIES, continuationPolicy)) {
    errors.push(`actionParams.continuationPolicy must be one of ${ENVIRONMENT_CONTINUATION_POLICIES.join(', ')}`)
  }
  if (hasCompletionBasis && !isEnumValue(ENVIRONMENT_COMPLETION_BASES, requiredCompletionBasis)) {
    errors.push(`actionParams.requiredCompletionBasis must be one of ${ENVIRONMENT_COMPLETION_BASES.join(', ')}`)
  }
  if (motionClass !== undefined && !isEnumValue(ENVIRONMENT_MOTION_CLASSES, motionClass)) {
    errors.push(`actionParams.motionClass must be one of ${ENVIRONMENT_MOTION_CLASSES.join(', ')}`)
  }
  if (hasContinuationPolicy !== hasCompletionBasis) {
    errors.push('actionParams must provide continuationPolicy and requiredCompletionBasis together')
  }

  if (value.needsAction === true) {
    if (value.actionType === 'none') errors.push('needsAction=true requires a non-none actionType')
    if (!hasContinuationPolicy || !hasCompletionBasis) {
      errors.push('needsAction=true requires a complete action task contract')
    }
    if (value.actionType === 'robot_movement' && !isEnumValue(ENVIRONMENT_MOTION_CLASSES, motionClass)) {
      errors.push('robot_movement requires actionParams.motionClass')
    }
    if (value.actionType !== 'robot_movement' && motionClass !== undefined) {
      errors.push('actionParams.motionClass is only valid for robot_movement work')
    }
  }
  if (value.needsAction === false && value.actionType !== 'none') {
    errors.push('needsAction=false requires actionType=none')
  }
  if (value.needsVision === true && value.needsEnvironment !== true) {
    errors.push('needsVision=true requires needsEnvironment=true')
  }

  if (errors.length > 0) return { valid: false, errors }
  return { valid: true, errors, value: value as unknown as EnvironmentRouterDecision }
}

export function parseEnvironmentRouterDecision(text: string): ParsedEnvironmentRouterDecision {
  let rawValue: unknown
  try {
    rawValue = JSON.parse(text.trim())
  } catch (error) {
    return {
      jsonValid: false,
      valid: false,
      errors: ['router output is not strict JSON'],
      parseError: error instanceof Error ? error.message : String(error),
    }
  }

  const validation = validateEnvironmentRouterDecision(rawValue)
  return { jsonValid: true, rawValue, ...validation }
}

export function environmentRouterRouteView(decision: EnvironmentRouterDecision): EnvironmentRouterRouteView {
  const continuationPolicy = decision.actionParams.continuationPolicy
  const requiredCompletionBasis = decision.actionParams.requiredCompletionBasis
  const motionClass = decision.actionParams.motionClass
  return {
    needsMemory: decision.needsMemory,
    needsEnvironment: decision.needsEnvironment,
    needsVision: decision.needsVision,
    needsAction: decision.needsAction,
    actionType: decision.actionType,
    motionClass: motionClass ?? null,
    continuationPolicy: continuationPolicy ?? null,
    requiredCompletionBasis: requiredCompletionBasis ?? null,
  }
}
