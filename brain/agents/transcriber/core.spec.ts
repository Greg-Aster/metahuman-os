import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { audioIdForPath, findAudioFiles } from './audio-inbox.js';

test('findAudioFiles discovers nested audio and ignores hidden or unrelated files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-transcriber-'));
  try {
    fs.mkdirSync(path.join(root, '2026-07-14'), { recursive: true });
    fs.mkdirSync(path.join(root, '.hidden'), { recursive: true });
    fs.writeFileSync(path.join(root, 'top.wav'), 'audio');
    fs.writeFileSync(path.join(root, '2026-07-14', 'nested.mp3'), 'audio');
    fs.writeFileSync(path.join(root, '2026-07-14', 'notes.txt'), 'not audio');
    fs.writeFileSync(path.join(root, '.hidden', 'ignored.wav'), 'audio');

    assert.deepEqual(findAudioFiles(root), [
      path.join(root, '2026-07-14', 'nested.mp3'),
      path.join(root, 'top.wav'),
    ]);
    assert.equal(
      audioIdForPath(root, path.join(root, '2026-07-14', 'nested.mp3')),
      '2026-07-14__nested',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
