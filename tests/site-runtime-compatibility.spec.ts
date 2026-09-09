import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Run against a real isolated Astro build, not a separately compiled substitute:
// MH_TEST_SITE_BUILD=/tmp/.../site node --import tsx tests/site-runtime-compatibility.spec.ts
test('compiled startup checker verifies source identity and actual selected node contracts', () => {
  assert.ok(process.env.MH_TEST_SITE_BUILD, 'Supply the actual built Site directory in MH_TEST_SITE_BUILD')
  const checker = path.resolve(process.env.MH_TEST_SITE_BUILD, 'server/check-runtime.mjs')
  assert.ok(fs.existsSync(checker), 'The Site build must contain its compiled checker')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-compiled-contract-'))
  try {
    for (const relative of ['packages/core/src', 'packages/agent-runtime/src', 'packages/core/package.json',
      'packages/agent-runtime/package.json', 'pnpm-lock.yaml', 'etc/cognitive-graphs']) {
      fs.cpSync(path.join(root, relative), path.join(fixture, relative), { recursive: true })
    }
    const check = () => spawnSync(process.execPath, [checker, fixture], {
      env: { ...process.env, METAHUMAN_ROOT: fixture }, encoding: 'utf8', timeout: 10_000,
    })
    const matching = check()
    assert.equal(matching.status, 0, matching.stdout + matching.stderr)
    assert.match(matching.stdout, /Runtime verified: compiled core matches source/)
    const implementation = path.join(fixture, 'packages/core/src/nodes/utility/execution-context.node.ts')
    const original = fs.readFileSync(implementation, 'utf8')
    fs.appendFileSync(implementation, '\n// Test deployment has newer source than its compiled runtime.\n')
    const stale = check()
    assert.equal(stale.status, 1)
    assert.match(stale.stderr, /does not match current source/)
    fs.writeFileSync(implementation, original)
    const graphFile = path.join(fixture, 'etc/cognitive-graphs/robot-autonomy-controller-mode.json')
    const savedGraph = fs.readFileSync(graphFile, 'utf8')
    const invalid = JSON.parse(savedGraph)
    invalid.edges.find((edge: any) => edge.data?.when).data.when.output = 'not_in_compiled_contract'
    fs.writeFileSync(graphFile, JSON.stringify(invalid))
    const incompatible = check()
    assert.equal(incompatible.status, 1)
    assert.match(incompatible.stderr, /undeclared output.*not_in_compiled_contract/)
    // Runtime selection, including a valid custom override, remains unchanged.
    fs.mkdirSync(path.join(fixture, 'etc/cognitive-graphs/custom'), { recursive: true })
    fs.writeFileSync(path.join(fixture, 'etc/cognitive-graphs/custom/robot-autonomy-controller-mode.json'), savedGraph)
    const overridden = check()
    assert.equal(overridden.status, 0, overridden.stdout + overridden.stderr)
  } finally { fs.rmSync(fixture, { recursive: true, force: true }) }
})
