/** Terminal-only presentation. Model results and saved evidence remain plain text. */
const paint = (code: string, text: string) => `\x1b[${code}m${text}\x1b[0m`

export function terminalHeading(text: string, tone: 'info' | 'success' | 'error' = 'info'): string {
  return `\r\n${paint(tone === 'error' ? '1;31' : tone === 'success' ? '1;32' : '1;36', text)}\r\n`
}

function inline(text: string): string {
  return text.replace(/`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, code, bold, label, target) => code !== undefined ? paint('36', code)
      : bold !== undefined ? paint('1', bold) : `${paint('4;36', label)} ${paint('2', `(${target})`)}`)
}

function markdown(text: string): string {
  let fence: string | undefined
  return text.split(/\r?\n/).map(line => {
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/)
    if (marker && (!fence || marker[1][0] === fence[0] && marker[1].length >= fence.length)) {
      fence = fence ? undefined : marker[1]
      return paint('2', line)
    }
    if (fence) return paint(line.startsWith('+') ? '32' : line.startsWith('-') ? '31' : '36', line)
    const heading = line.match(/^#{1,6}\s+(.+)$/)
    return heading ? paint('1;36', heading[1]) : inline(line)
  }).join('\r\n')
}

export function formatProviderDisplay(provider: string, lines: string[]): string {
  return lines.map(text => {
    const [first, ...rest] = text.split(/\r?\n/)
    const body = rest.length ? `${rest.join('\r\n')}\r\n` : ''
    if (first.startsWith('$ ') || first.startsWith('🔧 ')) {
      return `\r\n${paint('1;33', first)}\r\n${body}`
    }
    if (first.startsWith('💭 ')) {
      return `\r\n${paint('1;35', 'Reasoning')}\r\n${markdown(text.slice(3))}\r\n`
    }
    if (first.startsWith('❌ ')) return terminalHeading(text, 'error')
    if (/^\[(Codex|Claude)\]/.test(first)) {
      return `\r\n${paint(/Completed/.test(first) ? '1;32' : '2', first)}\r\n${body}`
    }
    if (first.startsWith('↳ ')) return `${paint('2', first)}\r\n${body}`
    return `\r\n${paint('1;36', provider)}\r\n${markdown(text)}\r\n`
  }).join('')
}
