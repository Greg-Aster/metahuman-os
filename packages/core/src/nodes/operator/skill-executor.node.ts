/**
 * Skill Executor Node
 *
 * Executes a specific skill based on the plan and captures tool invocations to memory
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { executeSkill, type TrustLevel } from '../../skills.js';
import { captureEvent } from '../../memory.js';
import { canWriteMemory, shouldCaptureTool } from '../../memory-policy.js';
import type { CognitiveModeId } from '../../cognitive-mode.js';

// Import error recovery executor for retry logic
import { ErrorRecoveryNode } from './error-recovery.node.js';

const execute: NodeExecutor = async (inputs, context) => {
  console.log('[SkillExecutor] ========== SKILL EXECUTOR ENTRY ==========');
  console.log('[SkillExecutor] useOperator:', context.useOperator);
  console.log('[SkillExecutor] yoloMode:', context.yoloMode);

  if (context.useOperator === false) {
    console.log('[SkillExecutor] EARLY RETURN: useOperator === false');
    return {};
  }

  // Handle Big Brother Router output
  let planInput = inputs[0] || '';
  if (planInput && typeof planInput === 'object' && 'localPath' in planInput && 'claudePath' in planInput) {
    if (planInput.localPath === null || planInput.localPath === undefined) {
      console.log('[SkillExecutor] Skipping - routed to Claude path');
      return {};
    }
    planInput = planInput.localPath;
  }

  const plan = typeof planInput === 'object' && planInput.plan ? planInput.plan : planInput;

  if (typeof plan !== 'string') {
    console.error('[SkillExecutor] Expected string plan, got:', typeof plan, plan);
    return {
      success: false,
      error: `Invalid plan type: ${typeof plan}`,
      outputs: {},
    };
  }

  const maxRetries = 2;
  const retryCount = context.retryCount || 0;

  // Check if this is a Final Answer
  const finalAnswerMatch = plan.match(/Final Answer:\s*(.+)/is);

  if (finalAnswerMatch) {
    const finalAnswer = finalAnswerMatch[1].trim();
    console.log('[SkillExecutor] ✅ Detected Final Answer, passing through to ResponseSynthesizer');
    return {
      success: true,
      finalResponse: finalAnswer,
      outputs: {
        response: finalAnswer,
      },
    };
  }

  // Parse the plan to extract skill_id and inputs
  const actionMatch = plan.match(/Action:\s*(\w+)/i);
  const inputMatch = plan.match(/Action Input:\s*({[\s\S]*?})/i);

  if (!actionMatch) {
    return {
      success: false,
      error: 'No action found in plan',
      outputs: {},
    };
  }

  const skillId = actionMatch[1];
  let skillInputs = {};

  if (inputMatch) {
    try {
      skillInputs = JSON.parse(inputMatch[1]);
    } catch (e) {
      console.error('[SkillExecutor] Failed to parse skill inputs:', e);
    }
  }

  const startTime = Date.now();
  let result;
  let error: string | undefined;
  let errorRecoveryAnalysis: any = null;

  try {
    const { loadDecisionRules } = await import('../../identity.js');
    const rules = loadDecisionRules();
    const trustLevel: TrustLevel = rules.trustLevel as TrustLevel;

    const autoApprove = context.yoloMode === true;
    result = await executeSkill(skillId, skillInputs, trustLevel, autoApprove);
    error = result.error;

    // If execution failed and we haven't exhausted retries, analyze error for recovery
    if (!result.success && result.error && retryCount < maxRetries) {
      console.log(`[SkillExecutor] Skill ${skillId} failed (retry ${retryCount}/${maxRetries}), analyzing error...`);

      errorRecoveryAnalysis = await ErrorRecoveryNode.execute(
        [{ error: result.error, skillId, retryCount }],
        context,
        { maxRetries }
      );

      if (errorRecoveryAnalysis.shouldRetry) {
        console.log(`[SkillExecutor] Error type: ${errorRecoveryAnalysis.errorType}, retrying...`);

        const delayMs = Math.min(1000 * Math.pow(2, retryCount), 5000);
        await new Promise(resolve => setTimeout(resolve, delayMs));

        const retryResult = await executeSkill(skillId, skillInputs, trustLevel, autoApprove);

        if (retryResult.success) {
          console.log(`[SkillExecutor] ✓ Retry succeeded for ${skillId}`);
          result = retryResult;
          error = undefined;
        } else {
          console.log(`[SkillExecutor] ✗ Retry failed for ${skillId}: ${retryResult.error}`);
          result = retryResult;
          error = retryResult.error;
        }
      }
    }
  } catch (err) {
    console.error('[SkillExecutor] Error executing skill:', err);
    result = {
      success: false,
      outputs: {},
      error: (err as Error).message,
    };
    error = (err as Error).message;
  }

  const executionTimeMs = Date.now() - startTime;

  // Capture tool invocation to memory
  const cognitiveMode = (context.cognitiveMode || 'dual') as CognitiveModeId;
  const allowMemoryWrites = context.allowMemoryWrites !== false;
  const canWrite = canWriteMemory(cognitiveMode, 'tool_invocation');
  const shouldCapture = shouldCaptureTool(cognitiveMode, skillId);

  if (allowMemoryWrites && canWrite && shouldCapture) {
    try {
      captureEvent(`Invoked skill: ${skillId}`, {
        type: 'tool_invocation',
        metadata: {
          cognitiveMode,
          sessionId: context.sessionId,
          conversationId: context.conversationId,
          parentEventId: context.parentEventId,
          toolName: skillId,
          toolInputs: skillInputs,
          toolOutputs: result.outputs || {},
          success: result.success !== false,
          error,
          executionTimeMs,
          iterationNumber: context.iterationNumber,
        },
        tags: ['tool', skillId, 'operator', 'react'],
      });

      console.log(`[SkillExecutor] ✓ Captured tool_invocation: ${skillId} (${executionTimeMs}ms)`);
    } catch (captureError) {
      console.error('[SkillExecutor] Failed to capture tool invocation:', captureError);
    }
  }

  return {
    success: result.success,
    outputs: result.outputs || {},
    error,
    skillId,
    executionTimeMs,
    retryCount,
    errorRecovery: errorRecoveryAnalysis ? {
      errorType: errorRecoveryAnalysis.errorType,
      suggestions: errorRecoveryAnalysis.suggestions,
      wasRetried: errorRecoveryAnalysis.shouldRetry,
    } : undefined,
  };
};

export const SkillExecutorNode: NodeDefinition = defineNode({
  id: 'skill_executor',
  name: 'Skill Executor',
  category: 'operator',
  inputs: [
    { name: 'skillName', type: 'string' },
    { name: 'arguments', type: 'object' },
  ],
  outputs: [
    { name: 'result', type: 'skill_result', description: 'Skill execution result' },
    { name: 'success', type: 'boolean' },
    { name: 'error', type: 'object', optional: true },
  ],
  description: 'Executes a skill with arguments',
  execute,
});
