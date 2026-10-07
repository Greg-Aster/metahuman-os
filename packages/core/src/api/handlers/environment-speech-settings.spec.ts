import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { UnifiedRequest } from '../types.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-speech-output-'));
process.env.METAHUMAN_ROOT = root;
process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'speech-fixture-token';
globalThis.fetch = async () => { throw new Error('Speech preference tests prohibit network'); };
const { ROOT, getProfilePaths } = await import('../../path-builder.js');
assert.equal(ROOT, root);
const { setAuditEnabled } = await import('../../audit.js');
setAuditEnabled(false);
const { eventBus } = await import('../../infrastructure/event-bus/client.js');
eventBus.disconnect();
const { createUser } = await import('../../users.js');
const { beginAuthenticatedRuntime, createSession, selectAuthenticatedSession } = await import('../../sessions.js');
const { handleEnvironmentBridgeSpeechSettings } = await import('./environment-bridge.js');
const { handleSaveVoiceSettings } = await import('./voice-settings.js');
const { getSpeechOutputSettings } = await import('../../tts/robot-speech.js');
const owner = createUser('speech-owner', 'fixture-password', 'owner');
beginAuthenticatedRuntime();
const session = createSession(owner.id, 'owner');
const request = (body = {}, token = 'speech-fixture-token'): UnifiedRequest => ({
  path: '/api/environment-bridge/speech-settings', method: 'POST', body,
  headers: { authorization: `Bearer ${token}` },
  user: { userId: '', username: '', role: 'guest', isAuthenticated: false },
});

test('bridge requires its service token and the authenticated owner before accessing preferences', async () => {
  assert.equal((await handleEnvironmentBridgeSpeechSettings(request({}, 'wrong'))).status, 401);
  assert.equal((await handleEnvironmentBridgeSpeechSettings(request())).status, 409);
  selectAuthenticatedSession(session.id);
  assert.equal((await handleEnvironmentBridgeSpeechSettings(request({ outputTarget: 'invalid' }))).status, 400);
});

test('Body Control and Voice Settings share one saved destination and preserve other preferences', async () => {
  selectAuthenticatedSession(session.id);
  let response = await handleEnvironmentBridgeSpeechSettings(request());
  assert.equal(response.status, 200);
  const filename = getProfilePaths(owner.username).voiceConfig;
  const original = JSON.parse(fs.readFileSync(filename, 'utf8'));
  original.tts.provider = 'kokoro';
  original.tts.kokoro.voice = 'af_heart';
  original.tts.robotVolumePercent = 23;
  fs.writeFileSync(filename, JSON.stringify(original));
  for (const target of ['robot', 'local']) {
    response = await handleEnvironmentBridgeSpeechSettings(request({ outputTarget: target, username: 'ignored-other-user' }));
    assert.equal(response.status, 200);
    assert.equal(response.data.outputTarget, target);
    assert.equal(response.data.username, owner.username);
    assert.equal(getSpeechOutputSettings(owner.username).outputTarget, target);
    assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')), {
      ...original, tts: { ...original.tts, outputTarget: target },
    });
    assert.equal((await handleEnvironmentBridgeSpeechSettings(request())).data.outputTarget, target);
  }
  const saved = await handleSaveVoiceSettings({ ...request({ outputTarget: 'robot' }),
    user: { userId: owner.id, username: owner.username, role: 'owner', isAuthenticated: true } });
  assert.equal(saved.status, 200);
  assert.equal((await handleEnvironmentBridgeSpeechSettings(request())).data.outputTarget, 'robot');
});

test.after(() => { eventBus.disconnect(); });
