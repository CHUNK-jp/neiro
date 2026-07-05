import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEXTURE_IDS,
  MOOD_IDS,
  mixTargetDuration,
  computeMixPlan,
  moodFoundation,
  encodeWavPcm16,
} from '../docs/app/js/mix-engine.js';

// Confirm the module loads cleanly in Node without touching window/AudioContext.
test('module imports without browser globals', () => {
  assert.deepEqual(TEXTURE_IDS, ['raw', 'echo', 'wobble', 'warm']);
  assert.deepEqual(MOOD_IDS, ['sunny', 'rain', 'night', 'breeze']);
});

// --- mixTargetDuration ---

test('mixTargetDuration: nearest whole multiple of loopDuration to target', () => {
  // 9*5=45 (err 3) vs 10*5=50 (err 2) → 50
  assert.equal(mixTargetDuration(5), 50);
});

test('mixTargetDuration: exact multiple stays as-is', () => {
  // 6*8=48
  assert.equal(mixTargetDuration(8), 48);
});

test('mixTargetDuration: clamps at lower bound 24', () => {
  // loop=1s, target=10: nearest multiple=10, clamp to 24
  assert.equal(mixTargetDuration(1, 10), 24);
});

test('mixTargetDuration: clamps at upper bound 72', () => {
  // loop=25s, target=90: round(90/25)=4, 4*25=100, clamp to 72
  assert.equal(mixTargetDuration(25, 90), 72);
});

test('mixTargetDuration: fallback for 0', () => {
  assert.equal(mixTargetDuration(0), 48);
});

test('mixTargetDuration: fallback for NaN', () => {
  assert.equal(mixTargetDuration(NaN), 48);
});

test('mixTargetDuration: fallback for negative', () => {
  assert.equal(mixTargetDuration(-5), 48);
});

test('mixTargetDuration: fallback for -Infinity', () => {
  assert.equal(mixTargetDuration(-Infinity), 48);
});

test('mixTargetDuration: custom targetSeconds respected', () => {
  // loop=10, target=30: 3*10=30
  assert.equal(mixTargetDuration(10, 30), 30);
});

// --- computeMixPlan ---

const mkSrc = (loopDuration) => ({ loopDuration, kind: 'ambient', bpm: 0 });

test('computeMixPlan: source 0 enters at 0', () => {
  const plan = computeMixPlan([mkSrc(8)]);
  assert.equal(plan.entries[0].enterAt, 0);
});

test('computeMixPlan: source 1 enters at masterLoop', () => {
  const plan = computeMixPlan([mkSrc(8), mkSrc(6)]);
  assert.equal(plan.masterLoop, 8);
  assert.equal(plan.entries[1].enterAt, 8);
});

test('computeMixPlan: source 2 enters at 2*masterLoop', () => {
  const plan = computeMixPlan([mkSrc(8), mkSrc(6), mkSrc(4)]);
  assert.equal(plan.entries[2].enterAt, 2 * 8);
});

test('computeMixPlan: source 4 capped at 3*masterLoop (min(4,3))', () => {
  const plan = computeMixPlan([0, 1, 2, 3, 4].map(() => mkSrc(8)));
  assert.equal(plan.entries[4].enterAt, 3 * 8);
});

test('computeMixPlan: source 3 enters at 3*masterLoop (cap boundary)', () => {
  const plan = computeMixPlan([0, 1, 2, 3].map(() => mkSrc(8)));
  assert.equal(plan.entries[3].enterAt, 3 * 8);
});

test('computeMixPlan: all exitAt === duration', () => {
  const plan = computeMixPlan([mkSrc(8), mkSrc(6), mkSrc(10)]);
  for (const entry of plan.entries) {
    assert.equal(entry.exitAt, plan.duration);
  }
});

test('computeMixPlan: duration is a whole multiple of masterLoop', () => {
  const plan = computeMixPlan([mkSrc(8), mkSrc(6)]);
  const ratio = plan.duration / plan.masterLoop;
  assert.ok(
    Math.abs(ratio - Math.round(ratio)) < 1e-9,
    `duration ${plan.duration} / masterLoop ${plan.masterLoop} = ${ratio}`
  );
});

test('computeMixPlan: source 0 fadeIn is 0.5', () => {
  const plan = computeMixPlan([mkSrc(8), mkSrc(5)]);
  assert.equal(plan.entries[0].fadeIn, 0.5);
});

test('computeMixPlan: later sources fadeIn is 1.5', () => {
  const plan = computeMixPlan([mkSrc(8), mkSrc(5)]);
  assert.equal(plan.entries[1].fadeIn, 1.5);
});

test('computeMixPlan: all fadeOut is 2.5', () => {
  const plan = computeMixPlan([mkSrc(8), mkSrc(5)]);
  for (const entry of plan.entries) {
    assert.equal(entry.fadeOut, 2.5);
  }
});

// --- moodFoundation ---

const REQUIRED_FIELDS = ['character', 'chord', 'bass', 'filterHz', 'level', 'osc'];

test('moodFoundation: all four MOOD_IDS return valid recipes', () => {
  for (const id of MOOD_IDS) {
    const r = moodFoundation(id);
    for (const f of REQUIRED_FIELDS) {
      assert.ok(r[f] !== undefined, `${id} missing field "${f}"`);
    }
    assert.ok(Array.isArray(r.chord) && r.chord.length > 0, `${id} chord should be non-empty array`);
    assert.ok(['pad', 'drone'].includes(r.character), `${id} character "${r.character}" invalid`);
    assert.ok(['sine', 'triangle'].includes(r.osc), `${id} osc "${r.osc}" invalid`);
    assert.ok(typeof r.bass === 'number' && r.bass > 0);
    assert.ok(typeof r.filterHz === 'number' && r.filterHz > 0);
    assert.ok(typeof r.level === 'number' && r.level > 0);
  }
});

test('moodFoundation: all four recipes are distinct (filterHz differs)', () => {
  const filterHzSet = new Set(MOOD_IDS.map((id) => moodFoundation(id).filterHz));
  assert.equal(filterHzSet.size, 4);
});

test('moodFoundation: unknown id falls back to breeze', () => {
  const breeze = moodFoundation('breeze');
  assert.deepEqual(moodFoundation('unknown_mood_xyz'), breeze);
  assert.deepEqual(moodFoundation(''), breeze);
  assert.deepEqual(moodFoundation(undefined), breeze);
});

test('moodFoundation: sunny uses triangle osc', () => {
  assert.equal(moodFoundation('sunny').osc, 'triangle');
});

test('moodFoundation: night uses drone character', () => {
  assert.equal(moodFoundation('night').character, 'drone');
});

test('moodFoundation: rain uses sine osc', () => {
  assert.equal(moodFoundation('rain').osc, 'sine');
});

test('moodFoundation: sunny has expected filterHz', () => {
  assert.equal(moodFoundation('sunny').filterHz, 1200);
});

// --- encodeWavPcm16 ---

const mono1 = () => [new Float32Array([0])];
const stereo4 = () => [new Float32Array([0, 0, 0, 0]), new Float32Array([0, 0, 0, 0])];

test('encodeWavPcm16: RIFF magic bytes at offset 0', () => {
  const b = new Uint8Array(encodeWavPcm16(mono1(), 44100));
  assert.equal(b[0], 0x52); // R
  assert.equal(b[1], 0x49); // I
  assert.equal(b[2], 0x46); // F
  assert.equal(b[3], 0x46); // F
});

test('encodeWavPcm16: WAVE magic bytes at offset 8', () => {
  const b = new Uint8Array(encodeWavPcm16(mono1(), 44100));
  assert.equal(b[8],  0x57); // W
  assert.equal(b[9],  0x41); // A
  assert.equal(b[10], 0x56); // V
  assert.equal(b[11], 0x45); // E
});

test('encodeWavPcm16: fmt magic bytes at offset 12', () => {
  const b = new Uint8Array(encodeWavPcm16(mono1(), 44100));
  assert.equal(b[12], 0x66); // f
  assert.equal(b[13], 0x6D); // m
  assert.equal(b[14], 0x74); // t
  assert.equal(b[15], 0x20); // (space)
});

test('encodeWavPcm16: data magic bytes at offset 36', () => {
  const b = new Uint8Array(encodeWavPcm16(mono1(), 44100));
  assert.equal(b[36], 0x64); // d
  assert.equal(b[37], 0x61); // a
  assert.equal(b[38], 0x74); // t
  assert.equal(b[39], 0x61); // a
});

test('encodeWavPcm16: stereo 4 samples @ 8000 Hz → byteLength 44+16=60', () => {
  assert.equal(encodeWavPcm16(stereo4(), 8000).byteLength, 60);
});

test('encodeWavPcm16: mono 4 samples → byteLength 44+8=52', () => {
  assert.equal(encodeWavPcm16([new Float32Array(4)], 8000).byteLength, 52);
});

test('encodeWavPcm16: sampleRate stored at offset 24 (little-endian uint32)', () => {
  const view = new DataView(encodeWavPcm16(mono1(), 8000));
  assert.equal(view.getUint32(24, true), 8000);
});

test('encodeWavPcm16: channel count at offset 22', () => {
  assert.equal(new DataView(encodeWavPcm16(mono1(), 44100)).getUint16(22, true), 1);
  assert.equal(new DataView(encodeWavPcm16([new Float32Array(1), new Float32Array(1)], 44100)).getUint16(22, true), 2);
});

test('encodeWavPcm16: sample roundtrip – values and clamping', () => {
  // Input: 0.5, -0.5, 2.0 (clamps to 1.0), -1.0
  const ch = [new Float32Array([0.5, -0.5, 2.0, -1.0])];
  const samples = new Int16Array(encodeWavPcm16(ch, 44100), 44);
  // 0.5 → round(0.5*32768)=16384, within ±1 of spec's "16383"
  assert.ok(Math.abs(samples[0] - 16383) <= 1, `samples[0]=${samples[0]}, expected ~16383`);
  // -0.5 → round(-0.5*32768)=-16384, within ±1 of spec's "-16384"
  assert.ok(Math.abs(samples[1] - (-16384)) <= 1, `samples[1]=${samples[1]}, expected ~-16384`);
  // 2.0 clamped to 1.0 → 32767
  assert.equal(samples[2], 32767);
  // -1.0 → -32768
  assert.equal(samples[3], -32768);
});

test('encodeWavPcm16: stereo samples are interleaved L/R', () => {
  const L = new Float32Array([1.0, 0]);
  const R = new Float32Array([0, 1.0]);
  const samples = new Int16Array(encodeWavPcm16([L, R], 44100), 44);
  // frame 0: L=32767, R=0
  assert.equal(samples[0], 32767);
  assert.equal(samples[1], 0);
  // frame 1: L=0, R=32767
  assert.equal(samples[2], 0);
  assert.equal(samples[3], 32767);
});
