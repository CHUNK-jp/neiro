import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mixDurationSeconds,
  computeLayerGain,
  computeStackPlan,
  AMBIENT_CROSSFADE_S,
  MIX_LOOP_CROSSFADE_S,
} from '../docs/app/js/audio-mixer.js';

const buf = (duration) => ({ duration });

test('mixDurationSeconds is the longest layer', () => {
  assert.equal(mixDurationSeconds([buf(4.2), buf(10), buf(7.5)]), 10);
});

test('computeLayerGain keeps a single layer at full volume', () => {
  assert.equal(computeLayerGain(1), 1);
});

test('computeLayerGain applies equal-power headroom as layers stack', () => {
  assert.ok(Math.abs(computeLayerGain(4) - 0.5) < 1e-9);
  assert.ok(computeLayerGain(9) < computeLayerGain(4));
  assert.equal(computeLayerGain(0), 1);
});

// --- computeStackPlan ---

const rhythmic = (duration, bpm, firstOnset = 0) => ({ duration, kind: 'rhythmic', bpm, firstOnset });
const ambient = (duration) => ({ duration, kind: 'ambient', bpm: 0, firstOnset: 0 });

test('a pure ambient stack has no tempo and loops at the longest layer', () => {
  const plan = computeStackPlan([ambient(8), ambient(5)]);
  assert.equal(plan.tempo, 0);
  assert.equal(plan.loopDuration, 8);
  assert.equal(plan.layers[0].kind, 'ambient');
  assert.ok(plan.layers[0].crossfade > 0);
});

test('the oldest rhythmic layer anchors the stack tempo', () => {
  const plan = computeStackPlan([ambient(6), rhythmic(4, 120), rhythmic(4, 97)]);
  assert.equal(plan.tempo, 120);
});

test('rhythmic layers snap to whole beats and skip lead-in silence', () => {
  // 120 BPM → 0.5s beat; 4.3s from the first onset snaps down to 4.0s (8 beats)
  const plan = computeStackPlan([rhythmic(4.55, 120, 0.25)]);
  const layer = plan.layers[0];
  assert.equal(layer.startOffset, 0.25);
  assert.ok(Math.abs(layer.playDuration - 4.5) < 1e-9 || Math.abs(layer.playDuration - 4.0) < 1e-9);
  assert.ok(Math.abs((plan.loopDuration / 0.5) % 1) < 1e-6, 'loop is a whole number of beats');
});

test('loop duration rounds up to whole beats when a grid exists', () => {
  // ambient 6.2s alongside 100 BPM (0.6s beat) → loop 6.6s (11 beats)
  const plan = computeStackPlan([rhythmic(2.4, 100), ambient(6.2)]);
  const beat = 60 / 100;
  assert.ok(plan.loopDuration >= 6.2);
  assert.ok(Math.abs((plan.loopDuration / beat) % 1) < 1e-6);
});

test('short rhythmic phrases repeat to fill the loop', () => {
  // 2-beat phrase in an 8-beat loop plays 4 times
  const plan = computeStackPlan([rhythmic(1, 120, 0), rhythmic(4, 120, 0)]);
  assert.equal(plan.layers[0].repeats, 4);
  assert.equal(plan.layers[1].repeats, 1);
});

test('ambient crossfade never exceeds a quarter of the layer', () => {
  const plan = computeStackPlan([ambient(0.6)]);
  assert.ok(plan.layers[0].crossfade <= 0.15 + 1e-9);
  assert.ok(plan.layers[0].crossfade <= AMBIENT_CROSSFADE_S);
});

test('an explicit loopCrossfade overrides the ambient default', () => {
  const plan = computeStackPlan([{ ...ambient(30), loopCrossfade: MIX_LOOP_CROSSFADE_S }]);
  assert.ok(Math.abs(plan.layers[0].crossfade - MIX_LOOP_CROSSFADE_S) < 1e-9);
});

test('loopCrossfade override is still capped at a quarter of the layer duration', () => {
  // 4s layer → quarter is 1s, well under the ~2.4s MIX override.
  const plan = computeStackPlan([{ ...ambient(4), loopCrossfade: MIX_LOOP_CROSSFADE_S }]);
  assert.ok(plan.layers[0].crossfade <= 1 + 1e-9);
});

test('layers without a loopCrossfade still use the plain ambient default', () => {
  const plan = computeStackPlan([ambient(30)]);
  assert.equal(plan.layers[0].crossfade, AMBIENT_CROSSFADE_S);
});

test('empty and micro layers produce an empty plan', () => {
  assert.equal(computeStackPlan([]).loopDuration, 0);
  assert.equal(computeStackPlan([ambient(0.01)]).layers.length, 0);
});
