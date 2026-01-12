/**
 * API: Get Babysitter Health Reports
 *
 * Returns health reports (hourly/daily/weekly) from the Babysitter agent.
 */

import type { APIRoute } from 'astro';
import * as fs from 'fs';
import * as path from 'path';
import { systemPaths } from '@metahuman/core';

export const GET: APIRoute = async ({ url }) => {
  try {
    const period = url.searchParams.get('period') || 'hourly';

    if (!['hourly', 'daily', 'weekly'].includes(period)) {
      return new Response(
        JSON.stringify({ error: 'Invalid period. Must be hourly, daily, or weekly' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Read report directory
    const reportPath = path.join(systemPaths.root, 'logs/run/babysitter-reports');

    if (!fs.existsSync(reportPath)) {
      return new Response(
        JSON.stringify({ reports: [], message: 'No reports available yet' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get all reports for this period
    const files = fs
      .readdirSync(reportPath)
      .filter(f => f.startsWith(`${period}-`) && f.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first

    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const reports = [];

    for (const file of files.slice(0, limit)) {
      try {
        const content = fs.readFileSync(path.join(reportPath, file), 'utf-8');
        const report = JSON.parse(content);
        reports.push(report);
      } catch {
        // Skip malformed files
      }
    }

    return new Response(
      JSON.stringify({ period, reports, total: files.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[babysitter-reports] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to get babysitter reports' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
