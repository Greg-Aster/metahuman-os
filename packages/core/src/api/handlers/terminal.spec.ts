import assert from 'node:assert/strict'
import * as net from 'node:net'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findAvailableTerminalPort,
  isTerminalPortInUse,
  parseTtydProcesses,
} from './terminal.js'

const parsed = parseTtydProcesses([
  '35057 /repo/bin/ttyd --port 3001 --writable --cwd /repo bash -c ./bin/start-services',
  '35112 /repo/bin/ttyd --interface 127.0.0.1 --port 3002 --writable --cwd /repo bash',
  '99999 unrelated process',
].join('\n'))

assert.deepEqual(parsed, [
  {
    pid: 35057,
    port: 3001,
    command: './bin/start-services',
    cwd: '/repo',
  },
  {
    pid: 35112,
    port: 3002,
    command: undefined,
    cwd: '/repo',
  },
])

const checkedPorts: number[] = []
const nextPort = await findAvailableTerminalPort(
  new Set([3001]),
  async port => {
    checkedPorts.push(port)
    return port === 3002
  },
)
assert.equal(nextPort, 3003)
assert.deepEqual(checkedPorts, [3002, 3003])

assert.equal(
  await findAvailableTerminalPort(
    new Set(Array.from({ length: 10 }, (_, index) => 3001 + index)),
    async () => false,
  ),
  null,
)

const server = net.createServer()
await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})

const address = server.address()
assert(address && typeof address === 'object')
assert.equal(await isTerminalPortInUse(address.port), true)

await new Promise<void>((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve())
})
assert.equal(await isTerminalPortInUse(address.port, '127.0.0.1', 100), false)

const componentPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../apps/site/src/components/TerminalManager.svelte',
)
const componentSource = await import('node:fs/promises').then(fs => fs.readFile(componentPath, 'utf8'))

assert.match(componentSource, /src=\{terminalFrameUrl\(tab\)\}/)
assert.doesNotMatch(
  componentSource,
  /\{#if tab\.id === activeTabId\}\s*\{#if tab\.isEventBus\}/,
  'terminal iframe must remain mounted when its tab becomes inactive',
)
assert.match(componentSource, /createNewTerminal\('default-shell'\)/)
assert.match(componentSource, /purpose: 'services'/)
assert.match(componentSource, /body: JSON\.stringify\(\{ action: 'stop' \}\)/)
assert.match(componentSource, /watchBigBrother/)

console.log('terminal lifecycle contract passed')
