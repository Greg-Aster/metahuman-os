import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

declare const __METAHUMAN_EXECUTABLE_HASH__: string | undefined

/** Shared by source workers and the bundled Site build, including imported node helpers. */
export function sourceExecutableHash(repoRoot: string): string {
  const hash = createHash('sha256')
  const add = (relative: string) => {
    const filename = path.join(repoRoot, relative)
    if (fs.statSync(filename).isDirectory()) {
      for (const name of fs.readdirSync(filename).sort()) {
        if (!name.startsWith('.') && name !== 'node_modules' && name !== 'dist') add(path.join(relative, name))
      }
    } else if ((/\.(ts|js|mts|mjs|json)$/.test(relative) && !/\.(spec|test)\./.test(relative)) || relative === 'pnpm-lock.yaml') {
      hash.update(relative).update('\0').update(fs.readFileSync(filename)).update('\0')
    }
  }
  for (const relative of ['packages/core/src', 'packages/agent-runtime/src', 'packages/core/package.json', 'packages/agent-runtime/package.json', 'pnpm-lock.yaml']) add(relative)
  return hash.digest('hex')
}

let currentHash: string | undefined
export function executableHash(): string {
  if (typeof __METAHUMAN_EXECUTABLE_HASH__ === 'string') return __METAHUMAN_EXECUTABLE_HASH__
  // Source execution only. Bundled deployments must embed their build's hash.
  if (!import.meta.url.endsWith('.ts')) throw new Error('Bundled graph runtime has no executable version')
  currentHash ??= sourceExecutableHash(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'))
  return currentHash
}

/** Launch source workers only alongside the runtime built from the same core. */
export function assertExecutableCurrent(repoRoot: string): void {
  const built = executableHash()
  const current = sourceExecutableHash(repoRoot)
  if (built !== current) {
    throw new Error(`Site runtime ${built.slice(0, 12)} does not match current source ${current.slice(0, 12)}. Rebuild with pnpm --dir apps/site build before starting services.`)
  }
}
