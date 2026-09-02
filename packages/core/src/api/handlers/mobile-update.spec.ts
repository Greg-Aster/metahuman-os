import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { setAuditEnabled } from '../../audit.js'
import { systemPaths } from '../../path-builder.js'
import { handleAppInfo } from './app-info.js'
import { handleGetMobileDownload } from './mobile-download.js'
import { handleGetMobileVersion } from './mobile-version.js'

const request = (query: Record<string, string> = {}) => ({
  method: 'GET',
  path: '/api/mobile/version',
  query,
  headers: {},
  user: { id: 'owner', username: 'owner', role: 'owner', isAuthenticated: true },
}) as any

function writeRelease(directory: string, overrides: Record<string, unknown> = {}): Buffer {
  const binary = Buffer.from('signed-apk-fixture')
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'metahuman-1.2.3.apk'), binary)
  fs.writeFileSync(path.join(directory, 'version.json'), `${JSON.stringify({
    version: '1.2.3',
    versionCode: 12,
    releaseDate: '2026-08-30',
    releaseNotes: 'Focused update fixture',
    minAndroidVersion: 24,
    fileSize: binary.length,
    ...overrides,
  }, null, 2)}\n`)
  return binary
}

test('mobile update handlers use one strict release store and return explicit failures', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-mobile-release-'))
  const originalReleaseDirectory = systemPaths.mobileReleases
  systemPaths.mobileReleases = root
  setAuditEnabled(false)

  try {
    const missing = await handleGetMobileVersion(request({ versionCode: '11' }))
    assert.equal(missing.status, 404)
    assert.match(missing.error || '', /No mobile release/)

    fs.writeFileSync(path.join(root, 'version.json'), '{invalid')
    const malformed = await handleGetMobileVersion(request({ versionCode: '11' }))
    assert.equal(malformed.status, 500)
    assert.match(malformed.error || '', /metadata is unreadable/)

    const expectedBinary = writeRelease(root)
    const available = await handleGetMobileVersion(request({ current: '1.2.2', versionCode: '11' }))
    assert.equal(available.status, 200)
    assert.equal(available.data.updateAvailable, true)
    assert.equal(available.data.latest.version, '1.2.3')
    assert.equal(available.data.latest.fileSize, expectedBinary.length)
    assert.equal(available.data.latest.downloadUrl, '/api/mobile/download?version=1.2.3')
    assert.equal(available.headers?.['Access-Control-Allow-Origin'], '*')

    const download = await handleGetMobileDownload(request({ version: '1.2.3' }))
    assert.equal(download.status, 200)
    assert.deepEqual(download.binary, expectedBinary)

    const invalidVersion = await handleGetMobileDownload(request({ version: '../../etc' }))
    assert.equal(invalidVersion.status, 400)

    const unavailableVersion = await handleGetMobileDownload(request({ version: '9.9.9' }))
    assert.equal(unavailableVersion.status, 404)

    writeRelease(root, { fileSize: expectedBinary.length + 1 })
    const sizeMismatch = await handleGetMobileVersion(request({ versionCode: '11' }))
    assert.equal(sizeMismatch.status, 500)
    assert.match(sizeMismatch.error || '', /size does not match/)
  } finally {
    systemPaths.mobileReleases = originalReleaseDirectory
    setAuditEnabled(true)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('mobile app information rejects missing build metadata instead of fabricating a version', async () => {
  const original = {
    mobile: process.env.METAHUMAN_MOBILE,
    version: process.env.APP_VERSION,
    versionCode: process.env.APP_VERSION_CODE,
    buildDate: process.env.APP_BUILD_DATE,
  }

  try {
    process.env.METAHUMAN_MOBILE = 'true'
    delete process.env.APP_VERSION
    delete process.env.APP_VERSION_CODE
    delete process.env.APP_BUILD_DATE
    const missing = await handleAppInfo(request())
    assert.equal(missing.status, 503)

    process.env.APP_VERSION = '1.2.3'
    process.env.APP_VERSION_CODE = '12'
    process.env.APP_BUILD_DATE = '2026-08-30T12:00:00Z'
    const valid = await handleAppInfo(request())
    assert.equal(valid.status, 200)
    assert.equal(valid.data.version, '1.2.3')
    assert.equal(valid.data.versionCode, 12)
    assert.equal(valid.data.packageName, 'com.metahuman.os')
  } finally {
    if (original.mobile === undefined) delete process.env.METAHUMAN_MOBILE
    else process.env.METAHUMAN_MOBILE = original.mobile
    if (original.version === undefined) delete process.env.APP_VERSION
    else process.env.APP_VERSION = original.version
    if (original.versionCode === undefined) delete process.env.APP_VERSION_CODE
    else process.env.APP_VERSION_CODE = original.versionCode
    if (original.buildDate === undefined) delete process.env.APP_BUILD_DATE
    else process.env.APP_BUILD_DATE = original.buildDate
  }
})
