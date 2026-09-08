import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const source = fs.readFileSync(new URL('../start.sh', import.meta.url), 'utf8')

function definition(name: string): string {
  const match = source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'))
  assert.ok(match, `Missing launcher function: ${name}`)
  return match[0]
}

function runShell(names: string[], mocks: string, body: string) {
  return spawnSync('bash', ['--noprofile', '--norc'], {
    input: `set -euo pipefail\nREPO_ROOT=/fixture/metahuman\n${names.map(definition).join('\n')}\n${mocks}\n${body}`,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
    timeout: 5_000,
  })
}

test('launcher process lookup distinguishes absence from failure', () => {
  for (const status of [1, 2, 3]) {
    const result = runShell(['matching_repo_pids', 'kill_pattern_fast'], `
pgrep() { [ ${status} -eq 1 ] || printf 'lookup failed\\n' >&2; return ${status}; }
is_repo_process() { return 0; }
kill_pids() { printf 'unexpected signal\\n'; exit 99; }
`, 'kill_pattern_fast absent-service\nprintf "continued\\n"')
    assert.equal(result.error, undefined)
    assert.equal(result.status, status === 1 ? 0 : status)
    assert.equal(result.stdout, status === 1 ? 'continued\n' : '')
    assert.equal(result.stderr, status === 1 ? '' : 'lookup failed\n')
  }
})

test('launcher process lookup retains repository filtering', () => {
  const result = runShell(['matching_repo_pids', 'is_repo_process'], `
pgrep() { printf '41001\\n41002\\n'; }
process_command() {
  if [ "$1" = 41001 ]; then printf '%s/worker' "$REPO_ROOT"; else printf '/other/worker'; fi
}
process_cwd() { printf '/elsewhere'; }
`, 'matching_repo_pids worker')
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '41001\n')
})

// Execute the actual cleanup and trap definitions. Only process/service effects
// are mocked; no installed services, profile data, or runtime files are touched.
for (const [trigger, status] of [
  ['exit 0', 0],
  ['kill -s INT "$$"', 130],
  ['kill -s TERM "$$"', 143],
  ['kill -s HUP "$$"', 143],
  ['cleanup; cleanup', 0],
] as const) {
  test(`launcher completes shutdown once through ${trigger}`, () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-shutdown-'))
    try {
      const traps = source.split('\n').filter(line => line.startsWith('trap ')).join('\n')
      const result = runShell([
        'matching_repo_pids', 'is_repo_process', 'kill_pattern_fast', 'cleanup',
      ], `
STARTED=true
CLEANING_UP=false
RUN_LOG_DIR=${JSON.stringify(fixture)}
print_warning() { printf '%s\\n' "$1"; }
print_status() { printf '%s\\n' "$1"; }
pgrep() {
  if [ "$3" = packages/core/src/agent-bootstrap.ts ]; then printf '41001\\n41002\\n'; else return 1; fi
}
process_command() {
  if [ "$1" = 41001 ]; then printf '%s/worker' "$REPO_ROOT"; else printf '/other/worker'; fi
}
process_cwd() { printf '/elsewhere'; }
kill_pids() { printf 'signal %s %s\\n' "$2" "$1"; }
sleep() { :; }
live_pids() { :; }
run_with_timeout() { printf 'service %s\\n' "$*"; }
rm() { :; }
clean_stale_runtime_files() { printf 'runtime cleanup\\n'; }
release_start_lock() { :; }
`, `${traps}\n${trigger}`)
      assert.equal(result.error, undefined)
      assert.equal(result.status, status, result.stderr)
      const log = fs.readFileSync(path.join(fixture, 'startup-shutdown.log'), 'utf8')
      assert.equal(log.match(/startup cleanup begin/g)?.length, 1)
      assert.equal(log.match(/startup cleanup complete/g)?.length, 1)
      assert.match(log, /agent stop --all/)
      assert.match(log, /signal TERM 41001/)
      assert.doesNotMatch(log, /signal \w+ 41002/)
      assert.match(log, /stop-local-models/)
      assert.match(log, /stop-voice-server/)
      assert.match(log, /stop-event-bus/)
      assert.match(log, /runtime cleanup/)
      assert.match(result.stdout, /MetaHuman services stopped/)
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true })
    }
  })
}
