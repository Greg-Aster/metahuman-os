/**
 * Operator API
 * Handles skill-based operations through the MetaHuman OS skills system
 */

import type { APIRoute } from 'astro';
import { initializeSkills } from '@brain/skills/index.js';
import { runOperatorWithFeatureFlag } from '@brain/agents/operator-react.js';
import { loadTrustLevel, getAvailableSkills, listSkills } from '@metahuman/core/skills';
import { audit } from '@metahuman/core/audit';
import { requireOperatorMode } from '../../middleware/cognitiveModeGuard';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { buildContextPackage } from '@metahuman/core/context-builder';
import { loadRuntimeConfig } from '@metahuman/core/config';

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
  reasoningDepth?: number;
  sessionId?: string;
  conversationId?: string;
}

interface OperatorResponse {
  success: boolean;
  goal: string;
  result?: string | null;
  reasoning?: string;
  actions?: string[];
  scratchpad?: any[];
  metadata?: Record<string, any>;
  error?: {
    type: 'stuck' | 'exception';
    reason: string;
    errorType?: 'repeated_failures' | 'no_progress' | 'timeout_approaching';
    message?: string;
    context?: any;
    suggestions?: string[];
    scratchpad?: any[];
    stack?: string;
  };
  mode?: 'strict' | 'yolo';
}

const postHandler: APIRoute = async (context) => {
  try {
    const { request } = context;
    const body: OperatorRequest = await request.json();
    const {
      goal,
      context: taskContext,
      autoApprove = false,
      profile,
      yolo,
      mode,
      allowMemoryWrites,
      reasoningDepth,
      sessionId,
      conversationId
    } = body;

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
        reasoningDepth,
        profile,
        cognitiveMode: policy.mode,
        role: policy.role
      },
      actor: 'web_ui',
    });

    // Check feature flag for context integration (Phase 0)
    const runtimeConfig = loadRuntimeConfig();
    const useContextPackage = runtimeConfig.operator?.useContextPackage ?? true;

    let enrichedContext;

    if (useContextPackage) {
      // NEW: Build semantic context before invoking operator
      const contextPackage = await buildContextPackage(
        goal,  // Use goal as semantic query
        policy.mode,  // Cognitive mode
        {
          maxMemories: 10,
          conversationId,
          sessionId: sessionId ?? policy.sessionId,
          userId: policy.sessionId ?? policy.username
        }
      );

      // Add conversation history to context package (preserve existing behavior)
      enrichedContext = {
        ...contextPackage,
        conversationHistory: taskContext ? [{ role: 'user', content: taskContext }] : [],
        allowMemoryWrites: effectiveMemoryWrites,
        sessionId: sessionId ?? policy.sessionId,
        conversationId
      };
    } else {
      // LEGACY: Use minimal context (backward compatibility)
      enrichedContext = {
        conversationHistory: taskContext ? [{ role: 'user', content: taskContext }] : [],
        allowMemoryWrites: effectiveMemoryWrites,
        sessionId: sessionId ?? policy.sessionId,
        conversationId
      };
    }

    const userContext = {
      userId: policy.sessionId ?? policy.username,
      cognitiveMode: policy.mode
    };

    const result = await runOperatorWithFeatureFlag(
      goal,
      enrichedContext,  // Now includes ContextPackage data when enabled
      undefined,
      userContext,
      reasoningDepth
    );

    // Check if operator returned an error (graceful failure)
    if (result?.error) {
      audit({
        level: 'warn',
        category: 'action',
        event: 'operator_graceful_failure',
        details: {
          goal,
          errorType: result.error.type,
          reason: result.error.reason,
          context: result.error.context
        },
        actor: 'web_ui',
      });

      // Return error details with HTTP 200 (not 500) for graceful failure
      const errorResponse: OperatorResponse = {
        success: false,
        goal,
        result: null,
        error: result.error,  // Structured error with suggestions
        reasoning: result?.reasoning,
        actions: result?.actions,
        scratchpad: result?.scratchpad,
        metadata: result?.metadata,
        mode: resolvedMode,
      };

      return new Response(
        JSON.stringify(errorResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Return success response
    const response: OperatorResponse = {
      success: true,
      goal,
      result: result?.result,
      reasoning: result?.reasoning,
      actions: result?.actions,
      scratchpad: result?.scratchpad,
      metadata: result?.metadata,
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
      details: {
        error: (error as Error).message,
        stack: process.env.NODE_ENV === 'development' ? (error as Error).stack : undefined
      },
      actor: 'web_ui',
    });

    // Return HTTP 200 with structured error (not 500) for graceful handling in UI
    return new Response(
      JSON.stringify({
        success: false,
        goal,
        result: null,
        error: {
          type: 'exception',
          reason: 'Unexpected error during operator execution',
          message: (error as Error).message,
          stack: process.env.NODE_ENV === 'development' ? (error as Error).stack : undefined,
          suggestions: [
            'Check the audit logs for detailed error information',
            'Verify all required services are running (Ollama, etc.)',
            'Try simplifying the request or breaking it into smaller tasks',
            'Report this error if it persists'
          ]
        },
        mode: resolvedMode,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
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
