/**
 * Reflector Agent — Module Definition
 *
 * Exports the AgentModule for registration with agent-runtime.
 * This is the Agent Runtime registration entry point.
 */

import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime'
import { run } from './core.js'

/**
 * Agent metadata
 */
export const meta: AgentMeta = {
  id: 'reflector',
  name: 'Reflector',
  description: 'Generates grounded, persona-aware reflections from profile memory',
  usesLLM: true,
  priority: 'low',
  tags: ['reflection', 'llm', 'background', 'inner-dialogue'],
}

/**
 * Complete agent module for registration
 */
const agent: AgentModule = {
  meta,
  run,
}

export default agent

// Re-export core functions for direct usage
export {
  evaluateReflectorGraph,
  parseReflectorArgs,
  runReflector,
  type ReflectorOptions,
  type ReflectorOutcome,
} from './core.js'
