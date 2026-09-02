import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'
import {
  automaticTrainingRuntimeInputs,
  evaluateAutomaticTrainingReadiness,
  saveAutomaticTrainingConfig,
} from '../../training-automation.js'
import { readTrainingHistoryForUser } from './training-history.js'

function currentStatus(username: string) {
  const inputs = automaticTrainingRuntimeInputs(username)
  return {
    config: inputs.config,
    readiness: evaluateAutomaticTrainingReadiness(
      inputs.config,
      inputs.inspection,
      readTrainingHistoryForUser(username),
      inputs.runningProcesses,
      inputs.remoteCredentialsConfigured,
    ),
    dataset: inputs.inspection.stats,
    integration: {
      owner: 'sleep-workflow' as const,
      triggerInstalled: false as const,
      message: 'The policy and launch boundary are ready. Sleep-cycle admission is the next implementation phase.',
    },
  }
}

export async function handleGetAutomaticTraining(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    return successResponse(currentStatus(req.user.username))
  } catch (error) {
    console.error('[training/automatic] GET error:', error)
    return {
      status: 500,
      error: error instanceof Error ? error.message : 'Failed to load automatic training configuration',
    }
  }
}

export async function handleUpdateAutomaticTraining(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const config = saveAutomaticTrainingConfig(req.user.username, req.body)
    return successResponse({
      ...currentStatus(req.user.username),
      config,
      success: true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update automatic training configuration'
    console.error('[training/automatic] POST error:', error)
    return { status: 400, error: message, data: { success: false } }
  }
}
