import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-connection-modes-'));
process.env.METAHUMAN_ROOT = fixture;
fs.mkdirSync(path.join(fixture, 'etc'), { recursive: true });
fs.mkdirSync(path.join(fixture, 'bin'), { recursive: true });
const credentialFile = path.join(fixture, 'access.env');
fs.writeFileSync(credentialFile, 'TUNNEL_SERVICE_TOKEN_ID=fixture-id\nTUNNEL_SERVICE_TOKEN_SECRET=fixture-secret\n', { mode: 0o600 });
fs.writeFileSync(path.join(fixture, 'etc/services.json'), JSON.stringify({ services: {
  'environment-bridge-local': { adapterUrl: 'ws://127.0.0.1:8790/environment' },
  'environment-bridge-remote': { adapterUrl: 'ws://127.0.0.1:18790/environment',
    cloudflareHostname: 'fixture.invalid', accessEnvFile: credentialFile },
} }));
fs.writeFileSync(path.join(fixture, 'bin/fixture.mjs'), `
import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(path.join(fixture, 'forwarder.json'))}, JSON.stringify({
  pid: process.pid, args: process.argv.slice(2),
  id: process.env.TUNNEL_SERVICE_TOKEN_ID, secret: process.env.TUNNEL_SERVICE_TOKEN_SECRET,
}));
setInterval(() => {}, 1000);
`);
fs.writeFileSync(path.join(fixture, 'bin/connect-environment'), `#!/bin/sh\nexec '${process.execPath}' '${path.join(fixture, 'bin/fixture.mjs')}' "$@"\n`, { mode: 0o700 });
process.env.MH_ENVIRONMENT_ADAPTER_URL = 'ws://old-shared.invalid/environment';
process.env.MH_ENVIRONMENT_ADAPTER_TOKEN = 'fixture-adapter';
process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'fixture-core';
const { readConfig } = await import('./core.js');
const { runCloudflareForwarder } = await import('./cloudflare.js');

async function forwarder(): Promise<{ pid: number; args: string[]; id: string; secret: string }> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (fs.existsSync(path.join(fixture, 'forwarder.json'))) return JSON.parse(fs.readFileSync(path.join(fixture, 'forwarder.json'), 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Fixture forwarder did not start');
}

test('separate adapter settings ignore the obsolete shared endpoint override', () => {
  assert.equal(readConfig('environment-bridge-local').adapterUrl, 'ws://127.0.0.1:8790/environment');
  assert.equal(readConfig('environment-bridge-remote').adapterUrl, 'ws://127.0.0.1:18790/environment');
});

test('Remote owns the forwarder, supplies private machine auth, and stops it on agent stop', async () => {
  const controller = new AbortController();
  let pid = 0;
  await runCloudflareForwarder(readConfig('environment-bridge-remote').adapterUrl, controller, async () => {
    const current = await forwarder();
    pid = current.pid;
    assert.deepEqual(current.args, ['fixture.invalid', '18790']);
    assert.equal(current.id, 'fixture-id');
    assert.equal(current.secret, 'fixture-secret');
    controller.abort();
  });
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('Remote reports forwarder failure rather than claiming a working agent', async () => {
  fs.unlinkSync(path.join(fixture, 'forwarder.json'));
  const controller = new AbortController();
  await assert.rejects(runCloudflareForwarder(readConfig('environment-bridge-remote').adapterUrl, controller, async () => {
    const current = await forwarder();
    process.kill(current.pid, 'SIGTERM');
    await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
  }), /Cloudflare forwarder exited/);
});

test.after(() => { fs.rmSync(fixture, { recursive: true, force: true }); });
