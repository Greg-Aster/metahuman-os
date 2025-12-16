import { queryIndex, loadIndex } from '../packages/core/src/vector-index.js';

async function main() {
  // Test 1: Check if car memory is in the index
  const idx = loadIndex();
  if (idx) {
    console.log('=== INDEX STATUS ===');
    console.log('Total items:', idx.data.length);

    // Search for car-related content in the raw index
    const carMemories = idx.data.filter(item =>
      item.text.toLowerCase().includes('beetle') ||
      item.text.toLowerCase().includes('celica') ||
      item.text.toLowerCase().includes('toyota orange')
    );
    console.log('\n=== CAR MEMORIES IN INDEX ===');
    console.log('Found', carMemories.length, 'car-related memories');
    carMemories.forEach(m => {
      console.log('\nID:', m.id);
      console.log('Text snippet:', m.text.substring(0, 300) + '...');
    });
  }

  // Test 2: Direct semantic search for "car"
  console.log('\n=== SEMANTIC SEARCH: "car" ===');
  const results = await queryIndex('car', { topK: 5 });
  results.forEach((r, i) => {
    console.log(`\n${i+1}. Score: ${r.score.toFixed(3)}`);
    console.log('   Text:', r.item.text.substring(0, 150) + '...');
  });

  // Test 3: Semantic search for "what car do I drive"
  console.log('\n=== SEMANTIC SEARCH: "what car do I drive" ===');
  const results2 = await queryIndex('what car do I drive', { topK: 5 });
  results2.forEach((r, i) => {
    console.log(`\n${i+1}. Score: ${r.score.toFixed(3)}`);
    console.log('   Text:', r.item.text.substring(0, 150) + '...');
  });

  // Test 4: Search for "beetle celica"
  console.log('\n=== SEMANTIC SEARCH: "beetle celica vehicle" ===');
  const results3 = await queryIndex('beetle celica vehicle', { topK: 5 });
  results3.forEach((r, i) => {
    console.log(`\n${i+1}. Score: ${r.score.toFixed(3)}`);
    console.log('   Text:', r.item.text.substring(0, 150) + '...');
  });
}

main().catch(console.error);
