/**
 * Audit Logger Node
 *
 * Logs execution to audit trail
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { audit } from '../../audit.js';

export const AuditLoggerNode: NodeDefinition = defineNode({
  id: 'audit_logger',
  name: 'Audit Logger',
  category: 'output',
  inputs: [
    { name: 'eventType', type: 'string', description: 'Type of event to log' },
    { name: 'details', type: 'object', description: 'Event details' },
  ],
  outputs: [
    { name: 'logged', type: 'boolean', description: 'Whether event was logged' },
  ],
  description: 'Logs to audit trail',

  execute: async (inputs, context) => {
    const response = inputs[0]?.response || inputs[0] || '';

    try {
      audit({
        level: 'info',
        category: 'system',
        event: 'node_graph_execution',
        details: {
          response,
          cognitiveMode: context.cognitiveMode,
          sessionId: context.sessionId,
        },
        userId: context.userId,
      });

      return {
        logged: true,
      };
    } catch (error) {
      console.error('[AuditLogger] Error:', error);
      return {
        logged: false,
        error: (error as Error).message,
      };
    }
  },
});
