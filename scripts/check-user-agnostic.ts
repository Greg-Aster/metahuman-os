import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

const errors: string[] = []
for (const forbidden of ['etc/default-user.txt', 'etc/model-registry.json']) {
  if (fs.existsSync(path.join(root, forbidden))) {
    errors.push(`${forbidden}: local user selection or profile data must not be tracked system configuration`)
  }
}

const maintainedRuntime = tracked.filter(file =>
  file !== 'scripts/check-user-agnostic.ts'
  && (
    file.startsWith('packages/cli/src/')
    || (file.startsWith('packages/core/src/') && !file.endsWith('.spec.ts'))
    || file.startsWith('brain/services/')
    || file.startsWith('brain/training/')
    || (file.startsWith('scripts/') && !/^scripts\/test[-/]/.test(file))
    || file.startsWith('apps/react-native/scripts/')
    || /^bin\/(start|stop)/.test(file)
    || /^etc\/[^/]+\.json$/.test(file)
  ),
)

const forbiddenPatterns: Array<[RegExp, string]> = [
  [/\/(?:home|media)\/greggles(?:\/|\b)/, 'personal absolute filesystem path'],
  [/(?:\|\||\?\?)\s*['"]greggles['"]/, 'personal username fallback'],
  [/\buser(?:name|Name)?\s*=\s*['"]greggles['"]/, 'personal username default'],
  [/default-user\.txt/, 'host-wide default user dependency'],
]

for (const file of maintainedRuntime) {
  const absolute = path.join(root, file)
  if (!fs.existsSync(absolute)) continue
  const content = fs.readFileSync(absolute, 'utf8')
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(content)) errors.push(`${file}: ${label}`)
  }
}

if (errors.length > 0) {
  console.error('User-agnostic guard failed:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(`User-agnostic guard passed (${maintainedRuntime.length} maintained runtime files checked)`)
