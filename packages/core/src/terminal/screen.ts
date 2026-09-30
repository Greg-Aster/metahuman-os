import headless from '@xterm/headless'
import serialize from '@xterm/addon-serialize'

/** A bounded, parsed screen. Slow viewers reconnect to a snapshot, never an output log. */
export class TerminalScreen {
  private terminal: InstanceType<typeof headless.Terminal>
  private serializer = new serialize.SerializeAddon()
  private pending: Promise<void> = Promise.resolve()
  constructor(cols: number, rows: number) {
    this.terminal = new headless.Terminal({ cols, rows, scrollback: 2000, allowProposedApi: true })
    this.terminal.loadAddon(this.serializer)
  }
  write(data: string): Promise<void> {
    this.pending = this.pending.then(() => new Promise<void>(resolve => this.terminal.write(data, resolve)))
    return this.pending
  }
  async snapshot(): Promise<string> {
    await this.pending
    return this.serializer.serialize()
  }
  resize(cols: number, rows: number): void { this.terminal.resize(cols, rows) }
  dispose(): void { this.terminal.dispose() }
}
