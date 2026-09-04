import assert from 'node:assert/strict'
import test from 'node:test'
import type { PropertySchema } from '@metahuman/core/nodes/types'
import {
  formatPropertySummary,
  getConnectedOutputConfigurationWarnings,
  getNodeStatusRows,
  groupNodeSlots,
  groupCanvasProperties,
  isPromptInputHandle,
  isPromptLikeProperty,
} from './node-property-presentation.js'

function schema(
  type: PropertySchema['type'],
  overrides: Partial<PropertySchema> = {},
): PropertySchema {
  return { type, default: '', ...overrides }
}

test('canvas property grouping promotes prompts and preserves explicit placement', () => {
  const groups = groupCanvasProperties({
    systemPrompt: schema('text_multiline', { label: 'System Prompt' }),
    responseContract: schema('text_multiline', { canvas: 'expanded' }),
    mode: schema('select', { default: 'safe' }),
    temperature: schema('slider', { default: 0.2, advanced: true }),
    emphasized: schema('string', { canvas: 'primary' }),
  })

  assert.deepEqual(groups.primary.map(([key]) => key), ['systemPrompt', 'emphasized'])
  assert.deepEqual(groups.settings.map(([key]) => key), ['responseContract', 'mode'])
  assert.deepEqual(groups.advanced.map(([key]) => key), ['temperature'])
})

test('prompt detection covers prompt-like names and multiline schema fields', () => {
  assert.equal(isPromptLikeProperty('systemPrompt', schema('string')), true)
  assert.equal(isPromptLikeProperty('responseContract', schema('string')), true)
  assert.equal(isPromptLikeProperty('notes', schema('text_multiline')), true)
  assert.equal(isPromptLikeProperty('temperature', schema('slider')), false)
})

test('compact summaries remain readable across property types', () => {
  assert.equal(formatPropertySummary(true, schema('boolean')), 'On')
  assert.equal(formatPropertySummary(['one', 'two', 'three', 'four'], schema('multiselect')), '4 items')
  assert.equal(formatPropertySummary(
    'json',
    schema('select', {
      options: [
        { value: 'text', label: 'Text' },
        { value: 'json', label: 'JSON' },
      ],
    }),
  ), 'JSON')
  assert.equal(
    formatPropertySummary('Line one\n\nLine two', schema('text_multiline')),
    'Line one Line two',
  )
  assert.equal(
    formatPropertySummary('', schema('string', { emptyLabel: 'Latest connected' })),
    'Latest connected',
  )
  assert.equal(formatPropertySummary(
    ['state', 'visual'],
    schema('multiselect', {
      options: [
        { value: 'state', label: 'Robot state' },
        { value: 'visual', label: 'Current image' },
      ],
    }),
  ), 'All 2')
})

test('slot presentation groups ports and warns when a configured output is disabled', () => {
  const outputs = [
    { name: 'observation', type: 'object' as const, group: 'Core', primary: true },
    {
      name: 'visual',
      type: 'object' as const,
      label: 'current image',
      group: 'Perception',
      enabledBy: { property: 'dataOutputs', includes: 'visual' },
    },
  ]

  assert.deepEqual(groupNodeSlots(outputs).map((group) => group.label), ['Core', 'Perception'])
  assert.deepEqual(getConnectedOutputConfigurationWarnings(
    outputs,
    { dataOutputs: ['state'] },
    {
      dataOutputs: schema('multiselect', {
        label: 'Optional Outputs',
        options: [{ value: 'visual', label: 'Current camera frame' }],
      }),
    },
    ['visual'],
  ), ['current image is connected, but Optional Outputs excludes Current camera frame.'])
  assert.deepEqual(getConnectedOutputConfigurationWarnings(
    outputs,
    { dataOutputs: ['visual'] },
    undefined,
    ['visual'],
  ), [])
})

test('schema-declared status rows summarize observation availability and age', () => {
  const now = Date.parse('2026-09-02T12:01:05.000Z')
  assert.deepEqual(getNodeStatusRows({
    statusFields: [
      { output: 'connected', label: 'Observation', format: 'availability' },
      { output: 'sessionId', label: 'Session', hideWhenEmpty: true },
      { output: 'timestamp', label: 'Observed', format: 'relative-time' },
    ],
  }, {
    connected: true,
    sessionId: 'robot-1',
    timestamp: '2026-09-02T12:00:00.000Z',
  }, now).map(({ label, value, tone }) => ({ label, value, tone })), [
    { label: 'Observation', value: 'Available', tone: 'success' },
    { label: 'Session', value: 'robot-1', tone: undefined },
    { label: 'Observed', value: '1m ago', tone: undefined },
  ])
})

test('prompt-source handles are identified without classifying unrelated inputs', () => {
  assert.equal(isPromptInputHandle('messages'), true)
  assert.equal(isPromptInputHandle('systemPrompt'), true)
  assert.equal(isPromptInputHandle('instruction'), true)
  assert.equal(isPromptInputHandle('temperature'), false)
  assert.equal(isPromptInputHandle(null), false)
})
