#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_MAJOR = 22
const REQUIRED_MINOR = 3
const currentVersion = process.versions.node
const [major, minor] = currentVersion.split('.').map(Number)
const quiet = process.argv.includes('--quiet')
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const recommendedVersion = fs.readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim()
const supported = major === REQUIRED_MAJOR && minor >= REQUIRED_MINOR

if (!supported) {
  if (!quiet) {
    console.error(
      `MetaHuman OS requires Node.js >=22.3.0 <23; found ${currentVersion} at ${process.execPath}.`,
    )
    console.error(`Install and activate the repo runtime with: nvm install ${recommendedVersion} && nvm use`)
  }
  process.exit(1)
}

if (!quiet) {
  console.log(`Node.js ${currentVersion} runtime contract satisfied (${process.execPath})`)
}
