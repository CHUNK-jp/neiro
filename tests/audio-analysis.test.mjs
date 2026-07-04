import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rmsEnvelope,
  onsetStrength,
  detectOnsets,
  estimateBpm,
  analyzeChannel,
  snapDurationToGrid,
  HOP_SIZE,
} from '../docs/app/js/audio-analysis.js';

const SR = 44100;

// Synthesizes a click track: short decaying bursts at each beat.
function clickTrack(bpm, seconds, sr = SR) {
  const data = new Float32Array(Math.round(seconds * sr));
  const interval = Math.round((60 / bpm) * sr);
  for (let start = 0; start < data.length; start += interval) {
    for (let i = 0; i < 2000 && start + i < data.length; i++) {
      data[start + i] = Math.sin(i * 0.3) * Math.exp(-i / 400);
    }
  }
  return data;
}

// Steady low-level noise, like a room tone / rain bed.
function roomTone(seconds, sr = SR) {
  const data = new Float32Array(Math.round(seconds * sr));
  let seed = 42;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = ((seed / 0x7fffffff) * 2 - 1) * 0.2;
  }
  return data;
}

test('rmsEnvelope tracks energy per hop', () => {
  const data = new Float32Array(HOP_SIZE * 2);
  data.fill(0.5, 0, HOP_SIZE); // loud first hop, silent second
  const env = rmsEnvelope(data);
  assert.equal(env.length, 2);
  assert.ok(env[0] > 0.4);
  assert.equal(env[1], 0);
});

test('onsetStrength keeps only rises', () => {
  const strength = onsetStrength(Float32Array.from([0, 0.5, 0.2, 0.8]));
  assert.equal(strength[1], 0.5);
  assert.equal(strength[2], 0);
  assert.ok(Math.abs(strength[3] - 0.6) < 1e-6);
});

test('detectOnsets finds the beats of a click track', () => {
  const data = clickTrack(120, 5);
  const env = rmsEnvelope(data);
  const onsets = detectOnsets(onsetStrength(env), HOP_SIZE / SR);
  // 120 BPM for 5s = 10 clicks
  assert.ok(onsets.length >= 8 && onsets.length <= 12, `got ${onsets.length}`);
});

test('estimateBpm recovers the tempo of a click track', () => {
  const data = clickTrack(120, 8);
  const env = rmsEnvelope(data);
  const onsets = detectOnsets(onsetStrength(env), HOP_SIZE / SR);
  const { bpm, score } = estimateBpm(onsets);
  assert.ok(Math.abs(bpm - 120) <= 3, `expected ~120, got ${bpm}`);
  assert.ok(score > 0.5);
});

test('analyzeChannel classifies a click track as rhythmic', () => {
  const result = analyzeChannel(clickTrack(100, 8), SR);
  assert.equal(result.kind, 'rhythmic');
  assert.ok(Math.abs(result.bpm - 100) <= 3, `expected ~100, got ${result.bpm}`);
});

test('a hit right at t=0 is not lost', () => {
  const result = analyzeChannel(clickTrack(120, 5), SR);
  assert.ok(result.firstOnset < 0.1, `firstOnset should be ~0, got ${result.firstOnset}`);
});

test('analyzeChannel classifies steady room tone as ambient', () => {
  const result = analyzeChannel(roomTone(8), SR);
  assert.equal(result.kind, 'ambient');
  assert.equal(result.bpm, 0);
});

test('analyzeChannel handles silence without blowing up', () => {
  const result = analyzeChannel(new Float32Array(SR * 2), SR);
  assert.equal(result.kind, 'ambient');
});

test('snapDurationToGrid rounds to whole beats, minimum one', () => {
  // 120 BPM → 0.5s beat
  assert.equal(snapDurationToGrid(2.1, 120), 2);
  assert.equal(snapDurationToGrid(1.8, 120), 2);
  assert.equal(snapDurationToGrid(0.1, 120), 0.5);
  assert.equal(snapDurationToGrid(4, 0), 4); // no grid without tempo
});
