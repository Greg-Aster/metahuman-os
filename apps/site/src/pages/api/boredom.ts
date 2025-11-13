import type { APIRoute } from 'astro';
import { ROOT } from '@metahuman/core/paths';
import fs from 'node:fs/promises';
import path from 'node:path';
import { audit } from '@metahuman/core';

const agentsConfigPath = path.join(ROOT, 'etc', 'agents.json');

// Interval mapping (in seconds)
const INTERVALS = {
  high: 60,      // ~1 minute
  medium: 300,   // ~5 minutes
  low: 900,      // ~15 minutes
  off: -1        // disabled
};

/**
 * Derives the boredom level from agents.json configuration
 */
function getLevelFromAgentsConfig(agentsConfig: any): string {
  const maintenanceAgent = agentsConfig.agents?.['boredom-maintenance'];
  if (!maintenanceAgent || !maintenanceAgent.enabled) {
    return 'off';
  }

  const threshold = maintenanceAgent.inactivityThreshold;
  if (threshold <= 60) return 'high';
  if (threshold <= 300) return 'medium';
  return 'low';
}

export const GET: APIRoute = async () => {
  try {
    const configData = await fs.readFile(agentsConfigPath, 'utf-8');
    const agentsConfig = JSON.parse(configData);
    const level = getLevelFromAgentsConfig(agentsConfig);

    return new Response(JSON.stringify({ level }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const { level } = await request.json();

    // Read current agents.json
    const configData = await fs.readFile(agentsConfigPath, 'utf-8');
    const agentsConfig = JSON.parse(configData);

    // Update boredom-maintenance agent if level is specified
    if (level !== undefined) {
      const intervalSeconds = INTERVALS[level as keyof typeof INTERVALS];
      const enabled = intervalSeconds > 0;
      const threshold = enabled ? intervalSeconds : 900; // Use 900 as default when disabled

      if (agentsConfig.agents?.['boredom-maintenance']) {
        agentsConfig.agents['boredom-maintenance'].enabled = enabled;
        agentsConfig.agents['boredom-maintenance'].inactivityThreshold = threshold;
      }

      // Keep reflector disabled (it's managed by boredom-maintenance)
      if (agentsConfig.agents?.reflector) {
        agentsConfig.agents.reflector.enabled = false;
        agentsConfig.agents.reflector.interval = threshold;
      }

      // Write updated agents.json
      await fs.writeFile(agentsConfigPath, JSON.stringify(agentsConfig, null, 2));

      // Audit the change
      audit({
        category: 'system',
        level: 'info',
        event: 'boredom_level_changed',
        actor: 'boredom-api',
        details: {
          level,
          intervalSeconds,
          enabled,
          note: 'Reflections are now inner_dialogue only (never show in chat)'
        }
      });

      console.log(`[boredom API] Updated to ${level} (${enabled ? `${intervalSeconds}s` : 'disabled'}) - reflections are internal only`);
    }

    const finalLevel = level || getLevelFromAgentsConfig(agentsConfig);

    return new Response(
      JSON.stringify({ success: true, level: finalLevel }),
      { status: 200 }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
  }
};
