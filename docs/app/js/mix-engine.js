// mix-engine.js — offline mix rendering for MIX Studio.
//
// Pure DSP helpers (mixTargetDuration, computeMixPlan, moodFoundation,
// encodeWavPcm16) are Node-testable and never touch browser globals.
// Browser wrappers (encodeWavBlob, renderMix) rely on OfflineAudioContext.

import { computeStackPlan, computeLayerGain } from './audio-mixer.js';
import { impulseResponseChannels } from './audio-effects.js';

export const TEXTURE_IDS = ['raw', 'echo', 'wobble', 'warm'];
export const MOOD_IDS = ['sunny', 'rain', 'night', 'breeze'];

// --- Pure (Node-testable) ---

// Nearest whole multiple of loopDuration to targetSeconds, clamped to [24, 72].
// Degenerate loopDuration → return targetSeconds unchanged.
export function mixTargetDuration(loopDuration, targetSeconds = 48) {
  if (!loopDuration || loopDuration <= 0 || !isFinite(loopDuration)) return targetSeconds;
  const n = Math.max(1, Math.round(targetSeconds / loopDuration));
  return Math.max(24, Math.min(72, n * loopDuration));
}

// sources: [{ loopDuration, kind, bpm }]
// masterLoop = longest loopDuration; duration = mixTargetDuration(masterLoop).
// Entry stagger: source i starts at min(i, 3) * masterLoop; all exit at duration.
export function computeMixPlan(sources, targetSeconds = 48) {
  if (!sources || !sources.length) return { duration: targetSeconds, masterLoop: 0, entries: [] };
  const masterLoop = Math.max(...sources.map((s) => s.loopDuration || 0));
  const duration = mixTargetDuration(masterLoop, targetSeconds);
  const entries = sources.map((_, i) => ({
    sourceIndex: i,
    enterAt: Math.min(i, 3) * masterLoop,
    exitAt: duration,
    fadeIn: i === 0 ? 0.5 : 1.5,
    fadeOut: 2.5,
  }));
  return { duration, masterLoop, entries };
}

const MOOD_RECIPES = {
  sunny:  { character: 'pad',   chord: [220, 277.18, 329.63], bass: 110,   filterHz: 1200, level: 0.055, osc: 'triangle' },
  rain:   { character: 'pad',   chord: [146.83, 174.61, 220], bass: 73.42, filterHz: 700,  level: 0.06,  osc: 'sine' },
  night:  { character: 'drone', chord: [55, 110, 164.81],     bass: 55,    filterHz: 500,  level: 0.07,  osc: 'sine' },
  breeze: { character: 'pad',   chord: [196, 293.66, 392],    bass: 98,    filterHz: 1500, level: 0.05,  osc: 'triangle' },
};

export function moodFoundation(moodId) {
  return MOOD_RECIPES[moodId] || MOOD_RECIPES.breeze;
}

// 16-bit PCM RIFF/WAVE. channels: Float32Array[] (1 or 2), samples clamped to [-1,1].
export function encodeWavPcm16(channels, sampleRate) {
  const numCh = channels.length;
  const numSamples = channels[0].length;
  const dataSize = numSamples * numCh * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  // RIFF chunk
  view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46);
  view.setUint32(4, 36 + dataSize, true);
  view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45);

  // fmt sub-chunk
  view.setUint8(12, 0x66); view.setUint8(13, 0x6D); view.setUint8(14, 0x74); view.setUint8(15, 0x20);
  view.setUint32(16, 16, true);          // subchunk1 size (PCM)
  view.setUint16(20, 1, true);           // AudioFormat = PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true); // byte rate
  view.setUint16(32, numCh * 2, true);   // block align
  view.setUint16(34, 16, true);          // bits per sample

  // data sub-chunk
  view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61);
  view.setUint32(40, dataSize, true);

  // interleaved samples
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, Math.max(-32768, Math.min(32767, Math.round(s * 32768))), true);
      offset += 2;
    }
  }
  return buf;
}

// --- Browser-only ---

export function encodeWavBlob(audioBuffer) {
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, c) =>
    audioBuffer.getChannelData(c)
  );
  return new Blob([encodeWavPcm16(channels, audioBuffer.sampleRate)], { type: 'audio/wav' });
}

// Spawn one AudioBufferSourceNode with a per-grain gain envelope.
function spawnSrc(ctx, buffer, destNode, gainValue, { when, offset, duration, fadeIn, fadeOut }) {
  const t = Math.max(0, when);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gainValue, t + Math.max(fadeIn, 0.001));
  g.gain.setValueAtTime(gainValue, t + duration - Math.max(fadeOut, 0.001));
  g.gain.linearRampToValueAtTime(0, t + duration);
  src.connect(g);
  g.connect(destNode);
  src.start(t, offset, duration);
}

// Build the texture insert between a source's layer mix and the master bus.
// Returns { input, output } AudioNodes.
function buildTexture(ctx, texture) {
  const input = ctx.createGain();

  if (texture === 'echo') {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.28;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    const dry = ctx.createGain();
    dry.gain.value = 1;
    const output = ctx.createGain();
    input.connect(dry); dry.connect(output);
    input.connect(delay);
    delay.connect(feedback); feedback.connect(delay); // feedback loop
    delay.connect(wet); wet.connect(output);
    return { input, output };
  }

  if (texture === 'wobble') {
    // Vibrato: delay modulated by slow LFO
    const vibratoDelay = ctx.createDelay(0.1);
    vibratoDelay.delayTime.value = 0.012;
    const vibratoLfo = ctx.createOscillator();
    vibratoLfo.type = 'sine';
    vibratoLfo.frequency.value = 0.9;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 0.006;
    vibratoLfo.connect(vibratoDepth);
    vibratoDepth.connect(vibratoDelay.delayTime);
    vibratoLfo.start(0);

    // Tremolo: amplitude modulated by slower LFO
    const tremoloGain = ctx.createGain();
    tremoloGain.gain.value = 1;
    const tremoloLfo = ctx.createOscillator();
    tremoloLfo.type = 'sine';
    tremoloLfo.frequency.value = 0.5;
    const tremoloDepth = ctx.createGain();
    tremoloDepth.gain.value = 0.15;
    tremoloLfo.connect(tremoloDepth);
    tremoloDepth.connect(tremoloGain.gain);
    tremoloLfo.start(0);

    input.connect(vibratoDelay);
    vibratoDelay.connect(tremoloGain);
    return { input, output: tremoloGain };
  }

  if (texture === 'warm') {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2200;
    filter.Q.value = 0.7;
    const output = ctx.createGain();
    output.gain.value = 1.15;
    input.connect(filter);
    filter.connect(output);
    return { input, output };
  }

  // raw: pass-through
  return { input, output: input };
}

// Render the full mix offline.
// sources: [{ layers: [{ buffer: AudioBuffer, analysis: {kind,bpm,firstOnset} }], texture }]
// Returns Promise<AudioBuffer> (stereo).
export async function renderMix({ sources, moodId, foundation, sampleRate = 44100 }) {
  // 1. Build per-source stack plans; skip sources with no usable layers.
  const usable = [];
  for (const src of sources) {
    const layers = (src.layers || []).filter((l) => l.buffer && l.buffer.duration > 0.05);
    if (!layers.length) continue;
    const plan = computeStackPlan(
      layers.map((l) => ({
        duration: l.buffer.duration,
        kind: l.analysis ? l.analysis.kind : 'ambient',
        bpm: l.analysis ? l.analysis.bpm : 0,
        firstOnset: l.analysis ? l.analysis.firstOnset : 0,
      }))
    );
    if (plan.loopDuration <= 0) continue;
    usable.push({ layers, plan, texture: src.texture || 'raw' });
  }
  if (!usable.length) throw new Error('no sources');

  // 2. Mix plan: staggered entries, shared duration.
  const mixPlan = computeMixPlan(
    usable.map((s) => ({
      loopDuration: s.plan.loopDuration,
      kind: s.plan.tempo > 0 ? 'rhythmic' : 'ambient',
      bpm: s.plan.tempo,
    }))
  );
  const { duration, entries } = mixPlan;

  // 3. Offline stereo context.
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);

  // 4. Master bus: masterGain → compressor → dry(0.84) + convolver → wet(0.16) → destination.
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0, 0);
  masterGain.gain.linearRampToValueAtTime(1, 0.5);
  const masterFadeStart = Math.max(0.5, duration - 2);
  masterGain.gain.setValueAtTime(1, masterFadeStart);
  masterGain.gain.linearRampToValueAtTime(0, duration);

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 24;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.22;

  const irCh = impulseResponseChannels(sampleRate, 1.6, 3.5);
  const irBuf = ctx.createBuffer(2, irCh[0].length, sampleRate);
  irBuf.getChannelData(0).set(irCh[0]);
  irBuf.getChannelData(1).set(irCh[1]);
  const convolver = ctx.createConvolver();
  convolver.buffer = irBuf;

  const dryGain = ctx.createGain();
  dryGain.gain.value = 0.84;
  const wetGain = ctx.createGain();
  wetGain.gain.value = 0.16;

  masterGain.connect(compressor);
  compressor.connect(dryGain);
  compressor.connect(convolver);
  convolver.connect(wetGain);
  dryGain.connect(ctx.destination);
  wetGain.connect(ctx.destination);

  // 5. Schedule each source.
  for (let si = 0; si < usable.length; si++) {
    const { layers, plan, texture } = usable[si];
    const entry = entries[si];
    if (!entry) continue;
    const { enterAt, exitAt, fadeIn, fadeOut } = entry;

    // Per-source entry/exit envelope.
    const srcEnv = ctx.createGain();
    srcEnv.gain.setValueAtTime(0, 0);
    if (enterAt > 0) srcEnv.gain.setValueAtTime(0, enterAt);
    srcEnv.gain.linearRampToValueAtTime(1, enterAt + fadeIn);
    const releaseStart = Math.max(enterAt + fadeIn, exitAt - fadeOut);
    srcEnv.gain.setValueAtTime(1, releaseStart);
    srcEnv.gain.linearRampToValueAtTime(0, exitAt);

    const tex = buildTexture(ctx, texture);
    srcEnv.connect(tex.input);
    tex.output.connect(masterGain);

    // Loop iterations from enterAt to exitAt.
    const loopDuration = plan.loopDuration;
    const layerGainValue = computeLayerGain(plan.layers.length);
    const numIters = Math.ceil((exitAt - enterAt) / loopDuration);

    for (let iter = 0; iter < numIters; iter++) {
      const iterStart = enterAt + iter * loopDuration;
      if (iterStart >= exitAt) break;
      const isFirst = iter === 0;

      for (const pl of plan.layers) {
        const layer = layers[pl.sourceIndex];
        if (!layer) continue;

        if (pl.kind === 'rhythmic') {
          for (let k = 0; k < pl.repeats; k++) {
            const when = iterStart + k * pl.playDuration;
            if (when >= exitAt) break;
            spawnSrc(ctx, layer.buffer, srcEnv, layerGainValue, {
              when,
              offset: pl.startOffset,
              duration: Math.min(pl.playDuration, exitAt - when),
              fadeIn: 0.006,
              fadeOut: 0.006,
            });
          }
        } else {
          // Ambient: overlap at seam with equal-power crossfade.
          const xf = pl.crossfade;
          const early = isFirst ? 0 : xf;
          const when = iterStart - early;
          spawnSrc(ctx, layer.buffer, srcEnv, layerGainValue, {
            when,
            offset: 0,
            duration: Math.min(layer.buffer.duration, loopDuration + xf),
            fadeIn: isFirst ? 0.006 : xf,
            fadeOut: xf,
          });
        }
      }
    }
  }

  // 6. Synth foundation (only when foundation === true).
  if (foundation) {
    const { chord, bass, filterHz, level, osc: oscType } = moodFoundation(moodId);

    // Slow attack 3s, release into final 2s.
    const foundEnv = ctx.createGain();
    foundEnv.gain.setValueAtTime(0, 0);
    foundEnv.gain.linearRampToValueAtTime(1, 3);
    const foundRelease = Math.max(3, duration - 2);
    foundEnv.gain.setValueAtTime(1, foundRelease);
    foundEnv.gain.linearRampToValueAtTime(0, duration);

    const foundFilter = ctx.createBiquadFilter();
    foundFilter.type = 'lowpass';
    foundFilter.frequency.value = filterHz;

    // Very slow filter breath LFO ±15% of filterHz at ~0.07 Hz.
    const filterLfo = ctx.createOscillator();
    filterLfo.type = 'sine';
    filterLfo.frequency.value = 0.07;
    const filterLfoDepth = ctx.createGain();
    filterLfoDepth.gain.value = filterHz * 0.15;
    filterLfo.connect(filterLfoDepth);
    filterLfoDepth.connect(foundFilter.frequency);
    filterLfo.start(0);
    filterLfo.stop(duration);

    foundEnv.connect(foundFilter);
    foundFilter.connect(masterGain);

    // Sunny + rhythmic bpm: soft pulse on the foundation bus.
    let firstRhythmicBpm = 0;
    for (const s of usable) {
      if (s.plan.tempo > 0) { firstRhythmicBpm = s.plan.tempo; break; }
    }
    if (moodId === 'sunny' && firstRhythmicBpm > 0) {
      const pulseLfo = ctx.createOscillator();
      pulseLfo.type = 'sine';
      pulseLfo.frequency.value = firstRhythmicBpm / 60;
      const pulseDepth = ctx.createGain();
      pulseDepth.gain.value = 0.25;
      pulseLfo.connect(pulseDepth);
      pulseDepth.connect(foundEnv.gain); // additive modulation on top of envelope
      pulseLfo.start(0);
      pulseLfo.stop(duration);
    }

    // One oscillator per chord note + bass.
    for (const freq of [...chord, bass]) {
      const osc = ctx.createOscillator();
      osc.type = oscType;
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g);
      g.connect(foundEnv);
      osc.start(0);
      osc.stop(duration);
    }
  }

  return ctx.startRendering();
}
