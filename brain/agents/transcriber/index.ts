import type { AgentModule, AgentMeta } from '@metahuman/agent-runtime';
import { run } from './core.js';

export const meta: AgentMeta = {
  id: 'transcriber', name: 'Transcriber',
  description: 'Monitors audio inbox and transcribes files using Whisper',
  usesLLM: false, priority: 'medium', defaultInterval: 10,
  tags: ['audio', 'transcription', 'background'],
};

const agent: AgentModule = { meta, run };
export default agent;

export { runCycle, type TranscriberOptions, type TranscriberResult } from './core.js';
