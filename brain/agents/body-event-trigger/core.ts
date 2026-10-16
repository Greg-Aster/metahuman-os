import { cognitiveGraphPath, getTargetUser, loadGraphFile, runGraph, withUserContext,
  getLatestEnvironmentObservation } from '@metahuman/core'
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'
import { randomUUID } from 'node:crypto'

export async function runEventTrigger(username?: string, observation?: any, request?: string, signal?: AbortSignal) {
  const target = getTargetUser(username ? { username } : undefined)
  if (!target) throw new Error('Body Event Trigger requires an authorized user')
  const source = observation ?? getLatestEnvironmentObservation()
  if (!source) throw new Error('Body Event Trigger requires a robot observation')
  if (!observation && !request) throw new Error('Supply a body event or an explicit request')
  const incoming = observation ?? { ...source, text: [], state: { ...source.state,
    bodyEvent: { name: 'body_event', event_id: randomUUID(), robot_id: source.state?.body?.robotId,
      data: { kind: 'request', source: 'user', request } } } }
  const loaded = await loadGraphFile(cognitiveGraphPath('body-event-trigger-mode.json'))
  if (!loaded) throw new Error('Body Event Trigger workflow is missing')
  return withUserContext({ userId: target.userId, username: target.username, role: target.role }, async () => {
    const state = await runGraph({ graph: loaded.graph, signal, context: {
      username: target.username, userId: target.userId, cognitiveMode: 'environment',
      environmentObservation: incoming, environmentObservationCurrent: true,
      userMessage: '', abortSignal: signal,
    } })
    if (state.status === 'failed') throw state.error ?? new Error('Body Event Trigger failed')
    return { executionId: state.executionId, status: state.status }
  })
}

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const start = Date.now()
  try {
    const options = input.options ?? {}
    const data = await runEventTrigger(ctx.username, options.observation,
      typeof options.taskBrief === 'string' ? options.taskBrief : input.args?.join(' '), ctx.signal)
    return { success: true, data, duration: Date.now() - start }
  } catch (error) { return { success: false, error: (error as Error).message, duration: Date.now() - start } }
}
