import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const tts = read('packages/core/src/tts.ts');
const kokoroService = read('packages/core/src/tts/providers/kokoro-service.ts');
const streamHandler = read('packages/core/src/api/handlers/tts-stream.ts');
const robotSpeech = read('packages/core/src/tts/robot-speech.ts');
const browserPlayback = read('apps/site/src/lib/client/composables/useTTS.ts');
const kokoroServer = read('external/kokoro/kokoro_server.py');
const voiceIndex = read('packages/core/src/voice/index.ts');
const voiceTemplate = read('etc/voice.json.template');
const kittenService = read('packages/core/src/tts/providers/kitten-service.ts');
const kittenServer = read('external/kitten/kitten_server.py');

assert.match(kittenService, /ensureVoiceServiceRunning\('kitten'\)/,
  'Kitten delegates process lifecycle to the shared manager');
assert.doesNotMatch(kittenService, /\bspawn\(|synthesizeStream|splitSpeechText/,
  'Kitten batch requests must not create another lifecycle or streaming owner');
assert.doesNotMatch(kittenServer, /StreamingResponse|ThreadPoolExecutor|audio_base64|chunk_text/,
  'Kitten Python serves batch inference without another phrase scheduler');

assert.match(
  tts,
  /export function createKokoroTTSService[\s\S]*?buildKokoroService/,
  'batch, browser, and robot adapters must construct the same profile-resolved Kokoro owner',
);
assert.match(
  kokoroService,
  /splitSpeechText[\s\S]*?async \*synthesizeStream[\s\S]*?synthesizeWithMetadata/,
  'KokoroService must own phrase splitting and streaming synthesis',
);
assert.doesNotMatch(
  kokoroService,
  /synthesizeViaCLI|config\.server|spawn\(/,
  'KokoroService must use the managed voice server rather than a private CLI lifecycle',
);
assert.match(
  streamHandler,
  /createKokoroTTSService[\s\S]*?service\.synthesizeStream/,
  'the HTTP stream handler must remain a thin adapter over KokoroService',
);
assert.match(
  robotSpeech,
  /createKokoroTTSService[\s\S]*?service\.synthesizeStream/,
  'robot delivery must use the same Kokoro synthesis owner',
);
assert.doesNotMatch(
  `${streamHandler}\n${robotSpeech}`,
  /fetch\([^)]*synthesize-stream|KOKORO_SERVER_URL/,
  'delivery adapters must not implement a direct Kokoro transport',
);
assert.doesNotMatch(
  kokoroServer,
  /synthesize-stream|StreamingResponse|ThreadPoolExecutor|audio_base64/,
  'the Python inference server must not retain a second streaming and chunking owner',
);
assert.doesNotMatch(
  voiceTemplate,
  /splitPattern|voice-stream|audioChunkMs/,
  'maintained voice defaults must not advertise settings with no runtime consumer',
);
assert.doesNotMatch(
  browserPlayback,
  /BUFFER_THRESHOLD|new Audio\(|Falling back to non-streaming TTS/,
  'browser streaming must start on the first Web Audio phrase without retrying through a second synthesis path',
);
assert.match(
  browserPlayback,
  /decodeAudioData[\s\S]*?scheduleStreamingChunks[\s\S]*?source\.start/,
  'browser streaming must decode and schedule received phrases on the Web Audio clock',
);
assert.equal(
  fs.existsSync(path.join(ROOT, 'packages/core/src/voice/tts-integration.ts')),
  false,
  'the simulated post-synthesis streaming integration must remain removed',
);
assert.doesNotMatch(
  voiceIndex,
  /TTSIntegration|tts-integration/,
  'the voice module must not export the retired simulated streamer',
);

console.log('tts-synthesis-ownership.spec.ts passed');
