import { withUserContext, buildMemoryIndex, getUserByUsername } from '@metahuman/core';

async function main() {
  const usernameFlag = process.argv.find(arg => arg.startsWith('--username='));
  const username = usernameFlag?.split('=')[1];
  if (!username) throw new Error('Usage: pnpm tsx scripts/rebuild-index-now.ts --username=<username>');
  const user = getUserByUsername(username);
  if (!user) throw new Error(`User not found: ${username}`);

  console.log('Starting index rebuild with qwen3-embedding-0.6b...\n');

  await withUserContext(
    { userId: user.id, username: user.username, role: user.role },
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
