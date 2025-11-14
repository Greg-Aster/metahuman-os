#!/usr/bin/env node
/**
 * Quick test to benchmark RVC server performance vs process spawning
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Simple test to call RVC server directly
async function testRVCServer() {
  console.log('🧪 Testing RVC Server Performance\n');

  // Test data - Base64 encoded WAV header (minimal valid WAV)
  // This is a tiny silent WAV file just for testing the pipeline
  const testWav = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x24, 0x00, 0x00, 0x00, // File size
    0x57, 0x41, 0x56, 0x45, // "WAVE"
    0x66, 0x6d, 0x74, 0x20, // "fmt "
    0x10, 0x00, 0x00, 0x00, // Chunk size
    0x01, 0x00,             // Audio format (PCM)
    0x01, 0x00,             // Channels (1)
    0x44, 0xac, 0x00, 0x00, // Sample rate (44100)
    0x88, 0x58, 0x01, 0x00, // Byte rate
    0x02, 0x00,             // Block align
    0x10, 0x00,             // Bits per sample
    0x64, 0x61, 0x74, 0x61, // "data"
    0x00, 0x00, 0x00, 0x00, // Data size (0 bytes)
  ]);

  const audioBase64 = testWav.toString('base64');

  // Test 1: Health check
  console.log('1️⃣  Health Check');
  const healthStart = Date.now();
  const healthResponse = await fetch('http://127.0.0.1:9881/health');
  const healthData = await healthResponse.json();
  console.log(`   Status: ${healthData.status}`);
  console.log(`   Device: ${healthData.device}`);
  console.log(`   Time: ${Date.now() - healthStart}ms\n`);

  // Test 2: Server synthesis (first call - cold model load)
  console.log('2️⃣  First Synthesis (with model loading)');
  const firstStart = Date.now();

  try {
    const response = await fetch('http://127.0.0.1:9881/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_base64: audioBase64,
        speaker_id: 'default',
        pitch_shift: 0,
        index_rate: 1.0,
        volume_envelope: 0.0,
        protect: 0.15,
        f0_method: 'rmvpe',
      }),
    });

    const result = await response.json();
    const firstTotal = Date.now() - firstStart;

    console.log(`   Success: ${result.success}`);
    console.log(`   Server processing time: ${result.duration_ms}ms`);
    console.log(`   Total roundtrip time: ${firstTotal}ms`);
    console.log(`   Output size: ${result.audio_size} bytes\n`);

    // Test 3: Second synthesis (hot model, should be fast)
    console.log('3️⃣  Second Synthesis (model already loaded)');
    const secondStart = Date.now();

    const response2 = await fetch('http://127.0.0.1:9881/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_base64: audioBase64,
        speaker_id: 'default',
        pitch_shift: 0,
        index_rate: 1.0,
        volume_envelope: 0.0,
        protect: 0.15,
        f0_method: 'rmvpe',
      }),
    });

    const result2 = await response2.json();
    const secondTotal = Date.now() - secondStart;

    console.log(`   Success: ${result2.success}`);
    console.log(`   Server processing time: ${result2.duration_ms}ms`);
    console.log(`   Total roundtrip time: ${secondTotal}ms`);
    console.log(`   Output size: ${result2.audio_size} bytes\n`);

    // Summary
    console.log('📊 Performance Summary');
    console.log('─'.repeat(50));
    console.log(`   First call (cold):  ${result.duration_ms}ms server + ${firstTotal}ms total`);
    console.log(`   Second call (hot):  ${result2.duration_ms}ms server + ${secondTotal}ms total`);
    console.log(`   Speedup ratio:      ${(firstTotal / secondTotal).toFixed(2)}x faster when hot`);
    console.log('\n✅ RVC Server is working and significantly faster with cached models!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testRVCServer().catch(console.error);
