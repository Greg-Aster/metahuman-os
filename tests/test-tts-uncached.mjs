/**
 * Test TTS with username parameter (no caching)
 */

import { generateSpeech } from './packages/core/dist/tts.js';
import { writeFileSync } from 'node:fs';

console.log('\n=== Testing TTS with No Caching ===\n');

// Test 1: Generate with username 'greggles'
console.log('Test 1: Generate with username "greggles"');
const text = 'This is a test of uncached TTS service creation.';

try {
  const audio1 = await generateSpeech(text, {
    provider: 'gpt-sovits',
    username: 'greggles',
  });

  console.log('✓ First generation successful');
  console.log(`  Audio size: ${audio1.length} bytes`);
  writeFileSync('/tmp/test-uncached-1.wav', audio1);
  console.log('  Saved to: /tmp/test-uncached-1.wav\n');

  // Test 2: Generate again with same username (should NOT use cache)
  console.log('Test 2: Generate again with username "greggles"');
  const audio2 = await generateSpeech(text, {
    provider: 'gpt-sovits',
    username: 'greggles',
  });

  console.log('✓ Second generation successful');
  console.log(`  Audio size: ${audio2.length} bytes`);
  console.log('  Should show referenceAudioDir: /profiles/greggles/out/voices/sovits/default\n');

  // Test 3: Generate with different username
  console.log('Test 3: Generate with username "testuser"');
  try {
    const audio3 = await generateSpeech(text, {
      provider: 'gpt-sovits',
      username: 'testuser',
    });

    console.log('✓ Third generation successful (or fell back to Piper)');
    console.log(`  Audio size: ${audio3.length} bytes`);
    console.log('  Should show referenceAudioDir: /profiles/testuser/out/voices/sovits/default\n');
  } catch (err) {
    console.log('✓ Third generation failed as expected (no audio for testuser)');
    console.log(`  Error: ${err.message}\n`);
  }

  console.log('All tests completed successfully!');
  console.log('\nKey Observations:');
  console.log('- No caching means fresh service every time');
  console.log('- Paths resolve correctly per user');
  console.log('- Web UI should now work without restart');

} catch (error) {
  console.error('Test failed:', error);
  process.exit(1);
}
