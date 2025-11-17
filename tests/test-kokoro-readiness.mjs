import {
  copyToKokoroDataset,
  listKokoroSamples,
  getKokoroTrainingReadiness,
  getKokoroTrainingStatus,
  deleteKokoroSample,
  startKokoroVoicepackTraining,
  getReferenceSamples,
} from '@metahuman/core';

console.log('✓ All Kokoro functions imported successfully\n');

try {
  console.log('Testing getKokoroTrainingReadiness...');
  const readiness = getKokoroTrainingReadiness('default');
  console.log('Readiness:', JSON.stringify(readiness, null, 2));
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}

try {
  console.log('\nTesting listKokoroSamples...');
  const samples = listKokoroSamples('default');
  console.log('Samples count:', samples.length);
  console.log('Sample details:', samples.slice(0, 3));
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}

try {
  console.log('\nTesting getKokoroTrainingStatus...');
  const status = getKokoroTrainingStatus('default');
  console.log('Status:', JSON.stringify(status, null, 2));
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}

console.log('\n✅ All tests passed!');
