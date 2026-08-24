import assert from 'node:assert/strict';
import test from 'node:test';
import { parseExifDate, parseGPSCoordinate } from './photo-ingestor.js';

test('normalizes EXIF Date and legacy string timestamps without inventing dates', () => {
  assert.equal(
    parseExifDate(new Date('2026-08-24T12:34:56.000Z')),
    '2026-08-24T12:34:56.000Z',
  );
  assert.equal(parseExifDate('2026:08:24 12:34:56'), '2026-08-24T12:34:56');
  assert.equal(parseExifDate('not-a-date'), null);
});

test('converts EXIF GPS coordinates and applies hemisphere', () => {
  assert.equal(parseGPSCoordinate([45, 30, 0], 'N'), 45.5);
  assert.equal(parseGPSCoordinate([122, 40, 0], 'W'), -(122 + 40 / 60));
  assert.equal(parseGPSCoordinate([45, 30], 'N'), null);
});
