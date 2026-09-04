import assert from 'node:assert/strict';
import test from 'node:test';
import { splitSpeechText } from './speech-chunks.js';

test('short speech remains one chunk', () => {
  assert.deepEqual(splitSpeechText('Please stand up.'), ['Please stand up.']);
});

test('paragraph boundaries are preserved as immediate chunk boundaries', () => {
  assert.deepEqual(
    splitSpeechText('First paragraph.\n\nSecond paragraph.'),
    ['First paragraph.', 'Second paragraph.'],
  );
});

test('a typical response yields a playable first phrase before the full response', () => {
  const text = [
    'I understand that you are disappointed about the cat situation.',
    'I can continue looking around the room using the available camera.',
    'I will let you know if I find anything useful nearby.',
  ].join(' ');
  const chunks = splitSpeechText(text);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks[0]!.length < text.length);
  assert.equal(chunks.join(' '), text);
});

test('long unpunctuated speech remains bounded', () => {
  const text = Array.from({ length: 100 }, (_, index) => `word${index}`).join(' ');
  const chunks = splitSpeechText(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 220));
  assert.equal(chunks.join(' '), text);
});

test('invalid chunk policies fail visibly', () => {
  assert.throws(
    () => splitSpeechText('text', { preferredChars: 200, maxChars: 100, minTailChars: 10 }),
    /Invalid speech chunk policy/,
  );
});
