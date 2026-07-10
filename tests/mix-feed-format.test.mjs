// Mixed-format MIX feed: WAV-era MIX Studio renders (audio/wav, no
// post.mimeType) and new Opus MIX renders (audio/ogg;codecs=opus, via
// opus-encoder.js) live side by side in the feed. After decodeAudioData both
// are plain AudioBuffers, so StackPlayer / computeStackPlan must not care
// which container a MIX post's single layer came from — only
// layersForPost's post.mix -> { kind: 'ambient', loopCrossfade:
// MIX_LOOP_CROSSFADE_S } treatment (app.js) matters, and that's applied
// regardless of mimeType. These tests exercise that pipeline at the plan
// level with the layer descriptors layersForPost produces after decoding.

import test from 'node:test';
import assert from 'node:assert/strict';
import { StackPlayer, MIX_LOOP_CROSSFADE_S } from '../docs/app/js/audio-mixer.js';
import { OPUS_MIME } from '../docs/app/js/opus-encoder.js';

// A decoded MIX layer as app.js's layersForPost yields it: identical shape
// whether the stored blob was audio/wav or audio/ogg;codecs=opus, because
// the container is gone after decodeAudioData.
const decodedLayer = (duration, analysis) => ({ buffer: { duration }, analysis });

const mixLayer = (duration = 48) =>
  decodedLayer(duration, { kind: 'ambient', bpm: 0, firstOnset: 0, loopCrossfade: MIX_LOOP_CROSSFADE_S });

const opusRecordingLayer = (duration = 10) =>
  decodedLayer(duration, { kind: 'rhythmic', bpm: 120, firstOnset: 0.1 });

test('a WAV-era MIX post (post.mimeType undefined, layer audio/wav) plays with the MIX crossfade', () => {
  // Pre-migration post: no mimeType field at all, layer blob was audio/wav.
  const player = new StackPlayer(null, [mixLayer(48)]);
  assert.equal(player.duration, 48);
  const plan = player.plan.layers[0];
  assert.equal(plan.kind, 'ambient');
  assert.ok(Math.abs(plan.crossfade - MIX_LOOP_CROSSFADE_S) < 1e-9);
});

test('a new Opus MIX post (post.mimeType audio/ogg;codecs=opus) yields an identical plan for identical audio', () => {
  // Same decoded metadata either way — the container never reaches the
  // planner, so a WAV-era MIX post and a new Opus MIX post with the same
  // duration/analysis must produce byte-identical plans.
  assert.equal(OPUS_MIME, 'audio/ogg;codecs=opus');
  const wavPlayer = new StackPlayer(null, [mixLayer(48)]);
  const opusPlayer = new StackPlayer(null, [mixLayer(48)]);
  assert.deepEqual(wavPlayer.plan, opusPlayer.plan);
});

test('both WAV-era and Opus MIX posts loop with the same MIX crossfade', () => {
  const wavPlayer = new StackPlayer(null, [mixLayer(48)]);
  const opusPlayer = new StackPlayer(null, [mixLayer(48)]);
  wavPlayer.setLoop(true);
  opusPlayer.setLoop(true);
  assert.equal(wavPlayer.loop, true);
  assert.equal(opusPlayer.loop, true);
  assert.ok(Math.abs(wavPlayer.plan.layers[0].crossfade - MIX_LOOP_CROSSFADE_S) < 1e-9);
  assert.equal(wavPlayer.plan.layers[0].crossfade, opusPlayer.plan.layers[0].crossfade);
});

test('layering (重ね再生): a WAV MIX layer + an Opus MIX layer + an Opus recording layer stack in one player', () => {
  const player = new StackPlayer(null, [mixLayer(48), mixLayer(48), opusRecordingLayer(10)]);
  const sources = player.plan.layers.map((l) => l.sourceIndex).sort();
  assert.deepEqual(sources, [0, 1, 2], 'all three layers survive into the plan');
  assert.ok(player.duration >= 48, 'loop covers the longest (MIX) layer');
});

test('a feed of wav-era MIX, opus MIX, and opus recording posts each plans independently', () => {
  const posts = [
    { mimeType: undefined, layers: [mixLayer(48)] }, // pre-migration MIX post: no mimeType field
    { mimeType: OPUS_MIME, layers: [mixLayer(48)] }, // new MIX post: compressed via opus-encoder.js
    { mimeType: OPUS_MIME, layers: [opusRecordingLayer(10)] }, // new plain recording, unrelated to MIX
  ];
  for (const post of posts) {
    const player = new StackPlayer(null, post.layers);
    assert.ok(player.duration > 0, 'every post is playable');
    assert.equal(player.plan.layers.length, post.layers.length);
  }
});
