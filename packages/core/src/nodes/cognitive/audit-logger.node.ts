/**
 * Audit Logger Node
 * Logs events to the audit system
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { audit } from '../../audit.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const data = inputs.data ?? inputs[0];
  const category = properties?.category ?? 'agent';
  const event = properties?.event ?? 'node_execution';
  const level = properties?.level ?? 'info';

  try {
    audit({
      category,
      level,
      event,
      actor: 'cognitive-graph',
      details: typeof data === 'object' ? data : { value: data },
    });

    return {
      success: true,
      logged: true,
      category,
      event,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const AuditLoggerNode: NodeDefinition = defineNode({
  id: 'audit_logger',
  name: 'Audit Logger',
  category: 'cognitive',
  inputs: [
    { name: 'data', type: 'any', description: 'Data to log' },
  ],
  outputs: [
    { name: 'success', type: 'boolean', description: 'Whether logging succeeded' },
  ],
  properties: {
    category: 'agent',
    event: 'node_execution',
    level: 'info',
  },
  propertySchemas: {
    category: {
      type: 'select',
      default: 'agent',
      label: 'Category',
      options: ['agent', 'system', 'action', 'data', 'security'],
    },
    event: {
      type: 'text',
      default: 'node_execution',
      label: 'Event Name',
    },
    level: {
      type: 'select',
      default: 'info',
      label: 'Level',
      options: ['info', 'warn', 'error'],
    },
  },
  description: 'Logs events to the audit system',
  execute,
});
