import assert from 'node:assert/strict';
import {
  isInnerDialogueSpeechVisible,
  setInnerDialogueSpeechVisible,
  shouldPlayAdmittedSpeech,
} from './inner-dialogue-speech-visibility.js';

setInnerDialogueSpeechVisible(false);
assert.equal(isInnerDialogueSpeechVisible(), false);
assert.equal(shouldPlayAdmittedSpeech('inner'), false);
assert.equal(shouldPlayAdmittedSpeech('conversation'), true);

setInnerDialogueSpeechVisible(true);
assert.equal(isInnerDialogueSpeechVisible(), true);
assert.equal(shouldPlayAdmittedSpeech('inner'), true);

setInnerDialogueSpeechVisible(false);
console.log('inner-dialogue-speech-visibility.spec.ts passed');
