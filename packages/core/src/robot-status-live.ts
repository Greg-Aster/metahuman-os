import { readEnvironmentBridgeState, summarizeEnvironmentBridgeState } from './environment-interface/store.js'
import { currentEnvironmentPerception, type EnvironmentPerception } from './environment-interface/perception.js'
import { getEnvironmentBridgeDiagnosticsSnapshot } from './environment-interface/diagnostics.js'
import { getQueueManager } from './queue/index.js'
import { openExecutionStore } from './durable-execution/storage.js'
import { ExecutionCheckpointer } from './durable-execution/checkpointer.js'

const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const age = (value: unknown, now: number): number | null => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(at) && at <= now ? now - at : null
}
const controls = (value: unknown) => Object.fromEntries(Object.entries(record(value))
  .filter(([key]) => ['type', 'command', 'name', 'gait', 'dir', 'direction', 'continuous', 'speed', 'stride', 'rate', 'forward', 'turn', 'steps'].includes(key)))

/** Read-time facts only. No writes, subscriptions, inference, or execution admission. */
export async function readRobotStatusLive(username: string, requestedSessionId?: string, now = Date.now()) {
  const bridge = readEnvironmentBridgeState()
  const sessions = summarizeEnvironmentBridgeState(bridge).sessions
  // An explicitly selected session is never replaced by another connected robot.
  const session = requestedSessionId ? sessions.find(item => item.sessionId === requestedSessionId)
    : [...sessions].sort((a, b) => Number(b.status === 'connected') - Number(a.status === 'connected')
      || b.lastSeenAt.localeCompare(a.lastSeenAt))[0]
  const observation = session?.latestObservation
  const state = record(observation?.state)
  const body = record(state.body)
  const robot = record(record(record(state.gateway).robots)[body.robotId])
  const gatewayInstance = record(state.activeMovementUpdates).gatewayInstance ?? null
  const connected = session?.status === 'connected' && robot.connection_state === 'online'
  const diagnostics = getEnvironmentBridgeDiagnosticsSnapshot().sessions.find(item => item.sessionId === session?.sessionId)
  const raw = state.perception as EnvironmentPerception | undefined
  const perception = connected ? currentEnvironmentPerception(observation, raw, now) : null
  const health = record(state.recognition)
  const metrics = diagnostics?.recognition
  const matchingMetrics = metrics?.robotId === body.robotId && metrics?.epoch === robot.epoch
    && metrics?.gatewayInstance === gatewayInstance ? metrics : undefined
  const processing = matchingMetrics && (!health.reportedAt || Date.parse(matchingMetrics.reportedAt) > Date.parse(health.reportedAt))
    ? matchingMetrics.processing : health
  const processingAt = processing === health ? health.reportedAt : matchingMetrics?.reportedAt
  const healthAge = age(processingAt, now)
  const cameraFrames = record(robot.camera_frames)
  const frameAge = number(cameraFrames.age_ms)
  const observationAge = age(observation?.timestamp, now)
  const receivingAgeMs = frameAge === null || observationAge === null ? null : frameAge + observationAge
  const enabled = typeof health.enabled === 'boolean' ? health.enabled : null
  const failure = record(observation?.metadata?.recognitionFailure)
  const failureCurrent = failure.gatewayInstance === gatewayInstance && failure.robotId === body.robotId && failure.epoch === robot.epoch
    && (!raw || Date.parse(observation!.timestamp) >= Date.parse(raw.observedAt))
  const recognitionState = !connected ? 'disconnected' : enabled === false ? 'disabled'
    : failureCurrent ? 'error' : perception ? 'fresh' : raw ? 'stale' : 'unavailable'
  const people = perception && enabled !== false && !failureCurrent
    ? perception.objects.filter(item => item.label.toLowerCase() === 'person').map(item => ({
      detectionConfidence: item.score ?? null, identity: item.identity ? {
        ...item.identity,
        ...('faceAgeMs' in item.identity ? { faceAgeMs: item.identity.faceAgeMs + (age(perception.observedAt, now) ?? 0) } : {}),
      } : null,
    })) : null
  const manager = getQueueManager()
  const work = manager.getAllTasks().filter(item => item.username === username && item.type === 'environment_command'
    && item.input.sessionId === session?.sessionId && !['speak', 'faceExpression', 'captureImage', 'sendText'].includes(String(item.input.type)))
  const store = openExecutionStore(username)
  try {
    const projected = store.projectedTask(username)
    const ids = new Set(work.filter(item => ['queued', 'leased', 'waiting'].includes(item.state)).map(item => item.durable?.executionId).filter(Boolean))
    if (projected) ids.add(projected.executionId)
    const executions = []
    for (const id of ids) {
      if (!id) continue
      const task = store.task(id)
      const reader = new ExecutionCheckpointer(store, { executionId: id, owner: 'status-read', generation: 0 })
      const saved = session ? await reader.activeBehaviorSnapshot(session.sessionId) : null
      const owned = work.filter(item => item.durable?.executionId === id)
      if (!saved && !owned.length && task?.personResume?.sessionId !== session?.sessionId) continue
      const events = store.events(id)
      const commands = store.dispatches(id).filter(effect => effect.actionId && record(record(effect.payload).input).sessionId === session?.sessionId)
        .filter(effect => !['speak', 'faceExpression', 'captureImage', 'sendText'].includes(record(record(effect.payload).input).type))
        .map(effect => {
          const input = record(record(effect.payload).input)
          const receipt = events.filter(event => event.kind === 'physical_result' && event.actionId === effect.actionId).at(-1)
          const feedback = record(record(receipt?.payload).feedback)
          const terminal = feedback.actionId === effect.actionId && ['completed', 'cancelled', 'failed', 'rejected', 'expired'].includes(feedback.type)
          const queued = owned.find(item => item.input.id === effect.actionId)
          return { actionId: effect.actionId, dispatchStatus: effect.status, commanded: controls(input),
            cancellationRequestedAt: queued?.cancellationRequestedAt ?? null,
            termination: terminal ? 'terminal_receipt' : feedback.type === 'outcome_unknown' ? 'unknown'
              : queued?.cancellationRequestedAt ? 'requested' : 'unconfirmed',
            receipt: receipt ? { eventId: receipt.eventId, type: feedback.type, timestamp: feedback.timestamp } : null }
        }).filter(command => command.termination !== 'terminal_receipt'
          || [task?.actionId, saved?.state.motionId, saved?.state.completedActionId].includes(command.actionId))
      const active = saved?.state
      const step = saved?.program.steps[active?.stepIndex ?? 0]
      const loss = active?.personLoss
      const candidateFresh = loss?.candidateFrame && loss.lastExpiresAt && loss.lastExpiresAt > now && loss.expiresAt > now
      const rec = store.get(id)
      executions.push({ executionId: id, status: rec.status, objective: task?.objective ?? null,
        behavior: active ? { stepIndex: active.stepIndex, kind: step?.kind ?? null,
          target: step?.kind === 'behavior' ? step.target : null,
          tracking: active.done ? 'ended' : loss ? candidateFresh ? 'awaiting_operator_confirmation'
            : now >= loss.expiresAt ? 'observation_window_expired' : 'lost'
            : perception ? 'observing' : 'feedback_unavailable',
          candidate: candidateFresh ? { frame: loss!.candidateFrame, identityContinuity: 'unverified' } : null,
          commanded: controls(active.action), pendingSteering: active.pendingControls?.controls ? JSON.parse(active.pendingControls.controls) : null,
          acknowledgedSteering: active.acknowledgedControls ? JSON.parse(active.acknowledgedControls) : null,
          finishRequestedAt: active.finishRequestedAt ?? null, cancellationRequestedAt: active.cancellationRequestedAt ?? null } : null,
        commands, unresolvedActionIds: commands.filter(command => command.termination !== 'terminal_receipt').map(command => command.actionId),
        ownership: owned.filter(item => item.bodyLease).map(item => ({ actionId: item.input.id,
          lease: item.bodyLease, currentCoordinatorOwner: manager.hasCurrentBodyLease(item.id) })),
      })
    }
    return {
      readAt: new Date(now).toISOString(), sessionId: session?.sessionId ?? requestedSessionId ?? null,
      robotId: body.robotId ?? null, gatewayInstance, epoch: robot.epoch ?? null,
      connection: session?.status ?? 'unavailable', sourceObservationAt: observation?.timestamp ?? null,
      camera: { enabled: null, ready: typeof body.cameraReady === 'boolean' ? body.cameraReady : null,
        receivingFrames: connected && receivingAgeMs !== null && number(health.maxFrameAgeMs) !== null
          ? receivingAgeMs < health.maxFrameAgeMs : null, lastFrameAgeMs: receivingAgeMs, receivedFrames: number(cameraFrames.received), frameCounter: cameraFrames.counter ?? null },
      recognition: { enabled, status: recognitionState, observedAt: raw?.observedAt ?? null,
        observationAgeMs: age(raw?.observedAt, now), expiresAt: raw?.expiresAt ?? null,
        processingReportedAt: processingAt ?? null, processingAgeMs: healthAge,
        processedFps: number(processing.processedFps), freshResultsPerSecond: number(processing.freshFps),
        rateBasis: 'since_first_frame', rateScope: 'gateway_recognition_worker', receivedFrames: number(processing.receivedFrames), errors: number(processing.errors),
        inferenceMs: number(processing.inferenceMs), error: failureCurrent ? failure.reason : null,
        model: raw?.model ?? null, peopleCount: people?.length ?? null, people,
        uncertainties: raw?.uncertainties ?? [], identityVerification: 'estimates_only' },
      movement: { source: 'gateway_command_state', observedAt: observation?.timestamp ?? null,
        commanded: { ...controls(robot.active_walk), ...controls(robot.body_command) }, activeWalkSequence: robot.active_walk_sequence ?? null,
        bodyCommandSequence: robot.body_command_sequence ?? null, measuredPhysicalMotion: { available: false },
        physicalRestConfirmed: false },
      sensing: { orientation: { available: false, reason: 'No timestamped orientation measurement exposed by the current adapter' },
        distance: { available: false }, obstacleClearance: { available: false } },
      control: { source: robot.body_command_source ?? 'unavailable',
        manualTakeover: connected && robot.body_command_source ? robot.body_command_source === 'manual' : null,
        gatewayCommandSequence: robot.body_command_sequence ?? null,
        lastCoordinatorLease: work.find(item => item.bodyLease && manager.hasCurrentBodyLease(item.id))?.bodyLease ?? null,
        observedAt: observation?.timestamp ?? null },
      executions,
    }
  } finally { store.close() }
}
