import type {
  EscalationBackend,
  EscalationOptions,
  EscalationResult,
} from '../escalation-backend.js'
import {
  bigBrotherSession,
  executeInBigBrotherSession,
  isTerminalBigBrotherProviderInstalled,
  type TerminalBigBrotherProvider,
} from '../big-brother-session.js'

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
      ready = await this.isAvailable()
      return ready
    },

    stop(): void {
      ready = false
      if (bigBrotherSession.getState().provider === definition.id) {
        void bigBrotherSession.stop(`${definition.name} backend stopped`)
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
