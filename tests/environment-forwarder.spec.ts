import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const launcher = new URL('../bin/connect-environment', import.meta.url).pathname;

test('desktop forwarder passes hostname and loopback port to cloudflared', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-environment-forwarder-'));
  try {
    const executable = path.join(directory, 'cloudflared');
    fs.writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${directory}:${process.env.PATH}` };
    for (const [args, port] of [
      [['bridge.ainek.io'], '18790'],
      [['bridge.ainek.io', '19234'], '19234'],
    ] as const) {
      const result = spawnSync('bash', [launcher, ...args], { env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes(`ws://127.0.0.1:${port}/environment`));
      assert.ok(result.stdout.endsWith(`access\ntcp\n--hostname\nbridge.ainek.io\n--url\n127.0.0.1:${port}\n`));
    }
    fs.writeFileSync(executable, '#!/bin/sh\necho "fixture Cloudflare failure" >&2\nexit 23\n');
    const failed = spawnSync('bash', [launcher, 'bridge.ainek.io'], { env, encoding: 'utf8' });
    assert.equal(failed.status, 23);
    assert.match(failed.stderr, /fixture Cloudflare failure/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('usage does not launch a connector and missing arguments report failure', () => {
  const help = spawnSync('bash', [launcher, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:/);
  const missing = spawnSync('bash', [launcher], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
});
