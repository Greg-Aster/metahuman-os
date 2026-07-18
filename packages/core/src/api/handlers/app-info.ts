/**
 * GET /api/app-info - Side-effect-free application version information.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'

export async function handleAppInfo(_req: UnifiedRequest): Promise<UnifiedResponse> {
  const version = process.env.APP_VERSION || '1.0.0'
  const versionCode = parseInt(process.env.APP_VERSION_CODE || '1', 10)
  const buildDate = process.env.APP_BUILD_DATE || new Date().toISOString()

  return successResponse({
    version,
    versionCode,
    buildDate,
    platform: process.env.METAHUMAN_MOBILE ? 'mobile' : 'server',
  })
}
