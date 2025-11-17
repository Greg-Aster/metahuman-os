import type { APIRoute } from 'astro';
import { loadCuriosityConfig, saveCuriosityConfig, systemPaths } from '@metahuman/core';
import { withUserContext } from '../../middleware/userContext';
import fs from 'node:fs';
import path from 'node:path';

const handler: APIRoute = async ({ request }) => {
  if (request.method === 'GET') {
    try {
      const config = loadCuriosityConfig();
      return new Response(JSON.stringify(config), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: (error as Error).message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (request.method === 'POST') {
    try {
      const updates = await request.json();
      const current = loadCuriosityConfig();

      // Merge updates (validate fields)
      const newConfig = {
        ...current,
        ...updates,
        // Clamp maxOpenQuestions to 0-5 range
        maxOpenQuestions: Math.max(0, Math.min(5, updates.maxOpenQuestions ?? current.maxOpenQuestions))
      };

      saveCuriosityConfig(newConfig);

      // Also update agents.json to sync the inactivityThreshold
      // This ensures the scheduler triggers curiosity at the right time
      if (updates.questionIntervalSeconds !== undefined) {
        try {
          const agentsPath = path.join(systemPaths.etc, 'agents.json');
          const agentsData = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));

          if (agentsData.agents.curiosity) {
            agentsData.agents.curiosity.inactivityThreshold = updates.questionIntervalSeconds;
            fs.writeFileSync(agentsPath, JSON.stringify(agentsData, null, 2), 'utf-8');
          }
        } catch (agentError) {
          console.error('[curiosity-config] Failed to update agents.json:', agentError);
          // Don't fail the whole request if agents.json update fails
        }
      }

      return new Response(JSON.stringify({ success: true, config: newConfig }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: (error as Error).message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' }
  });
};

// Wrap with user context middleware for automatic profile path resolution
export const GET = withUserContext(handler);
export const POST = withUserContext(handler);
