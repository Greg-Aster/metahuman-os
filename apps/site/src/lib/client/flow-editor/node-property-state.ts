export interface NodeDataWithProperties extends Record<string, unknown> {
  properties?: Record<string, unknown>
}

/**
 * Return node data with one property updated from the latest graph-state value.
 * Callers must pass the current node data for every edit; this keeps sibling
 * field changes atomic without introducing component-local property state.
 */
export function withUpdatedNodeProperty(
  data: NodeDataWithProperties,
  propertyKey: string,
  value: unknown,
): NodeDataWithProperties {
  if (
    data.properties !== undefined
    && (data.properties === null || typeof data.properties !== 'object' || Array.isArray(data.properties))
  ) {
    throw new TypeError('Node properties must be an object')
  }

  return {
    ...data,
    properties: {
      ...(data.properties ?? {}),
      [propertyKey]: value,
    },
  }
}
