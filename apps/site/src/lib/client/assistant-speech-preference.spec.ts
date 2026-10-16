import assert from 'node:assert/strict';
import {
  assistantSpeechEnabledFromPrefs,
  readAssistantSpeechEnabled,
  nextSpeechOutputState, speechOutputState, speechOutputSettings,
} from './assistant-speech-preference.js';

const storage = (value: string | null) => ({
  getItem: () => value,
});

assert.equal(assistantSpeechEnabledFromPrefs(undefined), true);
assert.equal(assistantSpeechEnabledFromPrefs({}), true);
assert.equal(assistantSpeechEnabledFromPrefs({ speechDisabled: false }), true);
assert.equal(assistantSpeechEnabledFromPrefs({ speechDisabled: true }), false);
assert.equal(assistantSpeechEnabledFromPrefs({ ttsEnabled: false }), true);

assert.equal(readAssistantSpeechEnabled(storage(null)), true);
assert.equal(readAssistantSpeechEnabled(storage('{broken')), true);
assert.equal(readAssistantSpeechEnabled(storage('{"speechDisabled":false}')), true);
assert.equal(readAssistantSpeechEnabled(storage('{"speechDisabled":true}')), false);

console.log('assistant-speech-preference.spec.ts passed');

for (const state of ['off', 'browser', 'body-control'] as const) {
  assert.equal(speechOutputState(speechOutputSettings(state)), state);
}
assert.equal(speechOutputState({ outputTarget: 'robot', speechDisabled: true }), 'off');
assert.equal(speechOutputState({ outputTarget: 'robot', speechDisabled: false }), 'body-control');
assert.equal(nextSpeechOutputState('off'), 'browser');
assert.equal(nextSpeechOutputState('browser'), 'body-control');
assert.equal(nextSpeechOutputState('body-control'), 'off');
assert.deepEqual(speechOutputSettings('off'), { speechDisabled: true }, 'turning off retains the saved destination');
