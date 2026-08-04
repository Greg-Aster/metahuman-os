import assert from 'node:assert/strict';
import {
  assistantSpeechEnabledFromPrefs,
  readAssistantSpeechEnabled,
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
