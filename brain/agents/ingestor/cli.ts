#!/usr/bin/env npx tsx
/**
 * Ingestor Agent — CLI Entry Point
 *
 * Converts files in memory/inbox into episodic memories.
 *
 * Usage:
 *   npx tsx brain/agents/ingestor/cli.ts [options]
 *
 * Options:
 *   --limit=N       Process at most N files
 *   --max-chars=N   Store at most N characters per memory chunk
 */

import { initGlobalLogger } from '@metahuman/core'
import { parseIngestorOptions, runIngestor } from './core.js'

async function main() {
  initGlobalLogger('ingestor')

  try {
    const options = parseIngestorOptions(process.argv.slice(2))
    const result = await runIngestor(options)
    console.log(
      `[ingestor] ${result.success ? 'Completed' : 'Failed'}: ${result.filesProcessed} processed, ${result.filesFailed} failed, ${result.chunksDeduplicated} deduplicated`,
    )
    if (result.errors.length > 0) console.error('[ingestor] Errors:', result.errors)
    process.exit(result.success ? 0 : 1)
  } catch (error) {
    console.error('[ingestor] Fatal error:', error)
    process.exit(1)
  }
}

main()
