import fs from 'node:fs';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { getProfilePaths } from '../../paths.js';

export async function handleGetPersonaInsights(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const profilePaths = getProfilePaths(req.user.username);
    const insightsPath = `${profilePaths.persona}/insights.json`;

    if (!fs.existsSync(insightsPath)) {
      return {
        status: 200,
        data: {
          version: '1.0.0',
          lastUpdated: null,
          entries: [],
        },
      };
    }

    return {
      status: 200,
      data: JSON.parse(fs.readFileSync(insightsPath, 'utf-8')),
    };
  } catch {
    return {
      status: 500,
      data: { error: 'Failed to load insights' },
    };
  }
}
