/**
 * Cache Node
 *
 * Stores intermediate results with TTL
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const cacheStore = new Map<string, { value: any; expiry: number }>();

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const key = properties?.key || 'default';
  const ttl = properties?.ttl || 60000;
  const operation = properties?.operation || 'get';

  try {
    switch (operation) {
      case 'set':
        const value = inputs[0];
        cacheStore.set(key, {
          value,
          expiry: Date.now() + ttl,
        });
        return {
          cached: true,
          key,
          ttl,
        };

      case 'get':
        const cached = cacheStore.get(key);
        if (cached && cached.expiry > Date.now()) {
          return {
            value: cached.value,
            hit: true,
            key,
          };
        } else {
          cacheStore.delete(key);
          return {
            value: null,
            hit: false,
            key,
          };
        }

      case 'clear':
        cacheStore.delete(key);
        return {
          cleared: true,
          key,
        };

      case 'clear_all':
        cacheStore.clear();
        return {
          cleared: true,
          count: 0,
        };

      default:
        return {
          error: `Unknown operation: ${operation}`,
        };
    }
  } catch (error) {
    console.error('[Cache] Error:', error);
    return {
      error: (error as Error).message,
    };
  }
};

export const CacheNode: NodeDefinition = defineNode({
  id: 'cache',
  name: 'Cache',
  category: 'utility',
  inputs: [
    { name: 'value', type: 'any', optional: true, description: 'Value to cache (for set)' },
  ],
  outputs: [
    { name: 'value', type: 'any', description: 'Cached value (for get)' },
    { name: 'hit', type: 'boolean', description: 'Whether cache hit' },
  ],
  properties: {
    key: 'default',
    ttl: 60000,
    operation: 'get',
  },
  propertySchemas: {
    key: {
      type: 'string',
      default: 'default',
      label: 'Cache Key',
    },
    ttl: {
      type: 'number',
      default: 60000,
      label: 'TTL (ms)',
      description: 'Time to live in milliseconds',
    },
    operation: {
      type: 'select',
      default: 'get',
      label: 'Operation',
      options: ['get', 'set', 'clear', 'clear_all'],
    },
  },
  description: 'Stores intermediate results with TTL',
  execute,
});
