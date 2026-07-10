// opus-encoder.js — Ogg/Opus compression for the MIX Studio feed-save path.
// Pure helpers are exercised directly; the encode test drives the actual
// vendored WASM encoder (opus-recorder 8.0.5) with production parameters to
// confirm real MIX renders land in the 400-800KB feed-size target.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  OPUS_MIME,
  OPUS_BITRATE,
  encoderInitMessage,
  estimateOpusBytes,
} from '../docs/app/js/opus-encoder.js';

// --- Pure helpers ---

test('OPUS_MIME is the Ogg/Opus content type stored on new MIX posts', () => {
  assert.equal(OPUS_MIME, 'audio/ogg;codecs=opus');
});

test('encoderInitMessage: production defaults for a 44.1kHz stereo render', () => {
  const msg = encoderInitMessage(2, 44100);
  assert.equal(msg.command, 'init');
  assert.equal(msg.encoderSampleRate, 48000);
  assert.equal(msg.encoderBitRate, OPUS_BITRATE);
  assert.equal(msg.encoderBitRate, 96000);
  assert.equal(msg.numberOfChannels, 2);
  assert.equal(msg.originalSampleRate, 44100);
  assert.equal(msg.encoderApplication, 2049);
});

test('encoderInitMessage: explicit bitRate overrides OPUS_BITRATE', () => {
  const msg = encoderInitMessage(1, 22050, 32000);
  assert.equal(msg.encoderBitRate, 32000);
  assert.equal(msg.numberOfChannels, 1);
  assert.equal(msg.originalSampleRate, 22050);
});

test('estimateOpusBytes: a 48s mix at OPUS_BITRATE lands in the 400-800KB feed-size target', () => {
  const bytes = estimateOpusBytes(48);
  assert.ok(bytes >= 400 * 1024, `${bytes} below 400KB floor`);
  assert.ok(bytes <= 800 * 1024, `${bytes} above 800KB ceiling`);
});

test('estimateOpusBytes: trivial bits/s * seconds / 8 math', () => {
  assert.equal(estimateOpusBytes(1, 8000), 1000);
});

// --- Real encode through the vendored WASM encoder ---
//
// This is the feed-save compression verification: build the exact init
// config production uses (encoderInitMessage(2, 44100), minus `command`,
// plus a fixed `serial` since the constructor's default is Math.random),
// then push ~48s of synthetic stereo audio through OggOpusEncoder the same
// way feedEncoder() in opus-encoder.js does — Ogg ID/comment pages first,
// then ~1s chunks, then the final frame.

test('real encode: a 48s synthetic stereo mix compresses to a valid, right-sized Ogg/Opus stream', async () => {
  const require = createRequire(import.meta.url);
  // encoderWorker.min.js assigns bare `onmessage`/calls postMessage when
  // driven as a worker; loading it in Node only needs postMessage to exist.
  globalThis.postMessage = () => {};
  const { Module, OggOpusEncoder } = require('../docs/app/vendor/opus-recorder/encoderWorker.min.js');

  // WASM is inlined and instantiates synchronously, but guard anyway.
  await new Promise((resolve) => {
    if (Module.HEAPF32) return resolve();
    Module.onRuntimeInitialized = resolve;
  });

  const SR = 44100;
  const DURATION_S = 48;
  const N = SR * DURATION_S;

  // Synthetic "rendered mix" character: a small sine chord plus low-passed
  // noise with a slow amplitude wobble, peak ~0.5. A pure sine would
  // compress unrealistically well and wouldn't exercise the encoder the
  // way an actual MIX render (pad + texture layers) does.
  function synthChannel(phaseOffset) {
    const out = new Float32Array(N);
    const freqs = [220, 277, 330];
    let noiseState = 0;
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      let s = 0;
      for (const f of freqs) s += Math.sin(2 * Math.PI * f * t + phaseOffset) / freqs.length;
      // Crude low-pass: leaky integrator over white noise.
      const raw = Math.random() * 2 - 1;
      noiseState += (raw - noiseState) * 0.05;
      const wobble = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.1 * t);
      s = s * 0.35 * wobble + noiseState * 0.15 * wobble;
      out[i] = Math.max(-0.5, Math.min(0.5, s));
    }
    return out;
  }

  const left = synthChannel(0);
  const right = synthChannel(0.3);

  const cfg = { ...encoderInitMessage(2, SR), serial: 42 };
  delete cfg.command;
  const enc = new OggOpusEncoder(cfg, Module);

  const pages = [];
  const push = (p) => { if (p && p.page) pages.push(p.page); };
  push(enc.generateIdPage());
  push(enc.generateCommentPage());
  for (let off = 0; off < N; off += SR) { // ~1s chunks, mirrors feedEncoder()
    const end = Math.min(N, off + SR);
    enc.encode([left.subarray(off, end), right.subarray(off, end)]).forEach(push);
  }
  enc.encodeFinalFrame().forEach(push);
  enc.destroy();

  assert.ok(pages.length > 0, 'encoder produced at least one Ogg page');

  const firstPage = pages[0] instanceof Uint8Array ? pages[0] : new Uint8Array(pages[0]);
  assert.equal(firstPage[0], 0x4f); // O
  assert.equal(firstPage[1], 0x67); // g
  assert.equal(firstPage[2], 0x67); // g
  assert.equal(firstPage[3], 0x53); // S

  let totalBytes = 0;
  for (const page of pages) totalBytes += page.byteLength ?? page.length;

  // Target for a 48s feed-saved mix at 96kbps (measured ~569KB with audio
  // like this).
  assert.ok(totalBytes >= 400 * 1024, `encoded ${totalBytes} bytes, below 400KB floor`);
  assert.ok(totalBytes <= 800 * 1024, `encoded ${totalBytes} bytes, above 800KB ceiling`);

  // Real compression happened: far smaller than the WAV this replaces
  // (48s * 44100 * 2ch * 2 bytes ~= 8.5MB).
  const wavEquivalentBytes = DURATION_S * SR * 2 * 2;
  assert.ok(totalBytes < wavEquivalentBytes / 10, 'encoded size should be well under 1/10 of WAV');
});
