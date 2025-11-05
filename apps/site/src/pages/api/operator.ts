/**
 * Operator API
 * Handles skill-based operations through the MetaHuman OS skills system
 */

import type { APIRoute } from 'astro';
import { initializeSkills } from '../../../../../brain/skills/index';
import { runTask } from '../../../../../brain/agents/operator';
import { executeSkill, loadTrustLevel, getAvailableSkills, listSkills } from '../../../../../packages/core/src/skills';
import { audit } from '@metahuman/core/audit';
import { requireOperatorMode } from '../../middleware/cognitiveModeGuard';
import { getSecurityPolicy } from '@metahuman/core/security-policy';

// Initialize skills when module loads
initializeSkills();

interface OperatorRequest {
  goal: string;
  context?: string;
  autoApprove?: boolean;
  profile?: 'files' | 'git' | 'web';
  yolo?: boolean;
  mode?: 'strict' | 'yolo';
  allowMemoryWrites?: boolean; // Cognitive mode memory write permission
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

const postHandler: APIRoute = async (context) => {
  try {
    const { request } = context;
    const body: OperatorRequest = await request.json();
    const { goal, context: taskContext, autoApprove = false, profile, yolo, mode, allowMemoryWrites } = body;

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

    // Get security policy
    const policy = getSecurityPolicy(context);

    // Determine effective memory write permission
    // Use explicit flag if provided, otherwise use policy default
    const effectiveMemoryWrites = allowMemoryWrites ?? policy.canWriteMemory;

    // Log the incoming request
    audit({
      level: 'info',
      category: 'action',
      event: 'operator_api_request',
      details: {
        goal,
        context: taskContext,
        autoApprove,
        mode: resolvedMode,
        allowMemoryWrites: effectiveMemoryWrites,
        cognitiveMode: policy.mode,
        role: policy.role
      },
      actor: 'web_ui',
    });

    // Pass policy to runTask so skills can enforce security at execution layer
    const result = await runTask(
      { goal, context: taskContext },
      1,
      { autoApprove, profile, mode: resolvedMode, policy }
    );

    // Return success response
    const response: OperatorResponse = {
      success: result.success,
      task: { goal, context: taskContext },
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

// Wrap POST with operator mode guard (blocks in emulation mode and for non-owners)
export const POST = requireOperatorMode(postHandler);

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
