/**
 * Agent Trigger Node
 * Allows one workflow to spawn another agent/workflow
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { audit } from '../../audit.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const agentName = properties?.agentName;
  const inputData = inputs[0] || {};
  const waitForCompletion = properties?.waitForCompletion !== false;
  const timeout = properties?.timeout || 30000;

  if (!agentName) {
    return {
      triggered: false,
      error: 'No agent name specified',
    };
  }

  try {
    audit({
      level: 'info',
      category: 'action',
      event: 'agent_triggered',
      actor: 'agent-trigger-node',
      details: {
        agentName,
        waitForCompletion,
        inputKeys: Object.keys(inputData),
      },
    });

    // Placeholder - actual implementation would:
    // 1. Look up the agent's cognitive graph
    // 2. Execute it with inputData as context
    // 3. Return the result
    return {
      triggered: true,
      agentName,
      inputData,
      waitForCompletion,
      timeout,
      note: 'Agent trigger queued - graph execution handled by caller',
    };
  } catch (error) {
    console.error('[AgentTrigger] Error:', error);
    return {
      triggered: false,
      agentName,
      error: (error as Error).message,
    };
  }
};

export const AgentTriggerNode: NodeDefinition = defineNode({
  id: 'agent_trigger',
  name: 'Agent Trigger',
  category: 'thought',
  inputs: [
    { name: 'inputData', type: 'object', optional: true, description: 'Data to pass to agent' },
  ],
  outputs: [
    { name: 'triggered', type: 'boolean' },
    { name: 'agentName', type: 'string' },
    { name: 'result', type: 'any', description: 'Agent result (if waitForCompletion)' },
  ],
  properties: {
    agentName: '',
    waitForCompletion: true,
    timeout: 30000,
  },
  propertySchemas: {
    agentName: {
      type: 'string',
      default: '',
      label: 'Agent Name',
      description: 'Name of agent to trigger',
    },
    waitForCompletion: {
      type: 'boolean',
      default: true,
      label: 'Wait for Completion',
    },
    timeout: {
      type: 'number',
      default: 30000,
      label: 'Timeout (ms)',
    },
  },
  description: 'Allows one workflow to spawn another agent/workflow',
  execute,
});
