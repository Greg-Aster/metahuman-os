/**
 * Conditional Router Node
 *
 * Routes data flow based on conditions, enabling graph-level loops
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const ConditionalRouterNode: NodeDefinition = defineNode({
  id: 'conditional_router',
  name: 'Conditional Router',
  category: 'control_flow',
  inputs: [
    { name: 'condition', type: 'any', description: 'Condition to evaluate' },
    { name: 'trueData', type: 'any', optional: true, description: 'Data for true branch' },
    { name: 'falseData', type: 'any', optional: true, description: 'Data for false branch' },
  ],
  outputs: [
    { name: 'routedData', type: 'any', description: 'Data routed based on condition' },
    { name: 'conditionMet', type: 'boolean', description: 'Whether condition was true' },
    { name: 'branch', type: 'string', description: 'Which branch was taken' },
  ],
  description: 'Routes data flow based on conditions, enabling graph-level loops',

  execute: async (inputs, _context, _properties) => {
    const condition = inputs[0]?.condition ?? inputs[0]?.isComplete ?? inputs[0];
    const trueData = inputs[1]?.trueData ?? inputs[1];
    const falseData = inputs[2]?.falseData ?? inputs[2];

    let conditionMet = false;

    if (typeof condition === 'boolean') {
      conditionMet = condition;
    } else if (typeof condition === 'string') {
      conditionMet = condition.toLowerCase() === 'true' || condition === '1';
    } else if (typeof condition === 'object' && condition !== null) {
      conditionMet = Boolean(
        condition.isComplete ||
        condition.isDone ||
        condition.shouldContinue ||
        condition.value
      );
    } else if (typeof condition === 'number') {
      conditionMet = condition !== 0;
    } else {
      conditionMet = Boolean(condition);
    }

    const routedData = conditionMet ? trueData : falseData;
    const branch = conditionMet ? 'true' : 'false';

    if (process.env.DEBUG_GRAPH) {
      console.log(`[ConditionalRouter] ${branch === 'true' ? '✅ EXITING LOOP' : '🔄 CONTINUING LOOP'}`);
    }

    return {
      routedData,
      conditionMet,
      branch,
      routingDecision: branch,
    };
  },
});
