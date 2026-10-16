import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolveConfig, createSettings, createNodeLogger } from './node_modules/astro/dist/core/config/index.js'
import { createRoutesList } from './node_modules/astro/dist/core/routing/manifest/create.js'

test('Astro exposes the existing vector index transport at /api/index rather than /api', async () => {
  const root = new URL('./', import.meta.url)
  const inline = { root: fileURLToPath(root), configFile: false, output: 'server', logLevel: 'silent' }
  const { astroConfig } = await resolveConfig(inline, 'build')
  const settings = await createSettings(astroConfig)
  const { routes } = await createRoutesList({ settings }, createNodeLogger(inline))
  const routesAtIndex = routes.filter(route => route.pattern.test('/api/index'))
  assert.equal(routesAtIndex.length, 1)
  assert.equal(routesAtIndex[0].type, 'endpoint')
  assert.equal(routesAtIndex[0].component, 'src/pages/api/index/index.ts')
  assert.equal(routes.some(route => route.pattern.test('/api')), false)
  const source = await fs.readFile(new URL(routesAtIndex[0].component, root), 'utf8')
  assert.match(source, /import \{ astroHandler \} from '@metahuman\/core\/api'/)
  assert.match(source, /export const GET = astroHandler/)
  assert.match(source, /export const POST = astroHandler/)
})
