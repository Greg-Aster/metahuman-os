/**
 * Remote training lifecycle. Core owns provider transport, configuration and
 * artifact acceptance; this worker owns SSH transfer and finite job execution.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { systemPaths, ProgressTracker, loadRunpodConfig, safeWriteJSON, parseTrainingCandidateResult } from '@metahuman/core'
import { callRunpodGraphQL, terminateTrainingPod } from '@metahuman/core/providers'
import { loadS3ConfigFromEnv, uploadDirectoryToS3 } from '@metahuman/core/s3-upload'

export interface RunRemoteTrainingOptions {
  DATE_STR: string
  RUN_LABEL: string
  run_id?: string | null
  WORK_LOCAL: string
  OUT_ROOT: string
  FINAL_ADAPTER_DIR: string
  RAW_DATA_FILE: string
  CLEAN_DATA_FILE: string
  EVAL_DATA_FILE: string
  DATASET_MANIFEST_FILE: string
  CONFIG_FILE: string
  SUMMARY_FILE: string
  samples_used: number
  username: string
  signal?: AbortSignal
}

interface RunRemoteTrainingResult {
  pod_id: string | null
  podName: string
  creationRequestedAt?: string
  cleanupConfirmedAt?: string
  ssh_user: string | null
  ssh_host: string | null
  training_success: boolean
  terminated: boolean
  upload_verification?: string
  gguf_path?: string
  s3_url?: string
  s3_key?: string
  error?: string
  termination_error?: string
}

interface SshConnection { user: string; host: string; port: number; key: string; knownHosts: string }
interface CommandResult { stdout: string; stderr: string; exitCode: number }

export function quoteShell(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

function sshArguments(connection: SshConnection): string[] {
  return [
    '-T', '-p', String(connection.port), '-i', connection.key,
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4',
    '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=' + connection.knownHosts,
    connection.user + '@' + connection.host,
  ]
}

async function ssh(
  connection: SshConnection, command: string,
  options: { signal?: AbortSignal; upload?: string; download?: string; stream?: boolean } = {},
): Promise<CommandResult> {
  options.signal?.throwIfAborted()
  const child = spawn('ssh', [...sshArguments(connection), command], {
    signal: options.signal, stdio: ['pipe', 'pipe', 'pipe'],
  })
  const output = options.download ? fs.createWriteStream(options.download, { flags: 'wx', mode: 0o600 }) : undefined
  const input = options.upload ? fs.createReadStream(options.upload) : undefined
  let stdout = ''
  let stderr = ''
  const completion = new Promise<number>((resolve, reject) => {
    let failure: Error | undefined
    child.once('error', error => { failure = error })
    child.stdin.once('error', error => { failure = error; child.kill() })
    child.once('close', (code, signal) => {
      if (failure || signal) reject(failure ?? new Error('SSH ended with signal ' + signal))
      else resolve(code ?? 1)
    })
    input?.once('error', error => { failure = error; child.kill() })
    output?.once('error', error => { failure = error; child.kill() })
  })
  input ? input.pipe(child.stdin) : child.stdin.end()
  if (output) child.stdout.pipe(output)
  else child.stdout.on('data', data => {
    if (options.stream) process.stdout.write(data)
    else stdout = (stdout + data.toString()).slice(-1_000_000)
  })
  child.stderr.on('data', data => {
    stderr = (stderr + data.toString()).slice(-20_000)
    if (options.stream) process.stderr.write(data)
  })
  try {
    const outputFinished = output ? new Promise<void>((resolve, reject) => {
      output.once('finish', resolve)
      output.once('error', reject)
    }) : Promise.resolve()
    const results = await Promise.allSettled([completion, outputFinished])
    for (const result of results) if (result.status === 'rejected') throw result.reason
    return { stdout, stderr, exitCode: (results[0] as PromiseFulfilledResult<number>).value }
  } finally {
    input?.destroy()
    output?.destroy()
  }
}

function requireCommand(result: CommandResult, stage: string): void {
  if (result.exitCode !== 0) throw new Error(stage + ' failed: ' + result.stderr.trim() + ' (exit ' + result.exitCode + ')')
}

export async function runRemoteTraining(opts: RunRemoteTrainingOptions): Promise<RunRemoteTrainingResult> {
  opts.signal?.throwIfAborted()
  const provider = loadRunpodConfig(opts.username)
  if (!provider.apiKey || !provider.templateId || !provider.gpuType) throw new Error('Complete RunPod settings are required')
  const cfg = JSON.parse(fs.readFileSync(opts.CONFIG_FILE, 'utf8'))
  const manifest = JSON.parse(fs.readFileSync(opts.DATASET_MANIFEST_FILE, 'utf8'))
  if (cfg.base_model !== manifest.baseModel) throw new Error('Config and frozen dataset base models differ')
  const key = process.env.RUNPOD_SSH_KEY_PATH || path.join(os.homedir(), '.ssh', 'id_ed25519')
  if (!fs.existsSync(key) || !fs.existsSync(key + '.pub')) throw new Error('Configure RUNPOD_SSH_KEY_PATH with an existing SSH key pair before training')
  const publicKey = fs.readFileSync(key + '.pub', 'utf8').trim()
  if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+) [A-Za-z0-9+/=]+(?: .*)?$/.test(publicKey)) throw new Error('Training SSH public key is invalid')
  const s3 = process.env.METAHUMAN_DISABLE_S3 === '0' ? loadS3ConfigFromEnv() : null
  if (process.env.METAHUMAN_DISABLE_S3 === '0' && !s3) throw new Error('S3 backup was requested but its credentials are incomplete')
  const script = path.join(systemPaths.root, 'docker/runpod-trainer/train_unsloth.py')
  for (const file of [script, opts.CLEAN_DATA_FILE, opts.EVAL_DATA_FILE, opts.DATASET_MANIFEST_FILE, opts.CONFIG_FILE]) {
    if (!fs.statSync(file).isFile()) throw new Error('Training input is not a file: ' + file)
  }
  fs.mkdirSync(opts.FINAL_ADAPTER_DIR, { recursive: true, mode: 0o700 })
  if (fs.readdirSync(opts.FINAL_ADAPTER_DIR).length) throw new Error('Candidate output directory must be empty')
  const tracker = new ProgressTracker('lora-training-' + opts.RUN_LABEL, [
    'initialization', 'pod_creation', 'ssh_connection', 'file_upload', 'training', 'adapter_download', 'pod_termination',
  ], opts.WORK_LOCAL)
  tracker.setMetadata({ username: opts.username, runLabel: opts.RUN_LABEL, model: cfg.base_model, samples: opts.samples_used })
  const summary: RunRemoteTrainingResult = {
    pod_id: null, podName: 'metahuman-training-' + opts.username + '-' + opts.RUN_LABEL,
    ssh_user: null, ssh_host: null, training_success: false, terminated: false,
  }
  const saveSummary = () => safeWriteJSON(opts.SUMMARY_FILE, {
    ...summary, username: opts.username, runLabel: opts.RUN_LABEL, datasetId: manifest.datasetId,
    baseModel: cfg.base_model, candidateDirectory: opts.FINAL_ADAPTER_DIR,
  })
  const controller = new AbortController()
  const cancel = () => controller.abort(new Error('Remote training was cancelled'))
  process.once('SIGTERM', cancel)
  process.once('SIGINT', cancel)
  opts.signal?.addEventListener('abort', cancel, { once: true })
  tracker.startStage('initialization', 'Validated configuration and frozen inputs')
  tracker.completeStage('initialization')
  saveSummary()
  try {
    controller.signal.throwIfAborted()
    tracker.startStage('pod_creation', 'Requesting configured GPU: ' + provider.gpuType)
    summary.creationRequestedAt = new Date().toISOString()
    saveSummary()
    // A create with an uncertain response must never be retried: it may have
    // allocated a billable pod. Persist its identifier immediately on receipt.
    const created = await callRunpodGraphQL<{ podFindAndDeployOnDemand: { id: string } }>(
      provider.apiKey,
      'mutation CreateTrainingPod($input: PodFindAndDeployOnDemandInput) { podFindAndDeployOnDemand(input: $input) { id } }',
      { input: {
        templateId: provider.templateId, gpuTypeId: provider.gpuType, cloudType: 'ALL',
        name: summary.podName, gpuCount: 1,
        minVcpuCount: 4, minMemoryInGb: 32, volumeInGb: 306, containerDiskInGb: 40,
        ports: '22/tcp', supportPublicIp: true, startSsh: true,
        env: [{ key: 'SSH_PUBLIC_KEY', value: publicKey }],
      } },
    )
    if (!created.podFindAndDeployOnDemand?.id) throw new Error('RunPod creation has no pod receipt; inspect your provider account before retrying')
    summary.pod_id = created.podFindAndDeployOnDemand.id
    saveSummary()
    tracker.completeStage('pod_creation')
    tracker.startStage('ssh_connection', 'Waiting for the pod and its exposed SSH port')
    let connection: SshConnection | undefined
    for (let attempt = 0; attempt < 120; attempt++) {
      controller.signal.throwIfAborted()
      const status = await callRunpodGraphQL<{ pod: {
        desiredStatus: string; runtime?: { ports?: Array<{ ip: string; isIpPublic: boolean; privatePort: number; publicPort: number }> }
      } | null }>(provider.apiKey,
        'query TrainingPod($id: String!) { pod(input: { podId: $id }) { desiredStatus runtime { ports { ip isIpPublic privatePort publicPort } } } }',
        { id: summary.pod_id }, { signal: controller.signal })
      if (!status.pod) throw new Error('The training pod no longer exists')
      if (status.pod.desiredStatus !== 'RUNNING') throw new Error('Training pod is not requested to run: ' + status.pod.desiredStatus)
      const port = status.pod.runtime?.ports?.find(port => port.isIpPublic && port.privatePort === 22)
      if (port && /^[a-fA-F0-9:.]+$/.test(port.ip) && Number.isInteger(port.publicPort) && port.publicPort > 0 && port.publicPort <= 65535) {
        const user = process.env.RUNPOD_DIRECT_SSH_USER || 'root'
        if (!/^[A-Za-z0-9_-]+$/.test(user)) throw new Error('RUNPOD_DIRECT_SSH_USER is invalid')
        const candidate = { user, host: port.ip, port: port.publicPort, key, knownHosts: path.join(opts.WORK_LOCAL, 'known_hosts') }
        const probe = await ssh(candidate, 'true', { signal: controller.signal })
        if (probe.exitCode === 0) { connection = candidate; break }
      }
      await delay(5000, undefined, { signal: controller.signal })
    }
    if (!connection) throw new Error('Training pod did not expose a working SSH service within ten minutes')
    summary.ssh_user = connection.user
    summary.ssh_host = connection.host
    saveSummary()
    tracker.completeStage('ssh_connection')
    tracker.startStage('file_upload', 'Uploading frozen training and evaluation inputs')
    const remoteRoot = '/workspace/metahuman-training-' + opts.RUN_LABEL
    if (!/^[0-9A-Za-z_-]+$/.test(opts.RUN_LABEL)) throw new Error('Invalid run label')
    requireCommand(await ssh(connection, 'mkdir -m 700 ' + quoteShell(remoteRoot), { signal: controller.signal }), 'Run directory creation')
    const uploads = [
      [script, 'train_unsloth.py'], [path.join(systemPaths.root, 'docker/runpod-trainer/requirements.txt'), 'requirements.txt'],
      [opts.CLEAN_DATA_FILE, 'train.jsonl'], [opts.EVAL_DATA_FILE, 'eval.jsonl'],
      [opts.DATASET_MANIFEST_FILE, 'dataset-manifest.json'], [opts.CONFIG_FILE, 'config.json'],
    ]
    const verified: Record<string, string> = {}
    for (const [file, name] of uploads) {
      const destination = remoteRoot + '/' + name
      requireCommand(await ssh(connection, 'umask 077; cat > ' + quoteShell(destination), {
        signal: controller.signal, upload: file,
      }), 'Upload ' + name)
      const checksum = await ssh(connection, 'sha256sum ' + quoteShell(destination), { signal: controller.signal })
      requireCommand(checksum, 'Verify ' + name)
      verified[name] = await sha256File(file)
      if (checksum.stdout.trim().split(/\s+/)[0] !== verified[name]) throw new Error('Uploaded checksum mismatch: ' + name)
      if (name === 'requirements.txt') {
        requireCommand(await ssh(connection,
          '/workspace/unsloth-venv/bin/python -m pip check && /workspace/unsloth-venv/bin/python ' +
          quoteShell(remoteRoot + '/train_unsloth.py') + ' --check-environment',
          { signal: controller.signal }), 'Pinned training environment validation')
      }
    }
    summary.upload_verification = createHash('sha256').update(JSON.stringify(verified)).digest('hex')
    saveSummary()
    tracker.completeStage('file_upload')
    tracker.startStage('training', 'Training and evaluating the serialized candidate')
    const command = [
      '/workspace/unsloth-venv/bin/python', remoteRoot + '/train_unsloth.py',
      '--data', remoteRoot + '/train.jsonl', '--eval-data', remoteRoot + '/eval.jsonl',
      '--manifest', remoteRoot + '/dataset-manifest.json', '--config', remoteRoot + '/config.json',
      '--output', remoteRoot + '/candidate',
    ].map(quoteShell).join(' ')
    requireCommand(await ssh(connection, command, { signal: controller.signal, stream: true }), 'Remote trainer')
    tracker.completeStage('training')
    tracker.startStage('adapter_download', 'Verifying candidate artifacts')
    const receipt = await ssh(connection, 'cat ' + quoteShell(remoteRoot + '/candidate/training-result.json'), { signal: controller.signal })
    requireCommand(receipt, 'Read candidate receipt')
    const result = parseTrainingCandidateResult(JSON.parse(receipt.stdout), manifest.datasetId, cfg.base_model)
    if (cfg.gguf_conversion?.enabled && !result.artifacts['model.gguf']) throw new Error('Requested GGUF was not produced')
    for (const [name, expected] of Object.entries(result.artifacts)) {
      const localFile = path.join(opts.FINAL_ADAPTER_DIR, name)
      requireCommand(await ssh(connection, 'cat ' + quoteShell(remoteRoot + '/candidate/' + name), {
        signal: controller.signal, download: localFile,
      }), 'Download ' + name)
      if (await sha256File(localFile) !== expected) throw new Error('Downloaded checksum mismatch: ' + name)
    }
    // Publish the candidate receipt only after every declared file is verified.
    safeWriteJSON(path.join(opts.FINAL_ADAPTER_DIR, 'training-result.json'), result)
    summary.training_success = true
    if (result.artifacts['model.gguf']) summary.gguf_path = path.join(opts.FINAL_ADAPTER_DIR, 'model.gguf')
    saveSummary()
    tracker.completeStage('adapter_download')
  } catch (error) {
    summary.training_success = false
    summary.error = (error as Error).message
    tracker.fail(summary.error)
  } finally {
    // SIGTERM/SIGINT abort SSH, then reach provider cleanup. The durable summary
    // retains an unconfirmed pod receipt for the launcher's recovery/stop action.
    if (summary.creationRequestedAt) {
      tracker.startStage('pod_termination', 'Confirming cleanup for ' + summary.podName)
      try {
        const result = await terminateTrainingPod(provider.apiKey, { podId: summary.pod_id, podName: summary.podName })
        summary.pod_id = result.podId
        summary.terminated = true
        summary.cleanupConfirmedAt = result.confirmedAt
        tracker.completeStage('pod_termination')
      } catch (error) {
        summary.termination_error = (error as Error).message
        summary.training_success = false
        summary.error = 'Pod termination was not confirmed: ' + summary.termination_error
        tracker.fail(summary.error)
      }
    }
    process.removeListener('SIGTERM', cancel)
    process.removeListener('SIGINT', cancel)
    opts.signal?.removeEventListener('abort', cancel)
    saveSummary()
  }
  // S3 is an explicit backup of the verified local candidate, using the existing
  // Core S3 owner after GPU termination. It never replaces artifact verification.
  if (summary.training_success && s3) {
    const backup = await uploadDirectoryToS3(opts.FINAL_ADAPTER_DIR, opts.username + '/' + opts.RUN_LABEL, s3)
    if (!backup.success) {
      summary.training_success = false
      summary.error = 'Requested S3 backup failed: ' + backup.error
      tracker.fail(summary.error)
    } else {
      summary.s3_url = backup.s3Url
      summary.s3_key = backup.s3Key
    }
    saveSummary()
  }
  if (summary.training_success) tracker.complete('Candidate downloaded and verified; activation requires review')
  return summary
}
