/** Agent-runtime module boundary for in-process execution. */

import type { AgentMeta, AgentModule } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'audio-organizer',
  name: 'Audio Organizer',
  description: 'Converts completed audio transcripts into episodic memories when explicitly requested',
  usesLLM: true,
  priority: 'normal',
  tags: ['audio', 'memory', 'llm'],
};

const agent: AgentModule = { meta, run };

export default agent;

export { runCycle, type AudioOrganizerResult } from './core.js';
