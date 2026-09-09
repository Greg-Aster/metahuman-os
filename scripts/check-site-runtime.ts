/** Compiled with the server so startup validates the executable, not a newer source validator. */
import fs from 'node:fs'
import path from 'node:path'
import { assertExecutableCurrent } from '@metahuman/core/executable-version'
import { loadGraphFile } from '@metahuman/core/graph-streaming'
import { systemPaths } from '@metahuman/core/path-builder'
import { eventBus } from '../packages/core/src/infrastructure/event-bus/client.js'

// Schema imports register event listeners. This read-only process has no events
// to deliver and must not join a running installation's event bus.
eventBus.disconnect()
try {
  const root = process.argv[2]
  if (!root) throw new Error('Runtime check requires the installation root')
  assertExecutableCurrent(root)
  const graphs = path.join(systemPaths.etc, 'cognitive-graphs')
  const directories = [graphs, path.join(graphs, 'custom')]
  const selected = new Map<string, string>()
  for (const directory of directories) {
    if (directory !== graphs && !fs.existsSync(directory)) continue
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      selected.set(entry.name, path.join(directory, entry.name))
    }
  }
  for (const file of selected.values()) {
    if (!await loadGraphFile(file)) throw new Error(`Workflow disappeared during verification: ${file}`)
  }
  console.log(`Runtime verified: compiled core matches source; ${selected.size} workflows validated.`)
} catch (error) {
  console.error(`Runtime verification failed: ${(error as Error).message}`)
  process.exitCode = 1
} finally {
  eventBus.disconnect()
}
