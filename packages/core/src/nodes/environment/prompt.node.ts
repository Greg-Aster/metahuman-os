import { defineNode } from '../types.js';

export const environmentPromptNode = defineNode({
  id: 'environment_prompt',
  name: 'Environment Prompt',
  category: 'environment',
  inputs: [
    { name: 'message', type: 'string', description: 'Prompt-ready environment message' },
    { name: 'context', type: 'object', optional: true, description: 'Structured environment context' },
    { name: 'availableActions', type: 'array', optional: true, description: 'Allowed action vocabulary' },
  ],
  outputs: [
    { name: 'message', type: 'string', description: 'Activated environment prompt' },
    { name: 'context', type: 'object', description: 'Environment context package' },
    { name: 'orchestrator', type: 'object', description: 'Instructions for downstream LLM nodes' },
  ],
  properties: {
    responseContract: '',
  },
  propertySchemas: {
    responseContract: {
      type: 'text_multiline',
      default: '',
      label: 'Response Contract',
      rows: 3,
    },
  },
  description: 'Activates an environment prompt as the current graph user message for downstream LLM nodes.',
  async execute(inputs, context, properties) {
    const message = typeof inputs.message === 'string' ? inputs.message : '';
    const responseContract = String(properties?.responseContract ?? '').trim();
    const availableActions = Array.isArray(inputs.availableActions) ? inputs.availableActions : [];
    const activeMessage = responseContract ? `${message}\n\n${responseContract}` : message;

    context.userMessage = activeMessage;
    context.contextPackage = inputs.context ?? context.contextPackage;
    context.contextInfo = activeMessage;

    return {
      message: activeMessage,
      context: inputs.context ?? null,
      orchestrator: {
        instructions: responseContract,
        availableActions,
      },
    };
  },
});
