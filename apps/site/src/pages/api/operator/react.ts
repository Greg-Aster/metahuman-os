/**
 * ReAct Operator API
 * Handles skill-based operations using the modern ReAct (Reason + Act) loop
 * Streams progress in real-time using Server-Sent Events
 */

import type { APIRoute } from 'astro';
import { initializeSkills } from '../../../../../../brain/skills/index';
import { runReActLoop, type ReActStep, type ReActContext, type OperatorTask } from '../../../../../../brain/agents/operator-react';
import { audit } from '@metahuman/core/audit';
import { requireOperatorMode } from '../../../middleware/cognitiveModeGuard';
import { getSecurityPolicy } from '@metahuman/core/security-policy';

// Initialize skills when module loads
initializeSkills();

interface ReactOperatorRequest {
  goal: string;
  audience?: string;
  context?: string;
  reasoningDepth?: number;  // 0-3 from UI slider
}

interface ReactOperatorResponse {
  success: boolean;
  goal: string;
  iterations: number;
  completed: boolean;
  result?: any;
  error?: string;
  steps?: ReActStep[];
}

/**
 * POST handler - Run a ReAct task with streaming progress
 */
const postHandler: APIRoute = async (context) => {
  try {
    const { request } = context;
    const body: ReactOperatorRequest = await request.json();
    const { goal, audience, context: taskContext, reasoningDepth } = body;

    if (!goal) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Goal is required'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get security policy
    const policy = getSecurityPolicy(context);

    // Log the incoming request
    audit({
      level: 'info',
      category: 'action',
      event: 'react_operator_api_request',
      details: {
        goal,
        audience,
        context: taskContext,
        cognitiveMode: policy.mode,
        role: policy.role
      },
      actor: 'web_ui',
    });

    // Check if streaming is requested
    const url = new URL(request.url);
    const stream = url.searchParams.get('stream') === 'true';

    if (stream) {
      // Return streaming response
      return streamReActTask(goal, audience, reasoningDepth);
    } else {
      // Return complete response after execution
      return runCompleteReActTask(goal, audience, reasoningDepth);
    }

  } catch (error) {
    console.error('[react_operator_api] Unexpected error:', error);

    audit({
      level: 'error',
      category: 'system',
      event: 'react_operator_api_error',
      details: { error: (error as Error).message },
      actor: 'web_ui',
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: `ReAct Operator API error: ${(error as Error).message}`
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * Run a ReAct task and return complete response
 */
async function runCompleteReActTask(goal: string, audience?: string, reasoningDepth?: number): Promise<Response> {
  const task: OperatorTask = {
    id: `task-${Date.now()}`,
    goal,
    audience,
    status: 'in_progress',
    created: new Date().toISOString(),
  };

  try {
    const reactContext: ReActContext = await runReActLoop(task, undefined, reasoningDepth);

    const response: ReactOperatorResponse = {
      success: reactContext.completed && !reactContext.error,
      goal: reactContext.goal,
      iterations: reactContext.steps.length,
      completed: reactContext.completed,
      result: reactContext.result,
      error: reactContext.error,
      steps: reactContext.steps,
    };

    audit({
      level: reactContext.error ? 'warn' : 'info',
      category: 'action',
      event: 'react_operator_completed',
      details: {
        goal,
        iterations: reactContext.steps.length,
        completed: reactContext.completed,
        hasError: !!reactContext.error,
      },
      actor: 'web_ui',
    });

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const response: ReactOperatorResponse = {
      success: false,
      goal,
      iterations: 0,
      completed: false,
      error: (error as Error).message,
    };

    return new Response(
      JSON.stringify(response),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Stream ReAct task progress using Server-Sent Events
 */
function streamReActTask(goal: string, audience?: string, reasoningDepth?: number): Response {
  const task: OperatorTask = {
    id: `task-${Date.now()}`,
    goal,
    audience,
    status: 'in_progress',
    created: new Date().toISOString(),
  };

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Helper to send SSE event
      const sendEvent = (event: string, data: any) => {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      try {
        // Send start event
        sendEvent('start', { goal, audience });

        // Run ReAct loop with progress callback
        const reactContext = await runReActLoop(task, (step: ReActStep) => {
          // Stream each step as it completes
          sendEvent('step', step);

          // Also emit reasoning stages for UI compatibility if reasoning is enabled
          if (reasoningDepth && reasoningDepth > 0) {
            // Emit thought process as a reasoning stage
            sendEvent('reasoning', {
              round: step.iteration,
              stage: `react_step_${step.iteration}`,
              content: `**Thought:** ${step.thought}\n\n**Action:** ${step.action}\n\n**Observation:** ${step.observation}${step.reasoning ? `\n\n**Deep Reasoning:** ${step.reasoning}` : ''}`,
            });
          }
        }, reasoningDepth);

        // Send completion event
        sendEvent('complete', {
          success: reactContext.completed && !reactContext.error,
          iterations: reactContext.steps.length,
          completed: reactContext.completed,
          result: reactContext.result,
          error: reactContext.error,
        });

        audit({
          level: reactContext.error ? 'warn' : 'info',
          category: 'action',
          event: 'react_operator_stream_completed',
          details: {
            goal,
            iterations: reactContext.steps.length,
            completed: reactContext.completed,
            hasError: !!reactContext.error,
          },
          actor: 'web_ui',
        });

      } catch (error) {
        // Send error event
        sendEvent('error', {
          error: (error as Error).message,
        });

        audit({
          level: 'error',
          category: 'action',
          event: 'react_operator_stream_error',
          details: {
            goal,
            error: (error as Error).message,
          },
          actor: 'web_ui',
        });
      } finally {
        // Close the stream
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// Wrap POST with operator mode guard (blocks in emulation mode and for non-owners)
export const POST = requireOperatorMode(postHandler);

/**
 * GET handler - Status and diagnostics
 */
export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'status';

    switch (action) {
      case 'status':
        return new Response(
          JSON.stringify({
            status: 'online',
            mode: 'react',
            description: 'ReAct (Reason + Act) operator with dynamic observation loops',
            maxIterations: 10,
            features: [
              'Single-step planning',
              'Observation-based adaptation',
              'Real-time streaming',
              'No hallucinated data',
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('[react_operator_api] Status check error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: `Status check error: ${(error as Error).message}`
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
