import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'
import { readTrainingLogForUser } from '../../training-process.js'

export async function handleGetTrainingConsoleLogs(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  const maxLines = Number(req.query?.maxLines ?? 200)
  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 5000) return { status: 400, error: 'maxLines must be from 1 to 5000' }
  try {
    const log = readTrainingLogForUser(req.user.username, req.query?.file)
    if (!log) return { status: 404, error: 'No training logs for this profile' }
    const logs = log.lines.slice(-maxLines)
    return successResponse({ success: true, logFile: log.fileName, logs, count: logs.length })
  } catch (error) { return { status: 400, error: (error as Error).message } }
}
