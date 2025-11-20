import type { APIRoute } from 'astro';
import { loadCuriosityConfig, saveCuriosityConfig, systemPaths, getAuthenticatedUser } from '@metahuman/core';
import fs from 'node:fs';
import path from 'node:path';

const handler: APIRoute = async ({ cookies, request }) => {
  // SECURITY FIX: 2025-11-20 - Require owner role for system configuration access
  // Curiosity config and agents.json are system-level files
  try {
    const user = getAuthenticatedUser(cookies);

    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ success: false, error: 'Owner role required to access/modify system configuration' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: 'Authentication required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

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

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// SECURITY FIX: 2025-11-20 - Require owner role for system configuration
export const GET = handler;
export const POST = handler;
