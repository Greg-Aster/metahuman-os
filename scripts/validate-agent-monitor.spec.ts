import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);

function snapshot(root: string) {
  return fs.readdirSync(root, { recursive: true }).sort().map(entry => {
    const name = String(entry);
    const file = path.join(root, name);
    return [name, fs.statSync(file).isFile() ? fs.readFileSync(file, 'base64') : null];
  });
}

test('Agent Monitor validation preserves the configured installation and cleans its fixtures', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-monitor-isolation-'));
  const installation = path.join(fixture, 'installation');
  const scratch = path.join(fixture, 'scratch');
  fs.mkdirSync(path.join(installation, 'etc'), { recursive: true });
  fs.mkdirSync(scratch);
  fs.writeFileSync(path.join(installation, 'etc', 'services.json'), '{"services":{}}\n');
  const before = snapshot(installation);
  const writes: string[] = [];
  const watcher = fs.watch(installation, { recursive: true }, (event, file) => writes.push(`${event}:${file}`));
  try {
    let failure: unknown;
    const env: NodeJS.ProcessEnv = { ...process.env, METAHUMAN_ROOT: installation, TMPDIR: scratch, TSX_DISABLE_CACHE: '1' };
    // A plain validator subprocess must not inherit the test runner's IPC protocol.
    delete env.NODE_TEST_CONTEXT;
    try {
      const { stdout, stderr } = await exec(process.execPath, [
        '--import', 'tsx', path.join(repoRoot, 'scripts', 'validate-agent-monitor.ts'),
      ], {
        cwd: repoRoot,
        env,
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      process.stdout.write(stdout);
      process.stderr.write(stderr);
      assert.match(stdout, /Agent Monitor validation passed: \d+\/\d+ checks/);
    } catch (error) {
      failure = error;
    }
    assert.deepEqual(snapshot(installation), before, 'validation must not write to the configured installation');
    assert.deepEqual(writes, [], 'even writes that are later restored can interfere with a running installation');
    assert.deepEqual(fs.readdirSync(scratch), [], 'validation must remove its temporary state even on failure');
    if (failure) throw failure;
  } finally {
    watcher.close();
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
