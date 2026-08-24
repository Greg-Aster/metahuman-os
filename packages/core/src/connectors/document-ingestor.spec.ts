import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractDocumentContent } from './document-ingestor.js';

test('extracts plain text with complete canonical metadata', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'metahuman-document-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const filepath = path.join(directory, 'example.txt');
  writeFileSync(filepath, 'one two three\n');

  const result = await extractDocumentContent(filepath);

  assert.equal(result.text, 'one two three\n');
  assert.equal(result.metadata.filename, 'example.txt');
  assert.equal(result.metadata.filepath, filepath);
  assert.equal(result.metadata.extractionMethod, 'plaintext');
  assert.equal(result.metadata.wordCount, 3);
  assert.equal(result.metadata.characterCount, 14);
});
