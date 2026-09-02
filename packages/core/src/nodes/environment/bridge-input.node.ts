import { defineNode } from '../types.js';
import { getLatestEnvironmentObservation } from '../../environment-interface/index.js';
import type { EnvironmentObservation } from '../../environment-interface/index.js';

export const ENVIRONMENT_BRIDGE_OBSERVATION_FIELDS = [
  'capabilities',
  'text',
  'state',
  'location',
  'map',
  'visual',
  'visuals',
  'feedback',
  'metadata',
] as const;

type EnvironmentBridgeObservationField = typeof ENVIRONMENT_BRIDGE_OBSERVATION_FIELDS[number];
const environmentBridgeObservationFieldSet = new Set<string>(ENVIRONMENT_BRIDGE_OBSERVATION_FIELDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function observationActionId(observation: EnvironmentObservation | null): string {
  const direct = typeof observation?.metadata?.actionId === 'string'
    ? observation.metadata.actionId.trim()
    : '';
  return direct || observation?.feedback?.find(item => item.actionId)?.actionId?.trim() || '';
}

function selectedObservationFields(value: unknown): Set<EnvironmentBridgeObservationField> {
  if (!Array.isArray(value)) return new Set(ENVIRONMENT_BRIDGE_OBSERVATION_FIELDS);
  return new Set(value.filter((field): field is EnvironmentBridgeObservationField => (
    typeof field === 'string' && environmentBridgeObservationFieldSet.has(field)
  )));
}

function projectObservation(
  observation: EnvironmentObservation,
  fields: Set<EnvironmentBridgeObservationField>,
): EnvironmentObservation {
  return {
    environmentId: observation.environmentId,
    adapter: observation.adapter,
    sessionId: observation.sessionId,
    timestamp: observation.timestamp,
    capabilities: fields.has('capabilities')
      ? observation.capabilities
      : { actions: [] },
    ...(fields.has('text') && observation.text ? { text: observation.text } : {}),
    ...(fields.has('state') && observation.state ? { state: observation.state } : {}),
    ...(fields.has('location') && observation.location ? { location: observation.location } : {}),
    ...(fields.has('map') && observation.map ? { map: observation.map } : {}),
    ...(fields.has('visual') && observation.visual ? { visual: observation.visual } : {}),
    ...(fields.has('visuals') && observation.visuals ? { visuals: observation.visuals } : {}),
    ...(fields.has('feedback') && observation.feedback ? { feedback: observation.feedback } : {}),
    ...(fields.has('metadata') && observation.metadata ? { metadata: observation.metadata } : {}),
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
    { name: 'observation', type: 'object', description: 'Current filtered Environment Bridge observation', group: 'Core', primary: true },
    { name: 'environmentId', type: 'string', description: 'Environment identifier from the observation envelope', group: 'Identity' },
    { name: 'adapter', type: 'string', description: 'Adapter that supplied the observation', group: 'Identity' },
    { name: 'timestamp', type: 'string', description: 'Observation timestamp', group: 'Identity' },
    {
      name: 'capabilities',
      type: 'object',
      description: 'Advertised actions, robot commands, descriptions, and perception support',
      group: 'State and capabilities',
      enabledBy: { property: 'observationFields', includes: 'capabilities' },
    },
    {
      name: 'text',
      type: 'array',
      description: 'Environment text events selected for output',
      group: 'Perception',
      enabledBy: { property: 'observationFields', includes: 'text' },
    },
    {
      name: 'state',
      type: 'object',
      description: 'Current adapter and robot state selected for output',
      group: 'State and capabilities',
      enabledBy: { property: 'observationFields', includes: 'state' },
    },
    {
      name: 'location',
      type: 'object',
      description: 'Current location data selected for output',
      group: 'Perception',
      enabledBy: { property: 'observationFields', includes: 'location' },
    },
    {
      name: 'map',
      type: 'object',
      description: 'Current map data selected for output',
      group: 'Perception',
      enabledBy: { property: 'observationFields', includes: 'map' },
    },
    {
      name: 'visual',
      type: 'object',
      description: 'Current visual frame, when present',
      group: 'Perception',
      enabledBy: { property: 'observationFields', includes: 'visual' },
    },
    {
      name: 'visuals',
      type: 'array',
      description: 'Current visual frame list',
      group: 'Perception',
      enabledBy: { property: 'observationFields', includes: 'visuals' },
    },
    {
      name: 'feedback',
      type: 'array',
      description: 'Current action lifecycle feedback selected for output',
      group: 'Lifecycle and provenance',
      enabledBy: { property: 'observationFields', includes: 'feedback' },
    },
    {
      name: 'metadata',
      type: 'object',
      description: 'Adapter-authored observation metadata selected for output',
      group: 'Lifecycle and provenance',
      enabledBy: { property: 'observationFields', includes: 'metadata' },
    },
    { name: 'actionId', type: 'string', description: 'Action identifier reported by the adapter observation or feedback', group: 'Lifecycle and provenance' },
    { name: 'correlationId', type: 'string', description: 'Correlation identifier reported by the adapter', group: 'Lifecycle and provenance' },
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
    observationFields: [...ENVIRONMENT_BRIDGE_OBSERVATION_FIELDS],
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
    observationFields: {
      type: 'multiselect',
      default: [...ENVIRONMENT_BRIDGE_OBSERVATION_FIELDS],
      label: 'Observation Data',
      description: 'Data categories included in the aggregate observation and their typed outputs. Identity, adapter, session, and timestamp remain available.',
      emptyLabel: 'No optional observation data',
      options: [
        { value: 'capabilities', label: 'Capabilities and commands' },
        { value: 'text', label: 'Text events' },
        { value: 'state', label: 'Robot and adapter state' },
        { value: 'location', label: 'Location' },
        { value: 'map', label: 'Map' },
        { value: 'visual', label: 'Current image' },
        { value: 'visuals', label: 'Image history' },
        { value: 'feedback', label: 'Action feedback' },
        { value: 'metadata', label: 'Correlation and task metadata' },
      ],
    },
  },
  description: 'Read-only source: uses the triggering observation or a selected/latest connected session, then exposes the chosen data. It has no prompt and sends no robot actions.',
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
    const sourceObservation: EnvironmentObservation | null = supplied
      && (!requestedSessionId || supplied.sessionId === requestedSessionId)
      ? supplied
      : getLatestEnvironmentObservation(requestedSessionId) ?? null;
    const fields = selectedObservationFields(properties?.observationFields);
    const observation = sourceObservation
      ? projectObservation(sourceObservation, fields)
      : null;

    return {
      observation,
      environmentId: observation?.environmentId ?? '',
      adapter: observation?.adapter ?? '',
      timestamp: observation?.timestamp ?? '',
      capabilities: fields.has('capabilities') ? observation?.capabilities ?? null : null,
      text: fields.has('text') ? observation?.text ?? [] : [],
      state: fields.has('state') ? observation?.state ?? null : null,
      location: fields.has('location') ? observation?.location ?? null : null,
      map: fields.has('map') ? observation?.map ?? null : null,
      visual: observation?.visual ?? null,
      visuals: observation?.visuals ?? [],
      feedback: fields.has('feedback') ? observation?.feedback ?? [] : [],
      metadata: fields.has('metadata') ? observation?.metadata ?? null : null,
      actionId: observationActionId(observation),
      correlationId: typeof observation?.metadata?.correlationId === 'string'
        ? observation.metadata.correlationId.trim()
        : '',
      sessionId: observation?.sessionId ?? '',
      connected: Boolean(observation),
    };
  },
});
