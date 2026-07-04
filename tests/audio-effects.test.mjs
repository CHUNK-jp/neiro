import test from 'node:test';
import assert from 'node:assert/strict';
import {
  semitoneRatio,
  clampPitch,
  hannWindow,
  resampleLinear,
  stretchOLA,
  pitchShiftChannel,
  impulseResponseChannels,
} from '../docs/app/js/audio-effects.js';

const SR = 44100;

function sine(freq, seconds, sr = SR) {
  const data = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  }
  return data;
}

function zeroCrossings(data) {
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if ((data[i - 1] < 0 && data[i] >= 0) || (data[i - 1] >= 0 && data[i] < 0)) count++;
  }
  return count;
}

test('semitoneRatio: +12 doubles, -12 halves', () => {
  assert.ok(Math.abs(semitoneRatio(12) - 2) < 1e-9);
  assert.ok(Math.abs(semitoneRatio(-12) - 0.5) < 1e-9);
  assert.equal(semitoneRatio(0), 1);
});

test('clampPitch limits to ±12 and rounds', () => {
  assert.equal(clampPitch(30), 12);
  assert.equal(clampPitch(-30), -12);
  assert.equal(clampPitch(2.6), 3);
});

test('hannWindow is zero at edges, one in the middle', () => {
  const w = hannWindow(1024);
  assert.ok(w[0] < 1e-6);
  assert.ok(w[1023] < 1e-6);
  assert.ok(Math.abs(w[512] - 1) < 0.01);
});

test('resampleLinear changes length by the ratio', () => {
  const data = sine(440, 1);
  assert.equal(resampleLinear(data, 2).length, Math.round(data.length / 2));
  assert.equal(resampleLinear(data, 0.5).length, data.length * 2);
});

test('stretchOLA changes length without changing pitch', () => {
  const data = sine(440, 1);
  const stretched = stretchOLA(data, 2);
  assert.ok(Math.abs(stretched.length - data.length * 2) < 4096);
  // pitch (zero-crossing rate per sample) stays roughly the same
  const rateIn = zeroCrossings(data) / data.length;
  const rateOut = zeroCrossings(stretched) / stretched.length;
  assert.ok(Math.abs(rateIn - rateOut) / rateIn < 0.12, `in ${rateIn}, out ${rateOut}`);
});

test('pitchShiftChannel(+12) doubles the frequency at the same length', () => {
  const data = sine(440, 1);
  const shifted = pitchShiftChannel(data, 12);
  assert.equal(shifted.length, data.length);
  const ratio = zeroCrossings(shifted) / zeroCrossings(data);
  assert.ok(Math.abs(ratio - 2) < 0.15, `zero-crossing ratio ${ratio}`);
});

test('pitchShiftChannel(-12) halves the frequency at the same length', () => {
  const data = sine(880, 1);
  const shifted = pitchShiftChannel(data, -12);
  assert.equal(shifted.length, data.length);
  const ratio = zeroCrossings(shifted) / zeroCrossings(data);
  assert.ok(Math.abs(ratio - 0.5) < 0.08, `zero-crossing ratio ${ratio}`);
});

test('pitchShiftChannel(0) is a pass-through copy', () => {
  const data = sine(440, 0.2);
  const out = pitchShiftChannel(data, 0);
  assert.notEqual(out, data);
  assert.deepEqual(Array.from(out.subarray(0, 50)), Array.from(data.subarray(0, 50)));
});

test('impulseResponseChannels decays to silence', () => {
  const rand = () => 0.75; // deterministic
  const [left, right] = impulseResponseChannels(SR, 1, 3, rand);
  assert.equal(left.length, SR);
  assert.equal(right.length, SR);
  assert.ok(Math.abs(left[0]) > 0.4);
  assert.ok(Math.abs(left[SR - 1]) < 1e-6);
  assert.ok(Math.abs(left[Math.round(SR / 2)]) < Math.abs(left[0]));
});
