import { buildMemoryIndex, getIndexStatus, withUserContext } from '@metahuman/core';

async function main() {
  console.log('Starting index build test...');
  
  await withUserContext(
    { userId: 'greggles', username: 'greggles', role: 'owner' },
    async () => {
      console.log('Building memory index...');
      const indexPath = await buildMemoryIndex({
        include: {
          episodic: true,
          tasks: true,
          curated: true,
          functions: true,
        },
        force: true,
      });
      
      console.log('Index path:', indexPath);
      
      const status = getIndexStatus();
      console.log('Index status:', JSON.stringify(status, null, 2));
    }
  );
}

main().catch(console.error);
