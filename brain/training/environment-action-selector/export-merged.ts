import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

import { REPOSITORY_ROOT } from './corpus.js'

const OUTPUT_ROOT = resolve(REPOSITORY_ROOT, 'out/environment-action-selector/training')
const PYTHON_PATH = resolve(REPOSITORY_ROOT, 'venv/bin/python')
const EXPORTER_PATH = resolve(REPOSITORY_ROOT, 'brain/training/export-merged-gguf.py')

interface FinalProvenance {
  owner?: string
  mode?: string
  baseModel?: string
  priorHeldOutUsed?: boolean
  selectionEvidence?: { digest?: string; checkpointPolicy?: string }
}

function parseRoot(arguments_: string[]): string {
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    const value = arguments_[index + 1]
    if (argument === '--') continue
    if (argument === '--root' && value) return resolve(value)
    throw new Error(`Unknown or incomplete argument: ${argument}`)
  }
  throw new Error('Usage: --root out/environment-action-selector/training/<final-run>')
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
  const root = parseRoot(arguments_)
  if (!root.startsWith(`${OUTPUT_ROOT}${sep}`)) {
    throw new Error(`Export root must remain under ${OUTPUT_ROOT}`)
  }
  const finalPath = resolve(root, 'final')
  const adapterPath = resolve(finalPath, 'adapter')
  const outputPath = resolve(finalPath, 'merged-gguf')
  const provenance = JSON.parse(await readFile(resolve(finalPath, 'run-provenance.json'), 'utf8')) as FinalProvenance
  if (
    provenance.owner !== 'environment-action-selector'
    || provenance.mode !== 'final-development-training'
    || provenance.baseModel !== 'unsloth/Qwen3.5-0.8B'
    || provenance.priorHeldOutUsed !== false
    || !provenance.selectionEvidence?.digest
  ) throw new Error('Final action-selector provenance is invalid')
  await Promise.all([
    access(resolve(adapterPath, 'adapter_model.safetensors')),
    access(PYTHON_PATH),
    access(EXPORTER_PATH),
  ])
  await runExporter(adapterPath, outputPath)

  const outputs = (await readdir(outputPath)).filter(name => name.endsWith('.gguf')).sort()
  const deployable = outputs.filter(name => name.toLowerCase().includes('no-mtp')
    && name.toLowerCase().includes('q4_k_m')
    && !name.toLowerCase().includes('mmproj'))
  if (deployable.length !== 1) throw new Error(`Expected one deployable Q4_K_M GGUF, found ${deployable.length}`)
  const artifact = deployable[0]!
  const artifactPath = resolve(outputPath, artifact)
  const artifactStat = await stat(artifactPath)
  await Promise.all([
    writeFile(resolve(outputPath, 'export-provenance.json'), `${JSON.stringify({
      version: 1,
      owner: 'environment-action-selector',
      purpose: 'merged-quantized-runtime-artifact',
      model: 'environment-action-selector-0.8b:v1',
      baseModel: provenance.baseModel,
      selectionEvidence: provenance.selectionEvidence,
      quantization: 'Q4_K_M',
      artifact,
      artifactBytes: artifactStat.size,
      artifactSha256: await fileDigest(artifactPath),
      mtpIncluded: false,
      exportedAt: new Date().toISOString(),
    }, null, 2)}\n`),
    writeFile(resolve(outputPath, 'Modelfile'), [
      `FROM ./${artifact}`,
      'TEMPLATE {{ .Prompt }}',
      'RENDERER qwen3.5',
      'PARSER qwen3.5',
      'PARAMETER num_ctx 2048',
      'PARAMETER num_predict 384',
      'PARAMETER temperature 0',
      '',
    ].join('\n')),
  ])
  console.log(`Merged action-selector GGUF: ${artifactPath}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
