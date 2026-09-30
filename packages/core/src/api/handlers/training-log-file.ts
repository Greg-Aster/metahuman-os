import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'
import { readTrainingLogForUser } from '../../training-process.js'

export async function handleGetTrainingLogFile(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  if (!req.query?.file) return { status: 400, error: 'Missing file parameter' }
  try {
    const log = readTrainingLogForUser(req.user.username, req.query.file)
    if (!log) return { status: 404, error: 'Training log not found' }
    return successResponse({ success: true, fileName: log.fileName, logs: log.lines, count: log.lines.length })
  } catch (error) { return { status: 400, error: (error as Error).message } }
}
