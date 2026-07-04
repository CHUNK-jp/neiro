// recorder.js — MediaRecorder wrapper: 10-second capped capture with
// level analysis for the waveform display.

export const MAX_DURATION_MS = 10000;
export const TICK_INTERVAL_MS = 100;

export const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

// --- Pure helpers (unit-tested in tests/) ---

// Picks the first supported container. `isSupported` is injectable for tests;
// in the browser it defaults to MediaRecorder.isTypeSupported.
export function pickMimeType(isSupported) {
  if (!isSupported) {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    isSupported = (type) => MediaRecorder.isTypeSupported(type);
  }
  for (const type of MIME_CANDIDATES) {
    if (isSupported(type)) return type;
  }
  return '';
}

// "10.0" → "0.0", clamped so the countdown never shows negatives.
export function formatCountdown(msLeft) {
  return (Math.max(0, msLeft) / 1000).toFixed(1);
}

export function elapsedRatio(elapsedMs, maxMs = MAX_DURATION_MS) {
  if (maxMs <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedMs / maxMs));
}

// --- Recorder ---

export class Recorder {
  constructor() {
    this.state = 'idle'; // idle | recording | stopped
    this.analyser = null;
    this._mediaRecorder = null;
    this._stream = null;
    this._sourceNode = null;
    this._chunks = [];
    this._startedAt = 0;
    this._tickTimer = null;
    this._stopTimer = null;
    this._onStop = null;
    this._onTick = null;
  }

  // Resolves once recording has actually started. Rejects if the microphone
  // is unavailable or permission is denied.
  async start({ onTick, onStop, audioContext } = {}) {
    if (this.state === 'recording') throw new Error('already recording');
    this._onTick = onTick || null;
    this._onStop = onStop || null;
    this._chunks = [];

    this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    if (audioContext) {
      this._sourceNode = audioContext.createMediaStreamSource(this._stream);
      this.analyser = audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this._sourceNode.connect(this.analyser); // analysis only — never to destination
    }

    const mimeType = pickMimeType();
    this._mediaRecorder = new MediaRecorder(
      this._stream,
      mimeType ? { mimeType } : undefined
    );
    this._mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size) this._chunks.push(e.data);
    };
    this._mediaRecorder.onstop = () => this._finish();

    await new Promise((resolve) => {
      this._mediaRecorder.onstart = () => resolve();
      this._mediaRecorder.start();
    });

    this.state = 'recording';
    this._startedAt = performance.now();

    this._tickTimer = setInterval(() => {
      const left = MAX_DURATION_MS - (performance.now() - this._startedAt);
      if (this._onTick) this._onTick(Math.max(0, left));
    }, TICK_INTERVAL_MS);

    this._stopTimer = setTimeout(() => this.stop(), MAX_DURATION_MS);
  }

  stop() {
    if (this.state !== 'recording') return;
    this.state = 'stopped';
    clearInterval(this._tickTimer);
    clearTimeout(this._stopTimer);
    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      this._mediaRecorder.stop();
    }
  }

  _finish() {
    const elapsedMs = Math.min(MAX_DURATION_MS, performance.now() - this._startedAt);
    const type = this._mediaRecorder ? this._mediaRecorder.mimeType : '';
    const blob = new Blob(this._chunks, type ? { type } : undefined);
    this._teardown();
    if (this._onStop) this._onStop(blob, elapsedMs);
  }

  _teardown() {
    if (this._stream) {
      for (const track of this._stream.getTracks()) track.stop();
    }
    if (this._sourceNode) this._sourceNode.disconnect();
    this._stream = null;
    this._sourceNode = null;
    this.analyser = null;
    this._mediaRecorder = null;
  }
}
