// audio-analysis.js — lightweight onset detection, BPM estimation and
// rhythmic/ambient classification. Everything here is pure JS over
// Float32Array + sampleRate so it runs in Node tests as well as the browser.
//
// Deliberately simple by design: rhythmic layers are *not* time-stretched to
// the grid (a real phase vocoder is out of scope for a no-build vanilla app).
// Instead their loop boundaries snap to whole beats, which is what makes
// stacked loops feel locked together.

export const HOP_SIZE = 512;
export const MIN_BPM = 70;
export const MAX_BPM = 180;
export const MIN_ONSETS_FOR_RHYTHM = 4;
export const RHYTHM_SCORE_THRESHOLD = 0.45;

// RMS envelope, one value per hop.
export function rmsEnvelope(data, hop = HOP_SIZE) {
  const frames = Math.floor(data.length / hop);
  const env = new Float32Array(Math.max(0, frames));
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const start = i * hop;
    for (let j = 0; j < hop; j++) {
      const v = data[start + j];
      sum += v * v;
    }
    env[i] = Math.sqrt(sum / hop);
  }
  return env;
}

// Positive energy flux — rises in the envelope mark onsets. The first frame
// counts as a rise from silence so a hit right at t=0 isn't lost.
export function onsetStrength(env) {
  const out = new Float32Array(env.length);
  if (env.length) out[0] = env[0];
  for (let i = 1; i < env.length; i++) {
    out[i] = Math.max(0, env[i] - env[i - 1]);
  }
  return out;
}

// Peak-pick onset times (seconds). Adaptive threshold over the local mean,
// with a 100ms refractory period.
export function detectOnsets(strength, hopSeconds) {
  const times = [];
  if (!strength.length) return times;
  let mean = 0;
  for (const v of strength) mean += v;
  mean /= strength.length;
  let max = 0;
  for (const v of strength) max = Math.max(max, v);
  if (max <= 0) return times;
  const threshold = Math.max(mean * 2.5, max * 0.18);
  const refractory = 0.1;
  let last = -Infinity;
  for (let i = 0; i < strength.length; i++) {
    const v = strength[i];
    if (v < threshold) continue;
    const prev = i > 0 ? strength[i - 1] : 0;
    const next = i < strength.length - 1 ? strength[i + 1] : 0;
    if (v < prev || v < next) continue;
    const t = i * hopSeconds;
    if (t - last < refractory) continue;
    times.push(t);
    last = t;
  }
  return times;
}

// Scores each candidate BPM by how well inter-onset intervals land on whole
// multiples of its beat. Returns { bpm, score } with score in 0..1.
export function estimateBpm(onsetTimes, minBpm = MIN_BPM, maxBpm = MAX_BPM) {
  if (onsetTimes.length < 2) return { bpm: 0, score: 0 };
  const iois = [];
  for (let i = 1; i < onsetTimes.length; i++) {
    const d = onsetTimes[i] - onsetTimes[i - 1];
    if (d > 0.08 && d < 4) iois.push(d);
  }
  if (!iois.length) return { bpm: 0, score: 0 };

  let best = { bpm: 0, score: 0 };
  for (let bpm = minBpm; bpm <= maxBpm; bpm++) {
    const beat = 60 / bpm;
    let score = 0;
    for (const ioi of iois) {
      const multiple = Math.max(1, Math.round(ioi / beat));
      const deviation = Math.abs(ioi - multiple * beat) / beat;
      // full credit for spot-on intervals, fading out by a quarter beat off
      score += Math.max(0, 1 - deviation * 4) / multiple;
    }
    score /= iois.length;
    if (score > best.score) best = { bpm, score };
  }
  return best;
}

// Full analysis of one mono channel.
// kind: 'rhythmic' → snap to the beat grid; 'ambient' → crossfade loops.
export function analyzeChannel(data, sampleRate, hop = HOP_SIZE) {
  const env = rmsEnvelope(data, hop);
  const strength = onsetStrength(env);
  const hopSeconds = hop / sampleRate;
  const onsets = detectOnsets(strength, hopSeconds);
  const { bpm, score } = estimateBpm(onsets);
  const rhythmic =
    onsets.length >= MIN_ONSETS_FOR_RHYTHM && bpm > 0 && score >= RHYTHM_SCORE_THRESHOLD;
  return {
    kind: rhythmic ? 'rhythmic' : 'ambient',
    bpm: rhythmic ? bpm : 0,
    firstOnset: onsets.length ? onsets[0] : 0,
    onsetCount: onsets.length,
    score,
  };
}

// Mixes an AudioBuffer-like ({numberOfChannels, getChannelData}) to mono.
export function toMono(buffer) {
  const first = buffer.getChannelData(0);
  if (buffer.numberOfChannels === 1) return first;
  const out = new Float32Array(first.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / buffer.numberOfChannels;
  }
  return out;
}

export function analyzeBuffer(buffer) {
  return analyzeChannel(toMono(buffer), buffer.sampleRate);
}

// Snaps a duration to the nearest whole number of beats (at least one beat).
export function snapDurationToGrid(duration, bpm) {
  if (!bpm || bpm <= 0) return duration;
  const beat = 60 / bpm;
  const beats = Math.max(1, Math.round(duration / beat));
  return beats * beat;
}
