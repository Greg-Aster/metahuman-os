import { defineNode, NodeInputValidationError } from '../types.js'
import { modelRouterDefinition } from '../llm/model-router.schema.js'
import { environmentActionParserNode } from './action-parser.node.js'

import { isPlanningDelegation } from './planning-contract.js'

/** Delegation is selected by the model; all programs use the existing parser. */
export const environmentTaskPlannerNode = defineNode({
  id: 'environment_task_planner', name: 'Resolve Task Plan', category: 'environment',
  execution: { timeoutOwner: 'children' },
  inputs: [...environmentActionParserNode.inputs,
    { name: 'planningMessages', type: 'array', description: 'The same selected context with the original task contract' },
    { name: 'planningSchema', type: 'object', description: 'Existing task schema without recursive delegation' }],
  outputs: [...environmentActionParserNode.outputs, { name: 'rawResponse', type: 'string', description: 'Exact final task output for continuation reuse, separate from conversational response' }],
  properties: { ...modelRouterDefinition.properties, role: 'persona', format: 'json', temperature: 0.1 },
  propertySchemas: modelRouterDefinition.propertySchemas,
  description: 'Resolves optional planning through Model Router, then returns the existing task parser output.',
  async execute(inputs, context, properties) {
    let selected: any
    try { selected = JSON.parse(inputs.response) } catch { /* The existing parser reports malformed output. */ }
    let response = inputs.response
    if (selected && Object.hasOwn(selected, 'delegatePlanning')) {
      if (!isPlanningDelegation(selected))
        throw new NodeInputValidationError('response', 'Planning delegation requires exactly {"delegatePlanning":true}')
      const { executeNodeByType } = await import('../../graph-executor.js')
      const planned = await executeNodeByType({ id: 'planning-model', type: 'modelNode', position: { x: 0, y: 0 },
        data: { label: 'Planning Model', nodeType: 'model_router', properties: properties ?? {} } },
      { messages: inputs.planningMessages, jsonSchema: inputs.planningSchema }, context)
      response = planned.response
      try {
        return { ...await environmentActionParserNode.execute({ ...inputs, response }, context, { includeResponse: false }), rawResponse: response }
      } catch (error) {
        // Validation of the larger model's answer must not rewrite the small
        // model's selected delegation or dispatch an alternative action.
        throw new Error(`Delegated planning failed the existing task contract: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
    }
    return { ...await environmentActionParserNode.execute(inputs, context, { includeResponse: false }), rawResponse: response }
  },
})
