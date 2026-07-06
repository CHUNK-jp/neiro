// mix-app.js — MIX Studio page controller.
// Five screens: 0 Feed → 1 Texture → 2 Mood → 3 Generating → 4 Result.

import { getAllPosts, addPost, setFavorite } from './storage.js';
import { getContext, decodeBlob, StackPlayer, MIX_LOOP_CROSSFADE_S } from './audio-mixer.js';
import { analyzeBuffer } from './audio-analysis.js';
import { pitchShiftBuffer } from './audio-effects.js';
import { renderMix, encodeWavBlob } from './mix-engine.js';
import { initLang, toggleLang, getLang, t } from './i18n.js';
import { filterFavorites } from './feed.js';

// ---- Design constants ----

const PRESET_DEFS = [
  { id: 'raw',    icon: '◈', iconBg: 'rgba(244,233,216,0.08)',  nameKey: 'mixTexRaw' },
  { id: 'echo',   icon: '◌', iconBg: 'rgba(96,165,250,0.15)',  nameKey: 'mixTexEcho' },
  { id: 'wobble', icon: '∿', iconBg: 'rgba(167,139,250,0.15)', nameKey: 'mixTexWobble' },
  { id: 'warm',   icon: '●', iconBg: 'rgba(245,158,11,0.15)',  nameKey: 'mixTexWarm' },
];

const MOOD_DEFS = [
  { id: 'sunny',  icon: '☀',  bg: 'linear-gradient(160deg,#3a2a00,#1a1500)', ring: '#F59E0B', glow: '0 0 24px rgba(245,158,11,0.35)',    twinkleDur: 2.4, nameKey: 'mixMoodSunny',  descKey: 'mixMoodSunnyDesc' },
  { id: 'rain',   icon: '☂',  bg: 'linear-gradient(160deg,#12253f,#0d1829)', ring: '#60A5FA', glow: '0 0 24px rgba(96,165,250,0.35)',    twinkleDur: 3.4, nameKey: 'mixMoodRain',   descKey: 'mixMoodRainDesc' },
  { id: 'night',  icon: '☾',  bg: 'linear-gradient(160deg,#2a1533,#1a0d1a)', ring: '#A78BFA', glow: '0 0 24px rgba(167,139,250,0.35)',   twinkleDur: 4.4, nameKey: 'mixMoodNight',  descKey: 'mixMoodNightDesc' },
  { id: 'breeze', icon: '〜', bg: 'linear-gradient(160deg,#0f2b1f,#001a0d)', ring: '#6EE7B7', glow: '0 0 24px rgba(110,231,183,0.35)',   twinkleDur: 2.4, nameKey: 'mixMoodBreeze', descKey: 'mixMoodBreezeDesc' },
];

// Ripple sources for screen 3 (from template's renderVals).
const RIPPLE_SOURCES = [
  { left: 34, top: 42, color: 'rgba(245,158,11,0.85)',  dur: 5.6, maxSize: 260 },
  { left: 36, top: 64, color: 'rgba(110,231,183,0.8)',  dur: 6.0, maxSize: 230 },
  { left: 50, top: 50, color: 'rgba(255,255,255,0.55)', dur: 4.6, maxSize: 200 },
];

// ---- App state ----

const state = {
  screen: 0,
  posts: [],           // all posts from storage (newest first)
  favoritesOnly: false, // screen-0 filter; in-memory only, matches app.js's state.favoritesOnly
  selectedIds: [],     // post ids in selection order
  textures: {},        // { postId: textureId } defaults to 'raw'
  moodId: null,
  musicOn: true,
  rendered: null,      // AudioBuffer from renderMix
  wavBlob: null,       // lazy-encoded WAV blob
  player: null,        // StackPlayer wrapping the rendered mix
  playStartCtxTime: 0, // ctx.currentTime when the current play() started
  playRaf: 0,
  loopOn: false,
  postBtnPosted: false,
};

// ---- DOM refs ----

const $ = (id) => document.getElementById(id);
const screens = [0, 1, 2, 3, 4].map((i) => $(`screen-${i}`));

const els = {
  backBtn:         $('back-btn'),
  screenLabel:     $('screen-label'),
  langPill:        $('lang-pill'),
  // Screen 0
  feedTitle:       $('feed-title'),
  feedSub:         $('feed-sub'),
  favFilterBtn:    $('fav-filter-btn'),
  soundsGrid:      $('sounds-grid'),
  continueBar:     $('continue-bar'),
  continueBtn:     $('continue-btn'),
  // Screen 1
  texTitle:        $('tex-title'),
  texSub:          $('tex-sub'),
  texRows:         $('tex-rows'),
  texNextBtn:      $('tex-next-btn'),
  // Screen 2
  moodTitle:       $('mood-title'),
  moodSub:         $('mood-sub'),
  moodGrid:        $('mood-grid'),
  musicToggleRow:  $('music-toggle-row'),
  musicSwitch:     $('music-switch'),
  musicLabel:      $('music-label'),
  musicDesc:       $('music-desc'),
  mixBtn:          $('mix-btn'),
  // Screen 3
  rippleStage:     $('ripple-stage'),
  genLine:         $('gen-line'),
  genSub:          $('gen-sub'),
  // Screen 4
  resultEyebrow:   $('result-eyebrow'),
  resultTitle:     $('result-title'),
  resultMeta:      $('result-meta'),
  artworkCard:     $('artwork-card'),
  artworkIcon:     $('artwork-icon'),
  artworkWave:     $('artwork-wave'),
  artworkTitleEl:  $('artwork-title-el'),
  artworkDur:      $('artwork-dur'),
  playBtn:         $('play-btn'),
  loopBtn:         $('loop-btn'),
  progressBars:    $('progress-bars'),
  shareBtn:        $('share-btn'),
  postBtn:         $('post-btn'),
  newMixBtn:       $('new-mix-btn'),
};

// Same glyph as feed.js's LOOP_ICON — kept as a local copy since the two
// pages don't share a rendering module.
const LOOP_ICON = '<svg viewBox="0 0 16 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" width="14" height="12" aria-hidden="true"><path d="M1 4h9a3 3 0 010 6H9"></path><path d="M15 4l-2-2M15 4l-2 2"></path><path d="M15 10H6a3 3 0 010-6H7"></path><path d="M1 10l2-2M1 10l2 2"></path></svg>';

// Same glyphs as feed.js's STAR_ICON/STAR_OUTLINE_ICON — kept as local copies
// for the same reason as LOOP_ICON above: two pages, no shared rendering module.
const STAR_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"></path></svg>';
const STAR_OUTLINE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"></path></svg>';

// ---- Deterministic pseudo-random waveform ----

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function waveHeights(seed, count) {
  // Same formula as template mkWave
  return Array.from({ length: count }, (_, i) => 20 + Math.abs(Math.sin(i * 0.8 + seed)) * 75);
}

function waveHeightsFromId(postId, count) {
  const hash = hashCode(postId + ':wave');
  return waveHeights(hash % 100, count);
}

// ---- Navigation ----

function goTo(screen) {
  state.screen = screen;
  screens.forEach((el, i) => { el.hidden = i !== screen; });
  els.backBtn.hidden = screen !== 1 && screen !== 2;
  renderTopBar();
}

function goBack() {
  if (state.screen > 0) goTo(state.screen - 1);
}

// ---- Top bar ---- (text only; structure is static HTML)

const SCREEN_LABELS = () => [
  'FEED',
  t('mixTextureTitle'),
  t('mixMoodLabel'),
  '',
  '',
];

function renderTopBar() {
  els.screenLabel.textContent = SCREEN_LABELS()[state.screen] || '';
  els.langPill.textContent = t('langToggle');
}

// ---- Screen 0: Feed ----

function selectedPosts() {
  return state.selectedIds.map((id) => state.posts.find((p) => p.id === id)).filter(Boolean);
}

function usedCount(post) {
  return state.posts.filter(
    (p) => p.mix && Array.isArray(p.mix.sourceIds) && p.mix.sourceIds.includes(post.id)
  ).length;
}

function formatDuration(post) {
  let maxDur = null;
  for (const layer of post.layers || []) {
    if (layer.analysis && layer.analysis.duration != null) {
      maxDur = maxDur == null ? layer.analysis.duration : Math.max(maxDur, layer.analysis.duration);
    }
  }
  if (maxDur == null) return null;
  return `${Math.round(maxDur)}s`;
}

function buildSoundCard(post) {
  const isSelected = state.selectedIds.includes(post.id);
  const isFavorite = !!post.favorite;
  const dur = formatDuration(post);
  const used = usedCount(post);
  const durStr = dur != null ? `${dur} ・ ` : '';
  const heights = waveHeightsFromId(post.id, 18);

  const card = document.createElement('div');
  card.className = 'sound-card' + (isSelected ? ' selected' : '');
  card.dataset.id = post.id;

  card.innerHTML = `
    <div class="sound-card-bg"></div>
    <div class="sound-card-head">
      <div>
        <div class="sound-card-title">${escHtml(post.title || t('mixUntitled'))}</div>
        <div class="sound-card-meta">${escHtml(durStr + t('mixUsed', used))}</div>
      </div>
      <div class="sound-card-head-actions">
        <button type="button" class="sound-star${isFavorite ? ' is-active' : ''}" aria-pressed="${isFavorite}" aria-label="${escHtml(t('favorite'))}">${isFavorite ? STAR_ICON : STAR_OUTLINE_ICON}</button>
        <div class="sound-check">
          <span class="sound-check-mark">✓</span>
        </div>
      </div>
    </div>
    <div class="sound-wave"></div>
  `;

  const wave = card.querySelector('.sound-wave');
  for (const h of heights) {
    const bar = document.createElement('div');
    bar.className = 'sound-wave-bar';
    bar.style.height = `${h}%`;
    wave.appendChild(bar);
  }

  // The whole card is clickable to toggle mix-selection, so the star button
  // must stop propagation or tapping it would also select/deselect the card.
  const starBtn = card.querySelector('.sound-star');
  starBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(post.id);
  });

  card.addEventListener('click', () => toggleSound(post.id));
  return card;
}

// Reuses storage.setFavorite exactly as-is (same path the Feed uses), then
// patches the in-memory state.posts snapshot so screen 0 reflects the change
// immediately — state.posts is only fetched once at init(), it won't refresh
// on its own.
async function toggleFavorite(postId) {
  const post = state.posts.find((p) => p.id === postId);
  if (!post) return;
  const next = !post.favorite;
  try {
    await setFavorite(postId, next);
  } catch (err) {
    console.warn('[neiro] failed to toggle favorite:', err);
    return;
  }
  post.favorite = next;
  renderScreen0();
}

function toggleSound(postId) {
  const idx = state.selectedIds.indexOf(postId);
  if (idx === -1) {
    state.selectedIds.push(postId);
  } else {
    state.selectedIds.splice(idx, 1);
  }
  renderScreen0();
}

function renderScreen0() {
  const grid = els.soundsGrid;
  grid.innerHTML = '';

  const visible = filterFavorites(state.posts, state.favoritesOnly);
  // Distinguish "no sounds at all" from "filtered down to zero favorites" —
  // same distinction the Feed makes in app.js.
  const noFavoritesYet = state.favoritesOnly && state.posts.length > 0 && visible.length === 0;

  if (state.posts.length === 0) {
    // Empty archive
    const empty = document.createElement('div');
    empty.className = 'mix-empty';
    grid.style.display = 'block';
    empty.innerHTML = `${escHtml(t('mixEmpty'))}<a href="./index.html">${escHtml(t('navFeed'))}</a>`;
    grid.appendChild(empty);
  } else if (noFavoritesYet) {
    const empty = document.createElement('div');
    empty.className = 'mix-empty';
    grid.style.display = 'block';
    empty.textContent = t('mixEmptyFav');
    grid.appendChild(empty);
  } else {
    grid.style.display = '';
    for (const post of visible) {
      grid.appendChild(buildSoundCard(post));
    }
  }

  const n = state.selectedIds.length;
  els.continueBar.hidden = n === 0;
  if (n > 0) els.continueBtn.textContent = t('mixContinue', n);

  els.feedTitle.textContent = t('mixFeedTitle');
  els.feedSub.textContent = t('mixFeedSub');

  els.favFilterBtn.classList.toggle('is-active', state.favoritesOnly);
  els.favFilterBtn.setAttribute('aria-pressed', String(state.favoritesOnly));
  const favLabel = els.favFilterBtn.querySelector('span');
  if (favLabel) favLabel.textContent = t('favoritesFilter');
}

// ---- Screen 1: Texture ----

function renderScreen1() {
  els.texTitle.textContent = t('mixTextureTitle');
  els.texSub.textContent = t('mixTextureSub');
  els.texNextBtn.textContent = t('mixNext');

  const rows = els.texRows;
  rows.innerHTML = '';

  for (const post of selectedPosts()) {
    const row = document.createElement('div');

    const label = document.createElement('div');
    label.className = 'tex-row-label';
    label.textContent = post.title || t('mixUntitled');
    row.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'tex-preset-grid';

    for (const preset of PRESET_DEFS) {
      const picked = (state.textures[post.id] || 'raw') === preset.id;
      const chip = document.createElement('div');
      chip.className = 'tex-chip' + (picked ? ' picked' : '');
      chip.innerHTML = `
        <div class="tex-chip-bg"></div>
        <div class="tex-icon-tile" style="background:${preset.iconBg};">${preset.icon}</div>
        <div class="tex-chip-name">${escHtml(t(preset.nameKey))}</div>
      `;
      chip.addEventListener('click', () => {
        state.textures[post.id] = preset.id;
        renderScreen1();
      });
      grid.appendChild(chip);
    }

    row.appendChild(grid);
    rows.appendChild(row);
  }
}

// ---- Screen 2: Mood ----

function renderScreen2() {
  els.moodTitle.textContent = t('mixMoodTitle');
  els.moodSub.textContent = t('mixMoodSub');
  els.mixBtn.textContent = t('mixBtn');
  els.mixBtn.disabled = !state.moodId;
  els.mixBtn.style.background = state.moodId ? '#F59E0B' : 'rgba(245,158,11,0.25)';

  const grid = els.moodGrid;
  grid.innerHTML = '';

  for (const mood of MOOD_DEFS) {
    const picked = state.moodId === mood.id;
    const card = document.createElement('div');
    card.className = 'mood-card' + (picked ? ' picked' : '');
    card.style.background = mood.bg;
    card.style.borderColor = picked ? mood.ring : 'transparent';
    card.style.boxShadow = picked ? mood.glow : 'none';

    const badgeHtml = picked
      ? `<div class="mood-check-badge" style="background:${mood.ring};">✓</div>`
      : '';

    card.innerHTML = `
      ${badgeHtml}
      <div class="mood-card-inner">
        <div class="mood-icon" style="animation:twinkle ${mood.twinkleDur}s ease-in-out infinite;">${mood.icon}</div>
        <div class="mood-name" style="${picked ? `color:${mood.ring};font-weight:700;` : ''}">${escHtml(t(mood.nameKey))}</div>
        <div class="mood-desc">${escHtml(t(mood.descKey))}</div>
      </div>
    `;

    card.addEventListener('click', () => {
      state.moodId = mood.id;
      renderScreen2();
    });
    grid.appendChild(card);
  }

  // Music toggle row — visible once mood is picked
  els.musicToggleRow.hidden = !state.moodId;
  els.musicLabel.textContent = t('mixMusicLabel');
  els.musicDesc.textContent = t('mixMusicDesc');
  els.musicSwitch.classList.toggle('on', state.musicOn);
}

// ---- Screen 3: Generating ----

let genTimer = null;

function buildRipples() {
  const stage = els.rippleStage;
  stage.innerHTML = '';
  const ringsPerSource = 2;
  for (let si = 0; si < RIPPLE_SOURCES.length; si++) {
    const src = RIPPLE_SOURCES[si];
    for (let r = 0; r < ringsPerSource; r++) {
      const jitter = Math.abs(Math.sin(si * 12.9898 + r * 78.233));
      const size = src.maxSize - r * 18;
      const thickness = 1 + jitter * 2.6;
      const delay = (src.dur / ringsPerSource) * r + jitter * src.dur * 0.6;

      const ring = document.createElement('div');
      ring.className = 'ripple-ring';
      ring.style.cssText = [
        `left:${src.left}%`,
        `top:${src.top}%`,
        `width:${size}px`,
        `height:${size}px`,
        `border:${thickness}px solid ${src.color}`,
        `animation:ripple-expand ${src.dur}s cubic-bezier(0.2,0.6,0.4,1) ${delay}s infinite`,
        `animation-fill-mode:backwards`,
      ].join(';');
      stage.appendChild(ring);
    }
  }
}

function startGenCycle() {
  const keys = ['mixGen0', 'mixGen1', 'mixGen2', 'mixGen3'];
  let step = 0;
  els.genLine.textContent = t(keys[0]);
  els.genSub.textContent = t('mixGenSub');

  clearInterval(genTimer);
  genTimer = setInterval(() => {
    step = (step + 1) % keys.length;
    els.genLine.textContent = t(keys[step]);
  }, 1100);
}

function stopGenCycle() {
  clearInterval(genTimer);
  genTimer = null;
}

// ---- Screen 4: Result ----

function moodDef(moodId) {
  return MOOD_DEFS.find((m) => m.id === moodId) || MOOD_DEFS[0];
}

function formatMmSs(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderScreen4() {
  const mood = moodDef(state.moodId);
  const n = state.selectedIds.length;
  const titleText = t(mood.nameKey);

  els.resultEyebrow.textContent = t('mixReady');
  els.resultTitle.textContent = titleText;
  els.resultMeta.textContent = state.musicOn ? t('mixMetaWith', n) : t('mixMetaWithout', n);

  // Artwork card
  els.artworkCard.style.background = mood.bg;
  els.artworkIcon.textContent = mood.icon;
  els.artworkTitleEl.textContent = titleText;

  const dur = state.rendered ? state.rendered.duration : 0;
  els.artworkDur.textContent = `${formatMmSs(dur)} ・ ${t(mood.nameKey)}`;

  // Artwork waveform (30 bars from mood seed)
  const wave = els.artworkWave;
  wave.innerHTML = '';
  const wHeights = waveHeights(mood.id.length, 30);
  for (const h of wHeights) {
    const bar = document.createElement('div');
    bar.className = 'artwork-wave-bar';
    bar.style.height = `${h}%`;
    wave.appendChild(bar);
  }

  // Progress bars (40 bars)
  buildProgressBars();

  // Buttons
  els.shareBtn.textContent = t('mixShare');
  els.postBtn.textContent = t('mixPost');
  els.postBtn.disabled = false;
  state.postBtnPosted = false;
  els.newMixBtn.textContent = t('mixNew');
  els.playBtn.textContent = '▶';

  els.loopBtn.innerHTML = LOOP_ICON;
  els.loopBtn.setAttribute('aria-label', t('loop'));
  els.loopBtn.setAttribute('aria-pressed', String(state.loopOn));
  els.loopBtn.classList.toggle('is-active', state.loopOn);
}

function buildProgressBars() {
  const container = els.progressBars;
  container.innerHTML = '';
  for (let i = 0; i < 40; i++) {
    const h = 15 + Math.abs(Math.sin(i * 0.5 + 2)) * 80;
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    bar.style.height = `${h}%`;
    container.appendChild(bar);
  }
}

// ---- Playback ----

function stopPlayback() {
  if (state.player) {
    state.player.onended = null;
    state.player.stop();
    state.player = null;
  }
  cancelAnimationFrame(state.playRaf);
  state.playRaf = 0;
}

function updateProgressBars(fraction) {
  const bars = els.progressBars.children;
  const played = Math.round(fraction * bars.length);
  for (let i = 0; i < bars.length; i++) {
    bars[i].style.background = i < played ? '#F59E0B' : 'rgba(244,233,216,0.2)';
  }
}

// Ticks the progress bar off the StackPlayer's loop length rather than a
// fixed end time — looping playback has no single "done", so the bar wraps
// back to 0 at each iteration instead of freezing at 100%.
function tick() {
  const player = state.player;
  if (!player || !player.playing) return;
  const ctx = getContext();
  const loopDur = player.duration;
  const elapsed = Math.max(0, ctx.currentTime - state.playStartCtxTime);
  const frac = player.loop && loopDur > 0
    ? (elapsed % loopDur) / loopDur
    : Math.min(1, loopDur > 0 ? elapsed / loopDur : 1);
  updateProgressBars(frac);
  if (player.loop || frac < 1) {
    state.playRaf = requestAnimationFrame(tick);
  }
}

async function startPlayback() {
  if (!state.rendered) return;
  stopPlayback();

  const ctx = getContext();
  // Single rendered layer, played through the same crossfade-aware looping
  // player the Feed uses — see audio-mixer.js MIX_LOOP_CROSSFADE_S for why
  // a mix layer needs a longer loop crossfade than a raw ambient take.
  const layer = {
    buffer: state.rendered,
    analysis: { kind: 'ambient', bpm: 0, firstOnset: 0, loopCrossfade: MIX_LOOP_CROSSFADE_S },
  };
  const player = new StackPlayer(ctx, [layer]);
  player.loop = state.loopOn;
  player.onended = () => {
    state.player = null;
    cancelAnimationFrame(state.playRaf);
    state.playRaf = 0;
    els.playBtn.textContent = '▶';
    updateProgressBars(0);
  };

  try {
    state.player = player;
    await player.play();
  } catch (err) {
    console.warn('[neiro] mix playback failed:', err);
    state.player = null;
    return;
  }
  state.playStartCtxTime = ctx.currentTime;
  els.playBtn.textContent = '❚❚';
  state.playRaf = requestAnimationFrame(tick);
}

function togglePlay() {
  if (state.player) {
    stopPlayback();
    els.playBtn.textContent = '▶';
    updateProgressBars(0);
  } else {
    startPlayback();
  }
}

function toggleLoop() {
  state.loopOn = !state.loopOn;
  els.loopBtn.classList.toggle('is-active', state.loopOn);
  els.loopBtn.setAttribute('aria-pressed', String(state.loopOn));
  if (state.player) state.player.setLoop(state.loopOn);
}

// ---- Share / Post ----

function ensureWavBlob() {
  if (!state.wavBlob && state.rendered) {
    state.wavBlob = encodeWavBlob(state.rendered);
  }
  return state.wavBlob;
}

async function shareCard() {
  const blob = ensureWavBlob();
  if (!blob) return;
  const mood = moodDef(state.moodId);
  const title = t(mood.nameKey);
  const file = new File([blob], 'neiro-mix.wav', { type: 'audio/wav' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      // fall through to download
    }
  }

  // Fallback: download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'neiro-mix.wav';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function postToFeed() {
  if (state.postBtnPosted) return;
  const blob = ensureWavBlob();
  if (!blob || !state.rendered) return;

  const mood = moodDef(state.moodId);
  const titleText = t(mood.nameKey);
  const posts = selectedPosts();

  let analysis;
  try {
    const ctx = getContext();
    if (ctx.state === 'suspended') await ctx.resume();
    analysis = analyzeBuffer(state.rendered);
  } catch (_) {
    analysis = { kind: 'ambient', bpm: 0, firstOnset: 0 };
  }

  const post = {
    id: crypto.randomUUID(),
    title: titleText,
    createdAt: Date.now(),
    parentId: null,
    parentTitle: null,
    layers: [{
      blob,
      type: 'audio/wav',
      pitch: 0,
      analysis: { ...analysis, duration: state.rendered.duration },
    }],
    mix: {
      moodId: state.moodId,
      foundation: state.musicOn,
      textures: { ...state.textures },
      sourceIds: [...state.selectedIds],
      sourceTitles: posts.map((p) => p.title || t('mixUntitled')),
    },
  };

  await addPost(post);

  state.postBtnPosted = true;
  els.postBtn.textContent = t('mixPosted');
  els.postBtn.disabled = true;

  setTimeout(() => {
    location.href = './index.html#feed';
  }, 900);
}

// ---- Mix generation flow ----

async function startMix() {
  if (!state.moodId) return;

  goTo(3);
  buildRipples();
  startGenCycle();

  const minElapsed = 4400;
  const t0 = Date.now();

  let rendered = null;
  let mixError = null;

  try {
    const ctx = getContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const sources = [];
    for (const post of selectedPosts()) {
      const layers = [];
      for (const layer of post.layers || []) {
        if (!layer || !layer.blob || !layer.blob.size) continue;
        try {
          let buffer = await decodeBlob(layer.blob, ctx);
          const analysis = layer.analysis || analyzeBuffer(buffer);
          if (layer.pitch) buffer = pitchShiftBuffer(ctx, buffer, layer.pitch);
          layers.push({ buffer, analysis });
        } catch (err) {
          console.warn('[neiro] skipping undecodable layer:', err);
        }
      }
      if (!layers.length) continue;
      sources.push({ layers, texture: state.textures[post.id] || 'raw' });
    }

    rendered = await renderMix({
      sources,
      moodId: state.moodId,
      foundation: state.musicOn,
    });
  } catch (err) {
    console.warn('[neiro] mix failed:', err);
    mixError = err;
  }

  const elapsed = Date.now() - t0;
  if (elapsed < minElapsed) {
    await new Promise((res) => setTimeout(res, minElapsed - elapsed));
  }

  stopGenCycle();

  if (mixError || !rendered) {
    goTo(2);
    return;
  }

  state.rendered = rendered;
  state.wavBlob = null;
  state.loopOn = false;
  stopPlayback();

  goTo(4);
  renderScreen4();
}

// ---- Reset ----

function resetMix() {
  stopPlayback();
  state.selectedIds = [];
  state.textures = {};
  state.moodId = null;
  state.musicOn = true;
  state.rendered = null;
  state.wavBlob = null;
  state.loopOn = false;
  state.postBtnPosted = false;
  goTo(0);
  renderScreen0();
}

// ---- i18n ----

function applyTranslations() {
  document.documentElement.lang = getLang();
  renderTopBar();

  const tabRecordLabel = document.getElementById('tab-record-label');
  const tabMixLabel = document.getElementById('tab-mix-label');
  if (tabRecordLabel) tabRecordLabel.textContent = t('tabRecord');
  if (tabMixLabel) tabMixLabel.textContent = t('tabMix');

  const screen = state.screen;
  if (screen === 0) renderScreen0();
  if (screen === 1) renderScreen1();
  if (screen === 2) renderScreen2();
  if (screen === 3) {
    els.genLine.textContent = els.genLine.textContent; // keep current cycle text
    els.genSub.textContent = t('mixGenSub');
  }
  if (screen === 4) renderScreen4();
}

// ---- Wire up event listeners ----

els.backBtn.addEventListener('click', goBack);
els.langPill.addEventListener('click', () => { toggleLang(); applyTranslations(); });

els.continueBtn.addEventListener('click', () => {
  goTo(1);
  renderScreen1();
});

els.favFilterBtn.addEventListener('click', () => {
  state.favoritesOnly = !state.favoritesOnly;
  renderScreen0();
});

els.texNextBtn.addEventListener('click', () => {
  goTo(2);
  renderScreen2();
});

els.musicSwitch.addEventListener('click', () => {
  state.musicOn = !state.musicOn;
  renderScreen2();
});

els.mixBtn.addEventListener('click', startMix);

els.playBtn.addEventListener('click', togglePlay);
els.loopBtn.addEventListener('click', toggleLoop);
els.shareBtn.addEventListener('click', shareCard);
els.postBtn.addEventListener('click', postToFeed);
els.newMixBtn.addEventListener('click', resetMix);

// ---- Escape hatch: small helper ----

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Boot ----

async function init() {
  initLang();
  document.documentElement.lang = getLang();
  renderTopBar();

  const tabRecordLabel = document.getElementById('tab-record-label');
  const tabMixLabel = document.getElementById('tab-mix-label');
  if (tabRecordLabel) tabRecordLabel.textContent = t('tabRecord');
  if (tabMixLabel) tabMixLabel.textContent = t('tabMix');

  let posts = [];
  try {
    posts = await getAllPosts();
  } catch (err) {
    console.warn('[neiro] failed to load posts:', err);
  }
  state.posts = posts;

  goTo(0);
  renderScreen0();
}

init();
