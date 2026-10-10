import type { NodeDefinition } from '../types.js'

export const faceExpressionSchema = {
  id: 'environment_face_expression', name: 'Face Expression', category: 'environment',
  inputs: [
    { name: 'control', type: 'any', optional: true },
    { name: 'expression', type: 'string', optional: true },
    { name: 'feedback', type: 'object', optional: true },
    { name: 'token', type: 'string', optional: true },
    { name: 'sessionId', type: 'string', optional: true },
  ],
  outputs: [
    { name: 'commands', type: 'array', description: 'Display commands admitted by the Coordinator' },
    { name: 'status', type: 'string', description: 'Environment Bridge admission status' },
    { name: 'success', type: 'boolean' },
    { name: 'message', type: 'string' },
    { name: 'control', type: 'any' },
    { name: 'token', type: 'string' },
    { name: 'failureFeedback', type: 'object', optional: true },
  ],
  properties: { expression: '', sessionId: '', operation: 'set', timeoutMs: 60000, background: false },
  propertySchemas: {
    operation: { type: 'select', default: 'set', label: 'Operation', options: ['set', 'release'],
      description: 'Set replaces the active expression. Release clears only the supplied token.' },
    expression: { type: 'select', default: '', label: 'Expression', suggestions: 'environment-expressions',
      description: 'Expressions advertised by the robot selected in Body Control.' },
    timeoutMs: { type: 'number', default: 60000, label: 'Expression Timeout (ms)', min: 0, max: 4294967295, step: 1000,
      description: 'Robot-local expiry, including during disconnection. 0 disables expiry.' },
    background: { type: 'boolean', default: false, label: 'Yield to Speech and Motion',
      description: 'Keep this expression between activities; show the existing speech or motion face while active.' },
    sessionId: { type: 'text', default: '', label: 'Bridge Session', suggestions: 'environment-sessions',
      advanced: true, description: 'Empty uses the connected Environment Bridge session.' },
  },
  description: 'Sends a display expression through the existing Environment Bridge command owner.',
} satisfies Pick<NodeDefinition, 'id' | 'name' | 'category' | 'inputs' | 'outputs' | 'properties' | 'propertySchemas' | 'description'>

export const expressionFeedbackSchema = {
  id: 'environment_expression_feedback', name: 'Expression Feedback', category: 'environment',
  inputs: [{ name: 'control', type: 'any', optional: true }, { name: 'token', type: 'string', optional: true },
    { name: 'actionResult', type: 'object', optional: true }, { name: 'workResult', type: 'object', optional: true }],
  outputs: [{ name: 'control', type: 'any' }, { name: 'feedback', type: 'object' }, { name: 'token', type: 'string' }],
  properties: { operation: 'set', expression: 'thinking', timeoutMs: 60000, background: true,
    errorExpression: 'confused', errorTimeoutMs: 5000 },
  propertySchemas: {
    operation: faceExpressionSchema.propertySchemas.operation,
    expression: { ...faceExpressionSchema.propertySchemas.expression, default: 'thinking' },
    timeoutMs: faceExpressionSchema.propertySchemas.timeoutMs,
    background: { ...faceExpressionSchema.propertySchemas.background, default: true },
    errorExpression: { ...faceExpressionSchema.propertySchemas.expression, default: 'confused', label: 'Failure Expression' },
    errorTimeoutMs: { ...faceExpressionSchema.propertySchemas.timeoutMs, default: 5000, label: 'Failure Timeout (ms)' },
  },
  description: 'Passes its input through unchanged and supplies a display update to Face Expression. A new expression replaces the active expression.',
} satisfies Pick<NodeDefinition, 'id' | 'name' | 'category' | 'inputs' | 'outputs' | 'properties' | 'propertySchemas' | 'description'>
