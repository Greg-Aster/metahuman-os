/**
 * Big Brother Executor Node
 *
 * Executes skills via Claude CLI delegation
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  try {
    // Handle Big Brother Router output
    let planInput = inputs[0] || '';
    if (planInput && typeof planInput === 'object' && 'localPath' in planInput && 'claudePath' in planInput) {
      if (planInput.claudePath === null || planInput.claudePath === undefined) {
        console.log('[BigBrotherExecutor] Skipping - routed to local path');
        return JSON.stringify({
          success: false,
          error: 'Not routed to Big Brother',
          outputs: {},
        });
      }
      planInput = planInput.claudePath;
    }

    const plan = typeof planInput === 'object' && planInput.plan ? planInput.plan : planInput;

    if (typeof plan !== 'string') {
      console.error('[BigBrotherExecutor] Expected string plan, got:', typeof plan);
      return JSON.stringify({
        success: false,
        error: `Invalid plan type: ${typeof plan}`,
        outputs: {},
      });
    }

    // Parse the plan
    const actionMatch = plan.match(/Action:\s*(\w+)/i);
    const inputMatch = plan.match(/Action Input:\s*({[\s\S]*?})/i);

    if (!actionMatch) {
      return {
        success: false,
        error: 'No action found in plan',
        outputs: {},
      };
    }

    const skillName = actionMatch[1];
    let skillInputs = {};

    if (inputMatch) {
      try {
        skillInputs = JSON.parse(inputMatch[1]);
      } catch (e) {
        console.error('[BigBrotherExecutor] Failed to parse skill inputs:', e);
      }
    }

    console.log(`[BigBrotherExecutor] Executing skill: ${skillName} via Claude CLI`);

    const { audit } = await import('../../audit.js');
    const { isClaudeSessionReady, sendPrompt, startClaudeSession } = await import('../../claude-session.js');

    if (!isClaudeSessionReady()) {
      const autoStart = properties?.autoStartSession !== false;
      if (autoStart) {
        console.log('[BigBrotherExecutor] Claude session not ready, starting...');
        const started = await startClaudeSession();
        if (!started) {
          throw new Error('Claude session not available and auto-start failed');
        }
      } else {
        throw new Error('Claude session not available');
      }
    }

    const prompt = `I need you to help me prepare content for a skill execution.

**Skill to Execute:** ${skillName}

**Skill Inputs:**
${JSON.stringify(skillInputs, null, 2)}

Please provide the content or instructions needed to execute this skill.

Return ONLY a JSON object in this format:
{
  "success": true,
  "content": "the actual content, command, or response text",
  "explanation": "brief explanation of what this does (optional)"
}

Do NOT try to execute any tools yourself. Just provide the content.`;

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_skill_delegation',
      details: {
        skillName,
        args: skillInputs,
        promptLength: prompt.length,
      },
      actor: 'big-brother',
    });

    const timeoutMs = properties?.timeout || 60000;
    const response = await sendPrompt(prompt, timeoutMs);

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    let claudeResult;

    if (jsonMatch) {
      try {
        claudeResult = JSON.parse(jsonMatch[0]);
      } catch (err) {
        claudeResult = {
          success: true,
          content: response,
        };
      }
    } else {
      claudeResult = {
        success: true,
        content: response,
      };
    }

    // Execute the skill locally using Claude's content
    console.log(`[BigBrotherExecutor] Received content from Claude, executing ${skillName} locally`);

    const { executeSkill } = await import('../../skills.js');
    const { loadDecisionRules } = await import('../../identity.js');
    const rules = loadDecisionRules();
    const trustLevel = rules.trustLevel as any;

    const finalInputs: Record<string, any> = { ...skillInputs };

    if (skillName === 'fs_write' && claudeResult.content) {
      finalInputs.content = claudeResult.content;
    } else if (skillName === 'conversational_response' && claudeResult.content) {
      finalInputs.response = claudeResult.content;
    } else if (claudeResult.content) {
      finalInputs.claudeContent = claudeResult.content;
    }

    const skillResult = await executeSkill(skillName, finalInputs, trustLevel);

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_skill_completed',
      details: {
        skillName,
        success: skillResult.success,
        claudeContent: claudeResult.content?.substring(0, 100),
      },
      actor: 'big-brother',
    });

    console.log(`[BigBrotherExecutor] ✓ Skill completed via Claude CLI + local execution`);

    return JSON.stringify({
      success: skillResult.success,
      outputs: skillResult.outputs || {
        response: claudeResult.content,
      },
      error: skillResult.error,
      skillId: skillName,
      delegatedTo: 'claude-cli',
      claudeExplanation: claudeResult.explanation,
    });
  } catch (error) {
    console.error('[BigBrotherExecutor] Error:', error);

    const { audit } = await import('../../audit.js');
    audit({
      level: 'error',
      category: 'action',
      event: 'big_brother_skill_failed',
      details: {
        error: (error as Error).message,
      },
      actor: 'big-brother',
    });

    return JSON.stringify({
      success: false,
      error: (error as Error).message,
      outputs: {},
    });
  }
};

export const BigBrotherExecutorNode: NodeDefinition = defineNode({
  id: 'big_brother_executor',
  name: 'Big Brother Executor',
  category: 'operator',
  inputs: [
    { name: 'skillName', type: 'string', description: 'Name of skill to execute' },
    { name: 'arguments', type: 'object', description: 'Skill arguments' },
  ],
  outputs: [
    { name: 'result', type: 'skill_result', description: 'Skill execution result from Claude CLI' },
    { name: 'success', type: 'boolean', description: 'Whether execution succeeded' },
    { name: 'error', type: 'object', optional: true, description: 'Error details if failed' },
  ],
  properties: {
    timeout: 60000,
    autoStartSession: true,
  },
  description: 'Executes skills via Claude CLI - delegates to Claude Code for intelligent execution',
  execute,
});
