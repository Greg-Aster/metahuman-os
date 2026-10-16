import assert from 'node:assert/strict'
import test from 'node:test'
import { executeGoalReviewInsights, GoalReviewInsightsNode } from '../agent/goal-review-insights.node.js'
import { DesireFeasibilityNode } from './desire-feasibility.node.js'
import { DesireCheckinEvaluatorNode } from './desire-checkin-evaluator.node.js'
import { ReActPlannerNode } from '../operator/react-planner.node.js'
import { QualityScorerNode } from '../cognitive/quality-scorer.node.js'
import { SelfHealingAnalysisNode } from '../active-operator/self-healing-analysis.node.js'
import { SearchInterpreterNode } from '../memory/search-interpreter.node.js'
import { PersonaProfileExtractorNode } from '../persona/persona-profile-extractor.node.js'
import { ResponseLLMNode } from '../response/response-llm.node.js'
import { environmentTaskPlannerNode } from '../environment/task-planner.node.js'

test('role selectors and executable defaults agree across reclassified consumers', () => {
  for (const [node, role] of [
    [GoalReviewInsightsNode, 'psychotherapist'], [DesireFeasibilityNode, 'psychotherapist'],
    [DesireCheckinEvaluatorNode, 'psychotherapist'], [ReActPlannerNode, 'planner'],
    [QualityScorerNode, 'psychotherapist'], [SelfHealingAnalysisNode, 'coder'],
    [SearchInterpreterNode, 'curator'], [PersonaProfileExtractorNode, 'psychotherapist'],
    [ResponseLLMNode, 'persona'], [environmentTaskPlannerNode, 'planner'],
  ] as const) {
    assert.equal(node.properties?.role, role, node.id)
    assert.equal(node.propertySchemas?.role.default, role, node.id)
    assert.equal(node.propertySchemas?.role.type, 'select', node.id)
  }
})

test('outside assessment uses its assigned category while honoring an explicit workflow category selection', async () => {
  for (const properties of [{}, { role: 'planner' }]) {
    let role: unknown
    await executeGoalReviewInsights({ projects: [{ title: 'Review work', progressPercent: 50, tasksCompleted: 1, tasksBlocked: 0 }], overallProgress: { activeProjects: 1, totalTasks: 2, completedTasks: 1, blockedTasks: 0 } }, { username: 'test', userId: 'test' }, properties, {
      callModel: async request => {
        role = request.role
        return { content: JSON.stringify({ insights: [], recommendations: [], focusAreas: [], celebrateWins: [], concernAreas: [] }), provider: 'test', model: 'test', modelId: 'test', role: request.role }
      },
    })
    assert.equal(role, properties.role ?? 'psychotherapist')
  }
})
