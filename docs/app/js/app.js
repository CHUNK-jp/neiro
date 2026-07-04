// app.js — entry point. Wires recorder, mixer, storage, feed and i18n.

import { Recorder, formatCountdown, elapsedRatio, MAX_DURATION_MS } from './recorder.js';
import { getContext, decodeBlob, StackPlayer } from './audio-mixer.js';
import { analyzeBuffer } from './audio-analysis.js';
import { pitchShiftBuffer, clampPitch, MIN_PITCH_SEMITONES, MAX_PITCH_SEMITONES } from './audio-effects.js';
import * as storage from './storage.js';
import { renderFeed, defaultTitle } from './feed.js';
import { initLang, getLang, toggleLang, t } from './i18n.js';

const els = {
  recorderCard: document.getElementById('recorder-card'),
  idlePanel: document.getElementById('panel-idle'),
  recordingPanel: document.getElementById('panel-recording'),
  previewPanel: document.getElementById('panel-preview'),
  micDeniedPanel: document.getElementById('panel-mic-denied'),
  recordBtn: document.getElementById('record-btn'),
  stopBtn: document.getElementById('stop-btn'),
  countdown: document.getElementById('countdown'),
  progressFill: document.getElementById('progress-fill'),
  waveCanvas: document.getElementById('wave-canvas'),
  layerBanner: document.getElementById('layer-banner'),
  layerBannerTitle: document.getElementById('layer-banner-title'),
  layerCancel: document.getElementById('layer-cancel'),
  previewPlayBtn: document.getElementById('preview-play-btn'),
  pitchValue: document.getElementById('pitch-value'),
  pitchDown: document.getElementById('pitch-down'),
  pitchUp: document.getElementById('pitch-up'),
  titleInput: document.getElementById('title-input'),
  postBtn: document.getElementById('post-btn'),
  discardBtn: document.getElementById('discard-btn'),
  feedList: document.getElementById('feed-list'),
  feedEmpty: document.getElementById('feed-empty'),
  installBtn: document.getElementById('install-btn'),
  langBtn: document.getElementById('lang-btn'),
  retryMicBtn: document.getElementById('retry-mic-btn'),
};

const state = {
  mode: 'idle', // idle | recording | preview
  layerTarget: null, // post being layered onto, or null
  recordedBlob: null,
  recordedBuffer: null, // decoded original recording
  pitch: 0, // semitones applied to the new layer
  playingId: null,
  loopIds: new Set(),
  confirmingDeleteId: null,
};

let recorder = null;
let feedPlayer = null; // currently playing feed stack
let previewPlayer = null;
let layerMonitor = null; // plays the base stack while recording a layer
let waveRaf = 0;
const layerCache = new Map(); // post.id -> [{buffer, analysis}]

// --- i18n ---

const STATIC_TEXT = {
  'nav-feed-link': 'navFeed',
  'nav-about-link': 'navAbout',
  'install-btn': 'install',
  'lang-btn': 'langToggle',
  'rec-hint': 'recHint',
  'rec-subhint': 'recSubhint',
  'stop-btn': 'tapToStop',
  'countdown-unit': 'sec',
  'preview-label': 'previewLabel',
  'pitch-label': 'pitchLabel',
  'post-btn': 'post',
  'discard-btn': 'discard',
  'mic-denied-title': 'micDeniedTitle',
  'mic-denied-body': 'micDeniedBody',
  'retry-mic-btn': 'retry',
  'feed-title': 'feedTitle',
  'feed-sub': 'feedSub',
  'feed-empty-1': 'feedEmpty1',
  'feed-empty-2': 'feedEmpty2',
  'layer-banner-hint': 'layerBannerHint',
  'footer-about': 'footerAbout',
};

function applyTranslations() {
  for (const [id, key] of Object.entries(STATIC_TEXT)) {
    const node = document.getElementById(id);
    if (node) node.textContent = t(key);
  }
  els.titleInput.placeholder = t('titlePlaceholder');
  document.documentElement.lang = getLang();
  updateLayerBanner();
  setPreviewButton(previewPlayer ? previewPlayer.playing : false);
}

// --- Feed ---

// Decodes every layer of a post, skipping any that are broken (e.g. empty
// blobs from an interrupted session) and applying per-layer pitch shift.
async function layersForPost(post) {
  if (layerCache.has(post.id)) return layerCache.get(post.id);
  const ctx = getContext();
  const decoded = [];
  for (const layer of post.layers || []) {
    if (!layer || !layer.blob || !layer.blob.size) continue;
    try {
      let buffer = await decodeBlob(layer.blob, ctx);
      const analysis = layer.analysis || analyzeBuffer(buffer);
      if (layer.pitch) buffer = pitchShiftBuffer(ctx, buffer, layer.pitch);
      decoded.push({ buffer, analysis });
    } catch (err) {
      console.warn('[neiro] skipping undecodable layer:', err);
    }
  }
  layerCache.set(post.id, decoded);
  return decoded;
}

async function refreshFeed() {
  let posts = [];
  try {
    posts = await storage.getAllPosts();
  } catch (err) {
    console.warn('[neiro] failed to load posts:', err);
  }
  els.feedEmpty.hidden = posts.length > 0;
  renderFeed(els.feedList, posts, feedHandlers, state, t);
}

function stopFeedPlayback() {
  if (feedPlayer) {
    feedPlayer.onended = null;
    feedPlayer.stop();
    feedPlayer = null;
  }
  state.playingId = null;
}

const feedHandlers = {
  async onPlay(post) {
    try {
      if (state.playingId === post.id) {
        stopFeedPlayback();
        await refreshFeed();
        return;
      }
      stopFeedPlayback();
      const layers = await layersForPost(post);
      if (!layers.length) {
        console.warn('[neiro] no playable layers in post', post.id);
        return;
      }
      feedPlayer = new StackPlayer(getContext(), layers);
      feedPlayer.loop = state.loopIds.has(post.id);
      feedPlayer.onended = () => {
        state.playingId = null;
        refreshFeed();
      };
      await feedPlayer.play();
      state.playingId = post.id;
    } catch (err) {
      console.warn('[neiro] playback failed:', err);
      stopFeedPlayback();
    }
    await refreshFeed();
  },

  async onLoopToggle(post) {
    if (state.loopIds.has(post.id)) {
      state.loopIds.delete(post.id);
    } else {
      state.loopIds.add(post.id);
    }
    if (state.playingId === post.id && feedPlayer) {
      feedPlayer.setLoop(state.loopIds.has(post.id));
    }
    await refreshFeed();
  },

  async onLayer(post) {
    if (state.mode === 'recording') return;
    stopFeedPlayback();
    stopPreview();
    state.layerTarget = post;
    state.recordedBlob = null;
    state.recordedBuffer = null;
    setMode('idle');
    els.recorderCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await refreshFeed();
  },

  // Two-tap delete: first tap arms the button, second tap deletes.
  async onDelete(post) {
    if (state.confirmingDeleteId !== post.id) {
      state.confirmingDeleteId = post.id;
      await refreshFeed();
      setTimeout(async () => {
        if (state.confirmingDeleteId === post.id) {
          state.confirmingDeleteId = null;
          await refreshFeed();
        }
      }, 3000);
      return;
    }
    state.confirmingDeleteId = null;
    if (state.playingId === post.id) stopFeedPlayback();
    if (state.layerTarget && state.layerTarget.id === post.id) cancelLayerMode();
    layerCache.delete(post.id);
    state.loopIds.delete(post.id);
    await storage.deletePost(post.id);
    await refreshFeed();
  },
};

// --- Recorder UI ---

function setMode(mode) {
  state.mode = mode;
  els.idlePanel.hidden = mode !== 'idle';
  els.recordingPanel.hidden = mode !== 'recording';
  els.previewPanel.hidden = mode !== 'preview';
  els.micDeniedPanel.hidden = true;
  els.recorderCard.classList.toggle('is-recording', mode === 'recording');
  updateLayerBanner();
}

function updateLayerBanner() {
  const target = state.layerTarget;
  els.layerBanner.hidden = !target;
  if (target) {
    els.layerBannerTitle.textContent = t('layerBanner', target.title);
  }
}

function cancelLayerMode() {
  state.layerTarget = null;
  updateLayerBanner();
}

async function startRecording() {
  const ctx = getContext();
  if (ctx.state === 'suspended') await ctx.resume();
  stopFeedPlayback();
  stopPreview();

  recorder = new Recorder();
  try {
    await recorder.start({
      audioContext: ctx,
      onTick: (msLeft) => {
        els.countdown.textContent = formatCountdown(msLeft);
        els.progressFill.style.width = `${elapsedRatio(MAX_DURATION_MS - msLeft) * 100}%`;
      },
      onStop: onRecordingStopped,
    });
  } catch (err) {
    console.warn('[neiro] microphone unavailable:', err);
    showMicDenied();
    return;
  }

  // In layer mode, play the base stack while recording so the user can
  // perform along with it (headphones recommended).
  if (state.layerTarget) {
    try {
      const layers = await layersForPost(state.layerTarget);
      if (layers.length) {
        layerMonitor = new StackPlayer(ctx, layers);
        layerMonitor.loop = true; // keep the bed going for the full take
        await layerMonitor.play();
      }
    } catch (err) {
      console.warn('[neiro] could not monitor base stack:', err);
    }
  }

  els.countdown.textContent = formatCountdown(MAX_DURATION_MS);
  els.progressFill.style.width = '0%';
  setMode('recording');
  drawWaveform();
}

function stopRecording() {
  if (recorder) recorder.stop();
}

async function onRecordingStopped(blob) {
  cancelAnimationFrame(waveRaf);
  if (layerMonitor) {
    layerMonitor.stop();
    layerMonitor = null;
  }
  if (!blob || !blob.size) {
    setMode('idle');
    return;
  }
  state.recordedBlob = blob;
  state.recordedBuffer = null;
  state.pitch = 0;
  els.pitchValue.textContent = '0';
  els.titleInput.value = '';
  setMode('preview');
}

function showMicDenied() {
  setMode('idle');
  els.idlePanel.hidden = true;
  els.micDeniedPanel.hidden = false;
}

// Amber time-domain bars while recording, in the Wonder tone.
function drawWaveform() {
  const canvas = els.waveCanvas;
  const g = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;

  const render = () => {
    if (state.mode !== 'recording' || !recorder || !recorder.analyser) return;
    const analyser = recorder.analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);

    g.clearRect(0, 0, canvas.width, canvas.height);
    const bars = 36;
    const step = Math.floor(data.length / bars);
    const barW = canvas.width / bars;
    const midY = canvas.height / 2;
    g.fillStyle = '#F59E0B';
    for (let i = 0; i < bars; i++) {
      let peak = 0;
      for (let j = i * step; j < (i + 1) * step; j++) {
        peak = Math.max(peak, Math.abs(data[j] - 128));
      }
      const h = Math.max(3 * dpr, (peak / 128) * canvas.height * 0.9);
      g.globalAlpha = 0.85;
      g.fillRect(i * barW + barW * 0.22, midY - h / 2, barW * 0.56, h);
    }
    waveRaf = requestAnimationFrame(render);
  };
  waveRaf = requestAnimationFrame(render);
}

// --- Preview / pitch / post ---

async function recordedBufferOriginal() {
  if (!state.recordedBuffer) {
    state.recordedBuffer = await decodeBlob(state.recordedBlob, getContext());
  }
  return state.recordedBuffer;
}

async function newLayerDescriptor() {
  const original = await recordedBufferOriginal();
  const analysis = analyzeBuffer(original);
  const buffer = state.pitch
    ? pitchShiftBuffer(getContext(), original, state.pitch)
    : original;
  return { buffer, analysis };
}

function stopPreview() {
  if (previewPlayer) {
    previewPlayer.onended = null;
    previewPlayer.stop();
    previewPlayer = null;
  }
  setPreviewButton(false);
}

function setPreviewButton(playing) {
  els.previewPlayBtn.classList.toggle('is-active', playing);
  const label = els.previewPlayBtn.querySelector('span');
  if (label) label.textContent = playing ? t('previewStop') : t('previewPlay');
}

async function togglePreview() {
  if (previewPlayer && previewPlayer.playing) {
    stopPreview();
    return;
  }
  stopPreview();
  try {
    const newLayer = await newLayerDescriptor();
    const layers = state.layerTarget
      ? [...(await layersForPost(state.layerTarget)), newLayer]
      : [newLayer];
    previewPlayer = new StackPlayer(getContext(), layers);
    previewPlayer.loop = true; // hear how the loop settles
    previewPlayer.onended = () => setPreviewButton(false);
    await previewPlayer.play();
    setPreviewButton(true);
  } catch (err) {
    console.warn('[neiro] preview failed:', err);
  }
}

function nudgePitch(delta) {
  state.pitch = clampPitch(state.pitch + delta);
  els.pitchValue.textContent = state.pitch > 0 ? `+${state.pitch}` : String(state.pitch);
  els.pitchDown.disabled = state.pitch <= MIN_PITCH_SEMITONES;
  els.pitchUp.disabled = state.pitch >= MAX_PITCH_SEMITONES;
  if (previewPlayer && previewPlayer.playing) {
    // restart preview so the new pitch is audible immediately
    stopPreview();
    togglePreview();
  }
}

async function postRecording() {
  if (!state.recordedBlob || !state.recordedBlob.size) {
    setMode('idle');
    return;
  }
  stopPreview();
  const target = state.layerTarget;
  const title = els.titleInput.value.trim() || defaultTitle(new Date(), t);
  let analysis = null;
  try {
    analysis = analyzeBuffer(await recordedBufferOriginal());
  } catch (err) {
    console.warn('[neiro] analysis failed, treating as ambient:', err);
    analysis = { kind: 'ambient', bpm: 0, firstOnset: 0 };
  }
  const newLayer = {
    blob: state.recordedBlob,
    type: state.recordedBlob.type || '',
    pitch: state.pitch,
    analysis: { kind: analysis.kind, bpm: analysis.bpm, firstOnset: analysis.firstOnset },
  };
  const post = {
    id: crypto.randomUUID(),
    title,
    createdAt: Date.now(),
    parentId: target ? target.id : null,
    parentTitle: target ? target.title : null,
    layers: target
      ? [...target.layers.map((l) => ({ ...l })), newLayer]
      : [newLayer],
  };
  await storage.addPost(post);
  state.recordedBlob = null;
  state.recordedBuffer = null;
  state.pitch = 0;
  cancelLayerMode();
  setMode('idle');
  await refreshFeed();
}

function discardRecording() {
  stopPreview();
  state.recordedBlob = null;
  state.recordedBuffer = null;
  state.pitch = 0;
  setMode('idle');
}

// --- PWA ---

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('[neiro] service worker registration failed:', err);
    });
  });
}

function setupInstallPrompt() {
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    els.installBtn.hidden = false;
  });
  els.installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    els.installBtn.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    els.installBtn.hidden = true;
  });
}

// --- Wire up ---

els.recordBtn.addEventListener('click', startRecording);
els.stopBtn.addEventListener('click', stopRecording);
els.layerCancel.addEventListener('click', cancelLayerMode);
els.previewPlayBtn.addEventListener('click', togglePreview);
els.pitchDown.addEventListener('click', () => nudgePitch(-1));
els.pitchUp.addEventListener('click', () => nudgePitch(1));
els.postBtn.addEventListener('click', postRecording);
els.discardBtn.addEventListener('click', discardRecording);
els.retryMicBtn.addEventListener('click', () => setMode('idle'));
els.langBtn.addEventListener('click', async () => {
  toggleLang();
  applyTranslations();
  await refreshFeed();
});

initLang();
applyTranslations();
registerServiceWorker();
setupInstallPrompt();
setMode('idle');
refreshFeed();
