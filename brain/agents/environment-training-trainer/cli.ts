#!/usr/bin/env node
/** Manual finite training cycle for owner-reviewed Environment specialists. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { compareEnvironmentSpecialistReports, getProfilePaths, getTargetUser, promoteEnvironmentSpecialist,
  resolveModelForCognitiveMode, withUserContext } from '@metahuman/core'

import { ACTION_SELECTOR_DIRECTORY, REPOSITORY_ROOT, sha256 } from '../../training/environment-action-selector/corpus.js'
import { main as train } from '../../training/environment-action-selector/train.js'
import { main as score } from '../../training/environment-action-selector/score-development.js'
import { main as exportLora } from '../../training/environment-action-selector/export-merged.js'
import { activateReviewedLora, withTrainingGpuCapacity } from '../../training/environment-action-selector/serve-promotion.js'

type Specialist = 'intent' | 'task'
interface CycleResult {
  specialist: Specialist
  baseModel: string
  root: string
  reviewedDataDigest: string
  frozenEvaluationDigest: string
  currentModelId: string
  previousPath: string
  endpoint: string
  currentReport: string
  candidateReport: string
  artifact: string
  comparison: ReturnType<typeof compareEnvironmentSpecialistReports>
  promotedModelId: string | null
}
const TRAINING_ROOT = resolve(REPOSITORY_ROOT, 'out/environment-action-selector/training')
const EVALUATOR = resolve(ACTION_SELECTOR_DIRECTORY, 'evaluate_qwen_checkpoint.py')
const FROZEN_EVALUATION = resolve(ACTION_SELECTOR_DIRECTORY, 'specialist-evaluation.jsonl')

async function run(command: string, arguments_: string[]): Promise<void> {
  const child = spawn(command, arguments_, { cwd: REPOSITORY_ROOT, env: process.env, stdio: 'inherit' })
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolveExit(code ?? 1))
  })
  if (exitCode !== 0) throw new Error(`${command} exited with code ${exitCode}`)
}

async function evaluate(root: string, label: 'candidate' | 'current', adapter: string,
  config: string, records: string): Promise<string> {
  const predictions = resolve(root, `${label}-predictions.jsonl`)
  const report = resolve(root, `${label}-evaluation.json`)
  await run(resolve(REPOSITORY_ROOT, 'venv/bin/python'), [EVALUATOR,
    '--split', 'evaluation', '--data', records, '--adapter', adapter,
    '--config', config, '--output', predictions])
  await score(['--root', root, '--predictions', predictions, '--records', records, '--output', report])
  return report
}

/** Native training identity follows the selected exported adapter, including reviewed cycles. */
export async function readSelectedTrainingSource(current: { adapters: string[]; baseModel?: string }) {
  const artifact = current.adapters[0]
  if (!artifact) throw new Error('Active model has no comparable PEFT adapter')
  // Both maintained exporters place the GGUF under <stage>/<export>/adapter-gguf/.
  const stage = dirname(dirname(dirname(artifact)))
  const adapter = resolve(stage, 'adapter')
  const provenance = JSON.parse(await readFile(resolve(stage, 'run-provenance.json'), 'utf8'))
  const config = JSON.parse(await readFile(resolve(stage, 'training-config.json'), 'utf8'))
  const native = JSON.parse(await readFile(resolve(adapter, 'adapter_config.json'), 'utf8'))
  const baseModel = provenance.baseModel
  if (baseModel !== current.baseModel || config.base_model !== baseModel
    || native.base_model_name_or_path !== baseModel) {
    throw new Error('Selected adapter and native training base provenance disagree')
  }
  return { adapter, baseModel: baseModel as string }
}

async function runSpecialist(username: string, specialist: Specialist, reviewedFile: string,
  evaluation: string[], runLabel: string): Promise<CycleResult | null> {
  const reviewed = await readFile(reviewedFile, 'utf8')
  if (!reviewed.trim()) return null
  const role = specialist === 'intent' ? 'orchestrator' : 'environmentActionSelector'
  const current = resolveModelForCognitiveMode('environment', role, username)
  const { adapter: currentAdapter, baseModel } = await readSelectedTrainingSource(current)

  const root = resolve(TRAINING_ROOT, `${specialist}-reviewed-${runLabel}`)
  const evaluated = evaluation.filter(line => JSON.parse(line).metadata.specialist === specialist)
  if (!evaluated.length) throw new Error(`${specialist}: frozen evaluation has no records`)
  await mkdir(root, { recursive: true })
  const records = resolve(root, 'frozen-evaluation.jsonl')
  await writeFile(records, `${evaluated.join('\n')}\n`)
  await train(['--specialist', specialist, '--base-model', baseModel, '--reviewed-data', reviewedFile, '--output', root])

  const config = resolve(root, 'reviewed/training-config.json')
  const candidateAdapter = resolve(root, 'reviewed/adapter')
  const currentReport = await evaluate(root, 'current', currentAdapter, config, records)
  const candidateReport = await evaluate(root, 'candidate', candidateAdapter, config, records)
  await exportLora(['--root', root, '--lora-only'])
  const artifact = resolve(root, 'reviewed/merged-gguf/adapter-gguf/adapter.F16.gguf')
  await access(artifact)
  const comparison = compareEnvironmentSpecialistReports(
    JSON.parse(await readFile(currentReport, 'utf8')),
    JSON.parse(await readFile(candidateReport, 'utf8')),
  )
  const previousPath = current.adapters[0]
  const endpoint = current.options.endpoint
  if (typeof previousPath !== 'string' || typeof endpoint !== 'string') {
    throw new Error(`${specialist}: active shared-server LoRA binding is incomplete`)
  }
  const result: CycleResult = { specialist, baseModel, root, reviewedDataDigest: sha256(reviewed),
    frozenEvaluationDigest: sha256(evaluated), currentModelId: current.id,
    previousPath, endpoint, currentReport, candidateReport, artifact, comparison,
    promotedModelId: null }
  await writeFile(resolve(root, 'cycle-result.json'), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

async function main(): Promise<void> {
  const username = process.argv.includes('--username')
    ? process.argv[process.argv.indexOf('--username') + 1] : process.env.MH_TRIGGER_USERNAME
  const user = getTargetUser(username ? { username } : undefined)
  if (!user) throw new Error('An authenticated profile is required')
  const specialistOption = process.argv.includes('--specialist')
    ? process.argv[process.argv.indexOf('--specialist') + 1] : 'all'
  if (!['all', 'intent', 'task'].includes(specialistOption ?? '')) throw new Error('--specialist must be intent, task, or all')
  await withUserContext(user, async () => {
    await run(process.execPath, ['--import', 'tsx',
      resolve(REPOSITORY_ROOT, 'scripts/environment-training-bank.ts'), 'export', '--username', user.username])
    const directory = resolve(getProfilePaths(user.username).out, 'environment-action-selector/reviewed')
    const evaluation = (await readFile(FROZEN_EVALUATION, 'utf8')).trim().split('\n').filter(Boolean)
    const runLabel = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    const specialists: Specialist[] = specialistOption === 'all' ? ['intent', 'task'] : [specialistOption as Specialist]
    const approved = await Promise.all(specialists.map(async specialist => ({
      specialist, file: resolve(directory, `${specialist}.jsonl`),
      contents: await readFile(resolve(directory, `${specialist}.jsonl`), 'utf8'),
    })))
    const ready = approved.filter(value => value.contents.trim())
    const results = await (ready.length ? withTrainingGpuCapacity(async () => {
      const completed: CycleResult[] = []
      for (const { specialist, file } of ready) {
        const result = await runSpecialist(user.username, specialist, file, evaluation, runLabel)
        if (result) completed.push(result)
      }
      return completed
    }) : Promise.resolve([] as CycleResult[]))
    for (const result of results) {
      if (!result.comparison.promote) continue
      result.promotedModelId = await activateReviewedLora({
        baseModel: result.baseModel, previousPath: result.previousPath, nextPath: result.artifact, endpoint: result.endpoint,
        commit: () => promoteEnvironmentSpecialist({ username: user.username,
          specialist: result.specialist, previousModelId: result.currentModelId,
          artifactPath: result.artifact, run: result.root.split('/').at(-1)!,
          currentReport: result.currentReport, evaluationReport: result.candidateReport }),
      })
      await writeFile(resolve(result.root, 'cycle-result.json'), `${JSON.stringify(result, null, 2)}\n`)
    }
    console.log(JSON.stringify({ username: user.username, results }, null, 2))
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
