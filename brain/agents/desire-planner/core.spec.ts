import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  getNode,
  initializeDesireMetrics,
  parseFeasibilityResponse,
  withUserContext,
  type Desire,
  type DesirePlan,
  type DesireReview,
  type GraphExecutionState,
} from '@metahuman/core';

import {
  buildDesirePlannerGraphContext,
  buildDesireReviewGraphContext,
  evaluateDesirePlanGraph,
  evaluateDesirePlanningAdmission,
  evaluateDesireReviewGraph,
  isReviewResumeCandidate,
  parseDesirePlannerArgs,
  parsePlannerConfig,
} from './core.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');

function plan(): DesirePlan {
  return {
    id: 'plan-1',
    version: 1,
    steps: [{
      order: 1,
      action: 'Verify the planner',
      expectedOutcome: 'Planner verified',
      risk: 'low',
      requiresApproval: false,
    }],
    estimatedRisk: 'low',
    requiredSkills: [],
    requiredTrustLevel: 'suggest',
    operatorGoal: 'Verify the canonical planner',
    createdAt: '2026-09-02T00:00:00.000Z',
  };
}

function desire(status: Desire['status'] = 'reviewing'): Desire {
  return {
    id: 'desire-1', title: 'Verify planner', description: 'Verify it', reason: 'Contract',
    source: 'reflection', status, strength: 0.8, baseWeight: 1, threshold: 0.7,
    decayRate: 0.03, lastReviewedAt: '2026-09-02T00:00:00.000Z', reinforcements: 1,
    runCount: 1, risk: 'low', requiredTrustLevel: 'suggest', metrics: initializeDesireMetrics(),
    plan: plan(), createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
  };
}

function review(): DesireReview {
  return {
    id: 'review-desire-1-v1', verdict: 'approve', reasoning: 'Aligned and safe.', concerns: [],
    riskAssessment: 'Low risk', alignmentScore: 0.95, reviewedAt: '2026-09-02T00:01:00.000Z',
    planId: 'plan-1', planVersion: 1, autoApprove: true, autoApproveReason: 'Policy permits it',
  };
}

function graphState(outputs: Record<string, Record<string, unknown>>): GraphExecutionState {
  return {
    nodes: new Map(Object.entries(outputs).map(([nodeType, nodeOutputs], index) => [
      String(index + 1),
      {
        nodeId: String(index + 1),
        status: 'completed',
        outputs: nodeOutputs,
        definition: { type: nodeType },
      },
    ])),
    startTime: 0,
    endTime: 1,
    status: 'completed',
  };
}

test('tracked Desire Planner configuration satisfies the strict owner contract', () => {
  const configPath = path.join(ROOT, 'etc', 'desire-planner.json');
  const parsed = parsePlannerConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));

  assert.equal(parsed.enabled, true);
  assert.equal(parsed.graph.planner, 'desire-planner.json');

  assert.throws(
    () => parsePlannerConfig({ ...parsed, graph: { ...parsed.graph, planner: '../escape.json' } }),
    /local planner and reviewer JSON filenames/,
  );
  assert.throws(
    () => parsePlannerConfig({ ...parsed, processing: { ...parsed.processing, batchSize: 0 } }),
    /processing configuration is invalid/,
  );
  assert.throws(
    () => parsePlannerConfig({ ...parsed, enabled: 'yes' }),
    /requires boolean enabled/,
  );
});

test('planner accepts explicit profile and targeted desire selectors', () => {
  assert.deepEqual(
    parseDesirePlannerArgs(['--desire-id', 'desire-1', '--username', 'profile-a']),
    { desireId: 'desire-1', username: 'profile-a' },
  );
  assert.throws(() => parseDesirePlannerArgs(['--single-user']), /Unknown/);
  assert.throws(() => parseDesirePlannerArgs(['--username']), /requires a value/);
  assert.throws(
    () => parseDesirePlannerArgs(['--desire-id', 'desire-1', '--desire-id', 'desire-2']),
    /duplicate/,
  );
});

test('planner consumes canonical capabilities and stable graph node contracts', () => {
  const source = fs.readFileSync(path.join(ROOT, 'brain/agents/desire-planner/core.ts'), 'utf8');
  const graph = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'etc/cognitive-graphs/desire-planner.json'),
    'utf8',
  )) as { nodes: Array<{ data: { nodeType: string } }> };
  assert.ok(graph.nodes.some(node => node.data.nodeType === 'tool_catalog_builder'));
  assert.ok(graph.nodes.some(node => node.data.nodeType === 'desire_feasibility'));
  assert.ok(graph.nodes.some(node => node.data.nodeType === 'desire_question_generator'));
  assert.doesNotMatch(source, /getCachedCatalog\(\)/);
  assert.doesNotMatch(source, /callLLM(?:Text)?\(/);
  assert.match(source, /evaluateDesirePlanningAdmission\(planResult\)/);
  assert.match(source, /evaluateDesireReviewGraph\(reviewResult\)/);
  assert.doesNotMatch(source, /Full computer access/);
  assert.doesNotMatch(source, /planResult\.nodes\.get\('5'\)/);
  assert.doesNotMatch(source, /reviewResult\.nodes\.get\('7'\)/);
  assert.doesNotMatch(source, /username: 'default'/);
});

test('review retries resume only persisted reviewing plans', () => {
  assert.equal(isReviewResumeCandidate(desire('reviewing')), true);
  const missingPlan = desire('reviewing');
  missingPlan.plan = undefined;
  assert.equal(isReviewResumeCandidate(missingPlan), false);
  assert.equal(isReviewResumeCandidate(desire('planning')), false);
});

test('planner and reviewer graph edges match registered named contracts', () => {
  for (const filename of ['desire-planner.json', 'desire-reviewer.json']) {
    const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc', 'cognitive-graphs', filename), 'utf8')) as {
      nodes: Array<{ id: string; data: { nodeType: string; properties?: Record<string, unknown> } }>;
      edges: Array<{ id: string; source: string; target: string; sourceHandle: string; targetHandle: string }>;
    };
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    for (const node of graph.nodes) {
      const definition = getNode(node.data.nodeType);
      assert.ok(definition, `${filename} registers ${node.data.nodeType}`);
      for (const property of Object.keys(node.data.properties || {})) {
        assert.ok(property in (definition.propertySchemas || {}), `${filename} declares ${node.data.nodeType}.${property}`);
      }
    }
    for (const edge of graph.edges) {
      const source = getNode(nodes.get(edge.source)!.data.nodeType)!;
      const target = getNode(nodes.get(edge.target)!.data.nodeType)!;
      assert.ok(source.outputs.some(output => output.name === edge.sourceHandle), `${filename}: ${edge.id} source`);
      assert.ok(target.inputs.some(input => input.name === edge.targetHandle), `${filename}: ${edge.id} target`);
    }
  }
});

test('manual planning delegates to the agent and has no competing inline reviewer route', () => {
  const apiSource = fs.readFileSync(
    path.join(ROOT, 'packages/core/src/api/handlers/agency-workflows.ts'),
    'utf8',
  );
  const routerSource = fs.readFileSync(path.join(ROOT, 'packages/core/src/api/router.ts'), 'utf8');
  assert.match(apiSource, /submitDesirePlanning\(/);
  assert.doesNotMatch(apiSource, /callLLM\(/);
  assert.doesNotMatch(apiSource, /saveGeneratedPlan/);
  assert.doesNotMatch(apiSource, /runAlignmentReview|runSafetyReview/);
  assert.doesNotMatch(routerSource, /handleReviewDesirePlan/);
});

test('manual controls cannot bypass the plan reviewer or approval owner', () => {
  const handlerSource = fs.readFileSync(
    path.join(ROOT, 'packages/core/src/api/handlers/agency.ts'),
    'utf8',
  );
  const dashboardSource = fs.readFileSync(
    path.join(ROOT, 'apps/site/src/components/AgencyDashboard.svelte'),
    'utf8',
  );
  assert.doesNotMatch(handlerSource, /VALID_ADVANCE_TRANSITIONS/);
  assert.match(handlerSource, /approveDesireForExecution\(desire, user\.username\)/);
  assert.doesNotMatch(dashboardSource, /Fast Approve|Skip to approved status/);
  assert.doesNotMatch(dashboardSource, /handleAdvanceStage\(desire\.id, 'reviewing'\)/);
});

test('graph context preserves account identity separately from profile identity', async () => {
  await withUserContext(
    { userId: 'account-1', username: 'profile-a', role: 'owner' },
    async () => {
      const context = buildDesirePlannerGraphContext(desire('planning'), 'profile-a');
      assert.equal(context.userId, 'account-1');
      assert.equal(context.username, 'profile-a');
      assert.equal(context.recordPersonaMemory, true);

      const reviewContext = buildDesireReviewGraphContext(desire('reviewing'), 'profile-a');
      assert.equal(reviewContext.userId, 'account-1');
      assert.equal(reviewContext.username, 'profile-a');
      assert.equal(reviewContext.desireId, 'desire-1');
      assert.equal(reviewContext.idempotencyKey, 'desire-plan-review:profile-a:desire-1:v1');
      assert.equal(reviewContext.memoryTimestamp, '2026-09-02T00:00:00.000Z');
      assert.equal('desire' in reviewContext, false);
    },
  );
});

test('planner graph evaluation requires generation, validation, and durable plan persistence', () => {
  const generatedPlan = plan();
  const persisted = desire('reviewing');
  assert.equal(evaluateDesirePlanGraph(graphState({
    desire_plan_generator: { success: true, plan: generatedPlan },
    plan_validator: { valid: true, plan: generatedPlan },
    desire_updater: { success: true, desire: persisted },
  })).desire.status, 'reviewing');

  assert.throws(() => evaluateDesirePlanGraph(graphState({
    desire_plan_generator: { success: true, plan: generatedPlan },
    plan_validator: { valid: true, plan: generatedPlan },
    desire_updater: { success: false, error: 'archive unavailable' },
  })), /Plan persistence failed/);
});

test('planning admission consumes graph-owned feasibility and clarification transitions', () => {
  assert.deepEqual(evaluateDesirePlanningAdmission(graphState({
    desire_feasibility: {
      result: { feasible: false, confidence: 0.9, reasoning: 'Missing required capability' },
    },
  })), {
    status: 'infeasible',
    feasibility: { feasible: false, confidence: 0.9, reasoning: 'Missing required capability' },
  });

  const questioningDesire: Desire = {
    ...desire('questioning'),
    currentStage: 'questioning',
    clarifyingQuestions: {
      phase: 'before_planning',
      questions: [{ id: 'q-1', text: 'Which target?', type: 'free_text', required: true }],
      answers: [],
      askedAt: '2026-09-03T00:00:00.000Z',
    },
  };
  const questions = evaluateDesirePlanningAdmission(graphState({
    desire_feasibility: {
      result: { feasible: true, confidence: 0.8, reasoning: 'Supported' },
    },
    desire_question_generator: { needsQuestions: true },
    desire_question_transition: {
      success: true,
      desire: questioningDesire,
      questions: questioningDesire.clarifyingQuestions?.questions,
      reason: 'Scope is ambiguous',
    },
  }));
  assert.equal(questions.status, 'questions');
  if (questions.status === 'questions') {
    assert.equal(questions.questions.length, 1);
    assert.equal(questions.reason, 'Scope is ambiguous');
  }
});

test('review graph evaluation requires reflection persistence and one durable transition', () => {
  const reviewed = { ...desire('approved'), review: review() };
  assert.equal(evaluateDesireReviewGraph(graphState({
    desire_verdict: { review: review(), autoApprove: true, reasoning: 'Aligned and safe.' },
    desire_plan_review_recorder: {
      success: true,
      persisted: true,
      review: review(),
      autoApprove: true,
      reasoning: 'Aligned and safe.',
    },
    inner_dialogue_buffer: { saved: true, persisted: true, savedCount: 1, text: 'Aligned and safe.' },
    inner_dialogue_saver: { success: true, saved: true, savedCount: 1 },
    desire_plan_review_transition: { success: true, desire: reviewed, action: 'auto_approved' },
  })).action, 'auto_approved');

  assert.throws(() => evaluateDesireReviewGraph(graphState({
    desire_verdict: { review: review(), autoApprove: false, reasoning: 'Needs approval.' },
    desire_plan_review_recorder: {
      success: true,
      persisted: true,
      review: { ...review(), autoApprove: false },
      autoApprove: false,
      reasoning: 'Needs approval.',
    },
    inner_dialogue_buffer: { saved: true, persisted: true, savedCount: 1, text: 'Needs approval.' },
    inner_dialogue_saver: { success: false, saved: false, savedCount: 0 },
    desire_plan_review_transition: { success: false },
  })), /Persona Memory persistence failed/);
});

test('feasibility parser fails closed on missing or malformed model decisions', () => {
  const accepted = parseFeasibilityResponse(`Assessment:
{
  "feasible": false,
  "confidence": 0.92,
  "reasoning": "Required authorization is unavailable.",
  "blockers": ["Missing authorization"]
}`);
  assert.equal(accepted.feasible, false);
  assert.equal(accepted.confidence, 0.92);
  assert.deepEqual(accepted.blockers, ['Missing authorization']);

  assert.throws(
    () => parseFeasibilityResponse('No structured assessment was returned.'),
    /did not contain a JSON object/,
  );
  assert.throws(
    () => parseFeasibilityResponse('{"confidence":0.5,"reasoning":"Unknown"}'),
    /missing required typed fields/,
  );
  assert.throws(
    () => parseFeasibilityResponse('{"feasible":true,"confidence":1.2,"reasoning":"Certain"}'),
    /missing required typed fields/,
  );
});
