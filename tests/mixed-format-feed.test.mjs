// Mixed-format feed: WAV-era posts (MIX Studio renders, pre-migration
// recordings) and new WebM/Opus recordings live in the same IndexedDB store.
// After decodeAudioData both are plain AudioBuffers, so everything downstream
// (StackPlayer, loop crossfades, layering) must be container-agnostic.
// These tests exercise that pipeline at the plan level with the layer
// descriptors app.js's layersForPost produces after decoding.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StackPlayer,
  computeStackPlan,
  MIX_LOOP_CROSSFADE_S,
} from '../docs/app/js/audio-mixer.js';
import { MIME_CANDIDATES, pickMimeType } from '../docs/app/js/recorder.js';

// A decoded layer as layersForPost yields it: the blob's container type is
// gone by this point — only the buffer and analysis remain.
const decodedLayer = (duration, analysis) => ({ buffer: { duration }, analysis });

const wavMixLayer = () =>
  decodedLayer(30, { kind: 'ambient', bpm: 0, firstOnset: 0, loopCrossfade: MIX_LOOP_CROSSFADE_S });
const opusRecordingLayer = () =>
  decodedLayer(8, { kind: 'rhythmic', bpm: 120, firstOnset: 0.1 });

test('recording format prefers WebM/Opus, then audio/mp4, then browser default', () => {
  assert.deepEqual(MIME_CANDIDATES, ['audio/webm;codecs=opus', 'audio/mp4']);
  assert.equal(pickMimeType(() => true), 'audio/webm;codecs=opus');
  // Safari-like: no WebM support
  assert.equal(pickMimeType((t) => t === 'audio/mp4'), 'audio/mp4');
  // Nothing supported → '' → MediaRecorder gets no mimeType option
  assert.equal(pickMimeType(() => false), '');
});

test('stack plans are container-agnostic: identical audio yields identical plans', () => {
  // Same decoded metadata, one from an audio/wav blob, one from webm/opus —
  // the plan must not differ, because the container never reaches the planner.
  const fromWav = computeStackPlan([{ duration: 8, kind: 'rhythmic', bpm: 120, firstOnset: 0.1 }]);
  const fromOpus = computeStackPlan([{ duration: 8, kind: 'rhythmic', bpm: 120, firstOnset: 0.1 }]);
  assert.deepEqual(fromWav, fromOpus);
});

test('a WAV-era MIX post still plays and loops with the MIX crossfade', () => {
  const player = new StackPlayer(null, [wavMixLayer()]);
  assert.equal(player.duration, 30);
  const plan = player.plan.layers[0];
  assert.equal(plan.kind, 'ambient');
  assert.ok(Math.abs(plan.crossfade - MIX_LOOP_CROSSFADE_S) < 1e-9);
  player.setLoop(true);
  assert.equal(player.loop, true);
});

test('a new WebM/Opus recording plays and loops on its beat grid', () => {
  const player = new StackPlayer(null, [opusRecordingLayer()]);
  assert.ok(player.duration > 0);
  assert.equal(player.plan.tempo, 120);
  assert.equal(player.plan.layers[0].kind, 'rhythmic');
  player.setLoop(true);
  assert.equal(player.loop, true);
});

test('WAV and WebM/Opus layers stack together in one player', () => {
  // 重ね再生: a new Opus take layered onto a WAV-era MIX post.
  const player = new StackPlayer(null, [wavMixLayer(), opusRecordingLayer()]);
  const sources = player.plan.layers.map((l) => l.sourceIndex).sort();
  assert.deepEqual(sources, [0, 1], 'both formats survive into the plan');
  assert.ok(player.duration >= 30, 'loop covers the longest (WAV) layer');
  const beat = 60 / 120;
  assert.ok(Math.abs((player.duration / beat) % 1) < 1e-6, 'loop still lands on the beat grid');
});

test('a feed mixing both formats plans every post independently', () => {
  // Simulated feed: a WAV MIX post, a WebM/Opus sound, and a layered post
  // whose stack carries one blob of each format.
  const posts = [
    { mimeType: undefined, layers: [wavMixLayer()] }, // pre-migration post: no mimeType field
    { mimeType: 'audio/webm;codecs=opus', layers: [opusRecordingLayer()] },
    { mimeType: 'audio/webm;codecs=opus', layers: [wavMixLayer(), opusRecordingLayer()] },
  ];
  for (const post of posts) {
    const player = new StackPlayer(null, post.layers);
    assert.ok(player.duration > 0, 'every post is playable');
    assert.equal(player.plan.layers.length, post.layers.length);
  }
});
