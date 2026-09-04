import assert from 'node:assert/strict';
import { parseDesireCheckinEvaluation } from './desire-checkin.js';

{
  const evaluation = parseDesireCheckinEvaluation(`Result:
\`\`\`json
{
  "statusAssessment": "Progress is supported by recent evidence.",
  "questionsForUser": ["Did you finish the field test?"],
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
  assert.throws(
    () => parseDesireCheckinEvaluation('No structured result was available.'),
    /did not contain a JSON object/,
  );
}

{
  assert.throws(
    () => parseDesireCheckinEvaluation(JSON.stringify({
      statusAssessment: 'Needs confirmation.',
      currentMilestoneComplete: false,
      suggestedNextActions: [],
      recommendation: 'run_shell_command',
      questionsForUser: [],
    })),
    /missing required typed fields/,
  );
}

{
  assert.throws(
    () => parseDesireCheckinEvaluation(JSON.stringify({
      statusAssessment: 'Needs confirmation.',
      currentMilestoneComplete: false,
      suggestedNextActions: [],
      recommendation: 'continue',
      questionsForUser: ['Valid question', 42],
    })),
    /questionsForUser must be an array of strings/,
  );
}

console.log('desire check-in contract passed');
