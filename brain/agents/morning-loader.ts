/**
 * Morning Loader Agent
 * Runs at the end of the sleep cycle to:
 * 1. Load the latest overnight learnings
 * 2. Compose the "daily operator profile" (base persona + overnight learnings)
 * 3. Activate the new profile for the operator
 * 4. Audit the activation
 *
 * This implements Tier 1 model adaptation (prompt adapter only, no training).
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths, audit, acquireLock, isLocked, setActiveAdapter, getActiveAdapter } from '../../packages/core/src/index.js';
import type { ActiveAdapterInfo } from '../../packages/core/src/adapters.js';

interface PersonaCore {
  name: string;
  role: string;
  values: string[];
  communication_style: string;
  expertise: string[];
}

/**
 * Load the base persona from persona/core.json
 */
function loadBasePersona(): PersonaCore | null {
  try {
    const personaPath = paths.personaCore;
    const data = fs.readFileSync(personaPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[morning-loader] Error loading persona/core.json:', error);
    return null;
  }
}

/**
 * Find the most recent overnight learnings file
 */
function findLatestOvernightLearnings(): string | null {
  try {
    const overnightDir = paths.proceduralOvernight;

    if (!fs.existsSync(overnightDir)) {
      console.log('[morning-loader] No overnight learnings directory found.');
      return null;
    }

    const files = fs.readdirSync(overnightDir)
      .filter(f => f.startsWith('overnight-learnings-') && f.endsWith('.md'))
      .sort()
      .reverse(); // Most recent first

    if (files.length === 0) {
      console.log('[morning-loader] No overnight learnings files found.');
      return null;
    }

    const latestFile = path.join(overnightDir, files[0]);
    return latestFile;
  } catch (error) {
    console.error('[morning-loader] Error finding overnight learnings:', error);
    return null;
  }
}

/**
 * Compose the daily operator profile
 * This combines the base persona with the overnight learnings
 */
function composeDailyProfile(persona: PersonaCore, overnightLearningsPath: string): string {
  let overnightContent = '';

  try {
    overnightContent = fs.readFileSync(overnightLearningsPath, 'utf-8');
  } catch (error) {
    console.warn('[morning-loader] Could not read overnight learnings:', error);
    overnightContent = '*(No overnight learnings available)*';
  }

  const profile = `# Daily Operator Profile

## Base Persona
**Name:** ${persona.name}
**Role:** ${persona.role}
**Communication Style:** ${persona.communication_style}

**Core Values:**
${persona.values.map(v => `- ${v}`).join('\n')}

**Expertise Areas:**
${persona.expertise.map(e => `- ${e}`).join('\n')}

---

## Overnight Learnings (Latest)

${overnightContent}

---

*This profile is composed daily by the morning-loader agent.*
*It combines the base persona with recent learnings extracted during the sleep cycle.*
*This implements Tier 1 adaptation: prompt-based grounding without model training.*
`;

  return profile;
}

/**
 * Save the daily profile to persona/overrides/
 */
function saveDailyProfile(profile: string): string {
  const today = new Date().toISOString().split('T')[0];
  const filename = `daily-profile-${today}.md`;
  const overridesDir = path.join(paths.persona, 'overrides');
  const filepath = path.join(overridesDir, filename);

  // Ensure directory exists
  fs.mkdirSync(overridesDir, { recursive: true });

  fs.writeFileSync(filepath, profile, 'utf-8');

  audit({
    level: 'info',
    category: 'data',
    event: 'daily_profile_created',
    details: {
      date: today,
      filepath,
      size: profile.length,
    },
    actor: 'morning-loader',
  });

  return filepath;
}

/**
 * Activate the daily operator profile
 * Tier 1: Makes profile available for chat/operator agents
 * Tier 2: Loads trained LoRA adapter if available and passing eval
 */
function activateProfile(profilePath: string) {
  // Tier 1: Create symlink to latest profile
  const symlinkPath = path.join(paths.persona, 'active-profile.md');

  try {
    // Remove existing symlink if it exists
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
    }

    // Create new symlink
    fs.symlinkSync(profilePath, symlinkPath);

    audit({
      level: 'info',
      category: 'action',
      event: 'operator_profile_loaded',
      details: {
        profilePath: path.basename(profilePath),
        activatedAt: new Date().toISOString(),
        tier: 'Tier 1 (prompt adapter)',
      },
      actor: 'morning-loader',
    });

    console.log(`[morning-loader] Profile activated: ${path.basename(profilePath)}`);
  } catch (error) {
    console.error('[morning-loader] Error activating profile:', error);
    audit({
      level: 'error',
      category: 'action',
      event: 'operator_profile_load_failed',
      details: { error: (error as Error).message },
      actor: 'morning-loader',
    });
  }

  // Tier 2: Check for trained adapter from last night
  try {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Check both today and yesterday (in case training completed overnight)
    for (const date of [today, yesterday]) {
      const adapterDir = path.join(paths.out, 'adapters', date);
      const evalPath = path.join(adapterDir, 'eval.json');
      const adapterPath = path.join(adapterDir, 'adapter_model.safetensors');

      if (!fs.existsSync(evalPath)) continue;

      const evalResult = JSON.parse(fs.readFileSync(evalPath, 'utf-8'));

      if (evalResult.passed) {
        console.log(`[morning-loader] Found passing adapter from ${date} (score: ${evalResult.score.toFixed(3)})`);

        // Check if already activated
        const existingAdapter = getActiveAdapter();
        if (existingAdapter?.dataset === date) {
          console.log(`[morning-loader] Adapter already active: ${existingAdapter.modelName}`);
          return; // Already activated
        }

        // Activate new adapter
        const modelName = `greg-${date}`;

        // Create Modelfile for Ollama
        const modelfile = `# MetaHuman OS LoRA Adapter - ${date}
FROM ${process.env.METAHUMAN_BASE_MODEL || 'dolphin-mistral:latest'}
ADAPTER ${adapterPath}
`;

        const modelfilePath = path.join(adapterDir, 'Modelfile');
        fs.writeFileSync(modelfilePath, modelfile);

        console.log(`[morning-loader] Creating Ollama model: ${modelName}`);
        console.log(`[morning-loader] Modelfile: ${modelfilePath}`);

        // Note: We don't auto-execute `ollama create` here because it requires Ollama to be running
        // and may take a while. Instead, we log instructions for manual execution or future automation.

        const activatedAt = new Date().toISOString();
        const activeInfo: ActiveAdapterInfo = {
          modelName,
          activatedAt,
          adapterPath,
          evalScore: evalResult.score,
          dataset: date,
          modelfilePath,
          status: 'ready_for_ollama_load',
          activatedBy: 'morning-loader',
          trainingMethod: 'remote',
          baseModel,
        };

        setActiveAdapter(activeInfo);

        audit({
          level: 'info',
          category: 'action',
          event: 'lora_adapter_activated',
          details: { modelName, evalScore: evalResult.score, dataset: date },
          actor: 'morning-loader',
        });

        console.log(`[morning-loader] ✓ Adapter activated: ${modelName}`);
        console.log(`[morning-loader] To load into Ollama, run:`);
        console.log(`[morning-loader]   ollama create ${modelName} -f ${modelfilePath}`);

        return; // Activated successfully
      } else {
        console.log(`[morning-loader] Adapter from ${date} did not pass eval (score: ${evalResult.score.toFixed(3)})`);
      }
    }

    console.log(`[morning-loader] No new LoRA adapters to activate.`);
  } catch (error) {
    console.warn('[morning-loader] Error checking for LoRA adapters:', error);
    // Non-fatal; continue with Tier 1 only
  }
}

/**
 * Main morning loader cycle
 */
async function run() {
  // Single-instance guard
  let lockHandle;
  try {
    if (isLocked('agent-morning-loader')) {
      console.log('[morning-loader] Another instance is already running. Exiting.');
      return;
    }
    lockHandle = acquireLock('agent-morning-loader');
  } catch {
    console.log('[morning-loader] Failed to acquire lock. Exiting.');
    return;
  }

  try {
    console.log('[morning-loader] Starting morning profile composition...');

    audit({
      level: 'info',
      category: 'action',
      event: 'morning_loader_started',
      details: {},
      actor: 'morning-loader',
    });

    // Step 1: Load base persona
    const persona = loadBasePersona();
    if (!persona) {
      console.error('[morning-loader] Failed to load base persona. Exiting.');
      return;
    }

    console.log(`[morning-loader] Base persona loaded: ${persona.name}`);

    // Step 2: Find latest overnight learnings
    const overnightLearningsPath = findLatestOvernightLearnings();
    if (!overnightLearningsPath) {
      console.log('[morning-loader] No overnight learnings found. Using base persona only.');
    } else {
      console.log(`[morning-loader] Latest learnings: ${path.basename(overnightLearningsPath)}`);
    }

    // Step 3: Compose daily profile
    const dailyProfile = composeDailyProfile(
      persona,
      overnightLearningsPath || ''
    );

    // Step 4: Save daily profile
    const profilePath = saveDailyProfile(dailyProfile);
    console.log(`[morning-loader] Daily profile saved: ${path.basename(profilePath)}`);

    // Step 5: Activate profile
    activateProfile(profilePath);

    audit({
      level: 'info',
      category: 'action',
      event: 'morning_loader_completed',
      details: {
        profilePath: path.basename(profilePath),
        hadOvernightLearnings: !!overnightLearningsPath,
      },
      actor: 'morning-loader',
    });

    console.log('[morning-loader] Morning profile composition completed successfully.');
  } catch (error) {
    console.error('[morning-loader] Error during morning loader:', error);
    audit({
      level: 'error',
      category: 'action',
      event: 'morning_loader_failed',
      details: { error: (error as Error).message },
      actor: 'morning-loader',
    });
  } finally {
    if (lockHandle) {
      lockHandle.release();
    }
  }
}

run().catch(console.error);
