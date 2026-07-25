/**
 * Robot Buffer Node
 * Persists structured outbound commands and inbound lifecycle feedback from
 * the Environment Bridge.
 */

import { getBufferPathForUser, writeBufferEntry } from '../../conversation-buffer.js';
import { defineNode, type NodeExecutor } from '../types.js';

export type RobotBridgeRecord = {
  direction?: 'outbound' | 'inbound';
  status?: string;
  reason?: string;
  message?: string;
  targetSessionId?: string | null;
  requestedActions?: unknown[];
  commands?: unknown[];
  rejectedActions?: unknown[];
  commandCount?: number;
  rejectedCount?: number;
  success?: boolean;
  ready?: boolean;
  bridgeEnabled?: boolean;
  streamSubscriberCount?: number;
  activeSessionCount?: number;
  source?: string;
  correlationId?: string | null;
  actionId?: string;
  action?: unknown;
  feedback?: {
    id?: string;
    timestamp?: string;
    type?: string;
    message?: string;
    actionId?: string;
    data?: Record<string, unknown>;
  };
};

export function createRobotBufferMessage(record: RobotBridgeRecord) {
  const direction = record.direction === 'inbound' ? 'inbound' : 'outbound';
  const status = typeof record.status === 'string' && record.status.trim()
    ? record.status.trim()
    : 'unknown';
  const message = typeof record.message === 'string' && record.message.trim()
    ? record.message.trim()
    : direction === 'inbound'
      ? 'The robot reported an action lifecycle update.'
      : 'Environment Bridge produced an outbound robot record.';
  const feedbackId = typeof record.feedback?.id === 'string' && record.feedback.id.trim()
    ? record.feedback.id.trim()
    : '';

  return {
    role: 'robot' as const,
    content: direction === 'inbound'
      ? `Robot action ${status}: ${message}`
      : `Robot bridge ${status}: ${message}`,
    meta: {
      type: 'robot_bridge_message',
      source: 'environment-bridge',
      direction,
      status,
      reason: typeof record.reason === 'string' ? record.reason : '',
      targetSessionId: typeof record.targetSessionId === 'string' ? record.targetSessionId : null,
      actionId: typeof record.actionId === 'string' ? record.actionId : null,
      ...(feedbackId ? { idempotencyKey: `environment-feedback:${feedbackId}` } : {}),
      bridgeRecord: record,
    },
  };
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const username = typeof context.username === 'string' ? context.username.trim() : '';
  const record = inputs.bridgeRecord ?? context.bridgeRecord;

  if (!username) {
    return { persisted: false, skipped: true, reason: 'No username in context' };
  }

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return {
      persisted: false,
      skipped: true,
      reason: 'No structured bridge record',
      bufferPath: getBufferPathForUser(username, 'robot'),
    };
  }

  const bridgeRecord = record as RobotBridgeRecord;
  const status = typeof bridgeRecord.status === 'string' ? bridgeRecord.status : 'unknown';
  if (status === 'no_actions' && properties?.recordNoAction !== true) {
    return {
      persisted: false,
      skipped: true,
      reason: 'No robot action was sent',
      status,
      bufferPath: getBufferPathForUser(username, 'robot'),
    };
  }

  try {
    const persisted = await writeBufferEntry(
      username,
      'robot',
      createRobotBufferMessage(bridgeRecord),
    );

    return {
      persisted,
      skipped: false,
      status,
      bufferPath: getBufferPathForUser(username, 'robot'),
    };
  } catch (error) {
    console.error('[RobotBuffer] Error:', error);
    return {
      persisted: false,
      skipped: false,
      status,
      error: (error as Error).message,
      bufferPath: getBufferPathForUser(username, 'robot'),
    };
  }
};

export const RobotBufferNode = defineNode({
  id: 'robot_buffer',
  name: 'Robot Buffer',
  category: 'output',
  inputs: [
    { name: 'bridgeRecord', type: 'object', description: 'Structured outbound command or inbound robot lifecycle result' },
  ],
  outputs: [
    { name: 'persisted', type: 'boolean', description: 'Whether the bridge record was appended' },
    { name: 'skipped', type: 'boolean', description: 'Whether the record was intentionally ignored' },
    { name: 'status', type: 'string', description: 'Bridge status attached to the record' },
    { name: 'bufferPath', type: 'string', description: 'Per-user Robot Buffer path' },
  ],
  properties: {
    recordNoAction: false,
  },
  propertySchemas: {
    recordNoAction: {
      type: 'toggle',
      default: false,
      label: 'Record No-Action Turns',
      description: 'Store Environment turns that produced no robot action.',
    },
  },
  description: 'Persists robot commands and correlated lifecycle feedback through the canonical shared buffer service.',
  execute,
});
