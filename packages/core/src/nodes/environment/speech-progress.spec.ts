import assert from 'node:assert/strict'
import { test } from 'node:test'
import { robotSpeechDeliveryProgress } from '../../tts/robot-speech.js'

test('speech progress follows correlated playback receipts in either delivery order', () => {
  const delivery = { deliveryId: 'render', route: 'robot' as const }
  const rendered: any = { kind: 'work_result', payload: { effectId: 'render',
    result: { state: 'completed', result: { actionIds: ['chunk-one', 'chunk-two'] } } } }
  const played = (id: string, type = 'completed'): any => ({ kind: 'physical_result', actionId: id,
    payload: { feedback: { actionId: id, type } } })
  assert.equal(robotSpeechDeliveryProgress(delivery, []).status, 'rendering')
  assert.equal(robotSpeechDeliveryProgress(delivery, [rendered, played('chunk-one')]).status, 'playing')
  assert.equal(robotSpeechDeliveryProgress(delivery, [played('chunk-two'), played('chunk-one'), rendered]).status, 'completed')
  assert.equal(robotSpeechDeliveryProgress(delivery, [rendered, played('chunk-one'), played('chunk-two', 'failed')]).status, 'failed')
  assert.equal(robotSpeechDeliveryProgress(delivery, [played('unrelated')]).status, 'rendering')
})
