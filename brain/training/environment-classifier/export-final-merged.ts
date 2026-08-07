import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readdir, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPOSITORY_ROOT } from './corpus.js'
import { loadScoredFinalArtifact } from './final-artifact.js'

const PYTHON_PATH = resolve(REPOSITORY_ROOT, 'venv/bin/python')
const EXPORTER_PATH = resolve(REPOSITORY_ROOT, 'brain/training/export-merged-gguf.py')

function parseRoot(arguments_: string[]): string {
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === '--') continue
    if (argument === '--root' && value) return value
    throw new Error(`Unknown or incomplete argument: ${argument}`)
  }
  throw new Error('Usage: --root out/environment-classifier/training/<final-run>')
}

async function fileDigest(path: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

async function runExporter(adapterPath: string, outputPath: string): Promise<void> {
  const child = spawn(PYTHON_PATH, [
    EXPORTER_PATH,
    '--adapter', adapterPath,
    '--output', outputPath,
  ], {
    cwd: REPOSITORY_ROOT,
    env: process.env,
    stdio: 'inherit',
  })
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolveExit(code ?? 1))
  })
  if (exitCode !== 0) throw new Error(`Merged GGUF exporter exited with code ${exitCode}`)
}

export async function main(arguments_: string[] = process.argv.slice(2)): Promise<void> {
  const { finalPath, adapterPath, provenance, receipt } = await loadScoredFinalArtifact(parseRoot(arguments_))
  const outputPath = resolve(finalPath, 'merged-gguf')
  await access(PYTHON_PATH)
  await access(EXPORTER_PATH)
  await runExporter(adapterPath, outputPath)

  const outputs = (await readdir(outputPath)).filter(name => name.endsWith('.gguf')).sort()
  const deployableOutputs = outputs.filter(name => !name.toLowerCase().includes('mmproj')
    && name.toLowerCase().includes('no-mtp')
    && name.toLowerCase().includes('q4_k_m'))
  if (deployableOutputs.length !== 1) {
    throw new Error(`Expected one merged Q4_K_M text artifact, found ${deployableOutputs.length}`)
  }
  const artifactPath = resolve(outputPath, deployableOutputs[0])
  const artifactStat = await stat(artifactPath)
  await writeFile(resolve(outputPath, 'export-provenance.json'), `${JSON.stringify({
    version: 1,
    owner: 'environment-classifier',
    purpose: 'merged-quantized-runtime-artifact',
    sourceModel: receipt.model,
    baseModel: provenance.baseModel,
    heldOutUsed: false,
    quantization: 'Q4_K_M',
    artifact: deployableOutputs[0],
    artifactBytes: artifactStat.size,
    artifactSha256: await fileDigest(artifactPath),
    auxiliaryGgufFiles: outputs.filter(name => name !== deployableOutputs[0]),
    mtpIncluded: false,
    exportedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8')
  await writeFile(resolve(outputPath, 'Modelfile'), [
    `FROM ./${deployableOutputs[0]}`,
    'TEMPLATE {{ .Prompt }}',
    'RENDERER qwen3.5',
    'PARSER qwen3.5',
    'PARAMETER num_ctx 2048',
    'PARAMETER num_predict 512',
    'PARAMETER temperature 0',
    '',
  ].join('\n'), 'utf8')
  console.log(`Merged GGUF artifact: ${artifactPath}`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
