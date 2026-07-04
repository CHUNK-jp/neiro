import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DURATION_MS,
  MIME_CANDIDATES,
  pickMimeType,
  formatCountdown,
  elapsedRatio,
} from '../docs/app/js/recorder.js';

test('recording is capped at exactly 10 seconds', () => {
  assert.equal(MAX_DURATION_MS, 10000);
});

test('formatCountdown renders tenths of a second', () => {
  assert.equal(formatCountdown(10000), '10.0');
  assert.equal(formatCountdown(9940), '9.9');
  assert.equal(formatCountdown(1234), '1.2');
  assert.equal(formatCountdown(0), '0.0');
});

test('formatCountdown never goes negative', () => {
  assert.equal(formatCountdown(-500), '0.0');
});

test('pickMimeType returns the first supported candidate', () => {
  const supported = (t) => t === 'audio/mp4';
  assert.equal(pickMimeType(supported), 'audio/mp4');
});

test('pickMimeType prefers webm/opus when everything is supported', () => {
  assert.equal(pickMimeType(() => true), MIME_CANDIDATES[0]);
  assert.equal(MIME_CANDIDATES[0], 'audio/webm;codecs=opus');
});

test('pickMimeType returns empty string when nothing is supported', () => {
  assert.equal(pickMimeType(() => false), '');
});

test('elapsedRatio maps elapsed time to 0..1', () => {
  assert.equal(elapsedRatio(0), 0);
  assert.equal(elapsedRatio(5000), 0.5);
  assert.equal(elapsedRatio(10000), 1);
  assert.equal(elapsedRatio(15000), 1);
  assert.equal(elapsedRatio(-100), 0);
});
