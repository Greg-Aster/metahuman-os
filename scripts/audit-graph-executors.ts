#!/usr/bin/env tsx
/**
 * Report graph node executor coverage.
 *
 * This is intentionally a report-only audit by default. It does not change
 * runtime behavior and is not part of startup.
 *
 * Use --fail-on-missing when a CI/check workflow should fail on missing
 * executor coverage.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  findMissingExecutors,
  validateSvelteFlowGraph,
  type SvelteFlowGraph,
} from '../packages/core/src/index.js'

interface GraphCoverage {
  file: string;
  graphName: string;
  nodeCount: number;
  missing: ReturnType<typeof findMissingExecutors>;
}

const failOnMissing = process.argv.includes('--fail-on-missing')
const graphsRoot = path.join(process.cwd(), 'etc', 'cognitive-graphs')

function collectGraphFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'backups') continue
      files.push(...collectGraphFiles(fullPath))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath)
    }
  }

  return files.sort()
}

function loadGraph(filePath: string): SvelteFlowGraph {
  const raw = readFileSync(filePath, 'utf-8')
  return validateSvelteFlowGraph(JSON.parse(raw))
}

const files = statSync(graphsRoot).isDirectory() ? collectGraphFiles(graphsRoot) : []
const reports: GraphCoverage[] = []
let invalidCount = 0

for (const file of files) {
  const relative = path.relative(process.cwd(), file)
  try {
    const graph = loadGraph(file)
    reports.push({
      file: relative,
      graphName: graph.name || path.basename(file),
      nodeCount: graph.nodes.length,
      missing: findMissingExecutors(graph),
    })
  } catch (error) {
    invalidCount++
    console.error(`[graph-executor-audit] Invalid graph ${relative}: ${(error as Error).message}`)
  }
}

const missingReports = reports.filter(report => report.missing.length > 0)
const totalNodes = reports.reduce((sum, report) => sum + report.nodeCount, 0)
const missingCount = missingReports.reduce((sum, report) => sum + report.missing.length, 0)

console.log('\nGraph executor coverage audit')
console.log('='.repeat(36))
console.log(`Graphs checked: ${reports.length}`)
console.log(`Nodes checked: ${totalNodes}`)
console.log(`Invalid graphs: ${invalidCount}`)
console.log(`Missing executors: ${missingCount}`)

if (missingReports.length > 0) {
  console.log('\nMissing executor details')
  console.log('-'.repeat(36))
  for (const report of missingReports) {
    console.log(`\n${report.file} (${report.graphName})`)
    for (const missing of report.missing) {
      const label = missing.label ? `, label="${missing.label}"` : ''
      console.log(`  - node ${missing.nodeId}: ${missing.nodeType}${label}`)
    }
  }
} else {
  console.log('\nAll checked graph nodes have registered executors.')
}

if (invalidCount > 0 || (failOnMissing && missingCount > 0)) {
  process.exit(1)
}

process.exit(0)
