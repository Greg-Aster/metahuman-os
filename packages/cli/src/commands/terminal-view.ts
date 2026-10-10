import readline from 'node:readline'
import { terminalRequest, terminalCall } from '@metahuman/core/terminal'
import type { TerminalEvent, DiagnosticReceipt } from '@metahuman/core/terminal/types'

/** Native terminal display/input only. The Terminal service owns all Codex work. */
export async function terminalView(id: string): Promise<void> {
  const response = await terminalRequest(`/events?id=${encodeURIComponent(id)}`)
  if (response.statusCode !== 200) {
    let body = ''
    for await (const chunk of response) body += chunk
    throw new Error(`Cannot attach diagnostic terminal: ${body}`)
  }
  response.setEncoding('utf8')
  const input = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' })
  let closedByOwner = false
  const close = () => { response.destroy() }
  input.on('line', line => {
    if (!line.trim()) { input.prompt(); return }
    void terminalCall<DiagnosticReceipt>('/diagnostic-input', { id, message: line }).then(receipt => {
      process.stdout.write(`\nSubmitted ${receipt.submissionId}\n`)
      input.prompt()
    }, error => { process.stderr.write(`\n${error.message}\n`); input.prompt() })
  })
  input.once('close', close)
  process.once('SIGTERM', close)
  process.once('SIGHUP', close)
  let buffered = ''
  try {
    process.stdout.write('Big Brother · Codex diagnostics\nType a follow-up and press Enter. Closing this window stops this session.\n')
    for await (const chunk of response) {
      buffered += chunk
      let end: number
      while ((end = buffered.indexOf('\n\n')) >= 0) {
        const frame = buffered.slice(0, end); buffered = buffered.slice(end + 2)
        if (!frame.startsWith('data: ')) continue
        const event: TerminalEvent = JSON.parse(frame.slice(6))
        if (event.type === 'error') throw new Error(event.error)
        if (event.type === 'state' && !event.state.sessions.some(session => session.id === id)) {
          closedByOwner = true
          return
        }
        if ((event.type === 'screen' || event.type === 'output') && event.id === id) {
          process.stdout.write(event.data)
          input.prompt(true)
        }
      }
    }
  } finally {
    input.off('close', close)
    input.close()
    response.destroy()
    process.off('SIGTERM', close)
    process.off('SIGHUP', close)
    if (!closedByOwner) await terminalCall('/close', { id })
  }
}
