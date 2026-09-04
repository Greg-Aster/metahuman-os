import assert from 'node:assert/strict'
import test from 'node:test'

import {
  executeGoalReviewInsights,
  parseGoalReviewInsights,
} from './goal-review-insights.node.js'

test('goal review insights are produced by the graph node from bounded progress', async () => {
  const output = await executeGoalReviewInsights(
    {
      projects: [{ title: 'Graph migration', progressPercent: 80, tasksCompleted: 8, tasksBlocked: 0 }],
      overallProgress: { activeProjects: 1, totalTasks: 10, completedTasks: 8, blockedTasks: 0 },
    },
    { username: 'profile-a', userId: 'account-a' },
    {},
    {
      callModel: async () => ({
        content: JSON.stringify({
          insights: ['Graph migration is nearly complete.'],
          recommendations: ['Finish focused validation.'],
          focusAreas: ['Validation'],
          celebrateWins: ['Eight tasks completed.'],
          concernAreas: [],
        }),
        provider: 'test',
        model: 'test',
        modelId: 'test',
        role: 'curator',
      }),
    },
  )
  assert.equal((output.result as { insights: string[] }).insights.length, 1)
})

test('goal review parser rejects partial output instead of returning empty arrays', () => {
  assert.throws(
    () => parseGoalReviewInsights('{"insights":[]}'),
    /recommendations must be a bounded string array/,
  )
})
