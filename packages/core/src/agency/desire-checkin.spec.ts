import assert from 'node:assert/strict';
import { parseDesireCheckinEvaluation } from './desire-checkin.js';

{
  const evaluation = parseDesireCheckinEvaluation(`Result:
\`\`\`json
{
  "statusAssessment": "Progress is supported by recent evidence.",
  "questionsForUser": ["Did you finish the field test?", 42, ""],
  "currentMilestoneComplete": true,
  "suggestedNextActions": ["Record the test result"],
  "recommendation": "advance_milestone",
  "recommendationReason": "The acceptance criteria appear satisfied."
}
\`\`\``);
  assert.equal(evaluation.recommendation, 'advance_milestone');
  assert.equal(evaluation.currentMilestoneComplete, true);
  assert.deepEqual(evaluation.questionsForUser, ['Did you finish the field test?']);
}

{
  const evaluation = parseDesireCheckinEvaluation('No structured result was available.');
  assert.equal(evaluation.recommendation, 'continue');
  assert.equal(evaluation.currentMilestoneComplete, false);
  assert.equal(evaluation.statusAssessment, 'No structured result was available.');
}

{
  const evaluation = parseDesireCheckinEvaluation(JSON.stringify({
    statusAssessment: 'Needs confirmation.',
    recommendation: 'run_shell_command',
    questionsForUser: Array.from({ length: 10 }, (_, index) => `Question ${index}`),
  }));
  assert.equal(evaluation.recommendation, 'continue');
  assert.equal(evaluation.questionsForUser.length, 5);
}

console.log('desire check-in contract passed');
