/**
 * Lizard Brain Logs API
 *
 * GET: Retrieve logs for a specific date
 * Query params:
 *   - date: YYYY-MM-DD (defaults to today)
 *   - days: Number of days to fetch (for multi-day summary)
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthRequiredError } from '@metahuman/core';
import {
  getLizardBrainLogs,
  getAvailableLogDates,
  getMultiDaySummary,
  getRecentEntries,
} from '@metahuman/core';

export const GET: APIRoute = async ({ cookies, url }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const date = url.searchParams.get('date');
    const days = url.searchParams.get('days');
    const recent = url.searchParams.get('recent');
    const listDates = url.searchParams.get('list');

    // List available log dates
    if (listDates === 'true') {
      const dates = await getAvailableLogDates(user.username);
      return new Response(JSON.stringify({ dates }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get multi-day summary
    if (days) {
      const numDays = parseInt(days, 10) || 7;
      const summary = await getMultiDaySummary(user.username, numDays);
      return new Response(JSON.stringify(summary), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get recent entries across multiple days
    if (recent) {
      const limit = parseInt(recent, 10) || 50;
      const entries = await getRecentEntries(user.username, limit);
      return new Response(JSON.stringify({ entries }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get logs for specific date (or today)
    const logFile = await getLizardBrainLogs(user.username, date || undefined);

    return new Response(JSON.stringify(logFile), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return new Response(
        JSON.stringify({
          entries: [],
          summary: null,
          message: 'Login required',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.error('[API] lizard-brain/logs error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
