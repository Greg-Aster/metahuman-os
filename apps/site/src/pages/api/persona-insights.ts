/**
 * Persona Insights API
 *
 * GET /api/persona-insights
 * Returns the persona insights/changes history
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import { getAuthenticatedUser, getProfilePaths } from '@metahuman/core';

interface InsightEntry {
  timestamp: string;
  type: 'addition' | 'removal' | 'update';
  category: string;
  items: string[];
  memoriesAnalyzed: number;
  confidence: number;
}

interface InsightsFile {
  version: string;
  lastUpdated: string;
  entries: InsightEntry[];
}

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);
    const insightsPath = `${profilePaths.persona}/insights.json`;

    if (!fs.existsSync(insightsPath)) {
      return new Response(
        JSON.stringify({
          version: '1.0.0',
          lastUpdated: null,
          entries: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const insights: InsightsFile = JSON.parse(fs.readFileSync(insightsPath, 'utf-8'));

    return new Response(
      JSON.stringify(insights),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    if ((error as Error).message.includes('Authentication required')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    console.error('[persona-insights] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to load insights' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
