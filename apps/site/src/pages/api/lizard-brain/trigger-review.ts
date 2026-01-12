/**
 * Trigger Big Brother Review API
 *
 * POST: Manually trigger a Big Brother review of Lizard Brain activity
 * Owner-only endpoint
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { requireOwner } from '../../../middleware/cognitiveModeGuard';
import { loadScratchpad, addScratchpadEntry } from '@metahuman/core';
import { recordBigBrotherReview } from '@metahuman/core';
import { escalateToBigBrother, loadFreshOperatorConfig } from '@metahuman/core';

const handler: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Load operator config to check if Big Brother is enabled (fresh, no cache)
    const operatorConfig = loadFreshOperatorConfig(user.username);

    if (!operatorConfig.bigBrotherMode?.enabled) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Big Brother mode is not enabled. Enable it in operator.json first.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Load current scratchpad for context
    const scratchpad = loadScratchpad();
    const cycleNumber = scratchpad.cycleNumber;

    // Build review context
    const recentEntries = scratchpad.entries.slice(-20);
    const contextLines = [
      '# Manual Big Brother Review Request',
      '',
      `## Requested by: ${user.username}`,
      `## Current Cycle: ${cycleNumber}`,
      '',
      '## Recent Activity',
      ...recentEntries.map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString();
        return `[${time}] ${e.type.toUpperCase()}: ${e.content}`;
      }),
    ];

    console.log(`[API] Triggering manual Big Brother review for ${user.username}`);

    // Convert ScratchpadEntry to BigBrotherScratchpadEntry format
    const bbScratchpad = recentEntries.map((e) => ({
      type: e.type === 'decision' ? 'thought' as const :
            e.type === 'execution' ? 'action' as const :
            e.type as 'thought' | 'action' | 'observation',
      content: e.content,
      timestamp: e.timestamp,
    }));

    // Escalate to Big Brother
    const result = await escalateToBigBrother(
      {
        goal: 'Review Lizard Brain autonomous operation (manual request)',
        stuckReason: 'Manual review requested by user',
        errorType: null,
        scratchpad: bbScratchpad,
        context: {
          cycleNumber,
          requestedBy: user.username,
          reviewContext: contextLines.join('\n'),
        },
        suggestions: [
          'Review recent decisions and their outcomes',
          'Identify any issues or areas for improvement',
          'Suggest configuration changes if needed',
        ],
      },
      operatorConfig
    );

    // Record the review
    const suggestions: string[] = [];
    if (result.reasoning) {
      suggestions.push(result.reasoning);
    }
    if (result.alternativeApproach) {
      suggestions.push(`Alternative approach: ${result.alternativeApproach}`);
    }

    // Add to scratchpad
    if (result.success && result.reasoning) {
      addScratchpadEntry('thought', `[Manual Big Brother Review] ${result.reasoning}`);
    }

    // Log the review
    await recordBigBrotherReview(user.username, {
      triggeredAt: new Date().toISOString(),
      reason: 'manual',
      result: result.success ? 'success' : 'failed',
      suggestions,
      scratchpadInstructions: result.reasoning,
    });

    audit({
      category: 'system',
      level: 'info',
      event: 'lizard_brain_manual_review_triggered',
      actor: user.username,
      details: {
        cycleNumber,
        success: result.success,
        suggestionsCount: suggestions.length,
      },
    });

    return new Response(
      JSON.stringify({
        success: result.success,
        reasoning: result.reasoning,
        suggestions,
        alternativeApproach: result.alternativeApproach,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[API] trigger-review error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST = requireOwner(handler);
