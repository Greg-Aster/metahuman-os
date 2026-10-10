import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-voice-ready-'));
process.env.METAHUMAN_ROOT = root;
const { ensureVoiceServiceRunning } = await import('./voice-service-manager.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; fs.rmSync(root, { recursive: true, force: true }); });

test('Kokoro startup waits for the existing loading process to become ready', async () => {
  const run = path.join(root, 'logs/run'); fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'kokoro-server.pid'), String(process.pid));
  let calls = 0;
  globalThis.fetch = async () => Response.json({ status: ++calls < 4 ? 'loading' : 'ready' });
  const status = await ensureVoiceServiceRunning('kokoro');
  assert.equal(status.healthy, true);
  assert.equal(status.readiness, 'ready');
  assert.equal(calls, 4);
  assert.equal(status.pid, process.pid, 'Loading must reuse the running service');
  globalThis.fetch = async () => Response.json({ status: 'error' });
  await assert.rejects(ensureVoiceServiceRunning('kokoro'), /failed while waiting for readiness/);
});
