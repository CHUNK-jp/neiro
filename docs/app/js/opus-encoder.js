// opus-encoder.js — Ogg/Opus encoding for the MIX Studio feed-save path.
//
// Pure helpers (encoderInitMessage, estimateOpusBytes) are Node-testable and
// never touch browser globals. encodeBufferToOpusBlob is browser-only (Worker,
// URL, Blob) — those globals are only referenced inside that function so the
// module itself stays importable in Node.

export const OPUS_MIME = 'audio/ogg;codecs=opus';

// Bits/s, stereo. Measured ≈569KB for a 48s stereo mix (target 400–800KB);
// the WAV equivalent this replaces is ~8.5MB.
export const OPUS_BITRATE = 96000;

// Relative to this file (js/), resolved against import.meta.url at call time.
export const ENCODER_WORKER_PATH = '../vendor/opus-recorder/encoderWorker.min.js';

// --- Pure (Node-testable) ---

export function encoderInitMessage(numberOfChannels, originalSampleRate, bitRate = OPUS_BITRATE) {
  return {
    command: 'init',
    numberOfChannels,
    originalSampleRate,
    // Opus only runs at 48kHz — the encoder's speex resampler upsamples from
    // whatever rate the OfflineAudioContext rendered at (44.1kHz here).
    encoderSampleRate: 48000,
    encoderBitRate: bitRate,
    encoderApplication: 2049, // OPUS_APPLICATION_AUDIO
    encoderFrameSize: 20,
    resampleQuality: 3,
    maxFramesPerPage: 40,
  };
}

// Sanity-check helper for tests: bytes implied by bitRate * duration.
export function estimateOpusBytes(durationSeconds, bitRate = OPUS_BITRATE) {
  return Math.ceil(durationSeconds * bitRate / 8);
}

// --- Browser-only ---

export function encodeBufferToOpusBlob(audioBuffer, { bitRate = OPUS_BITRATE, workerUrl } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = (value) => { if (!settled) { settled = true; resolve(value); } };
    const settleReject = (err) => { if (!settled) { settled = true; reject(err); } };

    const url = workerUrl || new URL(ENCODER_WORKER_PATH, import.meta.url);
    const worker = new Worker(url); // classic worker — encoderWorker.min.js is not a module

    const pages = [];

    worker.onerror = (e) => {
      worker.terminate();
      settleReject(new Error('opus encoder worker failed: ' + (e.message || e.type)));
    };

    worker.onmessage = ({ data }) => {
      if (data && data.page) {
        pages.push(data.page);
        return;
      }
      if (data && data.message === 'done') {
        worker.terminate();
        settleResolve(new Blob(pages, { type: OPUS_MIME }));
        return;
      }
      if (data && data.message === 'ready') {
        // The encoder posts 'ready' once its WASM runtime has handled the
        // init command below — feeding audio before that would race
        // instantiation, so we wait for this signal to start.
        feedEncoder(worker, audioBuffer);
      }
    };

    worker.postMessage(encoderInitMessage(audioBuffer.numberOfChannels, audioBuffer.sampleRate, bitRate));
  });
}

// Emit the Ogg ID + comment header pages, then stream channel data in
// ~1-second chunks, then signal completion.
function feedEncoder(worker, audioBuffer) {
  worker.postMessage({ command: 'getHeaderPages' }); // without these the file is not a valid Ogg stream

  const numCh = audioBuffer.numberOfChannels;
  const channels = Array.from({ length: numCh }, (_, c) => audioBuffer.getChannelData(c));
  const chunkSize = audioBuffer.sampleRate; // ~1 second per chunk
  const total = audioBuffer.length;

  for (let off = 0; off < total; off += chunkSize) {
    const end = Math.min(off + chunkSize, total);
    // .slice() copies so the underlying full-channel buffers are never
    // detached by the transfer below.
    const buffers = channels.map((ch) => ch.slice(off, end));
    worker.postMessage({ command: 'encode', buffers }, buffers.map((b) => b.buffer));
  }

  worker.postMessage({ command: 'done' });
}
