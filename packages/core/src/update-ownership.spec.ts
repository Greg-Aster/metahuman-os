import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { ROOT } from './path-builder.js'

const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

for (const retiredPath of [
  'brain/agents/update-check',
  'packages/core/src/api/handlers/app-version.ts',
  'packages/core/src/api/handlers/local-state.ts',
  'apps/site/src/pages/api/app-version.ts',
]) {
  assert.equal(fs.existsSync(path.join(ROOT, retiredPath)), false, `${retiredPath} must remain retired`)
}

const router = read('packages/core/src/api/router.ts')
assert.doesNotMatch(router, /\/api\/(?:app-version|update-state)/, 'retired update routes must not return')
assert.doesNotMatch(read('packages/core/src/api/handlers/index.ts'), /local-state|app-version/, 'retired update handlers must not remain exported')

const mobileVersion = read('packages/core/src/api/handlers/mobile-version.ts')
const mobileDownload = read('packages/core/src/api/handlers/mobile-download.ts')
for (const source of [mobileVersion, mobileDownload]) {
  assert.match(source, /mobile-release\.js/, 'mobile update handlers must delegate to the canonical release store')
  assert.doesNotMatch(source, /apps['"], ['"]mobile|apps\/mobile/, 'mobile update handlers must not read the deprecated app')
}

const releaseScript = read('apps/react-native/scripts/release-apk.sh')
assert.match(releaseScript, /out\/releases\/mobile/, 'React Native publishing must target the canonical release store')
assert.doesNotMatch(releaseScript, /apps\/site\/public\/downloads|RN_DIR\/releases/, 'publishing must not create competing release stores')

const syncManager = read('apps/site/src/components/SyncManager.svelte')
const syncStatus = read('apps/site/src/components/SyncStatus.svelte')
assert.doesNotMatch(syncManager, /app-updater|Program Update/, 'Profile Sync must not own software updates')
assert.doesNotMatch(syncStatus, /app-updater|checkForUpdates/, 'Sync Status must not trigger software updates')

const updater = read('apps/site/src/lib/client/app-updater.ts')
assert.doesNotMatch(updater, /downloadAndInstall|window\.open\(/, 'the maintained updater must not retain legacy download fallbacks')
assert.match(updater, /getRemoteSyncConfig/, 'mobile updates must resolve the explicitly configured remote installation')
assert.doesNotMatch(updater, /getApiBaseUrlAsync/, 'mobile updates must not query the bundled local server for release artifacts')

const serverUpdate = read('packages/core/src/api/handlers/server-update.ts')
assert.match(serverUpdate, /execFile/, 'server updates must execute commands without a shell command string')
assert.match(serverUpdate, /updateInProgress/, 'server updates must reject concurrent mutation')
assert.match(serverUpdate, /runPnpm\(\['build'\]/, 'server updates must build before reporting success')

console.log('update-ownership.spec.ts passed')
