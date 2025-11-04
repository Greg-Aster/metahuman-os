/**
 * Operator API
 * Handles skill-based operations through the MetaHuman OS skills system
 */

import type { APIRoute } from 'astro';
import { initializeSkills } from '../../../../../brain/skills/index';
import { runTask } from '../../../../../brain/agents/operator';
import { executeSkill, loadTrustLevel, getAvailableSkills, listSkills } from '../../../../../packages/core/src/skills';
import { audit } from '@metahuman/core/audit';

// Initialize skills when module loads
initializeSkills();

interface OperatorRequest {
  goal: string;
  context?: string;
  autoApprove?: boolean;
  profile?: 'files' | 'git' | 'web';
  yolo?: boolean;
  mode?: 'strict' | 'yolo';
}

interface OperatorResponse {
  success: boolean;
  task: {
    goal: string;
    context?: string;
  };
  plan?: {
    steps: Array<{
      id: number;
      description: string;
      skillId: string;
      inputs: Record<string, any>;
      expectedOutput: string;
    }>;
  };
  results?: Array<{
    stepId: number;
    success: boolean;
    output?: any;
    error?: string;
  }>;
  critique?: {
    success: boolean;
    feedback: string;
    shouldRetry: boolean;
    suggestedFixes?: string;
  };
  error?: string;
  mode?: 'strict' | 'yolo';
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body: OperatorRequest = await request.json();
    const { goal, context, autoApprove = false, profile, yolo, mode } = body;

    if (!goal) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Goal is required' 
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const resolvedMode: 'strict' | 'yolo' = mode === 'yolo' || yolo ? 'yolo' : 'strict';

    // Log the incoming request
    audit({
      level: 'info',
      category: 'action',
      event: 'operator_api_request',
      details: { goal, context, autoApprove, mode: resolvedMode },
      actor: 'web_ui',
    });

    // Run the task through the operator agent
    const result = await runTask({ goal, context }, 1, { autoApprove, profile, mode: resolvedMode }); // Max 1 retry, honor auto-approve + profile

    // Return success response
    const response: OperatorResponse = {
      success: result.success,
      task: { goal, context },
      plan: result.plan,
      results: result.results,
      critique: result.critique,
      error: result.error,
      mode: resolvedMode,
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[operator_api] Unexpected error:', error);
    
    audit({
      level: 'error',
      category: 'system',
      event: 'operator_api_error',
      details: { error: (error as Error).message },
      actor: 'web_ui',
    });

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: `Operator API error: ${(error as Error).message}` 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'status';
    
    switch (action) {
      case 'status':
        const trustLevel = loadTrustLevel();
        const availableSkills = getAvailableSkills(trustLevel);
        
        return new Response(
          JSON.stringify({
            status: 'online',
            trustLevel,
            availableSkills: availableSkills.map(s => ({
              id: s.id,
              name: s.name,
              description: s.description,
              risk: s.risk,
              requiresApproval: s.requiresApproval
            })),
            totalSkills: listSkills().length
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      case 'doctor': {
        const trust = loadTrustLevel();
        const skills = getAvailableSkills(trust).map(s => s.id);
        const writableRoots = ['memory/episodic','memory/semantic','memory/procedural','memory/tasks','memory/audio','out/','logs/'];
        return new Response(
          JSON.stringify({
            ok: true,
            trustLevel: trust,
            skills,
            writableRoots,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
      case 'skills':
        const allSkills = listSkills();
        return new Response(
          JSON.stringify({
            skills: allSkills.map(s => ({
              id: s.id,
              name: s.name,
              description: s.description,
              category: s.category,
              risk: s.risk,
              minTrustLevel: s.minTrustLevel,
              requiresApproval: s.requiresApproval
            }))
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
    console.error('[operator_api] Status check error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: `Status check error: ${(error as Error).message}` 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
