/**
 * LoRA Trainer Agent (Remote Orchestrator)
 * This agent orchestrates the entire remote training lifecycle on RunPod.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { paths, audit, ProgressTracker, getProfilePaths } from '../../packages/core/src/index.js';
import dotenv from 'dotenv';
import { ensureDirSync } from 'fs-extra';
import fetch from 'node-fetch';
import {
  loadS3ConfigFromEnv,
  uploadDirectoryToS3,
  uploadFileToS3,
  type S3Config,
} from '../../packages/core/src/s3-upload.js';

// Load environment variables from .env file
dotenv.config({ path: path.join(paths.root, '.env') });

const RUNPOD_API_BASE = 'https://api.runpod.io/graphql';

interface RunRemoteTrainingOptions {
  DATE_STR: string;
  RUN_LABEL: string;
  run_id?: string | null;
  WORK_LOCAL: string;
  OUT_ROOT: string;
  FINAL_ADAPTER_DIR: string;
  RAW_DATA_FILE: string;
  CLEAN_DATA_FILE: string;
  CONFIG_FILE: string;
  SUMMARY_FILE: string;
  samples_used: number;
  username: string; // Username for profile access
}

interface RunRemoteTrainingResult {
  pod_id: string | null;
  ssh_user: string | null;
  ssh_host: string | null;
  training_success: boolean;
  terminated: boolean;
  upload_verification?: string;
  gguf_path?: string;
  ollama_model?: string;
  ollama_loaded?: boolean;
  s3_url?: string;
  s3_key?: string;
}

// Helper to write logs to a dedicated file
function log(logFilePath: string, message: string) {
  console.log(`[lora-trainer] ${message}`);
  fs.appendFileSync(logFilePath, `[${new Date().toISOString()}] ${message}\n`);
}

async function sshExecNoPty(ssh_user: string, ssh_host: string, ssh_key_path: string, remoteCmd: string, ssh_port?: number | null): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const args: string[] = [
      '-T',
      '-vv',  // Verbose SSH debugging
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',  // 10 second timeout
      '-o', 'ServerAliveInterval=30',  // Send keepalive every 30 seconds
      '-o', 'ServerAliveCountMax=999',  // Allow 999 missed keepalives (8+ hours)
      '-o', 'TCPKeepAlive=yes',  // Enable TCP keepalive
    ];
    if (ssh_port) {
      args.push('-p', String(ssh_port));
    }
    args.push('-i', ssh_key_path, `${ssh_user}@${ssh_host}`, remoteCmd);
    const ssh = spawn('ssh', args);

    let stdout = '';
    let stderr = '';

    ssh.stdout.on('data', (data) => { stdout += data.toString(); });
    ssh.stderr.on('data', (data) => { stderr += data.toString(); });

    ssh.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode || 0 });
    });

    ssh.on('error', (err) => {
      console.error('SSH command failed to start:', err);
      resolve({ stdout: '', stderr: err.message, exitCode: -1 });
    });
  });
}

// Streaming version that writes stdout directly to a file (for large outputs like tar+base64)
async function sshExecToFile(ssh_user: string, ssh_host: string, ssh_key_path: string, remoteCmd: string, outputFilePath: string, ssh_port?: number | null): Promise<{ stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const args: string[] = [
      '-T',
      '-vv',  // Verbose SSH debugging
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=999',
      '-o', 'TCPKeepAlive=yes',
    ];
    if (ssh_port) {
      args.push('-p', String(ssh_port));
    }
    args.push('-i', ssh_key_path, `${ssh_user}@${ssh_host}`, remoteCmd);
    const ssh = spawn('ssh', args);

    const fileStream = fs.createWriteStream(outputFilePath);
    let stderr = '';

    // Stream stdout directly to file (avoids string length limits)
    ssh.stdout.pipe(fileStream);
    ssh.stderr.on('data', (data) => { stderr += data.toString(); });

    ssh.on('close', (exitCode) => {
      fileStream.end();
      resolve({ stderr, exitCode: exitCode || 0 });
    });

    ssh.on('error', (err) => {
      console.error('SSH command failed to start:', err);
      fileStream.end();
      resolve({ stderr: err.message, exitCode: -1 });
    });
  });
}

async function sshUploadFileBase64(localPath: string, remotePath: string, ssh_user: string, ssh_host: string, ssh_key_path: string, logFilePath: string, ssh_port?: number | null): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    log(logFilePath, `Uploading ${path.basename(localPath)} to ${remotePath} (attempt ${attempt}/3)...`);
    try {
      await new Promise<void>((resolve, reject) => {
        const portPart = ssh_port ? `-p ${ssh_port}` : '';
        const command = `cat "${localPath}" | base64 -w 0 | ssh -T -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes ${portPart} -i "${ssh_key_path}" ${ssh_user}@${ssh_host} "base64 -d > \"${remotePath}\""`;
        const child = spawn('bash', ['-c', command]);

        let stderr = '';
        child.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          if (code === 0) {
            log(logFilePath, `Upload of ${path.basename(localPath)} successful.`);
            resolve();
          } else {
            const errorMsg = `File upload failed with exit code ${code}${stderr ? `, stderr: ${stderr.substring(0, 200)}` : ''}`;
            log(logFilePath, errorMsg);
            reject(new Error(errorMsg));
          }
        });
        child.on('error', (err) => {
          log(logFilePath, `Upload process error: ${err.message}`);
          reject(err);
        });
      });
      return; // Success
    } catch (error) {
      log(logFilePath, `Upload attempt ${attempt} failed: ${(error as Error).message}`);
      if (attempt < 3) {
        log(logFilePath, `Waiting 5 seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        throw new Error(`Upload permanently failed for ${localPath} after 3 attempts. Last error: ${(error as Error).message}`);
      }
    }
  }
}

async function callRunPodAPI(apiKey: string, query: string) {
    log('/tmp/runpod-api.log', `Sending API request: ${query}`);
    try {
        const response = await fetch(RUNPOD_API_BASE, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query }),
        });
        const responseText = await response.text();
        log('/tmp/runpod-api.log', `API Response (${response.status}): ${responseText}`);
        
        if (!response.ok) {
            throw new Error(`RunPod API Error (${response.status}): ${responseText}`);
        }
        return JSON.parse(responseText);
    } catch (error) {
        log('/tmp/runpod-api.log', `API Error: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

// Try to discover an SSH login string (e.g., "user@host") from the GraphQL API
async function discoverGatewayLogin(runpodApiKey: string, pod_id: string, logFilePath: string): Promise<{ user: string; host: string } | null> {
  // First try the known field directly (may fail on older schemas)
  const primaryQuery = `
    query GetPodSsh {
      pod(input: { podId: \"${pod_id}\" }) {
        id
        runtime { sshCommand }
      }
    }
  `;
  try {
    const data = await callRunPodAPI(runpodApiKey, primaryQuery);
    const cmd = data?.data?.pod?.runtime?.sshCommand as string | undefined;
    if (cmd && typeof cmd === 'string') {
      const m = cmd.match(/([\w.-]+)@([\w.-]+)/);
      if (m) return { user: m[1], host: m[2] };
    }
  } catch (e) {
    log(logFilePath, `Primary sshCommand probe failed: ${(e as Error).message}`);
  }

  // Introspect schema to find any string field on PodRuntime containing "ssh"
  const introspection = `
    query IntrospectRuntime {
      __type(name: \"PodRuntime\") {
        fields { name type { kind name ofType { kind name } } }
      }
    }
  `;
  try {
    const meta = await callRunPodAPI(runpodApiKey, introspection);
    const fields = meta?.data?.__type?.fields || [];
    const stringFields = fields.filter((f: any) => {
      const t = f.type;
      const kind = t?.kind;
      const name = t?.name;
      const ofKind = t?.ofType?.kind;
      const ofName = t?.ofType?.name;
      const isStringScalar = (kind === 'SCALAR' && name === 'String') || (kind === 'NON_NULL' && ofKind === 'SCALAR' && ofName === 'String');
      return isStringScalar && /ssh/i.test(f.name);
    }).map((f: any) => f.name as string);

    for (const field of stringFields) {
      const q = `
        query ProbeField {
          pod(input: { podId: \"${pod_id}\" }) { id runtime { ${field} } }
        }
      `;
      try {
        const resp = await callRunPodAPI(runpodApiKey, q);
        const val = resp?.data?.pod?.runtime?.[field];
        if (typeof val === 'string') {
          const m = val.match(/([\w.-]+)@([\w.-]+)/);
          if (m) {
            log(logFilePath, `Discovered SSH via runtime.${field}`);
            return { user: m[1], host: m[2] };
          }
        }
      } catch (e) {
        log(logFilePath, `Probe for runtime.${field} failed: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    log(logFilePath, `Introspection query failed: ${(e as Error).message}`);
  }

  // As a last attempt, introspect Pod itself for any string fields with 'ssh'
  const podTypeIntro = `
    query IntrospectPod {
      __type(name: \"Pod\") {
        fields { name type { kind name ofType { kind name } } }
      }
    }
  `;
  try {
    const meta = await callRunPodAPI(runpodApiKey, podTypeIntro);
    const fields = meta?.data?.__type?.fields || [];
    const stringFields = fields.filter((f: any) => {
      const t = f.type;
      const kind = t?.kind;
      const name = t?.name;
      const ofKind = t?.ofType?.kind;
      const ofName = t?.ofType?.name;
      const isStringScalar = (kind === 'SCALAR' && name === 'String') || (kind === 'NON_NULL' && ofKind === 'SCALAR' && ofName === 'String');
      return isStringScalar && /ssh/i.test(f.name);
    }).map((f: any) => f.name as string);

    for (const field of stringFields) {
      const q = `
        query ProbePodField {
          pod(input: { podId: \"${pod_id}\" }) { id ${field} }
        }
      `;
      try {
        const resp = await callRunPodAPI(runpodApiKey, q);
        const val = resp?.data?.pod?.[field];
        if (typeof val === 'string') {
          const m = val.match(/([\w.-]+)@([\w.-]+)/);
          if (m) {
            log(logFilePath, `Discovered SSH via pod.${field}`);
            return { user: m[1], host: m[2] };
          }
        }
      } catch (e) {
        log(logFilePath, `Probe for pod.${field} failed: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    log(logFilePath, `Pod type introspection failed: ${(e as Error).message}`);
  }

  return null;
}

async function sshScpDownload(
  ssh_user: string,
  ssh_host: string,
  ssh_key_path: string,
  remotePath: string,
  localPath: string,
  logFilePath: string,
  ssh_port?: number | null,
  recursive: boolean = false
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const portArg = ssh_port ? ['-P', String(ssh_port)] : [];
    const recursiveArg = recursive ? ['-r'] : [];
    const args = [
      ...recursiveArg,
      ...portArg,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-i', ssh_key_path,
      `${ssh_user}@${ssh_host}:${remotePath}`,
      localPath,
    ];

    log(logFilePath, `Starting SCP download: scp ${args.join(' ')}`);
    const scp = spawn('scp', args);

    let stderr = '';
    scp.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error(`[scp] stderr: ${data.toString()}`);
    });
    
    scp.stdout.on('data', (data) => {
        console.log(`[scp] stdout: ${data.toString()}`);
    });

    scp.on('close', (exitCode) => {
      if (exitCode === 0) {
        log(logFilePath, `SCP download successful for ${remotePath}`);
      } else {
        log(logFilePath, `SCP download failed for ${remotePath} with exit code ${exitCode}. Stderr: ${stderr}`);
      }
      resolve({ exitCode: exitCode || 0, stderr });
    });

    scp.on('error', (err) => {
      log(logFilePath, `SCP command failed to start: ${err.message}`);
      resolve({ exitCode: -1, stderr: err.message });
    });
  });
}

/**
 * Download using rsync instead of scp - supports resume and excludes patterns
 */
async function rsyncDownload(
  ssh_user: string,
  ssh_host: string,
  ssh_key_path: string,
  remotePath: string,
  localPath: string,
  logFilePath: string,
  ssh_port?: number | null,
  excludePatterns: string[] = []
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const sshCmd = ssh_port
      ? `ssh -p ${ssh_port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i ${ssh_key_path}`
      : `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i ${ssh_key_path}`;

    const excludeArgs = excludePatterns.map(p => `--exclude=${p}`).join(' ');
    const cmd = `rsync -avz --partial --progress ${excludeArgs} -e "${sshCmd}" ${ssh_user}@${ssh_host}:${remotePath}/ ${localPath}/`;

    log(logFilePath, `Starting rsync download: ${cmd}`);
    const rsync = spawn('bash', ['-c', cmd]);

    let stderr = '';
    rsync.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    rsync.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('%') || output.includes('to-chk')) {
        process.stdout.write(output);
      }
    });

    rsync.on('close', (exitCode) => {
      if (exitCode === 0) {
        log(logFilePath, `Rsync download successful for ${remotePath}`);
      } else {
        log(logFilePath, `Rsync failed for ${remotePath} with exit code ${exitCode}. Stderr: ${stderr}`);
      }
      resolve({ exitCode: exitCode || 0, stderr });
    });

    rsync.on('error', (err) => {
      log(logFilePath, `Rsync command failed to start: ${err.message}`);
      resolve({ exitCode: -1, stderr: err.message });
    });
  });
}

export async function runRemoteTraining(opts: RunRemoteTrainingOptions): Promise<RunRemoteTrainingResult> {
  const logDir = path.join(paths.root, 'docs', 'run_logs', opts.DATE_STR, opts.RUN_LABEL);
  ensureDirSync(logDir);
  const logFilePath = path.join(logDir, 'trainer.log');

  // Initialize progress tracker
  const stages = [
    'initialization',
    'pod_creation',
    'ssh_connection',
    'file_upload',
    'training',
    'adapter_download',
    'pod_termination'
  ];
  const tracker = new ProgressTracker(`lora-training-${opts.RUN_LABEL}`, stages, opts.WORK_LOCAL);

  // Clear the log file at the start of each run
  fs.writeFileSync(logFilePath, '');

  console.log('\n🚀 ====== REMOTE LORA TRAINING STARTED ======');
  console.log(`📅 Date: ${opts.DATE_STR}`);
  console.log(`🏷️  Run label: ${opts.RUN_LABEL}`);
  console.log(`📁 Work directory: ${opts.WORK_LOCAL}`);
  console.log(`📊 Progress status file: ${tracker.getStatusFilePath()}\n`);

  log(logFilePath, '=== Starting new training run ===');
  log(logFilePath, `Date: ${opts.DATE_STR}`);
  log(logFilePath, `Run label: ${opts.RUN_LABEL}`);
  log(logFilePath, `Work directory: ${opts.WORK_LOCAL}`);

  tracker.startStage('initialization', 'Reading configuration');

  // Honor environment toggles for connection discovery
  const NO_GATEWAY = String(process.env.RUNPOD_NO_GATEWAY || '').trim() === '1';
  const DIRECT_SSH_USER = String(process.env.RUNPOD_DIRECT_SSH_USER || '').trim() || null;
  if (NO_GATEWAY) {
    log(logFilePath, 'RUNPOD_NO_GATEWAY=1 set; skipping gateway schema probes.');
  }
  if (DIRECT_SSH_USER) {
    log(logFilePath, `RUNPOD_DIRECT_SSH_USER=${DIRECT_SSH_USER}; will prefer this user for direct SSH.`);
  }

  // Read config file (base model and training mode)
  let base_model: string;
  let cfg: any;
  try {
    cfg = JSON.parse(fs.readFileSync(opts.CONFIG_FILE, 'utf-8'));
    base_model = cfg.base_model;
  } catch (error) {
    log(logFilePath, `Failed to read base model from config: ${(error as Error).message}`);
    base_model = "Qwen/Qwen3-30B-A3B"; // fallback
    cfg = { base_model, training_mode: 'lora' };
  }

  tracker.setMetadata({ base_model, samples: opts.samples_used });
  tracker.completeStage('initialization');

  const summary: any = {
    date: opts.DATE_STR,
    run_label: opts.RUN_LABEL,
    run_id: opts.run_id || null,
    samples_used: opts.samples_used,
    base_model: base_model,
    pod_id: null,
    ssh_user: null,
    ssh_host: null,
    ssh_key_path: null,
    connection_mode: 'gateway-no-scp-no-pty',
    adapter_path: opts.FINAL_ADAPTER_DIR,
    upload_verification: null,
    terminated: false,
    training_success: false,
  };

  const runpodApiKey = process.env.RUNPOD_API_KEY;
  if (!runpodApiKey) {
    tracker.fail('RUNPOD_API_KEY not set');
    throw new Error('RUNPOD_API_KEY is not set in the environment.');
  }

  // 3.1. Create the pod
  console.log('\n📦 Stage 1/6: Creating RunPod instance...');
  let pod_id: string | null = null;
  const envTemplateId = process.env.RUNPOD_TEMPLATE_ID;
  if (envTemplateId) {
    log(logFilePath, `Using RUNPOD_TEMPLATE_ID=${envTemplateId}`);
  }

  // GPU selection: A100 80GB for full fine-tuning, env var (5090) for LoRA
  const trainingMode = cfg.training_mode || 'lora';
  let gpuType: string;

  if (trainingMode === 'full_finetune' || trainingMode === 'full') {
    // Full fine-tuning requires 80GB+ VRAM (gradients + optimizer states)
    gpuType = process.env.RUNPOD_GPU_TYPE_FULL || "NVIDIA A100 80GB PCIe";
    log(logFilePath, `FULL FINE-TUNING mode: Using ${gpuType} (80GB VRAM required)`);
  } else {
    // LoRA training works on smaller GPUs
    gpuType = process.env.RUNPOD_GPU_TYPE || "NVIDIA GeForce RTX 4090";
    log(logFilePath, `LoRA mode: Using ${gpuType}`);
  }

  log(logFilePath, `Selected GPU type: ${gpuType}`);

  tracker.startStage('pod_creation', `Requesting ${gpuType}`);

  for (const cloudType of ['COMMUNITY', 'SECURE']) {
    log(logFilePath, `Attempting to deploy pod on ${cloudType} cloud...`);
    console.log(`📦 Trying ${cloudType} cloud...`);
    const mutation = `
      mutation CreatePod {
        podFindAndDeployOnDemand(
          input: {
            templateId: "${envTemplateId || 'metahuman-runpod-trainer'}",
            gpuTypeId: "${gpuType}",
            cloudType: ${cloudType},
            gpuCount: 1,
            minVcpuCount: 15,
            minMemoryInGb: 46,
            volumeInGb: 306,
            containerDiskInGb: 40
          }
        ) {
          id
          runtime {
            ports {
              ip
              isIpPublic
              privatePort
              publicPort
            }
          }
        }
      }`;
    try {
      const data = await callRunPodAPI(runpodApiKey, mutation);
      if (data.data?.podFindAndDeployOnDemand?.id) {
        pod_id = data.data.podFindAndDeployOnDemand.id;
        log(logFilePath, `Pod created successfully on ${cloudType} cloud. Pod ID: ${pod_id}`);
        console.log(`✅ Pod created: ${pod_id}`);
        tracker.setMetadata({ pod_id });
        tracker.completeStage('pod_creation');
        summary.pod_id = pod_id;
        break;
      } else {
        log(logFilePath, `No pod ID returned for ${cloudType}: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      log(logFilePath, `Failed to deploy on ${cloudType}: ${(error as Error).message}`);
    }
  }

  if (!pod_id) {
    console.error('❌ Failed to create pod on any cloud');
    tracker.failStage('pod_creation', 'No pods available');
    tracker.fail('Pod creation failed');
    fs.writeFileSync(opts.SUMMARY_FILE, JSON.stringify(summary, null, 2));
    return { ...summary, training_success: false, terminated: false };
  }

  // 3.2. Get SSH connection info
  console.log('\n🔌 Stage 2/6: Establishing SSH connection...');
  log(logFilePath, 'Waiting for pod to become RUNNING...');
  tracker.startStage('ssh_connection', 'Waiting for container to start');

  let ssh_user: string | null = null;
  let ssh_host: string | null = null;
  let ssh_key_path: string | null = null;
  let ssh_port: number | null = null;
  const ENV_SSH_KEY_PATH = (process.env.RUNPOD_SSH_KEY_PATH || '').trim() || null;

  try {
    // Poll until runtime is available; avoid querying unsupported fields
    let sshCommand: string | null = null;
    let lastRuntimePorts: any[] | null = null;
    for (let i = 0; i < 120; i++) { // up to ~10 minutes for Docker image download/extraction
      log(logFilePath, `Waiting for pod ssh gateway... (Attempt ${i + 1}/120)`);

      // Update progress every 10 attempts
      if (i % 10 === 0 && i > 0) {
        const progress = Math.min(90, Math.round((i / 120) * 100));
        tracker.updateStage('ssh_connection', progress, `Attempt ${i}/120 - Docker image loading...`);
        console.log(`🔌 SSH connection attempt ${i}/120... (container starting)`);
      }
      const podQuery = `
        query GetPodStatus {
          pod(input: { podId: \"${pod_id}\" }) {
            id
            runtime {
              ports {
                ip
                isIpPublic
                privatePort
                publicPort
                type
              }
            }
          }
        }`;
      try {
        const podData = await callRunPodAPI(runpodApiKey, podQuery);
        const runtimeInfo = podData?.data?.pod?.runtime || null;
        // Capture latest ports and attempt discovery via separate probes
        if (runtimeInfo && Array.isArray(runtimeInfo.ports)) {
          lastRuntimePorts = runtimeInfo.ports as any[];
          try {
            log(logFilePath, `runtime.ports: ${JSON.stringify(lastRuntimePorts)}`);
          } catch {}
          // If we're in NO_GATEWAY mode and we see a public mapping, we can stop polling early
          if (NO_GATEWAY) {
            const hasPublic = lastRuntimePorts.some((p: any) => p && p.isIpPublic);
            if (hasPublic) {
              log(logFilePath, 'Public port mapping detected and NO_GATEWAY=1; proceeding without gateway discovery.');
              break;
            }
          }
        }
        if (runtimeInfo && !NO_GATEWAY) {
          const discovered = await discoverGatewayLogin(runpodApiKey, pod_id!, logFilePath);
          if (discovered) {
            sshCommand = `${discovered.user}@${discovered.host}`;
            log(logFilePath, `Discovered SSH via schema probes: ${sshCommand}`);
            break;
          }
        }
      } catch (error) {
        log(logFilePath, `Ignoring GraphQL error during polling: ${(error as Error).message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    const connectionFile = path.join(opts.WORK_LOCAL, 'connection.json');

    // Load any existing manual overrides from connection.json
    let existingConn: any = null;
    if (fs.existsSync(connectionFile)) {
      try {
        existingConn = JSON.parse(fs.readFileSync(connectionFile, 'utf-8'));
      } catch {
        existingConn = null;
      }
    }

    // Preferred: Parse ssh_user and ssh_host from sshCommand if available
    if (sshCommand) {
      try {
        const m = sshCommand.match(/([\w.-]+)@([\w.-]+)/);
        if (m) {
          ssh_user = m[1];
          ssh_host = m[2];
        }
      } catch {}
    }

    // Fallback: allow manual override from connection.json when API doesn't expose sshCommand
    if (!ssh_user && existingConn && typeof existingConn.ssh_user === 'string') {
      ssh_user = existingConn.ssh_user;
    }
    if (!ssh_host && existingConn && typeof existingConn.ssh_host === 'string') {
      ssh_host = existingConn.ssh_host;
    }

    // Load/override ssh_key_path from existing file, env, or sensible default (do this EARLY)
    if (!ssh_key_path && existingConn && typeof existingConn.ssh_key_path === 'string') {
      ssh_key_path = existingConn.ssh_key_path as string;
    }
    if (!ssh_key_path && ENV_SSH_KEY_PATH) {
      ssh_key_path = ENV_SSH_KEY_PATH;
      log(logFilePath, `Using ssh key from RUNPOD_SSH_KEY_PATH env: ${ssh_key_path}`);
    }
    if (!ssh_key_path) {
      const defaultKey = path.join(process.env.HOME || '', '.ssh', 'id_ed25519');
      if (defaultKey && fs.existsSync(defaultKey)) {
        ssh_key_path = defaultKey;
        log(logFilePath, `Using default SSH key path: ${ssh_key_path}`);
      }
    }

    // Direct IP/port fallback: use runtime.ports to find a public SSH endpoint
    // When NO_GATEWAY=1, always prefer runtime ports over stale connection.json
    if ((NO_GATEWAY || !ssh_user || !ssh_host) && lastRuntimePorts && lastRuntimePorts.length > 0) {
      const sshPortMapping = lastRuntimePorts.find((p: any) => p.isIpPublic && p.privatePort === 22 && p.type && String(p.type).toLowerCase() === 'tcp')
        || lastRuntimePorts.find((p: any) => p.isIpPublic && (p.privatePort === 22 || p.publicPort === 22))
        || lastRuntimePorts.find((p: any) => p.isIpPublic && p.type && String(p.type).toLowerCase().includes('tcp'))
        || lastRuntimePorts.find((p: any) => p.isIpPublic);
      if (sshPortMapping) {
        ssh_host = sshPortMapping.ip;
        ssh_port = sshPortMapping.publicPort || 22;
        const keyPathCandidate = existingConn?.ssh_key_path || ssh_key_path || '';
        log(logFilePath, `Key path candidate: ${keyPathCandidate || '(empty)'}`);
        let probeSucceeded = false;
        // If a direct SSH user is provided, try it first and prefer it
        const candidates = DIRECT_SSH_USER ? [DIRECT_SSH_USER] : ['root', 'unsloth'];
        log(logFilePath, `SSH probe candidates: ${candidates.join(', ')}`);
        for (const u of candidates) {
          if (!keyPathCandidate) {
            log(logFilePath, `Skipping SSH probe - no key path available`);
            break;
          }
          // Retry up to ~10 minutes to allow Docker image download + sshd to start
          // Large images (8GB+) can take 5-10 minutes to download on first pull
          const maxAttempts = 120; // 120 attempts × 5 seconds = 10 minutes
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const probe = await sshExecNoPty(u, ssh_host!, keyPathCandidate, 'true', ssh_port);
            if (probe.exitCode === 0) {
              ssh_user = u;
              probeSucceeded = true;
              log(logFilePath, `Direct SSH handshake succeeded as ${u}@${ssh_host}:${ssh_port} (attempt ${attempt})`);
              break;
            } else {
              log(logFilePath, `Probe as ${u}@${ssh_host}:${ssh_port} failed (exit ${probe.exitCode}) attempt ${attempt}/${maxAttempts}`);
              if (attempt === 1 || attempt % 12 === 0) {
                // Log verbose details every minute
                if (probe.stderr) log(logFilePath, `SSH stderr: ${probe.stderr.substring(0, 500)}`);
                if (probe.stdout) log(logFilePath, `SSH stdout: ${probe.stdout.substring(0, 500)}`);
                const sshCmd = `ssh -vv -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=10 -i ${keyPathCandidate} -p ${ssh_port} ${u}@${ssh_host} 'true'`;
                log(logFilePath, `Manual test command: ${sshCmd}`);
                log(logFilePath, `Still waiting for container to fully start (Docker image download may be in progress)...`);
              }
              await new Promise(r => setTimeout(r, 5000));
            }
          }
          if (probeSucceeded) break;
        }
        if (!probeSucceeded) {
          throw new Error(`Direct SSH handshake failed for all candidate users (${candidates.join(', ')}). Ensure sshd is running, your SSH_PUBLIC_KEY is installed in the template, and port ${ssh_port} is open on ${ssh_host}.`);
        }
      }
    }

    // Default host if not provided
    if (!ssh_host) ssh_host = 'ssh.runpod.io';

    if (!ssh_user || !ssh_host) {
      throw new Error(
        'RunPod GraphQL did not expose sshCommand and no manual ssh_user/ssh_host found. ' +
        `Please create ${connectionFile} with {"ssh_user":"<value>", "ssh_host":"ssh.runpod.io", "ssh_key_path":"~/.ssh/id_ed25519"}`
      );
    }

    // Validate ssh_key_path presence
    if (!ssh_key_path) {
      throw new Error(
        `connection.json is missing ssh_key_path. Please create ${connectionFile} with at least {"ssh_key_path": "~/.ssh/id_ed25519"}`
      );
    }

    // Expand ~ to HOME if present
    if (ssh_key_path.startsWith('~')) {
      const home = process.env.HOME || '';
      ssh_key_path = path.join(home, ssh_key_path.slice(2));
    }

    if (!fs.existsSync(ssh_key_path)) {
      throw new Error(`ssh_key_path does not exist: ${ssh_key_path}`);
    }

    // Write fresh connection.json for this run
    const finalConnDetails = {
      ssh_user,
      ssh_host,
      ssh_key_path,
    };
    fs.writeFileSync(connectionFile, JSON.stringify(finalConnDetails, null, 2));
    log(logFilePath, `Wrote fresh connection.json for this pod: ${connectionFile}`);

    summary.ssh_user = ssh_user;
    summary.ssh_host = ssh_host;
    summary.ssh_key_path = ssh_key_path;
    if (ssh_port) {
      summary.connection_mode = 'direct-ssh-no-pty';
      log(logFilePath, `Using direct SSH mode: ${ssh_user}@${ssh_host}:${ssh_port}`);
      console.log(`✅ SSH connected: ${ssh_user}@${ssh_host}:${ssh_port}`);
    } else {
      summary.connection_mode = 'gateway-no-scp-no-pty';
      log(logFilePath, `Using gateway SSH mode: ${ssh_user}@${ssh_host}`);
      console.log(`✅ SSH connected: ${ssh_user}@${ssh_host}`);
    }
    tracker.completeStage('ssh_connection');
    console.log('✅ Stage 2/6: SSH connection established\n');

    // 2.1. Wait for pod environment to be fully ready
    console.log('⏸️  Verifying pod environment is ready...');
    log(logFilePath, 'Checking for Python, pip, and workspace setup');

    let retries = 0;
    const maxRetries = 6; // 6 retries * 10 seconds = 1 minute
    let envReady = false;

    while (retries < maxRetries && !envReady) {
      try {
        const checkResult = await sshExecNoPty(
          ssh_user!,
          ssh_host!,
          ssh_key_path!,
          'python3 --version && pip --version && ls /workspace && echo "ENV_READY"',
          ssh_port
        );

        if (checkResult.stdout.includes('ENV_READY')) {
          console.log('✅ Pod environment is ready');
          log(logFilePath, `Environment check passed: ${checkResult.stdout}`);
          envReady = true;
        } else {
          log(logFilePath, `Environment not ready yet (attempt ${retries + 1}/${maxRetries})`);
          retries++;
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      } catch (error) {
        log(logFilePath, `Environment check failed (attempt ${retries + 1}/${maxRetries}): ${(error as Error).message}`);
        retries++;
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }

    if (!envReady) {
      console.warn('⚠️  Pod environment may not be fully ready, proceeding with upload...');
      log(logFilePath, 'WARNING: Environment checks did not pass, proceeding anyway');
    }

    // 3.3. Upload dataset + config + fixed training script using base64-over-ssh
    console.log('\n📤 Stage 3/6: Uploading training data to pod...');
    log(logFilePath, `Uploading curated training files via base64-over-ssh (samples: ${opts.samples_used})...`);
    tracker.startStage('file_upload', 'Uploading 3 files');

    // Ensure target directories exist with proper permissions
    const mkdirResult = await sshExecNoPty(ssh_user!, ssh_host!, ssh_key_path!, 'mkdir -p /workspace/input && chmod 755 /workspace/input && ls -la /workspace/', ssh_port);
    log(logFilePath, `Directory creation result: ${mkdirResult.stdout}`);

    await sshUploadFileBase64(opts.CLEAN_DATA_FILE, '/workspace/input/unsloth_dataset.jsonl', ssh_user!, ssh_host!, ssh_key_path!, logFilePath, ssh_port);
    tracker.updateStage('file_upload', 25, `Uploaded dataset (${opts.samples_used} samples)`);
    console.log(`📤 Uploaded: dataset.jsonl (${opts.samples_used} samples)`);

    await sshUploadFileBase64(opts.CONFIG_FILE, '/workspace/input/config.json', ssh_user!, ssh_host!, ssh_key_path!, logFilePath, ssh_port);
    tracker.updateStage('file_upload', 50, 'Uploaded config.json');
    console.log('📤 Uploaded: config.json');

    // Upload persona data for training context
    const profilePaths = getProfilePaths(opts.username);
    const personaPath = path.join(profilePaths.persona, 'core.json');

    if (fs.existsSync(personaPath)) {
      await sshUploadFileBase64(personaPath, '/workspace/input/persona.json', ssh_user!, ssh_host!, ssh_key_path!, logFilePath, ssh_port);
      tracker.updateStage('file_upload', 75, 'Uploaded persona.json');
      console.log('📤 Uploaded: persona.json');
      log(logFilePath, 'Uploaded persona data for training context');
    } else {
      log(logFilePath, 'WARNING: persona/core.json not found, training without persona context');
      console.warn('⚠️  No persona.json found - training without persona context');
    }

    // Determine which training script to upload based on config
    let trainingScriptName: string;
    let trainingScriptPath: string;
    const trainingMode = cfg.training_mode || 'lora';

    if (trainingMode === 'full_finetune' || trainingMode === 'full') {
      trainingScriptName = 'train_full_finetune.py';
      trainingScriptPath = path.join(paths.root, 'docker', 'runpod-trainer', 'train_full_finetune.py');
      log(logFilePath, 'FULL FINE-TUNING mode detected');
    } else {
      trainingScriptName = 'train_unsloth.py';
      trainingScriptPath = path.join(paths.root, 'docker', 'runpod-trainer', 'train_unsloth.py');
      log(logFilePath, 'LoRA training mode detected');
    }

    // Upload training script (overrides the one baked into v3 image)
    log(logFilePath, `Uploading training script from: ${trainingScriptPath}`);
    await sshUploadFileBase64(trainingScriptPath, `/workspace/${trainingScriptName}`, ssh_user!, ssh_host!, ssh_key_path!, logFilePath, ssh_port);

    // Verify upload by checking file size and line count
    const verifyResult = await sshExecNoPty(ssh_user!, ssh_host!, ssh_key_path!, `wc -l /workspace/${trainingScriptName} && ls -lh /workspace/${trainingScriptName}`, ssh_port);
    log(logFilePath, `Training script verification: ${verifyResult.stdout.trim()}`);

    // Also remove any Python bytecode cache that might interfere
    await sshExecNoPty(ssh_user!, ssh_host!, ssh_key_path!, 'rm -rf /workspace/__pycache__ /workspace/*.pyc', ssh_port);

    tracker.completeStage('file_upload');
    console.log(`📤 Uploaded: ${trainingScriptName}`);
    console.log('✅ Stage 3/6: Upload complete\n');

    // Verify and generate upload.ok on the pod
    const verificationResult = await sshExecNoPty(ssh_user!, ssh_host!, ssh_key_path!, 'ls -lh /workspace/input && wc -l /workspace/input/unsloth_dataset.jsonl && sha256sum /workspace/input/config.json > /workspace/input/upload.ok && cat /workspace/input/upload.ok', ssh_port);
    const outputLines = verificationResult.stdout.split('\n');
    // Find the sha256sum line in the output
    const sha256Line = outputLines.find(line => line.includes('config.json') && line.includes('workspace/input/config.json'));
    if (sha256Line) {
      summary.upload_verification = sha256Line.trim();
      log(logFilePath, `Upload verification: ${summary.upload_verification}`);
    } else {
      log(logFilePath, `Could not find SHA256 verification in output: ${verificationResult.stdout}`);
    }

    // 3.4. Run training remotely with real-time progress streaming
    if (trainingMode === 'full_finetune' || trainingMode === 'full') {
      console.log('\n🔥 Stage 4/6: Full fine-tuning model...');
      console.log('⏱️  Expected duration: 2-6 hours for 30B model\n');
    } else {
      console.log('\n🔥 Stage 4/6: Training LoRA adapter...');
      console.log('⏱️  Expected duration: 30-60 minutes for 30B model\n');
    }
    log(logFilePath, `Executing remote training script: ${trainingScriptName}`);
    tracker.startStage('training', 'Model loading and setup');

    // Stream training output in real-time to show progress
    const trainResult = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      const args: string[] = [
        '-T',
        '-vv',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=999',
        '-o', 'TCPKeepAlive=yes',
      ];
      if (ssh_port) args.push('-p', String(ssh_port));

      // Use venv if available (LoRA templates), otherwise use system Python (A100 templates)
      const pythonCommand = trainingMode === 'full_finetune' || trainingMode === 'full'
        ? `python3 /workspace/${trainingScriptName}`  // A100: Use system Python
        : `source /workspace/unsloth-venv/bin/activate && python /workspace/${trainingScriptName}`;  // LoRA: Use venv

      args.push('-i', ssh_key_path!, `${ssh_user}@${ssh_host}`, pythonCommand);

      const ssh = spawn('ssh', args);
      let stdout = '';
      let stderr = '';
      let lastProgress = 0;
      let lastLogTime = Date.now();

      ssh.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;

        // Stream all output to console for detailed logging
        // Split by lines and log each line to preserve formatting
        const lines = text.split('\n').filter(line => line.trim());
        for (const line of lines) {
          console.log(line);
        }

        // Parse progress bar: "65%|██████▌ | 17/26 [27:32<11:45, 78.36s/it]"
        const progressMatch = text.match(/(\d+)%\|.*?\| (\d+)\/(\d+)/);
        if (progressMatch) {
          const [_, percent, current, total] = progressMatch;
          const progress = parseInt(percent);

          // Update progress tracker every 1% or 10 seconds (reduced from 5%/30s)
          if (progress > lastProgress || Date.now() - lastLogTime > 10000) {
            lastProgress = progress;
            lastLogTime = Date.now();
            tracker.updateStage('training', progress, `Step ${current}/${total}`);
          }
        }

        // Parse loss metrics: "{'loss': 2.4506, ...}"
        const lossMatch = text.match(/['"']loss['"']:\s*([\d.]+)/);
        if (lossMatch && Date.now() - lastLogTime > 10000) {
          lastLogTime = Date.now();
        }
      });

      ssh.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        // Stream stderr to console for detailed logging
        const lines = text.split('\n').filter(line => line.trim());
        for (const line of lines) {
          console.error(line);
        }
      });

      ssh.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode: exitCode || 0 });
      });

      ssh.on('error', (err) => {
        console.error('SSH training command failed to start:', err);
        resolve({ stdout: '', stderr: err.message, exitCode: -1 });
      });
    });

    log(logFilePath, `Training exit code: ${trainResult.exitCode}`);

    // Save full training output to file
    const trainingOutputFile = path.join(opts.WORK_LOCAL, 'training_output.txt');
    fs.writeFileSync(trainingOutputFile, `=== STDOUT ===\n${trainResult.stdout}\n\n=== STDERR ===\n${trainResult.stderr}\n`);
    log(logFilePath, `Full training output saved to: ${trainingOutputFile}`);

    // Log summary to console
    if (trainResult.stderr) log(logFilePath, `Training stderr (last 2000 chars): ${trainResult.stderr.substring(Math.max(0, trainResult.stderr.length - 2000))}`);
    if (trainResult.stdout) log(logFilePath, `Training stdout (last 2000 chars): ${trainResult.stdout.substring(Math.max(0, trainResult.stdout.length - 2000))}`);

    if (trainResult.exitCode !== 0) {
      log(logFilePath, 'Remote training script failed.');
      console.error(`❌ Training failed with exit code ${trainResult.exitCode}\n`);
      tracker.failStage('training', `Exit code ${trainResult.exitCode}`);
      summary.training_success = false;
    } else {
      console.log('✅ Stage 4/6: Training complete\n');
      tracker.completeStage('training');
      summary.training_success = true;
    }

    // 3.5. Download trained model (mode-specific paths)
    // trainingMode is already declared earlier (line 763)
    const isFullFineTune = trainingMode === 'full_finetune' || trainingMode === 'full';

    if (isFullFineTune) {
        // Full fine-tuning: download safetensors model directory
        console.log('\n📥 Stage 5/6: Downloading full fine-tuned model...');
        console.log('⏱️  This will download the safetensors model (~28GB)\n');
        log(logFilePath, 'Downloading full fine-tuned model from /workspace/output/model/...');
        tracker.startStage('adapter_download', 'Downloading safetensors model');

        if (summary.training_success) {
          // Check if S3 is configured for fast upload instead of download
          // Can be disabled via METAHUMAN_DISABLE_S3 environment variable
          const s3Disabled = process.env.METAHUMAN_DISABLE_S3 === '1';
          const s3Config = s3Disabled ? null : loadS3ConfigFromEnv();

          if (s3Disabled) {
            console.log('ℹ️ S3 upload disabled by user preference, using direct download...');
            log(logFilePath, 'S3 upload disabled via METAHUMAN_DISABLE_S3 flag');
          }

          if (s3Config) {
            // S3 Path: Upload model to S3 for fast termination
            console.log('☁️ S3 configured - uploading model to RunPod S3...');
            console.log('⏱️  This will upload the model (~2-3 minutes) then terminate the pod immediately\n');
            log(logFilePath, 'Uploading model to S3 storage...');
            tracker.startStage('s3_upload', 'Uploading to S3');

            // Install AWS CLI on the pod and upload directly from there
            const s3Key = `${opts.username}/${opts.RUN_LABEL}/model`;
            const uploadScript = `
#!/bin/bash
set -e

# Install AWS CLI if not present
if ! command -v aws &> /dev/null; then
  echo "Installing AWS CLI..."
  curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
  unzip -q awscliv2.zip
  ./aws/install
fi

# Configure AWS credentials
export AWS_ACCESS_KEY_ID="${s3Config.accessKeyId}"
export AWS_SECRET_ACCESS_KEY="${s3Config.secretAccessKey}"
export AWS_ENDPOINT_URL="${s3Config.endpoint}"
export AWS_DEFAULT_REGION="${s3Config.region || 'us-east-1'}"

# Upload model directory to S3 (excluding checkpoints to save 24GB)
echo "Uploading model to s3://${s3Config.bucket}/${s3Key}/"
aws s3 sync /workspace/output/model s3://${s3Config.bucket}/${s3Key}/ \\
  --exclude "checkpoint-*" \\
  --exclude "*.pt" \\
  --exclude "*.pth" \\
  --exclude "optimizer.pt" \\
  --exclude "scheduler.pt" \\
  --exclude "rng_state.pth" \\
  --endpoint-url "${s3Config.endpoint}"

echo "Upload complete!"
`;

            // Write upload script to temp file
            const uploadScriptPath = path.join(opts.WORK_LOCAL, 'upload_to_s3.sh');
            fs.writeFileSync(uploadScriptPath, uploadScript);

            try {
              // Copy script to pod using base64 upload
              await sshUploadFileBase64(
                uploadScriptPath,
                '/tmp/upload_to_s3.sh',
                ssh_user!, ssh_host!, ssh_key_path!,
                logFilePath, ssh_port
              );
              log(logFilePath, 'Upload script copied to pod');

              // Execute upload script on pod
              const uploadResult = await sshExecNoPty(
                ssh_user!, ssh_host!, ssh_key_path!,
                'chmod +x /tmp/upload_to_s3.sh && /tmp/upload_to_s3.sh',
                ssh_port
              );

              if (uploadResult.exitCode === 0) {
                const s3Url = `${s3Config.endpoint}/${s3Config.bucket}/${s3Key}/`;
                log(logFilePath, `Model uploaded to S3: ${s3Url}`);
                console.log(`✅ Model uploaded to S3!`);
                console.log(`📍 S3 Location: ${s3Url}`);
                console.log('💡 Download later with: aws s3 sync <s3-url> <local-path>');
                tracker.completeStage('s3_upload');

                summary.s3_url = s3Url;
                summary.s3_key = s3Key;
              } else {
                log(logFilePath, `S3 upload failed with exit code ${uploadResult.exitCode}`);
                console.error('❌ S3 upload failed');
                console.error(`stderr: ${uploadResult.stderr}`);
                tracker.failStage('s3_upload', `Upload failed: ${uploadResult.exitCode}`);
              }
            } catch (error) {
              log(logFilePath, `S3 upload error: ${(error as Error).message}`);
              console.error('❌ S3 upload error:', (error as Error).message);
              tracker.failStage('s3_upload', (error as Error).message);
            }
          } else {
            // Fallback: Direct download if S3 not configured
            console.log('📥 Downloading model via rsync (excluding 24GB of checkpoints)...');
            ensureDirSync(opts.FINAL_ADAPTER_DIR);

            const modelDownloadResult = await rsyncDownload(
              ssh_user!, ssh_host!, ssh_key_path!,
              '/workspace/output/model', // Full model directory
              opts.FINAL_ADAPTER_DIR, // Download directly to final dir
              logFilePath,
              ssh_port,
              ['checkpoint-*', '*.pt', '*.pth', 'optimizer.pt', 'scheduler.pt', 'rng_state.pth']
            );

            if (modelDownloadResult.exitCode === 0) {
              // Download succeeded - pod will be terminated in finally block to stop all billing
              log(logFilePath, 'Full model downloaded (checkpoints excluded).');
              console.log('✅ Download complete (saved 24GB by excluding checkpoints).');
              tracker.completeStage('adapter_download');

            // Convert to GGUF locally if enabled in config
            const ggufConfig = cfg.gguf_conversion;
            if (ggufConfig && ggufConfig.enabled) {
              console.log('\n🔧 Stage 6/7: Converting to GGUF locally...');
              console.log(`⏱️  Converting to ${ggufConfig.quantization_type} quantization (may take 10-20 minutes)\n`);
              log(logFilePath, 'Starting local GGUF conversion using llama.cpp...');
              tracker.startStage('gguf_conversion', `Converting to ${ggufConfig.quantization_type}`);

              try {
                // Paths
                const llamaCppPath = path.join(paths.root, 'vendor', 'llama.cpp');
                const convertScript = path.join(llamaCppPath, 'convert_hf_to_gguf.py');
                const quantizeBinary = path.join(llamaCppPath, 'llama-quantize');
                const modelParentDir = path.dirname(opts.FINAL_ADAPTER_DIR);
                const f16Path = path.join(modelParentDir, `model-f16.gguf`);
                const quantizedPath = path.join(modelParentDir, `model-${ggufConfig.quantization_type}.gguf`);

                // Ensure llama.cpp exists
                if (!fs.existsSync(llamaCppPath)) {
                  console.log('📦 llama.cpp not found, cloning...');
                  log(logFilePath, 'Cloning llama.cpp repository...');
                  const vendorDir = path.join(paths.root, 'vendor');
                  ensureDirSync(vendorDir);
                  execSync(`git clone https://github.com/ggml-org/llama.cpp.git "${llamaCppPath}"`, {
                    stdio: 'inherit',
                    cwd: vendorDir,
                  });
                  console.log('✓ llama.cpp cloned');
                }

                if (!fs.existsSync(quantizeBinary)) {
                  console.log('🔨 Building llama.cpp binaries...');
                  log(logFilePath, 'Building llama.cpp binaries...');
                  execSync('make -j$(nproc)', { cwd: llamaCppPath, stdio: 'inherit' });
                  console.log('✓ llama.cpp built');
                }

                // Step 1: Convert to F16 GGUF
                console.log('📝 Step 1/2: Converting to FP16 GGUF...');
                log(logFilePath, `Converting ${opts.FINAL_ADAPTER_DIR} to F16 GGUF...`);

                const venvPython = path.join(paths.root, 'venv', 'bin', 'python3');
                const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';

                execSync(`${pythonCmd} "${convertScript}" "${opts.FINAL_ADAPTER_DIR}" --outtype f16 --outfile "${f16Path}"`, {
                  stdio: 'inherit',
                  cwd: llamaCppPath,
                  env: { ...process.env, PYTHONPATH: llamaCppPath },
                });

                const f16SizeGB = (fs.statSync(f16Path).size / (1024 ** 3)).toFixed(2);
                console.log(`✓ F16 GGUF created (${f16SizeGB}GB)`);
                log(logFilePath, `F16 GGUF created: ${f16Path} (${f16SizeGB}GB)`);
                tracker.updateStage('gguf_conversion', 50, 'F16 conversion complete, quantizing...');

                // Step 2: Quantize to target format
                console.log(`📦 Step 2/2: Quantizing to ${ggufConfig.quantization_type}...`);
                log(logFilePath, `Quantizing to ${ggufConfig.quantization_type}...`);

                execSync(`"${quantizeBinary}" "${f16Path}" "${quantizedPath}" ${ggufConfig.quantization_type}`, {
                  stdio: 'inherit',
                  cwd: llamaCppPath,
                });

                const quantSizeGB = (fs.statSync(quantizedPath).size / (1024 ** 3)).toFixed(2);
                console.log(`✓ Quantized GGUF created (${quantSizeGB}GB)`);
                log(logFilePath, `Quantized GGUF: ${quantizedPath} (${quantSizeGB}GB)`);

                // Clean up intermediate F16 file
                console.log('🧹 Cleaning up intermediate F16 file...');
                fs.unlinkSync(f16Path);

                console.log(`\n✅ GGUF conversion complete!`);
                console.log(`📁 Safetensors: ${opts.FINAL_ADAPTER_DIR} (for future training)`);
                console.log(`📁 GGUF: ${quantizedPath} (for Ollama)`);
                console.log(`💾 Size: ${quantSizeGB}GB (${ggufConfig.quantization_type})\n`);

                log(logFilePath, `GGUF conversion complete: ${quantizedPath}`);
                tracker.completeStage('gguf_conversion');

                summary.gguf_path = quantizedPath;
              } catch (error) {
                console.error(`⚠️ GGUF conversion failed: ${(error as Error).message}`);
                log(logFilePath, `GGUF conversion failed: ${(error as Error).message}`);
                tracker.failStage('gguf_conversion', (error as Error).message);
                // Don't fail the entire pipeline - safetensors model is still usable
              }
            } else {
              console.log('ℹ️ GGUF conversion disabled in config, skipping');
              log(logFilePath, 'GGUF conversion disabled or not configured');
            }
          } else {
            log(logFilePath, `Model download failed with exit code ${modelDownloadResult.exitCode}`);
            console.error('❌ Model download failed.');
            tracker.failStage('adapter_download', `Model download failed: ${modelDownloadResult.exitCode}`);
          }
        }
        } else {
          log(logFilePath, 'Skipping model download due to training failure.');
          console.log('⚠️ Skipping model download due to training failure.');
        }
    } else {
        // LoRA training: download GGUF + adapter artifacts
        console.log('\n📥 Stage 5/6: Downloading trained model...');
        console.log('⏱️  This will download both the merged GGUF (~20GB) and adapter artifacts (~2GB)\n');
        log(logFilePath, 'Downloading merged GGUF and adapter artifacts...');
        tracker.startStage('adapter_download', 'Downloading merged GGUF');

        // First, download the merged GGUF (this is what we'll actually use)
        if (summary.training_success) {
            console.log('📥 Part 1/2: Downloading merged GGUF model via SCP...');
            const finalGGUFPath = path.join(path.dirname(opts.FINAL_ADAPTER_DIR), 'adapter.gguf');
            ensureDirSync(path.dirname(finalGGUFPath));

            const ggufDownloadResult = await sshScpDownload(
                ssh_user!, ssh_host!, ssh_key_path!,
                '/workspace/final_merged_model.gguf',
                finalGGUFPath,
                logFilePath,
                ssh_port
            );

            if (ggufDownloadResult.exitCode !== 0) {
                log(logFilePath, `Merged GGUF download failed with exit code ${ggufDownloadResult.exitCode}`);
                console.error(`❌ GGUF download via SCP failed.`);
                tracker.failStage('adapter_download', `GGUF SCP failed: ${ggufDownloadResult.exitCode}`);
            } else {
                const sizeGB = (fs.statSync(finalGGUFPath).size / (1024 ** 3)).toFixed(2);
                log(logFilePath, `Merged GGUF downloaded successfully to ${finalGGUFPath} (${sizeGB}GB)`);
                console.log(`✅ Merged GGUF saved successfully via SCP (${sizeGB}GB)`);
                tracker.updateStage('adapter_download', 50, 'GGUF ready, downloading adapter artifacts...');
            }
        } else {
            log(logFilePath, 'Skipping GGUF download due to training failure.');
            console.log('⚠️ Skipping GGUF download due to training failure.');
        }

        // Second, download the adapter artifacts (for potential future merging)
        console.log('\n📥 Part 2/2: Downloading adapter artifacts for archival via SCP...');
        ensureDirSync(opts.FINAL_ADAPTER_DIR);

        // Create a temporary directory for downloading the adapter contents
        const tempAdapterDir = path.join(opts.WORK_LOCAL, 'temp_adapter_download');
        ensureDirSync(tempAdapterDir);

        const adapterDownloadResult = await sshScpDownload(
            ssh_user!, ssh_host!, ssh_key_path!,
            '/output/adapter', // Download the whole directory
            tempAdapterDir,
            logFilePath,
            ssh_port,
            true // Recursive
        );

        if (adapterDownloadResult.exitCode === 0) {
            // Move contents from tempAdapterDir/adapter to FINAL_ADAPTER_DIR
            const downloadedAdapterPath = path.join(tempAdapterDir, 'adapter');
            if (fs.existsSync(downloadedAdapterPath)) {
                fs.readdirSync(downloadedAdapterPath).forEach(file => {
                    fs.renameSync(path.join(downloadedAdapterPath, file), path.join(opts.FINAL_ADAPTER_DIR, file));
                });
                fs.rmSync(tempAdapterDir, { recursive: true, force: true });
                log(logFilePath, 'Adapter artifacts moved to final directory.');
                console.log('✅ Adapter artifacts downloaded and moved successfully.');
            } else {
                log(logFilePath, 'Downloaded adapter directory not found in temp location.');
            }
        } else {
            log(logFilePath, `Adapter artifacts download failed with exit code ${adapterDownloadResult.exitCode}`);
            console.error(`❌ Adapter artifacts download failed.`);
        }
    }

    // Download the upload.ok file separately
    const uploadOkPath = path.join(opts.FINAL_ADAPTER_DIR, 'upload.ok');
    const uploadOkDownloadResult = await sshScpDownload(
        ssh_user!, ssh_host!, ssh_key_path!,
        '/workspace/input/upload.ok',
        uploadOkPath,
        logFilePath,
        ssh_port
    );
    if (uploadOkDownloadResult.exitCode === 0) {
        log(logFilePath, 'upload.ok file downloaded successfully.');
    } else {
        log(logFilePath, 'Failed to download upload.ok file.');
    }

    // Read upload.ok if we didn't get the verification earlier
    if (!summary.upload_verification) {
      const uploadOkPath = path.join(opts.FINAL_ADAPTER_DIR, 'upload.ok');
      if (fs.existsSync(uploadOkPath)) {
        const uploadOkContent = fs.readFileSync(uploadOkPath, 'utf-8');
        const sha256Line = uploadOkContent.split('\n').find(line => line.includes('config.json'));
        if (sha256Line) {
          summary.upload_verification = sha256Line.trim();
        }
      }
    }

  } catch (error) {
    console.error(`\n❌ ====== TRAINING FAILED ======`);
    console.error(`Error: ${(error as Error).message}\n`);
    log(logFilePath, `An error occurred: ${(error as Error).message}`);
    tracker.fail((error as Error).message);
    summary.training_success = false;
    summary.error = (error as Error).message;
  } finally {
    // 3.6. Terminate the pod
    if (pod_id) {
      console.log('\n🛑 Stage 6/6: Terminating pod...');
      tracker.startStage('pod_termination', `Stopping pod ${pod_id}`);
      log(logFilePath, `Terminating pod ${pod_id}...`);
      const terminateMutation = `
        mutation TerminatePod {
          podTerminate(input: { podId: \"${pod_id}\" })
        }`;
      try {
        await callRunPodAPI(runpodApiKey, terminateMutation);
        summary.terminated = true;
        log(logFilePath, 'Pod termination request sent successfully.');
        console.log(`✅ Pod ${pod_id} terminated`);
        tracker.completeStage('pod_termination');
      } catch (error) {
        log(logFilePath, `Failed to terminate pod: ${(error as Error).message}`);
        console.error(`⚠️  Failed to terminate pod: ${(error as Error).message}`);
        summary.terminated = false;
      }
    }

    // ROBUSTNESS: Create Modelfile even if training_success is false, as long as GGUF exists
    // This handles cases where training succeeded but post-processing failed
    if (!summary.training_success) {
      try {
        const pathMatch = opts.FINAL_ADAPTER_DIR.match(/profiles\/([^/]+)\//);
        const username = pathMatch ? pathMatch[1] : 'user';
        const dateStr = path.basename(path.dirname(opts.FINAL_ADAPTER_DIR));
        const runId = path.basename(opts.FINAL_ADAPTER_DIR);
        const isFullFineTune = trainingMode === 'full_finetune' || trainingMode === 'full';

        let ggufPath: string;
        if (isFullFineTune) {
          const modelParentDir = path.dirname(opts.FINAL_ADAPTER_DIR);
          ggufPath = path.join(modelParentDir, `model-Q6_K.gguf`);
        } else {
          ggufPath = path.join(path.dirname(opts.FINAL_ADAPTER_DIR), 'adapter.gguf');
        }

        // Only create Modelfile if GGUF actually exists (training may have produced output despite error)
        if (fs.existsSync(ggufPath)) {
          console.log('\n⚠️  Training marked as failed, but GGUF file exists - creating Modelfile anyway');
          log(logFilePath, `Found GGUF at ${ggufPath} despite training_success=false, creating Modelfile`);

          const usernameCapitalized = username.charAt(0).toUpperCase() + username.slice(1);
          const modelfileContent = `# MetaHuman OS ${isFullFineTune ? 'Full Fine-Tuned' : 'LoRA Adapter'} Model - ${username} - ${dateStr}
# Training run: ${runId}
# Note: Training had errors but model file was created
FROM ${ggufPath}

TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
{{ .Response }}<|im_end|>
"""

SYSTEM You are ${usernameCapitalized}'s digital personality extension. Speak naturally in first person as ${usernameCapitalized}.`;

          const modelfilePath = path.join(path.dirname(ggufPath), 'Modelfile');
          fs.writeFileSync(modelfilePath, modelfileContent);
          console.log(`✅ Created Modelfile at ${modelfilePath}`);
          log(logFilePath, `Created fallback Modelfile at ${modelfilePath}`);

          // Attempt to load into Ollama (best effort)
          try {
            const modelName = isFullFineTune ? `${username}-finetune-${dateStr}` : `${username}-${dateStr}`;
            console.log(`🦙 Attempting to load model into Ollama: ${modelName}`);
            log(logFilePath, `Running: ollama create ${modelName} -f ${modelfilePath}`);

            const { execSync } = await import('node:child_process');
            execSync(`ollama create ${modelName} -f "${modelfilePath}"`, {
              stdio: 'pipe',
              encoding: 'utf-8',
              timeout: 300000,
            });

            console.log(`✅ Model loaded into Ollama despite training errors`);
            log(logFilePath, `Successfully loaded ${modelName} into Ollama`);
          } catch (ollamaError) {
            console.warn(`⚠️  Failed to load model into Ollama: ${(ollamaError as Error).message}`);
            log(logFilePath, `Ollama load failed: ${(ollamaError as Error).message}`);
          }
        }
      } catch (fallbackError) {
        // Don't fail the entire process if fallback Modelfile creation fails
        log(logFilePath, `Fallback Modelfile creation failed: ${(fallbackError as Error).message}`);
        console.warn(`⚠️  Could not create fallback Modelfile: ${(fallbackError as Error).message}`);
      }
    }

    // Final completion message
    if (summary.training_success) {
      tracker.complete(`Training successful - adapter saved to ${opts.FINAL_ADAPTER_DIR}`);
      console.log('\n🎉 ====== TRAINING COMPLETED SUCCESSFULLY ======');
      console.log(`📁 Adapter location: ${opts.FINAL_ADAPTER_DIR}`);
      console.log(`📊 Progress log: ${tracker.getStatusFilePath()}`);
      console.log(`📝 Training output: ${path.join(opts.WORK_LOCAL, 'training_output.txt')}\n`);

      // 3.6.1 Load model into Ollama automatically
      console.log('\n🦙 Stage 7/7: Loading model into Ollama...');
      log(logFilePath, 'Creating Ollama model from GGUF...');
      tracker.startStage('ollama_load', 'Creating Ollama model');

      try {
        // Extract username from path (e.g., profiles/greggles/out/...)
        const pathMatch = opts.FINAL_ADAPTER_DIR.match(/profiles\/([^/]+)\//);
        const username = pathMatch ? pathMatch[1] : 'user';

        // Determine GGUF path and model name based on training type
        let ggufPath: string;
        let modelName: string;
        const dateStr = path.basename(path.dirname(opts.FINAL_ADAPTER_DIR));  // e.g., "2025-11-22"
        const runId = path.basename(opts.FINAL_ADAPTER_DIR);                   // e.g., "2025-11-22-065730-98d59b"
        const isFullFineTune = trainingMode === 'full_finetune' || trainingMode === 'full';

        if (isFullFineTune) {
          // Full fine-tune: use Q6_K quantized model
          const modelParentDir = path.dirname(opts.FINAL_ADAPTER_DIR);
          ggufPath = path.join(modelParentDir, `model-Q6_K.gguf`);
          modelName = `${username}-finetune-${dateStr}`;

          if (!fs.existsSync(ggufPath)) {
            // Fallback to safetensors directory if Q6_K not found (conversion might have failed)
            console.log(`⚠️ Q6_K model not found at ${ggufPath}, skipping Ollama load`);
            log(logFilePath, `Q6_K model not found, skipping Ollama load`);
            tracker.failStage('ollama_load', 'Q6_K model not found');
            throw new Error('Q6_K model not found');
          }
        } else {
          // LoRA training: use merged adapter GGUF
          ggufPath = path.join(path.dirname(opts.FINAL_ADAPTER_DIR), 'adapter.gguf');
          modelName = `${username}-${dateStr}`;

          if (!fs.existsSync(ggufPath)) {
            console.log(`⚠️ Adapter GGUF not found at ${ggufPath}, skipping Ollama load`);
            log(logFilePath, `Adapter GGUF not found, skipping Ollama load`);
            tracker.failStage('ollama_load', 'Adapter GGUF not found');
            throw new Error('Adapter GGUF not found');
          }
        }

        // Create Modelfile
        const usernameCapitalized = username.charAt(0).toUpperCase() + username.slice(1);
        const modelfileContent = `# MetaHuman OS ${isFullFineTune ? 'Full Fine-Tuned' : 'LoRA Adapter'} Model - ${username} - ${dateStr}
# Training run: ${runId}
FROM ${ggufPath}

TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
{{ .Response }}<|im_end|>
"""

SYSTEM You are ${usernameCapitalized}'s digital personality extension. Speak naturally in first person as ${usernameCapitalized}.`;

        const modelfilePath = path.join(path.dirname(ggufPath), 'Modelfile');
        fs.writeFileSync(modelfilePath, modelfileContent);
        log(logFilePath, `Created Modelfile at ${modelfilePath}`);

        // Load model into Ollama
        console.log(`🦙 Creating Ollama model: ${modelName}`);
        console.log(`📁 From GGUF: ${ggufPath}`);
        log(logFilePath, `Running: ollama create ${modelName} -f ${modelfilePath}`);

        const ollamaResult = execSync(`ollama create ${modelName} -f "${modelfilePath}"`, {
          stdio: 'pipe',
          encoding: 'utf-8',
          timeout: 300000,  // 5 minute timeout
        });

        console.log(`✅ Ollama model created: ${modelName}`);
        log(logFilePath, `Ollama model created successfully: ${modelName}`);
        log(logFilePath, `Ollama output: ${ollamaResult}`);
        tracker.completeStage('ollama_load');

        summary.ollama_model = modelName;
        summary.ollama_loaded = true;

        console.log('\n🎊 Model is now available in Ollama!');
        console.log(`   Run: ollama run ${modelName}\n`);

      } catch (error) {
        console.error(`⚠️ Failed to load model into Ollama: ${(error as Error).message}`);
        log(logFilePath, `Ollama load failed: ${(error as Error).message}`);
        tracker.failStage('ollama_load', (error as Error).message);
        summary.ollama_loaded = false;
        // Don't fail the entire training - model files are still usable
      }
    }

    // 3.7. Write final summary
    fs.writeFileSync(opts.SUMMARY_FILE, JSON.stringify(summary, null, 2));

    // 3.8. Auto-cleanup: Archive old training runs
    try {
      const pathMatch = opts.FINAL_ADAPTER_DIR.match(/profiles\/([^/]+)\//);
      const username = pathMatch ? pathMatch[1] : null;

      if (username) {
        const { autoCleanupTrainingRuns, cleanupOldWorkDirectories } = await import('@metahuman/core');
        const isFullFineTune = trainingMode === 'full_finetune' || trainingMode === 'full';
        await autoCleanupTrainingRuns(username, opts.RUN_LABEL, isFullFineTune);
        cleanupOldWorkDirectories(username);
      }
    } catch (err) {
      console.warn('[lora-trainer] Auto-cleanup failed (non-critical):', (err as Error).message);
      log(logFilePath, `Auto-cleanup failed: ${(err as Error).message}`);
    }
  }

  return summary;
}
