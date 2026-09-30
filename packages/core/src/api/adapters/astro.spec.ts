import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const compiled = ts.transpileModule(fs.readFileSync(new URL('./astro.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function adapter(stream: (signal: AbortSignal) => AsyncIterable<string>) {
  const exports: Record<string, any> = {}
  vm.runInNewContext(compiled, {
    exports, Buffer, AbortController, AbortSignal, ReadableStream, TextEncoder, Response, console,
    require: (name: string) => {
      assert.equal(name, './http.js')
      return { handleHttpRequest: async ({ signal }: { signal: AbortSignal }) => ({
        status: 200, isStreaming: true, stream: stream(signal), cookies: [], headers: { 'Content-Type': 'text/event-stream' },
      }) }
    },
  })
  return exports.astroHandler
}
function context() {
  return { request: new Request('http://localhost/api/terminal/events'), url: new URL('http://localhost/api/terminal/events'), params: {} }
}

test('HTTP body cancellation aborts and releases a quiet upstream stream', async () => {
  let released = false
  let aborted = false
  const handle = adapter(async function* (signal) {
    try {
      yield 'data: ready\n\n'
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve() }, { once: true }))
    } finally { released = true }
  })
  const response: Response = await handle(context())
  const reader = response.body!.getReader()
  await reader.read()
  await new Promise(resolve => setImmediate(resolve))
  await reader.cancel()
  assert.equal(aborted, true)
  assert.equal(released, true)
})

test('a slow browser applies backpressure instead of draining all terminal output', async () => {
  let reads = 0
  const handle = adapter(async function* () { for (let i = 0; i < 1000; i++) { reads++; yield `data: ${i}\n\n` } })
  const response: Response = await handle(context())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 1, 'only the bounded stream queue should fill before a consumer reads')
  await response.body!.cancel()
})
