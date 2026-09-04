import { defineNode } from '../types.js';
import {
  getEnvironmentBridgeDiagnosticsSnapshot,
  getLatestEnvironmentObservation,
  sanitizeEnvironmentBridgeObservation,
  summarizeEnvironmentBridgeState,
} from '../../environment-interface/index.js';
import type {
  EnvironmentBridgeDiagnosticsSession,
  EnvironmentObservation,
} from '../../environment-interface/index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function observationActionId(observation: EnvironmentObservation | null): string {
  const direct = typeof observation?.metadata?.actionId === 'string'
    ? observation.metadata.actionId.trim()
    : '';
  return direct || observation?.feedback?.find(item => item.actionId)?.actionId?.trim() || '';
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function selectedRobot(
  gateway: Record<string, unknown> | null,
  robotId: string,
): Record<string, unknown> | null {
  const robots = optionalRecord(gateway?.robots);
  if (!robots) return null;
  if (robotId) return isRecord(robots[robotId]) ? robots[robotId] : null;
  return Object.values(robots).find(isRecord) ?? null;
}

function selectedDiagnostics(
  sessions: EnvironmentBridgeDiagnosticsSession[],
  sessionId: string,
): EnvironmentBridgeDiagnosticsSession | null {
  if (sessionId) return sessions.find(session => session.sessionId === sessionId) ?? null;
  return sessions[0] ?? null;
}

function projectAinekioBridgeObservation(
  observation: EnvironmentObservation,
): EnvironmentObservation {
  return {
    environmentId: observation.environmentId,
    adapter: observation.adapter,
    sessionId: observation.sessionId,
    timestamp: observation.timestamp,
    capabilities: observation.capabilities,
    ...(observation.text ? { text: observation.text } : {}),
    ...(observation.state ? { state: observation.state } : {}),
    ...(observation.visual ? { visual: observation.visual } : {}),
    ...(observation.visuals ? { visuals: observation.visuals } : {}),
    ...(observation.feedback ? { feedback: observation.feedback } : {}),
    ...(observation.metadata ? { metadata: observation.metadata } : {}),
  };
}

export const environmentBridgeInputNode = defineNode({
  id: 'environment_bridge_input',
  name: 'Environment Bridge Input',
  category: 'environment',
  inputs: [
    { name: 'sessionId', type: 'string', optional: true, description: 'Specific environment session for a direct user turn' },
  ],
  outputs: [
    { name: 'observation', type: 'object', description: 'Current Ainekio Environment Bridge observation', group: 'Core', primary: true },
    { name: 'observationSource', type: 'string', description: 'Whether the observation triggered this run, came from saved bridge state, or is unavailable', group: 'Core', primary: true },
    { name: 'isTriggeringObservation', type: 'boolean', description: 'True only when this graph run received this exact observation from Environment Bridge', group: 'Core', primary: true },
    { name: 'environmentId', type: 'string', description: 'Environment identifier from the observation envelope', group: 'Identity' },
    { name: 'adapter', type: 'string', description: 'Adapter that supplied the observation', group: 'Identity' },
    { name: 'timestamp', type: 'string', description: 'Observation timestamp', group: 'Identity' },
    { name: 'robotId', type: 'string', description: 'Ainekio body identifier', group: 'Identity' },
    { name: 'robotEpoch', type: 'number', description: 'Authenticated Ainekio body connection epoch', group: 'Identity' },
    { name: 'capabilities', type: 'object', description: 'Actions and robot commands currently advertised by the Ainekio adapter', group: 'Observation' },
    { name: 'text', type: 'array', description: 'Text and microphone transcript events carried by the Ainekio bridge', group: 'Observation' },
    { name: 'state', type: 'object', description: 'Complete Ainekio gateway, body, safety, transport, and movement state', group: 'Observation' },
    { name: 'visual', type: 'object', label: 'current camera frame', description: 'Current Ainekio camera frame, when supplied', group: 'Observation' },
    { name: 'visuals', type: 'array', label: 'observation frames', description: 'Camera frames carried by the current Ainekio observation; this is not durable image history', group: 'Observation' },
    { name: 'feedback', type: 'array', description: 'Ainekio action acceptance, completion, rejection, expiry, or failure events', group: 'Observation' },
    { name: 'metadata', type: 'object', label: 'observation provenance', description: 'Ainekio correlation metadata plus Environment Bridge timing provenance', group: 'Observation' },
    { name: 'actionId', type: 'string', description: 'Action identifier reported by the adapter observation or feedback', group: 'Lifecycle and provenance' },
    { name: 'correlationId', type: 'string', description: 'Correlation identifier reported by the adapter', group: 'Lifecycle and provenance' },
    { name: 'body', type: 'object', description: 'Normalized Ainekio body availability and readiness state', group: 'Body status' },
    { name: 'bodyStatus', type: 'object', description: 'Freshest Ainekio body status packet available for this session', group: 'Body status' },
    { name: 'bodyEvent', type: 'object', description: 'Latest Ainekio connection, battery, storage, boot, asset, or TTS event carried by the observation', group: 'Body status' },
    { name: 'bodyAuthenticated', type: 'boolean', description: 'Whether the Ainekio body authenticated with the gateway', group: 'Body status' },
    { name: 'bodyState', type: 'string', description: 'Ainekio body state such as active, idle, dozing, deep-sleep, or failsafe', group: 'Body status' },
    { name: 'bodyStatusTimestamp', type: 'string', description: 'Timestamp of the freshest Ainekio body status packet', group: 'Body status' },
    { name: 'batteryVoltage', type: 'number', description: 'Battery voltage reported by the Ainekio body as vbat', group: 'Body status' },
    { name: 'wifiRssi', type: 'number', description: 'Ainekio body Wi-Fi signal strength in dBm', group: 'Body status' },
    { name: 'uptimeSeconds', type: 'number', description: 'Ainekio body uptime in seconds', group: 'Body status' },
    { name: 'freeHeapBytes', type: 'number', description: 'Free memory reported by the Ainekio body in bytes', group: 'Body status' },
    { name: 'sdAvailable', type: 'boolean', description: 'Whether the Ainekio body reports an available SD card', group: 'Body status' },
    { name: 'motionAvailable', type: 'boolean', description: 'Whether body motion commands are available', group: 'Body status' },
    { name: 'cameraReady', type: 'boolean', description: 'Whether the Ainekio camera is ready', group: 'Body status' },
    { name: 'microphoneReady', type: 'boolean', description: 'Ainekio microphone readiness when reported; null means unknown', group: 'Body status' },
    { name: 'speakerReady', type: 'boolean', description: 'Whether the Ainekio speaker path is ready', group: 'Body status' },
    { name: 'cameraDrops', type: 'number', description: 'Dropped Ainekio camera-frame count', group: 'Body status' },
    { name: 'microphoneDrops', type: 'number', description: 'Dropped Ainekio microphone-frame count', group: 'Body status' },
    { name: 'speakerUnderruns', type: 'number', description: 'Ainekio speaker underrun count', group: 'Body status' },
    { name: 'wakeEnabled', type: 'boolean', description: 'Whether local wake-word detection is enabled', group: 'Body status' },
    { name: 'wakeModel', type: 'string', description: 'Ainekio wake-word model identifier', group: 'Body status' },
    { name: 'wakeReady', type: 'boolean', description: 'Whether the Ainekio wake-word model is ready', group: 'Body status' },
    { name: 'gateway', type: 'object', description: 'Complete Ainekio gateway snapshot carried by the observation', group: 'Gateway and transport' },
    { name: 'adapterConnected', type: 'boolean', description: 'Whether the Environment Bridge adapter transport is connected', group: 'Gateway and transport' },
    { name: 'sessionStatus', type: 'string', description: 'Stored bridge session status: connected, stale, or disconnected', group: 'Gateway and transport' },
    { name: 'connectionState', type: 'string', description: 'Selected Ainekio body connection state', group: 'Gateway and transport' },
    { name: 'heartbeatAgeMs', type: 'number', description: 'Age of the selected Ainekio body heartbeat in milliseconds', group: 'Gateway and transport' },
    { name: 'transport', type: 'string', description: 'Ainekio body transport protocol', group: 'Gateway and transport' },
    { name: 'safety', type: 'string', description: 'Owner of physical safety enforcement', group: 'Gateway and transport' },
    { name: 'freestyleMovement', type: 'object', description: 'Ainekio movement-plan support, policy, and route availability', group: 'Gateway and transport' },
    { name: 'lastAudioResult', type: 'object', description: 'Latest Ainekio audio transcription result acknowledged by the adapter', group: 'Gateway and transport' },
    { name: 'bridgeSummary', type: 'object', description: 'Complete current Environment Bridge summary', group: 'Bridge diagnostics' },
    { name: 'bridgeEnabled', type: 'boolean', description: 'Whether the Environment Bridge is enabled', group: 'Bridge diagnostics' },
    { name: 'bridgeUpdatedAt', type: 'string', description: 'Timestamp of the stored Environment Bridge summary', group: 'Bridge diagnostics' },
    { name: 'sessions', type: 'array', description: 'All known Environment Bridge sessions', group: 'Bridge diagnostics' },
    { name: 'pendingCommandCount', type: 'number', description: 'Number of active Environment Bridge commands', group: 'Bridge diagnostics' },
    { name: 'diagnosticsSnapshot', type: 'object', description: 'Complete current Environment Bridge diagnostics snapshot for all sessions', group: 'Bridge diagnostics' },
    { name: 'diagnostics', type: 'object', description: 'Complete diagnostics for the selected Ainekio session', group: 'Bridge diagnostics' },
    { name: 'diagnosticsUpdatedAt', type: 'string', description: 'Timestamp of the selected session diagnostics', group: 'Bridge diagnostics' },
    { name: 'transportDiagnostics', type: 'object', description: 'Bridge byte, message, and transfer-rate diagnostics', group: 'Bridge diagnostics' },
    { name: 'mediaDiagnostics', type: 'object', description: 'Bridge image and audio counts and byte totals', group: 'Bridge diagnostics' },
    { name: 'microphoneLevel', type: 'number', description: 'Latest normalized Ainekio microphone level', group: 'Bridge diagnostics' },
    { name: 'pendingAudioUtterances', type: 'number', description: 'Number of Ainekio utterances awaiting transcription', group: 'Bridge diagnostics' },
    { name: 'transcriptionStatus', type: 'string', description: 'Latest Ainekio transcription status', group: 'Bridge diagnostics' },
    { name: 'transcript', type: 'string', description: 'Latest transcript retained by bridge diagnostics', group: 'Bridge diagnostics' },
    { name: 'movementPlan', type: 'object', description: 'Latest Ainekio movement-plan progress diagnostics', group: 'Bridge diagnostics' },
    { name: 'latestImage', type: 'object', description: 'Latest bounded bridge diagnostic image metadata', group: 'Bridge diagnostics' },
    { name: 'latestAudio', type: 'object', description: 'Latest bounded bridge diagnostic audio metadata', group: 'Bridge diagnostics' },
    { name: 'recentEvents', type: 'array', description: 'Recent bounded Environment Bridge transport events', group: 'Bridge diagnostics' },
    { name: 'sessionId', type: 'string', description: 'Environment Bridge session identifier', group: 'Core', primary: true },
    {
      name: 'connected',
      label: 'observation available',
      type: 'boolean',
      description: 'Whether a bridge observation is available; this is not a live connection-health check',
      group: 'Core',
      primary: true,
    },
  ],
  properties: {
    sessionId: '',
  },
  propertySchemas: {
    sessionId: {
      type: 'string',
      default: '',
      label: 'Observation Session',
      description: 'Use the triggering observation when it matches. Otherwise read this saved session; leave blank to use the latest connected session.',
      placeholder: 'Triggering / latest connected',
      emptyLabel: 'Triggering / latest connected',
      suggestions: 'environment-sessions',
    },
  },
  description: 'Complete read-only Ainekio Environment Bridge source. Every observation, body-status, gateway, session, and diagnostic output is always available; workflows choose data by connecting only the ports they need.',
  presentation: {
    defaultExpanded: true,
    badges: [
      { label: 'Read only', tone: 'info' },
      { label: 'No prompt', tone: 'neutral' },
      { label: 'No direct effects', tone: 'neutral' },
    ],
    statusTitle: 'Last observation',
    statusFields: [
      { output: 'connected', label: 'Observation', format: 'availability' },
      { output: 'sessionId', label: 'Session', hideWhenEmpty: true },
      { output: 'adapter', label: 'Adapter', hideWhenEmpty: true },
      { output: 'timestamp', label: 'Observed', format: 'relative-time', hideWhenEmpty: true },
      { output: 'bodyState', label: 'Body', hideWhenEmpty: true },
      { output: 'batteryVoltage', label: 'Battery (V)', hideWhenEmpty: true },
      { output: 'actionId', label: 'Action', hideWhenEmpty: true },
    ],
  },
  async execute(inputs, context, properties) {
    const inputSessionId = typeof inputs.sessionId === 'string' ? inputs.sessionId.trim() : '';
    const propertySessionId = typeof properties?.sessionId === 'string' ? properties.sessionId.trim() : '';
    const requestedSessionId = inputSessionId || propertySessionId || undefined;
    const supplied = isRecord(context.environmentObservation)
      ? context.environmentObservation as unknown as EnvironmentObservation
      : null;
    const isTriggeringObservation = Boolean(
      supplied && (!requestedSessionId || supplied.sessionId === requestedSessionId),
    );
    const sourceObservation: EnvironmentObservation | null = isTriggeringObservation
      ? supplied
      : getLatestEnvironmentObservation(requestedSessionId) ?? null;
    const observation = sourceObservation
      ? projectAinekioBridgeObservation(sanitizeEnvironmentBridgeObservation(sourceObservation))
      : null;
    const bridgeSummary = summarizeEnvironmentBridgeState();
    const diagnosticsSnapshot = getEnvironmentBridgeDiagnosticsSnapshot();
    const effectiveSessionId = observation?.sessionId
      ?? requestedSessionId
      ?? diagnosticsSnapshot.sessions[0]?.sessionId
      ?? [...bridgeSummary.sessions]
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0]?.sessionId
      ?? '';
    const diagnostics = selectedDiagnostics(diagnosticsSnapshot.sessions, effectiveSessionId);
    const state = optionalRecord(observation?.state);
    const body = optionalRecord(state?.body);
    const gateway = optionalRecord(state?.gateway);
    const diagnosticsRobotId = optionalString(diagnostics?.robotId);
    const observedRobotId = optionalString(body?.robotId);
    const robot = selectedRobot(gateway, diagnosticsRobotId || observedRobotId);
    const nestedBodyStatus = optionalRecord(robot?.status);
    const diagnosticBodyStatus = optionalRecord(diagnostics?.robotStatus);
    const bodyStatus = diagnosticBodyStatus ?? nestedBodyStatus;
    const robotId = diagnosticsRobotId
      || observedRobotId
      || optionalString(bodyStatus?.robot_id);
    const session = bridgeSummary.sessions.find(item => item.sessionId === effectiveSessionId);

    return {
      observation,
      observationSource: observation
        ? isTriggeringObservation ? 'triggering' : 'saved'
        : 'none',
      isTriggeringObservation,
      environmentId: observation?.environmentId ?? '',
      adapter: observation?.adapter ?? '',
      timestamp: observation?.timestamp ?? '',
      robotId,
      robotEpoch: optionalNumber(bodyStatus?.epoch) ?? optionalNumber(robot?.epoch),
      capabilities: observation?.capabilities ?? null,
      text: observation?.text ?? [],
      state,
      visual: observation?.visual ?? null,
      visuals: observation?.visuals ?? [],
      feedback: observation?.feedback ?? [],
      metadata: observation?.metadata ?? null,
      actionId: observationActionId(observation),
      correlationId: typeof observation?.metadata?.correlationId === 'string'
        ? observation.metadata.correlationId.trim()
        : '',
      body,
      bodyStatus,
      bodyEvent: optionalRecord(state?.bodyEvent),
      bodyAuthenticated: optionalBoolean(body?.authenticated),
      bodyState: optionalString(bodyStatus?.state),
      bodyStatusTimestamp: optionalString(bodyStatus?.timestamp),
      batteryVoltage: optionalNumber(bodyStatus?.vbat),
      wifiRssi: optionalNumber(bodyStatus?.rssi),
      uptimeSeconds: optionalNumber(bodyStatus?.uptime),
      freeHeapBytes: optionalNumber(bodyStatus?.heap),
      sdAvailable: optionalBoolean(bodyStatus?.sd),
      motionAvailable: optionalBoolean(body?.motionAvailable),
      cameraReady: optionalBoolean(bodyStatus?.camera_ready) ?? optionalBoolean(body?.cameraReady),
      microphoneReady: optionalBoolean(body?.microphoneReady),
      speakerReady: optionalBoolean(body?.speakerReady),
      cameraDrops: optionalNumber(bodyStatus?.cam_drops),
      microphoneDrops: optionalNumber(bodyStatus?.mic_drops),
      speakerUnderruns: optionalNumber(bodyStatus?.spk_underruns),
      wakeEnabled: optionalBoolean(bodyStatus?.wake_enabled),
      wakeModel: optionalString(bodyStatus?.wake_model),
      wakeReady: optionalBoolean(bodyStatus?.wake_ready),
      gateway,
      adapterConnected: optionalBoolean(state?.adapterConnected),
      sessionStatus: session?.status ?? '',
      connectionState: optionalString(robot?.connection_state),
      heartbeatAgeMs: optionalNumber(body?.heartbeatAgeMs) ?? optionalNumber(robot?.heartbeat_age_ms),
      transport: optionalString(state?.transport),
      safety: optionalString(state?.safety),
      freestyleMovement: optionalRecord(state?.freestyleMovement),
      lastAudioResult: optionalRecord(state?.lastAudioResult),
      bridgeSummary,
      bridgeEnabled: bridgeSummary.enabled,
      bridgeUpdatedAt: bridgeSummary.updatedAt,
      sessions: bridgeSummary.sessions,
      pendingCommandCount: bridgeSummary.pendingCommandCount,
      diagnosticsSnapshot,
      diagnostics,
      diagnosticsUpdatedAt: diagnostics?.updatedAt ?? '',
      transportDiagnostics: diagnostics?.transport ?? null,
      mediaDiagnostics: diagnostics?.media ?? null,
      microphoneLevel: diagnostics?.microphoneLevel ?? null,
      pendingAudioUtterances: diagnostics?.pendingAudioUtterances ?? null,
      transcriptionStatus: diagnostics?.lastTranscriptionStatus ?? '',
      transcript: diagnostics?.lastTranscript ?? '',
      movementPlan: diagnostics?.movementPlan ?? null,
      latestImage: diagnostics?.latestImage ?? null,
      latestAudio: diagnostics?.latestAudio ?? null,
      recentEvents: diagnostics?.recentEvents ?? [],
      sessionId: effectiveSessionId,
      connected: Boolean(observation),
    };
  },
});
