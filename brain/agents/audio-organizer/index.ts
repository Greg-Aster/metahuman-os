import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'audio-organizer', name: 'Audio Organizer',
  description: 'Converts transcripts into episodic memories with LLM-extracted metadata',
  usesLLM: true, priority: 'low', defaultInterval: 900,
  tags: ['audio', 'memory', 'llm', 'background'],
};

const agent: AgentModule = { meta, run };
export default agent;

export { runCycle, type AudioOrganizerOptions, type AudioOrganizerResult } from './core.js';
