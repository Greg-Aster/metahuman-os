import { defineNode } from '../types.js';
import type { EnvironmentObservation, EnvironmentTextEvent } from '../../environment-interface/index.js';

function textStartsWithYou(text: string): boolean {
  return /^\s*you\b[\s:,-]*/i.test(text);
}

function filterTextEvents(events: EnvironmentTextEvent[]): EnvironmentTextEvent[] {
  return events
    .filter(event => event.senderName?.toLowerCase() !== 'you')
    .filter(event => !textStartsWithYou(event.text))
    .map(event => ({
      ...event,
      text: event.text.replace(/^\s*(?!you\b)([^\s:]{1,80})\s*:\s*/i, '').trim(),
    }))
    .filter(event => event.text.length > 0);
}

export const megamealInterpreterNode = defineNode({
  id: 'megameal_interpreter',
  name: 'Megameal Interpreter',
  category: 'environment',
  inputs: [
    { name: 'observation', type: 'object', description: 'Raw Megameal environment observation' },
  ],
  outputs: [
    { name: 'observation', type: 'object', description: 'Filtered Megameal observation for Environment Mode' },
    { name: 'instruction', type: 'string', description: 'Most recent player text to treat as the task instruction' },
    { name: 'text', type: 'array', description: 'Filtered player text events' },
    { name: 'state', type: 'object', description: 'Megameal state payload' },
    { name: 'location', type: 'object', description: 'Megameal location payload' },
    { name: 'sessionId', type: 'string', description: 'Target Megameal bridge session' },
    { name: 'valid', type: 'boolean', description: 'Whether this is a Megameal observation with usable input' },
  ],
  description: 'Filters Megameal current-player bridge observations before they enter Environment Mode cognition.',
  async execute(inputs) {
    const observation = inputs.observation as EnvironmentObservation | undefined;
    if (!observation || observation.adapter !== 'megameal') {
      return {
        observation: null,
        instruction: '',
        text: [],
        state: {},
        location: null,
        sessionId: '',
        valid: false,
      };
    }

    const text = filterTextEvents(observation.text ?? []);
    const filteredObservation: EnvironmentObservation = {
      ...observation,
      text,
      capabilities: {
        ...observation.capabilities,
        actions: observation.capabilities.actions.filter(action =>
          action === 'move' ||
          action === 'jump' ||
          action === 'interact' ||
          action === 'stop' ||
          action === 'sendText',
        ),
      },
    };
    const instruction = text.map(event => event.text).join('\n');

    return {
      observation: filteredObservation,
      instruction,
      text,
      state: filteredObservation.state ?? {},
      location: filteredObservation.location ?? null,
      sessionId: filteredObservation.sessionId,
      valid: true,
    };
  },
});
