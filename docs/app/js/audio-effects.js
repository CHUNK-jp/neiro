// audio-effects.js — pitch shifting and the shared "glue" reverb.
//
// Pitch: AudioBufferSourceNode.detune changes pitch *and* speed, so instead
// we bounce offline: resample by the pitch ratio (pitch + speed change),
// then time-stretch back to the original length with windowed overlap-add.
// Quality is granular-shifter grade — right for 10-second sketches.
//
// The DSP below is pure Float32Array math (unit-tested in tests/); only the
// AudioBuffer/ConvolverNode wrappers at the bottom need a browser.

export const MIN_PITCH_SEMITONES = -12;
export const MAX_PITCH_SEMITONES = 12;

export function semitoneRatio(semitones) {
  return Math.pow(2, semitones / 12);
}

export function clampPitch(semitones) {
  return Math.max(MIN_PITCH_SEMITONES, Math.min(MAX_PITCH_SEMITONES, Math.round(semitones)));
}

export function hannWindow(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

// Linear-interpolation resampler. ratio > 1 raises pitch (shorter output).
export function resampleLinear(data, ratio) {
  const outLength = Math.max(1, Math.round(data.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(data.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = data[i0] * (1 - frac) + data[i1] * frac;
  }
  return out;
}

// Hann-windowed overlap-add time stretch. stretch > 1 lengthens the signal
// without changing pitch.
export function stretchOLA(data, stretch, frameSize = 2048) {
  if (Math.abs(stretch - 1) < 1e-6) return Float32Array.from(data);
  const synthesisHop = Math.round(frameSize / 4);
  const analysisHop = Math.max(1, Math.round(synthesisHop / stretch));
  const window = hannWindow(frameSize);
  const outLength = Math.max(frameSize, Math.round(data.length * stretch) + frameSize);
  const out = new Float32Array(outLength);
  const norm = new Float32Array(outLength);

  let inPos = 0;
  let outPos = 0;
  while (inPos + frameSize <= data.length) {
    for (let i = 0; i < frameSize; i++) {
      const w = window[i];
      out[outPos + i] += data[inPos + i] * w;
      norm[outPos + i] += w * w;
    }
    inPos += analysisHop;
    outPos += synthesisHop;
  }
  for (let i = 0; i < outLength; i++) {
    if (norm[i] > 1e-6) out[i] /= norm[i];
  }
  return out.subarray(0, Math.round(data.length * stretch));
}

// Shift pitch by N semitones, preserving duration. Returns new channel data
// trimmed/padded to the input length.
export function pitchShiftChannel(data, semitones) {
  const st = clampPitch(semitones);
  if (st === 0) return Float32Array.from(data);
  const ratio = semitoneRatio(st);
  const resampled = resampleLinear(data, ratio); // pitch shifted, wrong length
  const stretched = stretchOLA(resampled, ratio); // back to original length
  const out = new Float32Array(data.length);
  out.set(stretched.subarray(0, Math.min(stretched.length, data.length)));
  return out;
}

// Exponentially decaying stereo noise — the impulse response for the shared
// "same room" reverb. `random` is injectable for deterministic tests.
export function impulseResponseChannels(sampleRate, seconds = 1.6, decay = 3.5, random = Math.random) {
  const length = Math.max(1, Math.round(sampleRate * seconds));
  const channels = [new Float32Array(length), new Float32Array(length)];
  for (const ch of channels) {
    for (let i = 0; i < length; i++) {
      ch[i] = (random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return channels;
}

// --- Browser-only wrappers ---

export function pitchShiftBuffer(ctx, buffer, semitones) {
  if (clampPitch(semitones) === 0) return buffer;
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.getChannelData(c).set(pitchShiftChannel(buffer.getChannelData(c), semitones));
  }
  return out;
}

export function makeReverbBuffer(ctx, seconds, decay) {
  const channels = impulseResponseChannels(ctx.sampleRate, seconds, decay);
  const buffer = ctx.createBuffer(2, channels[0].length, ctx.sampleRate);
  buffer.getChannelData(0).set(channels[0]);
  buffer.getChannelData(1).set(channels[1]);
  return buffer;
}
