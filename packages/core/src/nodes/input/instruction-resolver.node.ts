import { defineNode } from '../types.js';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const instructionResolverNode = defineNode({
  id: 'instruction_resolver',
  name: 'Instruction Resolver',
  category: 'input',
  inputs: [
    { name: 'userInstruction', type: 'string', optional: true, description: 'Current human-authored instruction' },
    { name: 'autonomyInstruction', type: 'string', optional: true, description: 'Current planner-authored autonomy instruction' },
    { name: 'bridgeSource', type: 'string', optional: true, description: 'Provenance supplied by Environment Bridge Input' },
  ],
  outputs: [
    { name: 'instruction', type: 'string', description: 'Current instruction for the workflow' },
    { name: 'userInstruction', type: 'string', description: 'Human-authored instruction, or an empty string' },
    { name: 'inputSource', type: 'string', description: 'Instruction provenance: user or autonomy' },
  ],
  description: 'Resolves explicit human and autonomy inputs into one provenance-bearing instruction without interpreting intent.',
  async execute(inputs) {
    const userInstruction = text(inputs.userInstruction);
    const autonomyInstruction = text(inputs.autonomyInstruction);
    const bridgeSource = inputs.bridgeSource === 'autonomy' ? 'autonomy' : 'user';
    const inputSource = userInstruction
      ? 'user'
      : autonomyInstruction
        ? 'autonomy'
        : bridgeSource;
    const instruction = userInstruction || autonomyInstruction;

    return {
      instruction,
      userInstruction,
      inputSource,
    };
  },
});
