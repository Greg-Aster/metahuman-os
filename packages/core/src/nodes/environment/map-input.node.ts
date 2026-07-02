import { defineNode } from '../types.js';
import type { EnvironmentLocationData, EnvironmentMapData } from '../../environment-interface/index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseStructuredValue(value: unknown): { value: Record<string, unknown> | null; error: string } {
  if (!value) {
    return { value: null, error: '' };
  }
  if (isRecord(value)) {
    return { value, error: '' };
  }
  if (typeof value !== 'string') {
    return { value: null, error: 'Value must be a JSON object.' };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { value: null, error: '' };
  }

  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed)
      ? { value: parsed, error: '' }
      : { value: null, error: 'JSON value must be an object.' };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : 'Invalid JSON.',
    };
  }
}

export const environmentMapInputNode = defineNode({
  id: 'environment_map_input',
  name: 'Environment Map Input',
  category: 'environment',
  inputs: [
    { name: 'map', type: 'object', optional: true, description: 'Map object from another graph node' },
    { name: 'location', type: 'object', optional: true, description: 'Location object from another graph node' },
  ],
  outputs: [
    { name: 'map', type: 'object', description: 'Environment map data, or null when unset' },
    { name: 'location', type: 'object', description: 'Environment location data, or null when unset' },
    { name: 'hasMap', type: 'boolean', description: 'Whether map data is available' },
    { name: 'hasLocation', type: 'boolean', description: 'Whether location data is available' },
    { name: 'error', type: 'string', description: 'JSON parsing error, if any' },
  ],
  properties: {
    mapJson: '',
    locationJson: '',
    coordinateSystem: '',
  },
  propertySchemas: {
    mapJson: {
      type: 'json',
      default: '',
      label: 'Map JSON',
      description: 'Optional authored map object. Leave blank until real map data exists.',
    },
    locationJson: {
      type: 'json',
      default: '',
      label: 'Location JSON',
      description: 'Optional authored location object. Adapter observation location can also be used directly.',
    },
    coordinateSystem: {
      type: 'text',
      default: '',
      label: 'Coordinate System',
      description: 'Optional label copied onto the map when the map does not already define one.',
    },
  },
  description: 'Provides optional graph-authored map and location context without baking environment data into Environment Mode.',
  async execute(inputs, _context, properties) {
    const mapResult = parseStructuredValue(inputs.map ?? properties?.mapJson);
    const locationResult = parseStructuredValue(inputs.location ?? properties?.locationJson);
    const coordinateSystem = typeof properties?.coordinateSystem === 'string'
      ? properties.coordinateSystem.trim()
      : '';

    const map = mapResult.value
      ? {
          ...mapResult.value,
          ...(coordinateSystem && !mapResult.value.coordinateSystem ? { coordinateSystem } : {}),
        } as EnvironmentMapData
      : null;
    const location = locationResult.value as EnvironmentLocationData | null;
    const errors = [mapResult.error, locationResult.error].filter(Boolean);

    return {
      map,
      location,
      hasMap: Boolean(map),
      hasLocation: Boolean(location),
      error: errors.join('\n'),
    };
  },
});
