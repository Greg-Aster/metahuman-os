import { defineNode } from '../types.js';
import type { EnvironmentCapabilities, EnvironmentObservation, EnvironmentTextEvent } from '../../environment-interface/index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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

function textEventFromMessage(message: string): EnvironmentTextEvent | null {
  const text = message.trim();
  if (!text) {
    return null;
  }

  return {
    id: `environment-chat-${Date.now()}`,
    source: 'player',
    text,
    timestamp: new Date().toISOString(),
    senderName: 'user',
  };
}

export const environmentInstructionInterpreterNode = defineNode({
  id: 'environment_instruction_interpreter',
  name: 'Environment Instruction Interpreter',
  category: 'environment',
  inputs: [
    { name: 'observation', type: 'object', optional: true, description: 'Raw environment observation, when an adapter is connected' },
  ],
  outputs: [
    { name: 'observation', type: 'object', description: 'Environment observation for Environment Mode' },
    { name: 'instruction', type: 'string', description: 'Current environment instruction text' },
    { name: 'text', type: 'array', description: 'Environment text events used as instruction input' },
    { name: 'state', type: 'object', description: 'Environment state payload' },
    { name: 'location', type: 'object', description: 'Environment location payload' },
    { name: 'sessionId', type: 'string', description: 'Target environment bridge session' },
    { name: 'valid', type: 'boolean', description: 'Whether usable environment input exists' },
  ],
  description: 'Normalizes adapter observations and typed environment chat into one instruction surface.',
  async execute(inputs, context) {
    const rawObservation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    const contextMessage = typeof context.userMessage === 'string' ? context.userMessage : '';
    const fallbackEvent = textEventFromMessage(contextMessage);
    const text = filterTextEvents([
      ...(rawObservation?.text ?? []),
      ...(fallbackEvent ? [fallbackEvent] : []),
    ]);
    const instruction = text.map(event => event.text).join('\n').trim();
    const sessionId = rawObservation?.sessionId ?? '';
    const timestamp = rawObservation?.timestamp || new Date().toISOString();
    const capabilities: EnvironmentCapabilities = {
      actions: rawObservation?.capabilities?.actions ?? [],
      robotCommands: rawObservation?.capabilities?.robotCommands,
      text: rawObservation?.capabilities?.text ?? true,
      movement: rawObservation?.capabilities?.movement ?? false,
      visual: rawObservation?.capabilities?.visual ?? false,
      map: rawObservation?.capabilities?.map ?? false,
    };
    const observation: EnvironmentObservation = {
      environmentId: rawObservation?.environmentId ?? 'unavailable',
      adapter: rawObservation?.adapter ?? 'none',
      sessionId,
      timestamp,
      capabilities,
      text,
      state: rawObservation?.state ?? {},
      location: rawObservation?.location,
      map: rawObservation?.map,
      visual: rawObservation?.visual,
      visuals: rawObservation?.visuals,
      feedback: rawObservation?.feedback,
    };

    return {
      observation,
      instruction,
      text,
      state: observation.state ?? {},
      location: observation.location ?? null,
      sessionId,
      valid: instruction.length > 0 || Boolean(rawObservation),
    };
  },
});
