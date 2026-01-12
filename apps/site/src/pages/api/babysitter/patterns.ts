/**
 * API: Get Babysitter Error Patterns
 *
 * Returns detected error patterns with occurrence counts and fix status.
 */

import type { APIRoute } from 'astro';
import * as fs from 'fs';
import * as path from 'path';
import { systemPaths } from '@metahuman/core';

export const GET: APIRoute = async ({ url }) => {
  try {
    // Read pattern file
    const patternPath = path.join(systemPaths.root, 'logs/run/babysitter-patterns.json');

    if (!fs.existsSync(patternPath)) {
      return new Response(
        JSON.stringify({ patterns: [], message: 'No patterns detected yet' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const content = fs.readFileSync(patternPath, 'utf-8');
    const data = JSON.parse(content);

    // Extract patterns
    const patterns = data.map((item: any) => ({
      signature: item.signature,
      occurrences: item.pattern.occurrences,
      firstSeen: item.pattern.firstSeen,
      lastSeen: item.pattern.lastSeen,
      sources: item.pattern.sources,
      autoFixable: item.pattern.autoFixable,
      fixId: item.pattern.fixId,
    }));

    // Sort by occurrences (most frequent first)
    patterns.sort((a: any, b: any) => b.occurrences - a.occurrences);

    // Apply limit
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const limitedPatterns = patterns.slice(0, limit);

    return new Response(
      JSON.stringify({
        patterns: limitedPatterns,
        total: patterns.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[babysitter-patterns] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to get babysitter patterns' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
