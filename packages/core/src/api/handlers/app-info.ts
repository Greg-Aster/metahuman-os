/**
 * GET /api/app-info - Side-effect-free application version information.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'
import fs from 'node:fs'
import path from 'node:path'
import { systemPaths } from '../../path-builder.js'

export async function handleAppInfo(_req: UnifiedRequest): Promise<UnifiedResponse> {
  const mobile = process.env.METAHUMAN_MOBILE === 'true'
  let version: string
  let versionCode: number

  if (mobile) {
    version = process.env.APP_VERSION?.trim() || ''
    versionCode = Number(process.env.APP_VERSION_CODE)
    if (!version || !Number.isInteger(versionCode) || versionCode < 0) {
      return {
        status: 503,
        error: 'Mobile build version metadata is missing or invalid',
      }
    }
  } else {
    const packagePath = path.join(systemPaths.root, 'package.json')
    const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: unknown }
    if (typeof packageData.version !== 'string' || packageData.version.trim().length === 0) {
      return { status: 500, error: 'Root package.json is missing a valid version' }
    }
    version = packageData.version.trim()
    versionCode = 0
  }

  return successResponse({
    version,
    versionCode,
    buildDate: process.env.APP_BUILD_DATE || null,
    packageName: 'com.metahuman.os',
    platform: mobile ? 'mobile' : 'server',
  })
}
