/**
 * Sleep Service - Nightly Pipeline Orchestration
 *
 * This module provides the core logic for the nightly processing pipeline.
 * It is now triggered by the night-pipeline.ts agent via the AgentScheduler,
 * rather than managing its own timer.
 *
 * Functions:
 * 1. loadSleepConfig() - Read etc/sleep.json configuration
 * 2. isSleepTime() - Check if current time is within sleep window
 * 3. isIdle() - Check if system has been idle for threshold duration
 * 4. runNightlyPipeline() - Orchestrate the full nightly pipeline:
 *    - Run dreamer agent (with maxDreamsPerNight limit)
 *    - Process audio backlog (transcriber + organizer)
 *    - LoRA training pipeline (adapter-builder, auto-approver, trainer, eval, activation)
 * 5. updateActivity() - Record user activity for idle detection
 *
 * MULTI-USER: This is a system-level orchestrator service. It triggers
 * multi-user agents (dreamer, night-processor) which handle per-user
 * processing with isolated contexts internally.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { paths, audit, setActiveAdapter } from '../../packages/core/src/index.js';
import type { ActiveAdapterInfo } from '../../packages/core/src/adapters.js';

export interface SleepConfig {
  enabled: boolean;
  window: { start: string; end: string };
  minIdleMins: number;
  maxDreamsPerNight: number;
  showInUI: boolean;
  evaluate: boolean;
  adapters: { prompt: boolean; rag: boolean; lora: boolean };
}

// Track dreams generated today
let dreamsToday = 0;
let lastDreamDate = '';

// Track last activity time (for idle detection)
let lastActivityTime = Date.now();

export function loadSleepConfig(): SleepConfig {
  try {
    const configPath = path.join(paths.etc, 'sleep.json');
    const data = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[sleep-service] Error reading sleep.json:', error);
    return {
      enabled: true,
      window: { start: '23:00', end: '06:30' },
      minIdleMins: 15,
      maxDreamsPerNight: 3,
      showInUI: true,
      evaluate: true,
      adapters: { prompt: true, rag: true, lora: false },
    };
  }
}

export function isSleepTime(schedule: { start: string; end: string }): boolean {
  if (!schedule || !schedule.start || !schedule.end) {
    return false;
  }

  const now = new Date();
  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();

  const [startHours, startMinutes] = schedule.start.split(':').map(Number);
  const [endHours, endMinutes] = schedule.end.split(':').map(Number);

  const currentTime = currentHours + currentMinutes / 60;
  const startTime = startHours + startMinutes / 60;
  const endTime = endHours + endMinutes / 60;

  // Handle overnight schedules (e.g., 23:00 - 07:00)
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime < endTime;
  }

  return currentTime >= startTime && currentTime < endTime;
}

export function isIdle(minIdleMins: number): boolean {
  const now = Date.now();
  const idleTimeMs = now - lastActivityTime;
  const idleTimeMins = idleTimeMs / (60 * 1000);
  return idleTimeMins >= minIdleMins;
}

export function resetDayCounter() {
  const today = new Date().toISOString().split('T')[0];
  if (lastDreamDate !== today) {
    dreamsToday = 0;
    lastDreamDate = today;
  }
}

function runAgent(agentName: string, description: string, args: string[] = []): Promise<number> {
  return new Promise((resolve, reject) => {
    console.log(`[sleep-service] Starting ${agentName}...`);

    const agentPath = path.join(paths.brain, 'agents', `${agentName}.ts`);

    if (!fs.existsSync(agentPath)) {
      console.warn(`[sleep-service] ${agentName} not found at ${agentPath}`);
      resolve(1);
      return;
    }

    audit({
      level: 'info',
      category: 'action',
      event: `${agentName}_triggered`,
      details: { description, args, triggeredBy: 'sleep-service' },
      actor: 'sleep-service',
    });

    const child = spawn('tsx', [agentPath, ...args], {
      stdio: 'inherit',
      cwd: paths.root,
    });

    child.on('error', (err) => {
      console.error(`[sleep-service] Failed to start ${agentName}: ${err.message}`);
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`[sleep-service] ${agentName} exited with code ${code}`);
      } else {
        console.log(`[sleep-service] ${agentName} completed successfully`);
      }
      resolve(code || 0);
    });
  });
}

export async function runNightlyPipeline(config: SleepConfig) {
  console.log('[sleep-service] Starting nightly pipeline...');

  audit({
    level: 'info',
    category: 'action',
    event: 'nightly_pipeline_started',
    details: {
      dreamsToday,
      maxDreamsPerNight: config.maxDreamsPerNight,
      hasAudioBacklog: true, // Could check inbox count here
    },
    actor: 'sleep-service',
  });

  try {
    // Step 1: Run dreamer if under daily limit
    if (dreamsToday < config.maxDreamsPerNight) {
      await runAgent('dreamer', 'Generate dreams and overnight learnings');
      dreamsToday++;
      console.log(`[sleep-service] Dreams generated today: ${dreamsToday}/${config.maxDreamsPerNight}`);
    } else {
      console.log(`[sleep-service] Max dreams per night reached (${config.maxDreamsPerNight}). Skipping dreamer.`);
    }

    // Step 2: Run night-processor to handle audio backlog (transcriber + audio-organizer)
    // Check if there's work to do first
    const inboxPath = paths.audioInbox;
    const transcriptsPath = paths.audioTranscripts;

    let inboxCount = 0;
    let transcriptsCount = 0;

    try {
      if (fs.existsSync(inboxPath)) {
        inboxCount = fs.readdirSync(inboxPath).filter(f => !f.startsWith('.')).length;
      }
      if (fs.existsSync(transcriptsPath)) {
        const transcriptFiles = fs.readdirSync(transcriptsPath).filter(f => f.endsWith('.txt'));
        transcriptsCount = transcriptFiles.length;
      }
    } catch (err) {
      console.warn('[sleep-service] Could not check audio backlog:', err);
    }

    if (inboxCount > 0 || transcriptsCount > 0) {
      console.log(`[sleep-service] Audio backlog detected: ${inboxCount} inbox, ${transcriptsCount} transcripts`);
      console.log('[sleep-service] Running night-processor to handle audio backlog...');
      await runAgent('night-processor', 'Process audio backlog (transcriber + audio-organizer)');
    } else {
      console.log('[sleep-service] No audio backlog to process.');
    }

    // Step 3: Tier-2 LoRA adaptation (if enabled)
    if (config.adapters.lora) {
      console.log('[sleep-service] LoRA adapters enabled. Starting dataset curation...');

      audit({
        level: 'info',
        category: 'action',
        event: 'lora_orchestration_started',
        details: { trigger: 'nightly_pipeline' },
        actor: 'sleep-service',
      });

      try {
        const datasetResult = await runAgent('adapter-builder', 'Curate instruction pairs for LoRA training');

        if (datasetResult === 0) {
          console.log('[sleep-service] LoRA dataset created successfully');

          const today = new Date().toISOString().split('T')[0];

          audit({
            level: 'info',
            category: 'action',
            event: 'lora_dataset_ready',
            details: {
              timestamp: new Date().toISOString(),
              date: today,
              nextStep: 'auto_approval_check',
            },
            actor: 'sleep-service',
          });

          // Trigger auto-approver
          console.log('[sleep-service] Running auto-approver...');

          try {
            const approverResult = await runAgent('auto-approver', 'Auto-approve dataset based on quality thresholds', [today]);

            if (approverResult === 0) {
              console.log('[sleep-service] Auto-approval check completed');
              // Note: Check approved.json to see if it was actually approved or just dry-run
            } else {
              console.warn('[sleep-service] Auto-approver failed or rejected dataset');
            }
          } catch (approverError) {
            console.error('[sleep-service] Error running auto-approver:', approverError);
            // Non-fatal; dataset is still available for manual review
          }

          console.log('[sleep-service] Dataset ready at: out/adapters/' + today + '/');
          console.log('[sleep-service] Check audit logs for auto-approval result.');

          // Auto-train/eval/activate if configured and not in dry-run
          try {
            const aaPath = path.join(paths.etc, 'auto-approval.json');
            const autoCfg = fs.existsSync(aaPath)
              ? JSON.parse(fs.readFileSync(aaPath, 'utf-8'))
              : { enabled: true, dryRun: true };

            const datasetDir = path.join(paths.out, 'adapters', today);
            const approvedPath = path.join(datasetDir, 'approved.json');

            if (!autoCfg.dryRun && fs.existsSync(approvedPath)) {
              // Auto-train
              if (autoCfg.autoTrain !== false) {
                console.log('[sleep-service] Auto-training LoRA adapter...');
                const trainCode = await runAgent('lora-trainer', 'Train LoRA adapter', [today]);
                if (trainCode !== 0) {
                  console.warn('[sleep-service] lora-trainer exited non-zero, aborting auto-eval/activation');
                } else {
                  // Auto-evaluate
                  if (autoCfg.autoEval !== false) {
                    console.log('[sleep-service] Auto-evaluating adapter...');
                    await runAgent('eval-adapter', 'Evaluate LoRA adapter', [today]);
                  }

                  // Check evaluation result
                  const evalPath = path.join(datasetDir, 'eval.json');
                  if (fs.existsSync(evalPath)) {
                    const evalData = JSON.parse(fs.readFileSync(evalPath, 'utf-8'));
                    if (evalData.passed) {
                      // Auto-activate
                      if (autoCfg.autoActivate !== false) {
                        console.log('[sleep-service] Auto-activating adapter (metadata + Modelfile)...');
                        const adapterPath = path.join(datasetDir, 'adapter_model.safetensors');
                        const modelName = `greg-${today}`;
                        const baseModel = process.env.METAHUMAN_BASE_MODEL || 'dolphin-mistral:latest';
                        const modelfile = `# MetaHuman OS LoRA Adapter - ${today}\nFROM ${baseModel}\nADAPTER ${adapterPath}\n`;
                        const modelfilePath = path.join(datasetDir, 'Modelfile');
                        fs.writeFileSync(modelfilePath, modelfile);

                        const activatedAt = new Date().toISOString();
                        const activeInfo: ActiveAdapterInfo = {
                          modelName,
                          activatedAt,
                          adapterPath,
                          evalScore: evalData.score,
                          dataset: today,
                          modelfilePath,
                          status: 'ready_for_ollama_load',
                          activatedBy: 'sleep-service',
                          trainingMethod: 'remote',
                          baseModel,
                        };

                        setActiveAdapter(activeInfo);

                        // Auto-load into Ollama (best-effort)
                        try {
                          console.log(`[sleep-service] Running: ollama create ${modelName} -f ${modelfilePath}`);
                          execSync(`ollama create ${modelName} -f ${modelfilePath}`, { stdio: 'inherit' });
                          // Mark as loaded
                          const loadedInfo: ActiveAdapterInfo = { ...activeInfo, status: 'loaded' };
                          setActiveAdapter(loadedInfo);
                        } catch (e) {
                          console.warn('[sleep-service] Failed to auto-load model into Ollama:', (e as Error).message);
                        }

                        audit({
                          level: 'info',
                          category: 'action',
                          event: 'adapter_activated',
                          details: { date: today, modelName, evalScore: evalData.score, auto: true },
                          actor: 'sleep-service',
                        });
                      }
                    } else {
                      console.log('[sleep-service] Adapter failed evaluation, skipping activation');
                    }
                  }
                }
              }
            }
          } catch (autoErr) {
            console.warn('[sleep-service] Auto-train/eval/activate step failed:', autoErr);
          }
        } else {
          console.warn('[sleep-service] adapter-builder failed or returned non-zero exit code');

          audit({
            level: 'warn',
            category: 'action',
            event: 'lora_dataset_failed',
            details: { exitCode: datasetResult },
            actor: 'sleep-service',
          });
        }
      } catch (error) {
        console.error('[sleep-service] Error during LoRA orchestration:', error);

        audit({
          level: 'error',
          category: 'action',
          event: 'lora_orchestration_failed',
          details: { error: (error as Error).message },
          actor: 'sleep-service',
        });
      }
    } else {
      console.log('[sleep-service] LoRA adapters disabled (set adapters.lora: true in etc/sleep.json to enable)');
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'nightly_pipeline_completed',
      details: {
        dreamsGenerated: dreamsToday,
        audioInboxProcessed: inboxCount,
        transcriptsOrganized: transcriptsCount,
        loraEnabled: config.adapters.lora,
      },
      actor: 'sleep-service',
    });

    console.log('[sleep-service] Nightly pipeline completed.');
  } catch (error) {
    console.error('[sleep-service] Error during nightly pipeline:', error);
    audit({
      level: 'error',
      category: 'action',
      event: 'nightly_pipeline_failed',
      details: { error: (error as Error).message },
      actor: 'sleep-service',
    });
  }
}

export function updateActivity() {
  // This could be hooked into audit events or user interactions
  // For now, we assume activity = recent audit events
  lastActivityTime = Date.now();
}

/**
 * MIGRATION NOTE:
 *
 * This file previously ran as a standalone service with its own setInterval timer.
 * It has been refactored to export functions for use by the night-pipeline.ts agent,
 * which is triggered by the AgentScheduler.
 *
 * The main() function and setInterval have been removed to eliminate timer duplication.
 * All orchestration logic remains intact and is now invoked via:
 *   - night-pipeline.ts (scheduled by AgentScheduler)
 *   - runNightlyPipeline() (called from night-pipeline.ts)
 *
 * If you need to run this pipeline manually, use:
 *   npx tsx brain/agents/night-pipeline.ts
 */
