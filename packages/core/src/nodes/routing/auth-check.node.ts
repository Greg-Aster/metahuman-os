/**
 * Auth Check Node
 *
 * Checks user authentication status and permissions
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const AuthCheckNode: NodeDefinition = defineNode({
  id: 'auth_check',
  name: 'Authentication Check',
  category: 'router',
  inputs: [
    { name: 'user', type: 'user', optional: true, description: 'User context' },
  ],
  outputs: [
    { name: 'isAuthenticated', type: 'boolean', description: 'Whether user is authenticated' },
    { name: 'role', type: 'string', description: 'User role (owner/guest/anonymous)' },
    { name: 'userId', type: 'string', description: 'User ID' },
    { name: 'canWriteMemory', type: 'boolean', description: 'Can write to memory' },
    { name: 'canExecuteSkills', type: 'boolean', description: 'Can execute skills' },
  ],
  description: 'Checks user authentication status',

  execute: async (inputs, context) => {
    const isAuthenticated = context.userId && context.userId !== 'anonymous';

    return {
      authenticated: isAuthenticated,
      isAuthenticated,
      userId: context.userId || 'anonymous',
      role: isAuthenticated ? 'owner' : 'anonymous',
      canWriteMemory: isAuthenticated,
      canExecuteSkills: isAuthenticated,
    };
  },
});
