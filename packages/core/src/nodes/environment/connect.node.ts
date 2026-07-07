import { defineNode } from '../types.js';
import { upsertEnvironmentConnection } from '../../environment-interface/store.js';

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEnvironmentUrl(rawUrl: string, roomName?: string): string {
  const url = new URL(rawUrl);
  if (roomName) {
    url.searchParams.set('room', roomName);
  }
  return url.toString();
}

function environmentIdForUrl(adapter: string, rawUrl: string): string {
  const url = new URL(rawUrl);
  return `${adapter}:${url.origin}/`;
}

export const environmentConnectNode = defineNode({
  id: 'environment_connect',
  name: 'Environment Connect',
  category: 'environment',
  inputs: [
    { name: 'url', type: 'string', optional: true, description: 'Environment URL' },
    { name: 'roomName', type: 'string', optional: true, description: 'Environment room/session name' },
  ],
  outputs: [
    { name: 'connection', type: 'object', description: 'Stored environment connection configuration' },
    { name: 'connectionId', type: 'string', description: 'Connection identifier' },
    { name: 'adapter', type: 'string', description: 'Adapter identifier' },
    { name: 'url', type: 'string', description: 'Environment URL' },
    { name: 'roomName', type: 'string', description: 'Room/session name' },
    { name: 'enabled', type: 'boolean', description: 'Whether this connection is enabled' },
    { name: 'configured', type: 'boolean', description: 'Whether the minimum connection fields are set' },
    { name: 'error', type: 'string', description: 'Configuration error, if any' },
  ],
  properties: {
    adapter: '',
    url: '',
    roomName: '',
    graphName: 'environment-mode',
    enabled: true,
  },
  propertySchemas: {
    adapter: {
      type: 'text',
      default: '',
      label: 'Adapter',
      description: 'Bridge-agent adapter id, such as an externally registered game or device adapter.',
    },
    url: {
      type: 'text',
      default: '',
      label: 'Environment URL',
      description: 'URL for the environment page or endpoint.',
    },
    roomName: {
      type: 'text',
      default: '',
      label: 'Room Name',
      description: 'Optional multiplayer room/session name.',
    },
    graphName: {
      type: 'text',
      default: 'environment-mode',
      label: 'Graph Name',
      description: 'Graph the bridge agent should run when observations arrive.',
    },
    enabled: {
      type: 'toggle',
      default: true,
      label: 'Enabled',
      description: 'When disabled, the bridge agent ignores this connection.',
    },
  },
  description: 'Stores graph-owned environment connection settings for the optional bridge agent.',
  async execute(inputs, context, properties) {
    const adapter = stringValue(properties?.adapter);
    const url = stringValue(inputs.url) || stringValue(properties?.url);
    const roomName = stringValue(inputs.roomName) || stringValue(properties?.roomName);
    const graphName = stringValue(properties?.graphName) || 'environment-mode';
    const enabled = properties?.enabled !== false;
    const username = typeof context.username === 'string'
      ? context.username
      : typeof context.userId === 'string'
        ? context.userId
        : undefined;

    if (!adapter || !url) {
      return {
        connection: null,
        connectionId: '',
        adapter,
        url: '',
        roomName,
        enabled,
        configured: false,
        error: !adapter ? 'Environment adapter is required.' : 'Environment URL is required.',
      };
    }

    try {
      const normalizedUrl = normalizeEnvironmentUrl(url, roomName);
      const connection = upsertEnvironmentConnection({
        id: environmentIdForUrl(adapter, normalizedUrl),
        adapter,
        url: normalizedUrl,
        roomName,
        graphName,
        metadata: username ? { modelUsername: username } : undefined,
        enabled,
      });

      return {
        connection,
        connectionId: connection.id,
        adapter: connection.adapter,
        url: connection.url,
        roomName: connection.roomName ?? '',
        enabled: connection.enabled,
        configured: true,
        error: '',
      };
    } catch (error) {
      return {
        connection: null,
        connectionId: '',
        adapter,
        url,
        roomName,
        enabled,
        configured: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
