// audio-mixer.js — Web Audio playback of layered posts.
//
// A stack plays as one "loop iteration":
//   - rhythmic layers snap to the beat grid of the stack tempo (trimmed to
//     whole beats, lead-in silence skipped, short phrases repeated to fill
//     the loop) — no time-stretching, just alignment;
//   - ambient layers ignore the grid and get equal-power crossfades at the
//     loop seam so field recordings loop without clicks;
//   - everything runs through a shared master bus (gentle compression +
//     generated-IR convolution reverb) so different sources sit in the same
//     room.
//
// computeStackPlan is pure and unit-tested in tests/.

import { snapDurationToGrid } from './audio-analysis.js';
import { makeReverbBuffer } from './audio-effects.js';

let sharedContext = null;

export function getContext() {
  if (!sharedContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    sharedContext = new Ctx();
  }
  return sharedContext;
}

export async function decodeBlob(blob, ctx = getContext()) {
  const data = await blob.arrayBuffer();
  return ctx.decodeAudioData(data);
}

// --- Pure helpers (unit-tested in tests/) ---

export function mixDurationSeconds(buffers) {
  let max = 0;
  for (const b of buffers) max = Math.max(max, b.duration);
  return max;
}

// Equal-power headroom per layer; the master compressor catches the rest.
export function computeLayerGain(layerCount) {
  return Math.min(1, 1 / Math.sqrt(Math.max(1, layerCount)));
}

export const AMBIENT_CROSSFADE_S = 0.25;
// Rendered MIX tracks (mix-engine.js renderMix) bake a fixed ~2s tail fade
// into the actual samples. Looping them with the normal short ambient
// crossfade means the outgoing copy is already fading to silence for ~1.75s
// before the next copy's crossfade window even starts — an audible dip.
// A crossfade longer than that baked fade guarantees the incoming copy is
// back at full volume by the time the outgoing one bottoms out, so the seam
// reads as one continuous swell instead of a gap.
export const MIX_LOOP_CROSSFADE_S = 2.4;
export const EDGE_FADE_S = 0.006;

// layers: [{ duration, kind: 'rhythmic'|'ambient', bpm, firstOnset, loopCrossfade? }]
// Returns { tempo, loopDuration, layers: [plan] } where each plan is
//   { kind, startOffset, playDuration, repeats, crossfade, sourceIndex }.
// sourceIndex points back into the input array (too-short layers are
// dropped, so plan indices don't line up with input indices).
export function computeStackPlan(layers) {
  const usable = layers
    .map((l, sourceIndex) => ({ ...l, sourceIndex }))
    .filter((l) => l.duration > 0.05);
  if (!usable.length) return { tempo: 0, loopDuration: 0, layers: [] };

  // Stack tempo comes from the oldest rhythmic layer — the one everyone
  // else layered onto.
  const anchor = usable.find((l) => l.kind === 'rhythmic' && l.bpm > 0);
  const tempo = anchor ? anchor.bpm : 0;
  const beat = tempo > 0 ? 60 / tempo : 0;

  const plans = usable.map((layer) => {
    if (tempo > 0 && layer.kind === 'rhythmic') {
      const startOffset = Math.min(layer.firstOnset || 0, Math.max(0, layer.duration - 0.1));
      const available = layer.duration - startOffset;
      let playDuration = snapDurationToGrid(available, tempo);
      // Snapping must not run past the end of the recording; prefer the
      // largest whole-beat length that fits, unless the clip is under a beat.
      if (playDuration > available && available >= beat) {
        playDuration = Math.floor(available / beat) * beat;
      }
      return {
        kind: 'rhythmic',
        startOffset,
        playDuration,
        repeats: 1,
        crossfade: 0,
        sourceIndex: layer.sourceIndex,
      };
    }
    return {
      kind: 'ambient',
      startOffset: 0,
      playDuration: layer.duration,
      repeats: 1,
      crossfade: Math.min(layer.loopCrossfade || AMBIENT_CROSSFADE_S, layer.duration / 4),
      sourceIndex: layer.sourceIndex,
    };
  });

  // Loop length: longest layer, rounded up to whole beats when on a grid.
  let loopDuration = Math.max(...plans.map((p) => p.playDuration));
  if (tempo > 0) {
    loopDuration = Math.ceil(loopDuration / beat - 1e-6) * beat;
  }

  // Short rhythmic phrases repeat to fill the loop (2 beats in an 8-beat
  // loop plays 4 times) — this is what makes sparse taps feel like a groove.
  for (const plan of plans) {
    if (plan.kind === 'rhythmic' && plan.playDuration > 0) {
      plan.repeats = Math.max(1, Math.round(loopDuration / plan.playDuration));
      // only repeat on exact subdivisions of the loop
      if (Math.abs(plan.repeats * plan.playDuration - loopDuration) > 0.01) {
        plan.repeats = 1;
      }
    }
  }

  return { tempo, loopDuration, layers: plans };
}

// --- Master bus (6c): compression + shared-room reverb ---

export const REVERB_WET = 0.16;
export const MASTER_GAIN = 0.9;

let reverbBufferCache = null;

function buildMasterBus(ctx) {
  const input = ctx.createGain();
  input.gain.value = MASTER_GAIN;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 24;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.22;

  const dry = ctx.createGain();
  dry.gain.value = 1 - REVERB_WET;
  const wet = ctx.createGain();
  wet.gain.value = REVERB_WET;

  if (!reverbBufferCache || reverbBufferCache.sampleRate !== ctx.sampleRate) {
    reverbBufferCache = makeReverbBuffer(ctx, 1.6, 3.5);
  }
  const convolver = ctx.createConvolver();
  convolver.buffer = reverbBufferCache;

  input.connect(compressor);
  compressor.connect(dry);
  compressor.connect(convolver);
  convolver.connect(wet);
  dry.connect(ctx.destination);
  wet.connect(ctx.destination);

  return {
    input,
    disconnect() {
      input.disconnect();
      compressor.disconnect();
      convolver.disconnect();
      dry.disconnect();
      wet.disconnect();
    },
  };
}

// --- StackPlayer ---

const LOOP_LOOKAHEAD_MS = 150;

// layers: [{ buffer: AudioBuffer, analysis: {kind,bpm,firstOnset,loopCrossfade?} }]
export class StackPlayer {
  constructor(ctx, layers) {
    this.ctx = ctx;
    this.layers = layers;
    this.plan = computeStackPlan(
      layers.map((l) => ({
        duration: l.buffer.duration,
        kind: l.analysis ? l.analysis.kind : 'ambient',
        bpm: l.analysis ? l.analysis.bpm : 0,
        firstOnset: l.analysis ? l.analysis.firstOnset : 0,
        loopCrossfade: l.analysis ? l.analysis.loopCrossfade : undefined,
      }))
    );
    this.duration = this.plan.loopDuration;
    this.loop = false;
    this.playing = false;
    this.onended = null;
    this._active = [];
    this._timer = null;
    this._iterStart = 0;
    this._first = true;
    this._bus = null;
  }

  async play() {
    if (this.playing) this.stop();
    if (!this.layers.length || this.duration <= 0) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this._bus = buildMasterBus(this.ctx);
    this.playing = true;
    this._first = true;
    this._iterStart = this.ctx.currentTime + 0.06;
    this._startIteration();
  }

  _spawnSource(layer, gainValue, { when, offset, duration, fadeIn, fadeOut }) {
    const src = this.ctx.createBufferSource();
    src.buffer = layer.buffer;
    const gain = this.ctx.createGain();
    const g = gain.gain;
    if (fadeIn > 0 || fadeOut > 0) {
      g.setValueAtTime(0, when);
      g.linearRampToValueAtTime(gainValue, when + Math.max(fadeIn, 0.001));
      g.setValueAtTime(gainValue, when + duration - Math.max(fadeOut, 0.001));
      g.linearRampToValueAtTime(0, when + duration);
    } else {
      g.setValueAtTime(gainValue, when);
    }
    src.connect(gain);
    gain.connect(this._bus.input);
    src.start(when, offset, duration);
    this._active.push(src);
    src.onended = () => {
      const i = this._active.indexOf(src);
      if (i !== -1) this._active.splice(i, 1);
      gain.disconnect();
    };
  }

  _startIteration() {
    const when = this._iterStart;
    const gainValue = computeLayerGain(this.plan.layers.length);

    for (const plan of this.plan.layers) {
      const layer = this.layers[plan.sourceIndex];
      if (!layer) continue;
      if (plan.kind === 'rhythmic') {
        for (let k = 0; k < plan.repeats; k++) {
          this._spawnSource(layer, gainValue, {
            when: when + k * plan.playDuration,
            offset: plan.startOffset,
            duration: plan.playDuration,
            fadeIn: EDGE_FADE_S,
            fadeOut: EDGE_FADE_S,
          });
        }
      } else {
        // Ambient: start a crossfade-length early at the seam so the loop
        // boundary is an equal-power blend instead of a cut.
        const xf = plan.crossfade;
        const early = this._first ? 0 : xf;
        this._spawnSource(layer, gainValue, {
          when: when - early,
          offset: 0,
          duration: Math.min(layer.buffer.duration, this.duration + xf),
          fadeIn: this._first ? EDGE_FADE_S : xf,
          fadeOut: xf,
        });
      }
    }

    this._first = false;
    this._scheduleNext();
  }

  _scheduleNext() {
    clearTimeout(this._timer);
    if (!this.playing) return;
    const endAt = this._iterStart + this.duration;
    const msUntilEnd = Math.max(0, (endAt - this.ctx.currentTime) * 1000);
    if (this.loop) {
      this._timer = setTimeout(() => {
        if (!this.playing || !this.loop) return;
        this._iterStart = endAt;
        this._startIteration();
      }, Math.max(0, msUntilEnd - LOOP_LOOKAHEAD_MS));
    } else {
      this._timer = setTimeout(() => {
        this.stop();
        if (this.onended) this.onended();
      }, msUntilEnd + AMBIENT_CROSSFADE_S * 1000 + 60);
    }
  }

  setLoop(value) {
    this.loop = !!value;
    if (this.playing) this._scheduleNext();
  }

  stop() {
    clearTimeout(this._timer);
    this._timer = null;
    this.playing = false;
    for (const src of this._active) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        // already stopped
      }
    }
    this._active = [];
    if (this._bus) {
      this._bus.disconnect();
      this._bus = null;
    }
  }
}
