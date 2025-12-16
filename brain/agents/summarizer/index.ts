/**
 * Conversation Summarizer Agent — Module Definition
 *
 * Exports the AgentModule for registration with agent-runtime.
 * This is the entry point for in-process execution on mobile.
 */

import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

/**
 * Agent metadata
 */
export const meta: AgentMeta = {
  id: 'summarizer',
  name: 'Conversation Summarizer',
  description: 'Summarize conversation sessions into concise overviews',
  usesLLM: true,
  priority: 'low',
  defaultInterval: 3600, // 1 hour
  tags: ['summary', 'conversation', 'memory', 'background'],
};

/**
 * Complete agent module for registration
 */
const agent: AgentModule = {
  meta,
  run,
};

export default agent;

// Re-export core functions for direct usage
export {
  run,
  summarizeSession,
  autoSummarize,
  generateSummary,
  type ConversationSummary,
  type SummarizerOptions,
} from './core.js';
