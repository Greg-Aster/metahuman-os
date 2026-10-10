import { submitBigBrotherDiagnostic } from '../../terminal/client.js'
import { ROOT, systemPaths } from '../../path-builder.js'
import path from 'node:path'
import type { DiagnosticRequest } from '../../terminal/types.js'
import { defineNode, type NodeExecutionContext } from '../types.js'
import { bigBrotherSchema } from './big-brother.schema.js'

export function buildBigBrotherDiagnostic(
  inputs: Record<string, unknown>, context: NodeExecutionContext, properties?: Record<string, any>,
): DiagnosticRequest {
  return {
    prompt: properties?.prompt ?? bigBrotherSchema.properties.prompt,
    model: properties?.model || undefined,
    reasoning: properties?.reasoning ?? true,
    username: context.username,
    data: Object.fromEntries(bigBrotherSchema.inputs.filter(slot => Object.hasOwn(inputs, slot.name))
      .map(slot => [slot.name, inputs[slot.name]])),
    source: {
      graphExecutionId: context.graphExecution?.executionId,
      occurrenceId: context.graphExecution?.occurrenceId,
      graphNode: context.graphNode,
      originalRequest: context.userMessage,
      originalEntry: context.userMessageEntry,
      instructionSource: context.instructionSource,
      sessionId: context.sessionId,
      locations: {
        workspace: ROOT,
        systemReference: path.join(ROOT, 'docs/technical/BIG_BROTHER.md'),
        serverLog: path.join(systemPaths.logs, 'server.log'),
        graphTraces: path.join(systemPaths.logs, 'graph-traces.ndjson'),
        agentLogs: systemPaths.runAgents,
        executionStorageOwner: path.join(ROOT, 'packages/core/src/durable-execution/storage.ts'),
      },
    },
  }
}

export const bigBrotherNode = defineNode({
  ...bigBrotherSchema,
  async execute(inputs, context, properties) {
    return submitBigBrotherDiagnostic(buildBigBrotherDiagnostic(inputs, context, properties))
  },
})
