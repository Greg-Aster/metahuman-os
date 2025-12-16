import { withUserContext, buildMemoryIndex } from '@metahuman/core';

async function main() {
  console.log('Starting index rebuild with qwen3-embedding-0.6b...\n');

  await withUserContext(
    { userId: 'f1be5026-fd95-4c58-a033-8c05e061f82d', username: 'greggles', role: 'owner' },
    async () => {
      console.log('Building memory index with qwen3-embedding-0.6b (1024 dims)...');
      // Don't pass model explicitly - let it use the configured default.embedder from models.json
      const result = await buildMemoryIndex({
        forceRebuild: true,
      });
      console.log('\nIndex build complete!');
      console.log(`  Total indexed: ${result.totalIndexed}`);
      console.log(`  Dimensions: ${result.dimensions}`);
      console.log(`  Model: ${result.model}`);
    }
  );
}

main().catch(console.error);
