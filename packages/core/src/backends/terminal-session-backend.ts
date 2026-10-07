import type {
  EscalationBackend,
  EscalationOptions,
  EscalationResult,
} from '../escalation-backend.js'
import {
  getBigBrotherSessionState,
  startTerminalService,
  stopBigBrotherSession,
  executeInBigBrotherSession,
} from '../terminal/client.js'
import { isTerminalBigBrotherProviderInstalled, type TerminalBigBrotherProvider } from '../terminal/providers/cli.js'

interface TerminalBackendDefinition {
  id: TerminalBigBrotherProvider
  name: string
  description: string
}

export function createTerminalSessionBackend(definition: TerminalBackendDefinition): EscalationBackend {
  let ready = false

  return {
    ...definition,
    supportsStreaming: true,

    async isAvailable(): Promise<boolean> {
      return isTerminalBigBrotherProviderInstalled(definition.id)
    },

    isReady(): boolean {
      return ready
    },

    async start(): Promise<boolean> {
      if (!await this.isAvailable()) return false
      await startTerminalService()
      ready = true
      return ready
    },

    async stop(): Promise<void> {
      ready = false
      if ((await getBigBrotherSessionState()).provider === definition.id) {
        await stopBigBrotherSession()
      }
    },

    async execute(prompt: string, options?: EscalationOptions): Promise<EscalationResult> {
      return executeInBigBrotherSession(definition.id, prompt, options)
    },

    async *executeStreaming(
      prompt: string,
      options?: EscalationOptions,
    ): AsyncGenerator<string, EscalationResult, unknown> {
      const result = await executeInBigBrotherSession(definition.id, prompt, options)
      if (result.success && result.output) yield result.output
      return result
    },
  }
}
