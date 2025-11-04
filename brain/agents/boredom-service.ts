
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { paths, audit, acquireLock, initGlobalLogger } from '../../packages/core/src/index';
import { loadTrustLevel, getAvailableSkills } from '../../packages/core/src/skills';
import { readAutonomyConfig } from '../../packages/core/src/autonomy';
import { runTask } from './operator';

const boredomConfigFile = path.join(paths.root, 'etc', 'boredom.json');

let boredomInterval;
let activeIntervalId: NodeJS.Timeout | null = null;

function getBoredomConfig() {
  try {
    const configData = fs.readFileSync(boredomConfigFile, 'utf-8');
    return JSON.parse(configData);
  } catch (error) {
    console.error('[boredom-service] Error reading boredom config:', error);
    return null;
  }
}

function runReflectorAgent() {
  console.log('[boredom-service] Triggering reflector agent...');
  const agentPath = path.join(paths.brain, 'agents', 'reflector.ts');

  // Audit the trigger so the monitor can reflect service activity
  try {
    audit({
      category: 'action',
      level: 'info',
      message: 'Boredom service triggering reflector agent',
      actor: 'boredom-service',
      metadata: { target: 'reflector' }
    });
  } catch {}

  const child = spawn('tsx', [agentPath], {
    stdio: 'inherit',
    cwd: paths.root,
  });

  child.on('error', (err) => {
    console.error(`[boredom-service] Failed to start reflector agent: ${err.message}`);
  });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error(`[boredom-service] Reflector agent exited with code ${code}`);
    }
  });
}

function startBoredomTimer() {
  if (activeIntervalId) {
    clearInterval(activeIntervalId);
    activeIntervalId = null;
  }

  const config = getBoredomConfig();
  const autonomy = readAutonomyConfig();
  if (!config) {
    console.log('[boredom-service] No config found, service will not run.');
    return;
  }

  const currentLevel = config.level || 'off';
  const intervalSeconds = config.intervals[currentLevel];

  if (intervalSeconds && intervalSeconds > 0) {
    boredomInterval = intervalSeconds * 1000;
    activeIntervalId = setInterval(runReflectorAgent, boredomInterval);
    console.log(`[boredom-service] Started. Will reflect every ${intervalSeconds} seconds (level: ${currentLevel}).`);

    audit({
      category: 'system',
      level: 'info',
      message: `Boredom service started: ${currentLevel} mode`,
      actor: 'boredom-service',
      metadata: {
        level: currentLevel,
        intervalSeconds,
        nextReflection: new Date(Date.now() + boredomInterval).toISOString()
      }
    });

    // Trigger an immediate reflection shortly after start for UI visibility
    setTimeout(runReflectorAgent, 1000);

    // Capability banner (trust + skills + autonomy)
    try {
      const trust = loadTrustLevel();
      const skills = getAvailableSkills(trust).map(s => s.id);
      audit({
        category: 'system',
        level: 'info',
        message: 'Agent capability banner',
        actor: 'boredom-service',
        metadata: { trustLevel: trust, skills, autonomy }
      });
    } catch {}

    // Optional low-risk maintenance in supervised/bounded modes
    if (autonomy.mode !== 'off') {
      const delay = Math.min(5000, Math.max(2000, 0.05 * boredomInterval));
      setTimeout(async () => {
        try {
          await runTask(
            { goal: 'Summarize docs/README.md and save the summary to out/summaries/README-summary.md' },
            0,
            { autoApprove: true, profile: 'files' }
          );
        } catch (e) {
          console.error('[boredom-service] maintenance task failed:', (e as Error).message)
        }
      }, delay);
    }
  } else {
    console.log('[boredom-service] Boredom is turned off. Service is idle.');

    audit({
      category: 'system',
      level: 'info',
      message: 'Boredom service stopped: set to off',
      actor: 'boredom-service'
    });
  }
}

function main() {
  initGlobalLogger('boredom-service');
  console.log('[boredom-service] Initializing...');
  // Single-instance guard using lock acquisition (heals stale locks)
  try {
    acquireLock('service-boredom');
  } catch {
    console.log('[boredom-service] Failed to acquire lock. Exiting.');
    return;
  }
  startBoredomTimer();

  fs.watch(boredomConfigFile, (eventType) => {
    if (eventType === 'change') {
      console.log('[boredom-service] Boredom config changed, restarting timer...');
      startBoredomTimer();
    }
  });
}

main();
