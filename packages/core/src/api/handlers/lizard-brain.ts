import type { UnifiedHandler } from '../types.js';
import { audit } from '../../audit.js';
import {
  getAvailableLogDates,
  getLizardBrainLogs,
  getMultiDaySummary,
  getRecentEntries,
  recordBigBrotherReview,
} from '../../active-operator/lizard-brain-logger.js';
import { loadScratchpad, addScratchpadEntry } from '../../active-operator/state-persister.js';
import { escalateToBigBrother } from '../../big-brother.js';
import { loadFreshOperatorConfig } from '../../config.js';

export const handleGetLizardBrainLogs: UnifiedHandler = async (req) => {
  if (!req.user.isAuthenticated) {
    return {
      status: 200,
      data: {
        entries: [],
        summary: null,
        message: 'Login required',
      },
    };
  }

  const date = req.query?.date;
  const days = req.query?.days;
  const recent = req.query?.recent;
  const listDates = req.query?.list;

  try {
    if (listDates === 'true') {
      const dates = await getAvailableLogDates(req.user.username);
      return { status: 200, data: { dates } };
    }

    if (days) {
      const numDays = parseInt(days, 10) || 7;
      const summary = await getMultiDaySummary(req.user.username, numDays);
      return { status: 200, data: summary };
    }

    if (recent) {
      const limit = parseInt(recent, 10) || 50;
      const entries = await getRecentEntries(req.user.username, limit);
      return { status: 200, data: { entries } };
    }

    const logFile = await getLizardBrainLogs(req.user.username, date || undefined);
    return { status: 200, data: logFile };
  } catch (error) {
    console.error('[api/lizard-brain] logs error:', error);
    return {
      status: 500,
      data: { error: (error as Error).message },
    };
  }
};

export const handleTriggerLizardBrainReview: UnifiedHandler = async (req) => {
  try {
    const operatorConfig = loadFreshOperatorConfig(req.user.username);

    if (!operatorConfig.bigBrotherMode?.enabled) {
      return {
        status: 400,
        data: {
          success: false,
          error: 'Big Brother mode is not enabled. Enable it in operator.json first.',
        },
      };
    }

    const scratchpad = loadScratchpad();
    const cycleNumber = scratchpad.cycleNumber;
    const recentEntries = scratchpad.entries.slice(-20);
    const contextLines = [
      '# Manual Big Brother Review Request',
      '',
      `## Requested by: ${req.user.username}`,
      `## Current Cycle: ${cycleNumber}`,
      '',
      '## Recent Activity',
      ...recentEntries.map((entry) => {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        return `[${time}] ${entry.type.toUpperCase()}: ${entry.content}`;
      }),
    ];

    console.log(`[api/lizard-brain] Triggering manual Big Brother review for ${req.user.username}`);

    const bbScratchpad = recentEntries.map((entry) => ({
      type: entry.type === 'decision'
        ? ('thought' as const)
        : entry.type === 'execution'
          ? ('action' as const)
          : (entry.type as 'thought' | 'action' | 'observation'),
      content: entry.content,
      timestamp: entry.timestamp,
    }));

    const result = await escalateToBigBrother(
      {
        goal: 'Review Lizard Brain autonomous operation (manual request)',
        stuckReason: 'Manual review requested by user',
        errorType: null,
        scratchpad: bbScratchpad,
        context: {
          cycleNumber,
          requestedBy: req.user.username,
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

    const suggestions: string[] = [];
    if (result.reasoning) {
      suggestions.push(result.reasoning);
    }
    if (result.alternativeApproach) {
      suggestions.push(`Alternative approach: ${result.alternativeApproach}`);
    }

    if (result.success && result.reasoning) {
      addScratchpadEntry('thought', `[Manual Big Brother Review] ${result.reasoning}`);
    }

    await recordBigBrotherReview(req.user.username, {
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
      actor: req.user.username,
      details: {
        cycleNumber,
        success: result.success,
        suggestionsCount: suggestions.length,
      },
    });

    return {
      status: 200,
      data: {
        success: result.success,
        reasoning: result.reasoning,
        suggestions,
        alternativeApproach: result.alternativeApproach,
      },
    };
  } catch (error) {
    console.error('[api/lizard-brain] trigger-review error:', error);
    return {
      status: 500,
      data: { error: (error as Error).message },
    };
  }
};
