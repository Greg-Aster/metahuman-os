import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadDesire, saveDesire, moveDesire, type Desire, type DesireRisk } from '@metahuman/core';
import { callLLM, type RouterMessage } from '@metahuman/core/model-router';

const LOG_PREFIX = '[API:agency/review]';

interface AlignmentReviewOutput {
  alignmentScore: number;
  concerns: string[];
  approved: boolean;
  reasoning: string;
}

interface SafetyReviewOutput {
  safetyScore: number;
  risks: string[];
  mitigations: string[];
  approved: boolean;
  reasoning: string;
}

/**
 * POST /api/agency/desires/:id/review
 * Run alignment and safety review on a desire's plan inline
 */
export const POST: APIRoute = async ({ params, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} ❌ Authentication required`);
      return new Response(
        JSON.stringify({ error: 'Authentication required to review desires.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require owner role
    const policy = getSecurityPolicy({ cookies });
    try {
      policy.requireOwner();
    } catch (error) {
      console.log(`${LOG_PREFIX} ❌ Owner role required`);
      return new Response(
        JSON.stringify({ error: 'Owner role required to review desires.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Desire ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 🔍 Review requested for: ${id}`);
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} ❌ Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 📋 Desire: "${desire.title}" (status: ${desire.status})`);

    // Require a plan to review
    if (!desire.plan || !desire.plan.steps || desire.plan.steps.length === 0) {
      console.log(`${LOG_PREFIX} ❌ No plan to review`);
      return new Response(
        JSON.stringify({ error: 'Cannot review desire without a plan. Generate a plan first.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 📝 Plan has ${desire.plan.steps.length} steps`);
    console.log(`${LOG_PREFIX} 🤖 Running alignment review...`);

    // Run alignment review
    const alignmentResult = await runAlignmentReview(desire);
    console.log(`${LOG_PREFIX}    Alignment score: ${alignmentResult.alignmentScore}`);
    console.log(`${LOG_PREFIX}    Approved: ${alignmentResult.approved}`);

    console.log(`${LOG_PREFIX} 🛡️ Running safety review...`);
    const safetyResult = await runSafetyReview(desire);
    console.log(`${LOG_PREFIX}    Safety score: ${safetyResult.safetyScore}`);
    console.log(`${LOG_PREFIX}    Approved: ${safetyResult.approved}`);

    // Determine verdict
    const alignmentThreshold = 0.7;
    const safetyThreshold = 0.8;
    const autoApproveThreshold = 0.9;

    const passedAlignment = alignmentResult.alignmentScore >= alignmentThreshold;
    const passedSafety = safetyResult.safetyScore >= safetyThreshold;
    const autoApprove = alignmentResult.alignmentScore >= autoApproveThreshold &&
                        safetyResult.safetyScore >= autoApproveThreshold;

    let verdict: 'approve' | 'reject' | 'revise';
    let newStatus: Desire['status'];

    if (!passedAlignment || !passedSafety) {
      verdict = 'reject';
      newStatus = 'reviewing'; // Stay in reviewing for user decision
    } else if (autoApprove) {
      verdict = 'approve';
      newStatus = 'approved';
    } else {
      verdict = 'revise'; // Needs improvement but not rejected
      newStatus = 'reviewing'; // Stay in reviewing for user approval
    }

    console.log(`${LOG_PREFIX} ⚖️ Verdict: ${verdict}`);

    // Update desire with review results
    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire: Desire = {
      ...desire,
      review: {
        id: `review-${desire.id}-${Date.now()}`,
        verdict,
        alignmentScore: alignmentResult.alignmentScore,
        reasoning: `Alignment: ${alignmentResult.reasoning}\n\nSafety: ${safetyResult.reasoning}`,
        concerns: [...alignmentResult.concerns, ...safetyResult.risks],
        suggestions: safetyResult.mitigations,
        riskAssessment: `Safety Score: ${safetyResult.safetyScore.toFixed(2)}. Risks: ${safetyResult.risks.join(', ') || 'None identified'}`,
        reviewedAt: now,
      },
      status: newStatus,
      updatedAt: now,
    };

    // Move desire if status changed
    if (oldStatus !== newStatus) {
      console.log(`${LOG_PREFIX} 📦 Moving ${oldStatus} → ${newStatus}`);
      await moveDesire(updatedDesire, oldStatus as Desire['status'], newStatus, user.username);
    } else {
      await saveDesire(updatedDesire, user.username);
    }

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_reviewed_inline',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        verdict,
        alignmentScore: alignmentResult.alignmentScore,
        safetyScore: safetyResult.safetyScore,
        autoApproved: autoApprove,
      },
    });

    console.log(`${LOG_PREFIX} ✅ Review complete: ${verdict}`);

    return new Response(JSON.stringify({
      success: true,
      desire: updatedDesire,
      review: {
        verdict,
        alignment: alignmentResult,
        safety: safetyResult,
        autoApproved: autoApprove,
      },
      message: verdict === 'approve'
        ? 'Plan auto-approved! High alignment and safety scores.'
        : verdict === 'reject'
        ? 'Plan needs revision. See concerns below.'
        : 'Plan reviewed. Waiting for your approval.',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Error:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

async function runAlignmentReview(desire: Desire): Promise<AlignmentReviewOutput> {
  const plan = desire.plan!;

  const systemPrompt = `You are the Alignment Review module of MetaHuman OS. Your job is to evaluate whether a planned action aligns with the persona's values, goals, and identity.

Be thoughtful and honest. If there are concerns, raise them. If the plan aligns well, say so.

Respond with valid JSON matching the schema.`;

  const userPrompt = `## Plan to Review

**Desire**: ${desire.title}
**Description**: ${desire.description}
**Reason**: ${desire.reason}

**Plan Steps**:
${plan.steps.map(s => `${s.order}. ${s.action} (${s.skill || 'manual'})`).join('\n')}

**Operator Goal**: ${plan.operatorGoal}

## Review Questions

1. Does this plan seem reasonable for the stated goal?
2. Are there any ethical concerns with this plan?
3. Would a reasonable person want this outcome?
4. Are there any value conflicts or concerns?
5. Is the stated reason authentic?

## Output

Respond with JSON:
{
  "alignmentScore": 0.0-1.0,
  "concerns": ["concern 1", "concern 2"],
  "approved": true/false,
  "reasoning": "Brief explanation of the verdict"
}`;

  const messages: RouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const response = await callLLM({
      role: 'persona',
      messages,
      options: { temperature: 0.2, responseFormat: 'json' },
    });

    if (!response.content) {
      return { alignmentScore: 0, concerns: ['Empty response'], approved: false, reasoning: 'Failed to get response' };
    }

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { alignmentScore: 0, concerns: ['Invalid format'], approved: false, reasoning: 'Could not parse response' };
    }

    const parsed = JSON.parse(jsonMatch[0]) as AlignmentReviewOutput;
    return {
      alignmentScore: Math.max(0, Math.min(1, parsed.alignmentScore)),
      concerns: parsed.concerns || [],
      approved: parsed.approved,
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    return {
      alignmentScore: 0,
      concerns: [`Error: ${(error as Error).message}`],
      approved: false,
      reasoning: 'Review failed',
    };
  }
}

async function runSafetyReview(desire: Desire): Promise<SafetyReviewOutput> {
  const plan = desire.plan!;

  const systemPrompt = `You are the Safety Review module of MetaHuman OS. Your job is to evaluate plans for safety, risk, and policy compliance.

## Hard Rules (Never Violate)
- Never send messages without explicit approval
- Never make financial transactions (except pre-approved <$10)
- Never delete important data without explicit approval
- Always maintain complete audit logs
- Never share private data externally

Be conservative with safety. When in doubt, flag concerns.

Respond with valid JSON matching the schema.`;

  const userPrompt = `## Plan to Review for Safety

**Desire**: ${desire.title}
**Description**: ${desire.description}
**Estimated Risk**: ${plan.estimatedRisk}

**Plan Steps**:
${plan.steps.map(s => `${s.order}. [${s.risk}] ${s.action} (skill: ${s.skill || 'none'})`).join('\n')}

**Operator Goal**: ${plan.operatorGoal}

## Safety Review Questions

1. Does any step violate the hard rules?
2. What is the worst-case outcome if this goes wrong?
3. Is each step reversible? If not, what's the impact?
4. Is user data or privacy at risk?
5. Could this action have unintended consequences?

## Output

Respond with JSON:
{
  "safetyScore": 0.0-1.0,
  "risks": ["risk 1", "risk 2"],
  "mitigations": ["mitigation 1", "mitigation 2"],
  "approved": true/false,
  "reasoning": "Brief explanation of safety verdict"
}`;

  const messages: RouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const response = await callLLM({
      role: 'orchestrator',
      messages,
      options: { temperature: 0.1, responseFormat: 'json' },
    });

    if (!response.content) {
      return { safetyScore: 0, risks: ['Empty response'], mitigations: [], approved: false, reasoning: 'Failed to get response' };
    }

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { safetyScore: 0, risks: ['Invalid format'], mitigations: [], approved: false, reasoning: 'Could not parse response' };
    }

    const parsed = JSON.parse(jsonMatch[0]) as SafetyReviewOutput;
    return {
      safetyScore: Math.max(0, Math.min(1, parsed.safetyScore)),
      risks: parsed.risks || [],
      mitigations: parsed.mitigations || [],
      approved: parsed.approved,
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    return {
      safetyScore: 0,
      risks: [`Error: ${(error as Error).message}`],
      mitigations: [],
      approved: false,
      reasoning: 'Review failed',
    };
  }
}
