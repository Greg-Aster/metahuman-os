#!/usr/bin/env tsx

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = process.cwd()
const graphNames = process.argv.slice(2)

async function main(): Promise<void> {
  if (graphNames.length === 0) {
    throw new Error('Pass at least one graph name, for example: dual-mode')
  }

  for (const graphName of graphNames) {
    if (!/^[a-z0-9-]+$/.test(graphName)) {
      throw new Error(`Invalid graph name: ${graphName}`)
    }

    const sourcePath = join(ROOT, 'etc', 'cognitive-graphs', `${graphName}.json`)
    const source = await readFile(sourcePath, 'utf8')
    const graph = JSON.parse(source)

    if (graph.format !== 'svelte-flow') {
      throw new Error(`${graphName} is not a canonical Svelte Flow graph`)
    }

    const normalized = `${JSON.stringify(graph, null, 2)}\n`
    const destinations = [
      join(ROOT, 'apps', 'site', 'public', 'cognitive-graphs', `${graphName}.json`),
      join(ROOT, 'apps', 'react-native', 'nodejs-assets', 'nodejs-project', 'etc', 'cognitive-graphs', `${graphName}.json`),
    ]

    await Promise.all(destinations.map(destination => writeFile(destination, normalized)))
    console.log(`Synced ${graphName} to ${destinations.length} runtime artifacts`)
  }
}

void main()
