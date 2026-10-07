import assert from 'node:assert/strict';
import test from 'node:test';
import { splitSpeechText } from './speech-chunks.js';

test('short speech remains one chunk', () => {
  assert.deepEqual(splitSpeechText('Please stand up.'), ['Please stand up.']);
});

test('a short greeting joins the following phrase', () => {
  const text = 'Hello! This is a test of the text to speech system.';
  assert.deepEqual(splitSpeechText(text), [text]);
});

test('a short greeting joins only the next opening phrase of a long response', () => {
  const text = 'Hello, Greg! I can see the doorway, and I am waiting for your next instruction. '
    + 'The battery is ready for the next test.';
  const chunks = splitSpeechText(text);
  assert.equal(chunks[0], 'Hello, Greg! I can see the doorway,');
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(' '), text);
});

test('a standalone greeting is still spoken', () => {
  assert.deepEqual(splitSpeechText('Hello!'), ['Hello!']);
});

test('joining a greeting respects paragraph boundaries', () => {
  assert.deepEqual(splitSpeechText('Hi!\n\nWelcome back.'), ['Hi!', 'Welcome back.']);
});

test('joining a greeting respects a smaller custom chunk limit', () => {
  const text = 'Hi! Welcome back.';
  assert.deepEqual(
    splitSpeechText(text, { preferredChars: 13, maxChars: 13, minTailChars: 4 }),
    ['Hi!', 'Welcome back.'],
  );
});

test('the opening clause is released before a longer conversational sentence', () => {
  const text = 'I can see the doorway, and I am waiting for your next instruction.';
  const chunks = splitSpeechText(text);
  assert.equal(chunks[0], 'I can see the doorway,');
  assert.equal(chunks.join(' '), text);
});

test('tail merging cannot swallow the opening phrase of a three-sentence response', () => {
  const text = 'I can see the doorway, and I am waiting for your next instruction. '
    + 'The battery is at 75 percent, and the room temperature is 22 degrees. '
    + 'I will stay here until you ask me to move.';
  const chunks = splitSpeechText(text);
  assert.equal(chunks[0], 'I can see the doorway,');
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(' '), text);
});

test('splitting speech preserves decimal numbers', () => {
  const text = 'The reading is 3.14 volts. The battery is ready for the next test.';
  assert.equal(splitSpeechText(text).join(' '), text);
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
