import { withUserContext, queryIndex } from '@metahuman/core';

async function main() {
  await withUserContext(
    { userId: 'f1be5026-fd95-4c58-a033-8c05e061f82d', username: 'greggles', role: 'owner' },
    async () => {
      console.log('Testing semantic search...\n');

      const results = await queryIndex('metahuman project development', { topK: 5 });

      console.log('Found ' + results.length + ' results:\n');
      for (const r of results) {
        const score = (r.score || 0).toFixed(3);
        const id = (r.item.id || 'unknown').slice(-30);
        const type = r.item.type || 'unknown';
        console.log('- [' + score + '] ' + id + ' | ' + type);
        const text = r.item.text || '';
        if (text) {
          console.log('  "' + text.substring(0, 80) + '..."\n');
        }
      }
    }
  );
}

main().catch(console.error);
