/**
 * JSON Parser Node
 *
 * Extracts JSON from text (useful for parsing LLM responses)
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const text = inputs[0]?.text || inputs[0]?.response || inputs[0] || '';
  const fallback = properties?.fallback || null;

  try {
    let jsonText = text;
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1];
    } else {
      const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
    }

    const parsed = JSON.parse(jsonText);

    return {
      data: parsed,
      success: true,
      raw: text,
    };
  } catch (error) {
    console.warn('[JSONParser] Failed to parse JSON:', (error as Error).message);
    return {
      data: fallback,
      success: false,
      raw: text,
      error: (error as Error).message,
    };
  }
};

export const JSONParserNode: NodeDefinition = defineNode({
  id: 'json_parser',
  name: 'JSON Parser',
  category: 'utility',
  inputs: [
    { name: 'text', type: 'string', description: 'Text containing JSON' },
  ],
  outputs: [
    { name: 'data', type: 'object', description: 'Parsed JSON data' },
    { name: 'success', type: 'boolean' },
  ],
  properties: {
    fallback: null,
  },
  description: 'Extracts and parses JSON from text',
  execute,
});
