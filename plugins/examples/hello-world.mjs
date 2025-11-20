/**
 * Example Plugin: Hello World
 *
 * A simple example plugin that demonstrates the basic structure
 * of a MetaHuman cognitive node plugin.
 */

export default {
  metadata: {
    id: 'hello_world',
    name: 'Hello World',
    version: '1.0.0',
    author: 'MetaHuman Team',
    description: 'A simple example plugin that greets the user',
    category: 'custom',
    color: '#ff6b6b',
    bgColor: '#c92a2a',
  },

  inputs: [
    {
      name: 'name',
      type: 'string',
      optional: true,
      description: 'Name to greet (optional)',
    },
  ],

  outputs: [
    {
      name: 'greeting',
      type: 'string',
      description: 'The generated greeting',
    },
    {
      name: 'timestamp',
      type: 'number',
      description: 'When the greeting was generated',
    },
  ],

  properties: {
    prefix: 'Hello',
    suffix: '!',
  },

  executor: async (inputs, context, properties) => {
    const name = inputs[0] || 'World';
    const prefix = properties?.prefix || 'Hello';
    const suffix = properties?.suffix || '!';

    const greeting = `${prefix}, ${name}${suffix}`;

    console.log(`[HelloWorld Plugin] Generated: ${greeting}`);

    return {
      greeting,
      timestamp: Date.now(),
    };
  },
};
