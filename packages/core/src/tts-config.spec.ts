import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, beforeEach, test } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-tts-config-'));
process.env.METAHUMAN_ROOT = root;
const { setAuditEnabled } = await import('./audit.js');
setAuditEnabled(false);
const { eventBus } = await import('./infrastructure/event-bus/client.js');
eventBus.disconnect();
const { getProfilePaths } = await import('./path-builder.js');
const { withUserContext } = await import('./context.js');
const { createKokoroTTSService, generateSpeech } = await import('./tts.js');
const { handleTtsStream } = await import('./api/handlers/tts-stream.js');
const originalFetch = globalThis.fetch;
const globalFile = path.join(root, 'etc', 'voice.json');
const requests: Array<Record<string, unknown>> = [];

function voiceConfig(voice = 'af_heart', speed = 1) {
  return {
    tts: { provider: 'kokoro', kokoro: {
      langCode: 'a', voice, speed, useCustomVoicepack: false,
      customVoicepackPath: '{PROFILE_DIR}/out/voices/custom.pt',
      autoFallbackToPiper: false, outputFormat: 'wav',
    } },
    cache: { enabled: false, directory: '{PROFILE_DIR}/out/voice-cache', maxSizeMB: 10 },
  };
}

function writeProfile(username: string, config: unknown) {
  const file = getProfilePaths(username).voiceConfig;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config));
  return file;
}

beforeEach(() => {
  fs.rmSync(path.join(root, 'profiles'), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(globalFile), { recursive: true });
  fs.rmSync(globalFile, { force: true });
  requests.length = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/health')) return Response.json({ status: 'ok' });
    if (String(url).endsWith('/synthesize')) {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(Buffer.from('synthetic-audio'));
    }
    throw new Error(`Unexpected request: ${url}`);
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });
after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }); });

test('batch and streaming use profile settings without a global voice file', async () => {
  const file = writeProfile('fixture', voiceConfig('am_adam', 0.9));
  const before = fs.readFileSync(file, 'utf8');
  const audio = await generateSpeech('Synthetic greeting.', { username: 'fixture' });
  assert.equal(audio.toString(), 'synthetic-audio');
  const chunks = [];
  for await (const chunk of createKokoroTTSService('fixture').synthesizeStream('Synthetic stream.')) chunks.push(chunk);
  assert.equal(chunks.length, 1);
  assert(requests.every(request => request.voice === 'am_adam' && request.speed === 0.9));
  assert.equal(fs.existsSync(globalFile), false);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('existing global defaults merge with profile overrides and are reread after edits', async () => {
  fs.writeFileSync(globalFile, JSON.stringify(voiceConfig('af_heart', 1)));
  writeProfile('fixture', { tts: { kokoro: { voice: 'am_adam' } } });
  await generateSpeech('First read.', { username: 'fixture' });
  assert.equal(requests[0].voice, 'am_adam');
  assert.equal(requests[0].speed, 1);
  fs.writeFileSync(globalFile, JSON.stringify(voiceConfig('af_heart', 0.8)));
  writeProfile('fixture', { tts: { kokoro: { voice: 'bf_emma' } } });
  await generateSpeech('Second read.', { username: 'fixture' });
  assert.equal(requests[1].voice, 'bf_emma');
  assert.equal(requests[1].speed, 0.8);
});

test('concurrent profile contexts retain their own voice and cache paths', async () => {
  for (const [username, voice] of [['first', 'am_adam'], ['second', 'bf_emma']]) {
    const config = voiceConfig(voice);
    config.cache.enabled = true;
    writeProfile(username, config);
  }
  await Promise.all(['first', 'second'].map(username => withUserContext(
    { userId: username, username, role: 'owner' },
    () => generateSpeech('Same synthetic text.'),
  )));
  assert.deepEqual(new Set(requests.map(request => request.voice)), new Set(['am_adam', 'bf_emma']));
  for (const username of ['first', 'second']) {
    const cache = path.join(getProfilePaths(username).root, 'out', 'voice-cache');
    assert.equal(fs.readdirSync(cache).filter(file => file.endsWith('.wav')).length, 1);
  }
});

test('malformed profile settings fail visibly instead of using another voice', async () => {
  fs.writeFileSync(globalFile, JSON.stringify(voiceConfig()));
  const file = writeProfile('broken', voiceConfig());
  fs.writeFileSync(file, '{invalid');
  await assert.rejects(generateSpeech('Must not synthesize.', { username: 'broken' }), /voice configuration|JSON/i);
  const response = await handleTtsStream({ method: 'POST', body: { text: 'Must not synthesize.' },
    user: { username: 'broken', isAuthenticated: true, role: 'owner' } } as any);
  assert.equal(response.status, 500);
  assert.match(String(response.error), /voice configuration|JSON/i);
  assert.equal(requests.length, 0);
});

test('absent or incomplete settings report a configuration error before inference', async () => {
  await assert.rejects(generateSpeech('Missing.', { username: 'missing' }), /[Vv]oice configuration/);
  writeProfile('incomplete', { tts: { provider: 'kokoro' } });
  await assert.rejects(generateSpeech('Incomplete.', { username: 'incomplete' }), /[Vv]oice configuration/);
  assert.equal(requests.length, 0);
});

function kittenVoiceConfig(voice = 'Jasper', speed = 1) {
  return {
    tts: { provider: 'kitten', kitten: { voice, speed, outputFormat: 'wav' } },
    cache: { enabled: false, directory: '{PROFILE_DIR}/out/voice-cache', maxSizeMB: 10 },
  };
}

test('Kitten batch synthesis uses its profile voice without Piper or Kokoro configuration', async () => {
  writeProfile('kitten-fixture', kittenVoiceConfig('Luna', 0.9));
  const audio = await generateSpeech('Synthetic Kitten speech.', { username: 'kitten-fixture' });
  assert.equal(audio.toString(), 'synthetic-audio');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].voice, 'Luna');
  assert.equal(requests[0].speed, 0.9);
  assert.equal(requests[0].custom_voicepack, undefined);
});

test('Kitten streams ordered phrases through the existing generic stream handler', async () => {
  writeProfile('kitten-fixture', kittenVoiceConfig());
  const response = await handleTtsStream({ method: 'POST',
    body: { text: 'Hello! I am ready to speak while later phrases are generated.', provider: 'kitten' },
    user: { username: 'kitten-fixture', isAuthenticated: true, role: 'owner' },
  } as any);
  assert.equal(response.status, 200);
  let events = '';
  for await (const event of response.stream!) events += event;
  assert.doesNotMatch(events, /"event":"error"/);
  assert.match(events, /"chunk_index":0/);
  assert.match(events, /"chunk_index":1/);
  assert.match(events, /"event":"complete"/);
  assert.equal(requests[0].text, 'Hello!');
  assert(requests.every(request => request.voice === 'Jasper'));
});

test('Kitten refuses unknown voices before contacting an inference server', async () => {
  writeProfile('kitten-fixture', kittenVoiceConfig('af_heart'));
  await assert.rejects(generateSpeech('Do not change my voice.', { username: 'kitten-fixture' }), /Kitten voice/i);
  assert.equal(requests.length, 0);
});

test('Kitten starts the following phrase before handing off the first audio', async () => {
  writeProfile('kitten-fixture', kittenVoiceConfig());
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const fetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/synthesize')) {
      const body = JSON.parse(String(init?.body));
      if (body.text !== 'Hello!') {
        requests.push(body);
        await blocked;
        return new Response(Buffer.from('second-phrase'));
      }
    }
    return fetch(url, init);
  };
  const response = await handleTtsStream({ method: 'POST',
    body: { text: 'Hello! This next phrase must already be processing.', provider: 'kitten', voiceId: 'Bella', speed: 0.8 },
    user: { username: 'kitten-fixture', isAuthenticated: true, role: 'owner' },
  } as any);
  const iterator = response.stream![Symbol.asyncIterator]();
  try {
    const first = await iterator.next();
    assert.match(String(first.value), /"chunk_index":0/);
    assert.equal(requests.length, 2);
    assert(requests.every(request => request.voice === 'Bella' && request.speed === 0.8));
  } finally { release(); }
  const second = await iterator.next();
  assert.match(String(second.value), /"chunk_index":1/);
  await iterator.return?.();
});

test('Kitten streaming reports inference failures without a false completion event', async () => {
  writeProfile('kitten-fixture', kittenVoiceConfig());
  const fetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).endsWith('/synthesize')
    ? new Response('inference unavailable', { status: 503 }) : fetch(url, init);
  const response = await handleTtsStream({ method: 'POST',
    body: { text: 'Hello! Do not skip a failed phrase.', provider: 'kitten' },
    user: { username: 'kitten-fixture', isAuthenticated: true, role: 'owner' },
  } as any);
  let events = '';
  for await (const event of response.stream!) events += event;
  assert.match(events, /"event":"error"/);
  assert.match(events, /503/);
  assert.doesNotMatch(events, /"event":"complete"|audio_base64/);
});

test('an interrupted Kitten stream neither synthesizes nor emits completion', async () => {
  writeProfile('kitten-fixture', kittenVoiceConfig());
  const controller = new AbortController();
  controller.abort();
  const response = await handleTtsStream({ method: 'POST', signal: controller.signal,
    body: { text: 'Hello! Never synthesize canceled text.', provider: 'kitten' },
    user: { username: 'kitten-fixture', isAuthenticated: true, role: 'owner' },
  } as any);
  let events = '';
  for await (const event of response.stream!) events += event;
  assert.equal(events, '');
  assert.equal(requests.length, 0);
});
