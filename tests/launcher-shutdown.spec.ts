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

test('launcher verifies the compiled runtime before starting any services', () => {
  assert.ok(source.indexOf('\nverify_site_runtime\n') < source.indexOf('"Starting background services"'))
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-launch-check-'))
  try {
    const entry = path.join(fixture, 'entry.mjs')
    const checker = path.join(fixture, 'check-runtime.mjs')
    fs.writeFileSync(entry, '')
    const mocks = `
SERVER_ENTRY=${JSON.stringify(entry)}
RUNTIME_CHECK=${JSON.stringify(checker)}
print_error() { printf '%s\\n' "$*" >&2; }
`
    const missing = runShell(['verify_site_runtime'], mocks, 'verify_site_runtime\necho services-started')
    assert.equal(missing.status, 1)
    assert.doesNotMatch(missing.stdout, /services-started/)
    for (const status of [1, 0]) {
      fs.writeFileSync(checker, `if (process.argv[2] !== '/fixture/metahuman') process.exit(99); process.exit(${status})`)
      const checked = runShell(['verify_site_runtime'], mocks, 'verify_site_runtime\necho services-started')
      assert.equal(checked.status, status)
      assert.equal(checked.stdout.includes('services-started'), status === 0)
    }
  } finally { fs.rmSync(fixture, { recursive: true, force: true }) }
})

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

test('application restart replaces the web child repeatedly without service lifecycle calls', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-app-restart-'))
  try {
    const entry = path.join(fixture, 'server.cjs')
    const count = path.join(fixture, 'starts')
    fs.writeFileSync(entry, `const fs=require('node:fs'); const file=${JSON.stringify(count)};
const n=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8'))+1:1;fs.writeFileSync(file,String(n));
if(n<3){process.on('SIGTERM',()=>process.exit(0));setTimeout(()=>process.kill(process.ppid,'SIGUSR1'),30);setInterval(()=>{},1000)}else process.exit(42);`)
    const result = runShell(['run_web_server', 'request_app_restart'], `
APP_RESTART=false
WEB_PID=''
SERVER_ENTRY=${JSON.stringify(entry)}
SERVER_LOG=${JSON.stringify(path.join(fixture, 'server.log'))}
verify_site_runtime() { printf 'verified\\n'; }
print_status() { printf '%s\\n' "$*"; }
trap request_app_restart USR1
`, 'run_web_server')
    assert.equal(result.error, undefined)
    assert.equal(result.status, 42, result.stderr)
    assert.equal(fs.readFileSync(count, 'utf8'), '3')
    assert.equal(result.stdout.match(/verified/g)?.length, 2)
    assert.equal(result.stdout.match(/Restarting application/g)?.length, 2)
  } finally { fs.rmSync(fixture, { recursive: true, force: true }) }
})

test('application-only shutdown does not stop background services', () => {
  const result = runShell(['cleanup'], `
STARTED=true
CLEANING_UP=false
APP_ONLY=true
WEB_PID=''
print_status() { printf '%s\\n' "$*"; }
release_start_lock() { printf 'lock released\\n'; }
`, 'cleanup')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /background services unchanged/)
  assert.match(result.stdout, /lock released/)
})

test('a failed runtime verification leaves the existing application running', () => {
  const result = runShell(['request_app_restart'], `
APP_RESTART=false
WEB_PID=41001
verify_site_runtime() { printf 'runtime mismatch\\n' >&2; return 1; }
kill() { echo unexpected-signal; exit 99; }
`, 'request_app_restart\nprintf "%s\\n" "$APP_RESTART"')
  assert.equal(result.status, 0)
  assert.equal(result.stdout, 'false\n')
  assert.match(result.stderr, /runtime mismatch/)
})


test('llama.cpp lifecycle discovers this installation without a model list', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-llama-lifecycle-'))
  const script = new URL('../bin/llama-cpp-services', import.meta.url).pathname
  const root = path.dirname(path.dirname(script))
  const log = path.join(directory, 'calls')
  fs.writeFileSync(path.join(directory, 'systemctl'), `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_CALLS"
if [ "$TEST_ERROR" = "$2" ]; then echo 'systemd failure' >&2; exit 23; fi
case "$2" in
  list-unit-files) printf '%s\\n' 'custom-model.service static -' 'retained.service disabled -' 'unrelated.service enabled -' 'worker@.service static -';;
  show) case "$*" in *worker@.service*) exit 92;; esac
cat <<'UNITS'
Id=custom-model.service
WorkingDirectory=${root}
ExecStart={ path=${script} ; argv[]=${script} serve /binary/llama-server --model /configured.gguf ; }

Id=retained.service
WorkingDirectory=${root}
ExecStart={ path=/binary/llama-server ; argv[]=/binary/llama-server --model /old.gguf ; }

Id=unrelated.service
WorkingDirectory=/other/application
ExecStart={ path=/binary/llama-server ; argv[]=/binary/llama-server --model /other.gguf ; }
UNITS
;;
esac
`, { mode: 0o755 })
  const env = { ...process.env, PATH: `${directory}:${process.env.PATH}`, TEST_CALLS: log }
  try {
    for (const operation of ['start', 'stop']) {
      fs.writeFileSync(log, '')
      const result = spawnSync(script, [operation], { encoding: 'utf8', env })
      assert.equal(result.status, 0, result.stderr)
      const calls = fs.readFileSync(log, 'utf8').trim().split('\n')
      assert.equal(calls.at(-1), `--user ${operation} custom-model.service${operation === 'stop' ? ' retained.service' : ''}`)
    }
    for (const operation of ['list-unit-files', 'show', 'start', 'stop']) {
      const result = spawnSync(script, [operation === 'stop' ? 'stop' : 'start'], {
        encoding: 'utf8', env: { ...env, TEST_ERROR: operation },
      })
      assert.equal(result.status, 23)
      assert.match(result.stderr, /systemd failure/)
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('native router starts without weights and retains GPU, adapter and inference options', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-llama-preset-'))
  const script = new URL('../bin/llama-cpp-services', import.meta.url).pathname
  const binary = path.join(directory, 'llama-server')
  fs.writeFileSync(binary, `#!/usr/bin/env python3
import sys, json
from pathlib import Path
args = sys.argv[1:]
print(json.dumps({'args': args, 'preset': Path(args[args.index('--models-preset')+1]).read_text()}))
`, { mode: 0o755 })
  try {
    const retained = ['--port', '12345', '--gpu-layers', 'all', '--lora-scaled', '/adapter.gguf:0',
      '--ctx-size', '0', '--mmproj-on-demand', '--temp', '0.3']
    const result = spawnSync(script, ['serve', binary, '--model', '/model with spaces.gguf',
      '--alias', 'custom-model', '--mmproj', '/vision.gguf', ...retained], { encoding: 'utf8', env: { ...process.env, XDG_RUNTIME_DIR: directory } })
    assert.equal(result.status, 0, result.stderr)
    const { args, preset } = JSON.parse(result.stdout)
    assert.deepEqual(args.slice(0, retained.length), retained)
    assert.deepEqual(args.slice(retained.length, -2), ['--sleep-idle-seconds', '300'])
    assert.equal(args.includes('--model'), false)
    assert.equal(args.includes('--alias'), false)
    assert.equal(preset, 'version = 1\n\n[custom-model]\nalias = custom-model\nmodel = /model with spaces.gguf\nmmproj = /vision.gguf\nload-on-startup = false\n')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
