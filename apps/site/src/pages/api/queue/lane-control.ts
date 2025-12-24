/**
 * Lane Control API
 *
 * Pause/resume individual resource lanes.
 */

import type { APIRoute } from 'astro';
import { getQueueSystem } from '@metahuman/core';

type LaneId = 'local-llm' | 'vector-index' | 'remote-llm';

const VALID_LANES: LaneId[] = ['local-llm', 'vector-index', 'remote-llm'];

export const GET: APIRoute = async () => {
  try {
    const system = getQueueSystem();
    const state = system.getState();

    return new Response(
      JSON.stringify({
        success: true,
        lanes: {
          'local-llm': {
            ...state.lanes['local-llm'],
            paused: system.isLanePaused('local-llm'),
          },
          'vector-index': {
            ...state.lanes['vector-index'],
            paused: system.isLanePaused('vector-index'),
          },
          'remote-llm': {
            ...state.lanes['remote-llm'],
            paused: system.isLanePaused('remote-llm'),
          },
        },
        pausedLanes: system.getPausedLanes(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[API] Lane control error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { lane, action } = body as { lane: string; action: 'pause' | 'resume' };

    // Validate lane
    if (!VALID_LANES.includes(lane as LaneId)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Invalid lane: ${lane}. Must be one of: ${VALID_LANES.join(', ')}`,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate action
    if (action !== 'pause' && action !== 'resume') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid action. Must be "pause" or "resume"',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const system = getQueueSystem();

    if (action === 'pause') {
      system.pauseLane(lane as LaneId);
    } else {
      system.resumeLane(lane as LaneId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        lane,
        action,
        paused: system.isLanePaused(lane as LaneId),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[API] Lane control error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
