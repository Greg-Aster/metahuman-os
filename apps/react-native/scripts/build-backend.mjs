#!/usr/bin/env node

import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const mobileDirectory = path.dirname(scriptDirectory)
const repositoryRoot = path.resolve(mobileDirectory, '../..')
const coreDirectory = path.join(repositoryRoot, 'packages/core')
const brainDirectory = path.join(repositoryRoot, 'brain')
const nodeProjectDirectory = process.env.METAHUMAN_MOBILE_NODE_PROJECT
  ? path.resolve(process.env.METAHUMAN_MOBILE_NODE_PROJECT)
  : path.join(mobileDirectory, 'nodejs-assets/nodejs-project')
const outputDirectory = path.join(nodeProjectDirectory, 'dist')
const configOutputDirectory = path.join(nodeProjectDirectory, 'etc')

const importMetaUrlPlugin = {
  name: 'import-meta-url',
  setup(build) {
    build.onLoad({ filter: /\.[jt]sx?$/ }, async args => {
      const contents = await fs.promises.readFile(args.path, 'utf8')
      if (!contents.includes('import.meta.url')) return null

      const transformed = contents.replace(
        /import\.meta\.url/g,
        `(typeof __filename !== 'undefined' ? require('url').pathToFileURL(__filename).href : 'file://' + (process.env.METAHUMAN_ROOT || '/data/local/tmp') + '/main.js')`,
      )
      const extension = path.extname(args.path)
      const loader = extension === '.js' || extension === '.mjs'
        ? 'js'
        : extension === '.tsx'
          ? 'tsx'
          : extension === '.jsx'
            ? 'jsx'
            : 'ts'
      return { contents: transformed, loader }
    })
  },
}

async function buildBundle(label, entryPoint, outputFile) {
  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: outputFile,
    plugins: [importMetaUrlPlugin],
    external: ['rn-bridge'],
    alias: { '@metahuman/core': path.join(coreDirectory, 'src') },
    sourcemap: true,
    minify: false,
    treeShaking: true,
    logLevel: 'warning',
  })
  const sizeKiB = fs.statSync(outputFile).size / 1024
  console.log(`[mobile-backend] ${label}: ${sizeKiB.toFixed(1)} KiB`)
}

function copyJsonFiles(sourceDirectory, destinationDirectory) {
  if (!fs.existsSync(sourceDirectory)) return
  fs.mkdirSync(destinationDirectory, { recursive: true })
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      fs.copyFileSync(
        path.join(sourceDirectory, entry.name),
        path.join(destinationDirectory, entry.name),
      )
    }
  }
}

function syncConfigAssets() {
  fs.rmSync(configOutputDirectory, { recursive: true, force: true })
  fs.mkdirSync(configOutputDirectory, { recursive: true })

  for (const name of ['agents.json', 'llm-backend.json', 'models.json']) {
    fs.copyFileSync(
      path.join(repositoryRoot, 'etc', name),
      path.join(configOutputDirectory, name),
    )
  }

  const graphSource = path.join(repositoryRoot, 'etc/cognitive-graphs')
  const graphOutput = path.join(configOutputDirectory, 'cognitive-graphs')
  copyJsonFiles(graphSource, graphOutput)
  copyJsonFiles(path.join(graphSource, 'custom'), path.join(graphOutput, 'custom'))
  console.log('[mobile-backend] Configuration copied from canonical etc owners')
}

async function main() {
  fs.rmSync(outputDirectory, { recursive: true, force: true })
  fs.mkdirSync(outputDirectory, { recursive: true })

  await buildBundle(
    'agent handlers',
    path.join(brainDirectory, 'mobile-handlers.ts'),
    path.join(outputDirectory, 'handlers.js'),
  )
  await buildBundle(
    'HTTP adapter',
    path.join(coreDirectory, 'src/api/adapters/http.ts'),
    path.join(outputDirectory, 'http-adapter.js'),
  )
  syncConfigAssets()
}

main().catch(error => {
  console.error('[mobile-backend] Build failed:', error)
  process.exitCode = 1
})
