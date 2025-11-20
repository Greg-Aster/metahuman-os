/**
 * Example Plugin: Memory Counter
 *
 * Demonstrates integration with MetaHuman's core functionality
 * by counting memories based on type or tags.
 */

export default {
  metadata: {
    id: 'memory_counter',
    name: 'Memory Counter',
    version: '1.0.0',
    author: 'MetaHuman Team',
    description: 'Counts memories by type or tag',
    category: 'custom',
    color: '#748ffc',
    bgColor: '#4c6ef5',
  },

  inputs: [
    {
      name: 'filterType',
      type: 'string',
      optional: true,
      description: 'Memory type to filter by (e.g., "observation", "conversation")',
    },
  ],

  outputs: [
    {
      name: 'count',
      type: 'number',
      description: 'Number of matching memories',
    },
    {
      name: 'breakdown',
      type: 'object',
      description: 'Count by type',
    },
    {
      name: 'success',
      type: 'boolean',
    },
  ],

  properties: {
    includeProcessed: true,
  },

  executor: async (inputs, context, properties) => {
    try {
      // Import MetaHuman core functions
      const { searchMemory } = await import('@metahuman/core');
      const fs = await import('fs');

      const filterType = inputs[0];
      const includeProcessed = properties?.includeProcessed !== false;

      // Get all memory files
      const memoryPaths = searchMemory('');

      const breakdown = {};
      let totalCount = 0;

      for (const memoryPath of memoryPaths) {
        try {
          const content = fs.readFileSync(memoryPath, 'utf-8');
          const memory = JSON.parse(content);

          // Skip processed memories if requested
          if (!includeProcessed && memory.metadata?.processed) {
            continue;
          }

          // Filter by type if specified
          if (filterType && memory.type !== filterType) {
            continue;
          }

          // Count by type
          const type = memory.type || 'unknown';
          breakdown[type] = (breakdown[type] || 0) + 1;
          totalCount++;

        } catch (error) {
          // Skip invalid memory files
          continue;
        }
      }

      console.log(`[MemoryCounter Plugin] Found ${totalCount} memories`);
      if (filterType) {
        console.log(`[MemoryCounter Plugin] Filter: type="${filterType}"`);
      }

      return {
        count: totalCount,
        breakdown,
        success: true,
      };

    } catch (error) {
      console.error('[MemoryCounter Plugin] Error:', error);
      return {
        count: 0,
        breakdown: {},
        success: false,
        error: error.message,
      };
    }
  },
};
