#!/usr/bin/env tsx
/**
 * Boredom Service (Legacy Compatibility Layer)
 *
 * This service maintains backward compatibility with the original boredom.json
 * configuration by translating it to the new AgentScheduler system.
 *
 * The boredom.json config controls the reflector agent's interval timing,
 * and the scheduler-service.ts handles the actual execution.
 *
 * NOTE: This service is now much simpler - it just updates the scheduler
 * configuration when boredom.json changes. The actual agent scheduling
 * is handled by scheduler-service.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths, audit, acquireLock, initGlobalLogger } from '@metahuman/core';
import { loadTrustLevel, getAvailableSkills } from '@metahuman/core';
import { readAutonomyConfig } from '@metahuman/core';

const boredomConfigFile = path.join(paths.etc, 'boredom.json');
const agentsConfigFile = path.join(paths.etc, 'agents.json');

function getBoredomConfig() {
  try {
    const configData = fs.readFileSync(boredomConfigFile, 'utf-8');
    return JSON.parse(configData);
  } catch (error) {
    console.error('[boredom-service] Error reading boredom config:', error);
    return null;
  }
}

function syncToScheduler() {
  const config = getBoredomConfig();
  const autonomy = readAutonomyConfig();

  if (!config) {
    console.log('[boredom-service] No config found, cannot sync to scheduler.');
    return;
  }

  const currentLevel = config.level || 'off';
  const intervalSeconds = config.intervals[currentLevel];

  // Read current agents.json
  let agentsConfig;
  try {
    agentsConfig = JSON.parse(fs.readFileSync(agentsConfigFile, 'utf-8'));
  } catch (error) {
    console.error('[boredom-service] Error reading agents.json:', error);
    return;
  }

  // Update reflector agent configuration
  if (agentsConfig.agents.reflector) {
    agentsConfig.agents.reflector.enabled = intervalSeconds && intervalSeconds > 0;
    agentsConfig.agents.reflector.interval = intervalSeconds || 900;
  }

  // Update boredom-maintenance configuration
  if (agentsConfig.agents['boredom-maintenance']) {
    agentsConfig.agents['boredom-maintenance'].enabled = autonomy.mode !== 'off';
    agentsConfig.agents['boredom-maintenance'].inactivityThreshold = intervalSeconds || 900;
  }

  // Write updated configuration
  try {
    fs.writeFileSync(agentsConfigFile, JSON.stringify(agentsConfig, null, 2));
    console.log(`[boredom-service] Synced to scheduler: level=${currentLevel}, interval=${intervalSeconds}s`);

    audit({
      category: 'system',
      level: 'info',
      message: `Boredom config synced to scheduler: ${currentLevel} mode`,
      actor: 'boredom-service',
      metadata: {
        level: currentLevel,
        intervalSeconds,
        autonomyMode: autonomy.mode
      }
    });

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
  } catch (error) {
    console.error('[boredom-service] Error writing agents.json:', error);
  }
}

function main() {
  initGlobalLogger('boredom-service');
  console.log('[boredom-service] Initializing compatibility layer...');
  console.log('[boredom-service] This service translates boredom.json → agents.json for scheduler');

  // Single-instance guard using lock acquisition (heals stale locks)
  try {
    acquireLock('service-boredom');
  } catch {
    console.log('[boredom-service] Another instance is running. Exiting.');
    return;
  }

  // Initial sync
  syncToScheduler();

  // Watch boredom.json for changes
  fs.watch(boredomConfigFile, (eventType) => {
    if (eventType === 'change') {
      console.log('[boredom-service] Boredom config changed, syncing to scheduler...');
      syncToScheduler();
    }
  });

  console.log('[boredom-service] Watching boredom.json for changes...');
}

main();
