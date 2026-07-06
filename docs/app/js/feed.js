// feed.js — feed rendering and post presentation helpers. DOM work stays in
// renderFeed; the helpers above it are pure (translator injectable) and
// unit-tested in tests/.

import { t as defaultT } from './i18n.js';

// --- Pure helpers ---

export function defaultTitle(date = new Date(), t = defaultT) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${t('defaultTitlePrefix')} ${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function lineageLabel(post, t = defaultT) {
  if (!post.parentTitle) return '';
  return t('layeredOnto', post.parentTitle);
}

export function layerCountLabel(post, t = defaultT) {
  return t('layerCount', post.layers ? post.layers.length : 0);
}

export const MAX_TITLE_LENGTH = 32;

// Trims and caps a candidate title; returns null when the result is empty
// so callers know to keep the existing title instead of saving a blank one.
export function sanitizeTitle(input) {
  const trimmed = (input || '').trim().slice(0, MAX_TITLE_LENGTH);
  return trimmed || null;
}

// Label for the musical character of a stack: tempo if any layer is
// rhythmic, otherwise ambient.
export function stackKindLabel(post, t = defaultT) {
  const layers = post.layers || [];
  const anchor = layers.find((l) => l.analysis && l.analysis.kind === 'rhythmic' && l.analysis.bpm > 0);
  if (anchor) return t('bpm', anchor.analysis.bpm);
  return t('ambient');
}

export function timeAgo(createdAt, now = Date.now(), t = defaultT) {
  const diff = Math.max(0, now - createdAt);
  const min = Math.floor(diff / 60000);
  if (min < 1) return t('justNow');
  if (min < 60) return t('minutesAgo', min);
  const hours = Math.floor(min / 60);
  if (hours < 24) return t('hoursAgo', hours);
  const d = new Date(createdAt);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// --- Rendering ---

const PLAY_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="11" height="13" aria-hidden="true"><polygon points="1,1 9,6 1,11"></polygon></svg>';
const STOP_ICON = '<svg viewBox="0 0 10 10" fill="currentColor" width="10" height="10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" rx="1"></rect></svg>';
const LOOP_ICON = '<svg viewBox="0 0 16 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" width="14" height="12" aria-hidden="true"><path d="M1 4h9a3 3 0 010 6H9"></path><path d="M15 4l-2-2M15 4l-2 2"></path><path d="M15 10H6a3 3 0 010-6H7"></path><path d="M1 10l2-2M1 10l2 2"></path></svg>';
const LAYER_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" aria-hidden="true"><path d="M2 14l8 4 8-4M2 10l8 4 8-4M2 6l8 4 8-4"></path></svg>';
const EDIT_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" width="12" height="12" aria-hidden="true"><path d="M10.5 2.5l3 3-8 8-3.5 1 1-3.5 8-8z"></path><path d="M9 4l3 3"></path></svg>';

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

// Renders the whole feed. `state` = { playingId, loopIds:Set, confirmingDeleteId, editingId }.
export function renderFeed(listEl, posts, handlers, state, t = defaultT) {
  listEl.textContent = '';
  for (const post of posts) {
    listEl.appendChild(renderCard(post, handlers, state, t));
  }
}

function renderCard(post, handlers, state, t) {
  const playing = state.playingId === post.id;
  const looping = state.loopIds.has(post.id);

  const card = el('article', 'post-card' + (playing ? ' is-playing' : ''));
  card.dataset.id = post.id;

  const head = el('div', 'post-head');
  const titleWrap = el('div', 'post-title-wrap');

  if (state.editingId === post.id) {
    titleWrap.appendChild(renderTitleInput(post, handlers, t));
  } else {
    const titleRow = el('div', 'post-title-row');
    const title = el('h3', 'post-title');
    title.textContent = post.title || '';
    titleRow.appendChild(title);

    const editBtn = el('button', 'btn-edit-title', EDIT_ICON);
    editBtn.type = 'button';
    editBtn.setAttribute('aria-label', t('editTitle'));
    editBtn.addEventListener('click', () => handlers.onEditTitle(post));
    titleRow.appendChild(editBtn);

    titleWrap.appendChild(titleRow);
  }

  const meta = el('div', 'post-meta');
  meta.textContent = `${timeAgo(post.createdAt, Date.now(), t)} · ${layerCountLabel(post, t)} · ${stackKindLabel(post, t)}`;
  titleWrap.appendChild(meta);

  const lineage = lineageLabel(post, t);
  if (lineage) {
    const lin = el('div', 'post-lineage', LAYER_ICON);
    const span = document.createElement('span');
    span.textContent = lineage;
    lin.appendChild(span);
    titleWrap.appendChild(lin);
  }
  head.appendChild(titleWrap);

  if (playing) {
    head.appendChild(el('div', 'post-playing-badge', '<span class="dot"></span>PLAYING'));
  }
  card.appendChild(head);

  const bars = el('div', 'post-bars');
  for (let i = 0; i < 24; i++) {
    const bar = el('span', 'bar');
    // Deterministic pseudo-random heights so each post has a stable "waveform".
    const seed = hashCode(post.id + ':' + i);
    bar.style.height = `${22 + (seed % 58)}%`;
    if (playing) bar.style.animationDelay = `${(seed % 10) / 10}s`;
    bars.appendChild(bar);
  }
  card.appendChild(bars);

  const actions = el('div', 'post-actions');

  const playBtn = el('button', 'btn btn-play' + (playing ? ' is-active' : ''));
  playBtn.type = 'button';
  playBtn.innerHTML = (playing ? STOP_ICON : PLAY_ICON) + `<span>${playing ? t('stop') : t('play')}</span>`;
  playBtn.addEventListener('click', () => handlers.onPlay(post));
  actions.appendChild(playBtn);

  const loopBtn = el('button', 'btn btn-loop' + (looping ? ' is-active' : ''));
  loopBtn.type = 'button';
  loopBtn.setAttribute('aria-pressed', String(looping));
  loopBtn.innerHTML = LOOP_ICON + `<span>${t('loop')}</span>`;
  loopBtn.addEventListener('click', () => handlers.onLoopToggle(post));
  actions.appendChild(loopBtn);

  const layerBtn = el('button', 'btn btn-layer');
  layerBtn.type = 'button';
  layerBtn.innerHTML = LAYER_ICON + `<span>${t('layer')}</span>`;
  layerBtn.addEventListener('click', () => handlers.onLayer(post));
  actions.appendChild(layerBtn);

  actions.appendChild(el('div', 'post-actions-spacer'));

  const confirming = state.confirmingDeleteId === post.id;
  const delBtn = el('button', 'btn btn-delete' + (confirming ? ' is-confirming' : ''));
  delBtn.type = 'button';
  delBtn.textContent = confirming ? t('delConfirm') : t('del');
  delBtn.addEventListener('click', () => handlers.onDelete(post));
  actions.appendChild(delBtn);

  card.appendChild(actions);
  return card;
}

// Inline title editor. Enter or blur commits; Escape discards. A local
// `settled` guard stops the blur-after-commit that re-rendering triggers
// from firing a second, redundant save/cancel.
function renderTitleInput(post, handlers, t) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'post-title-input';
  input.maxLength = MAX_TITLE_LENGTH;
  input.value = post.title || '';
  input.setAttribute('aria-label', t('editTitle'));

  let settled = false;
  const commit = () => {
    if (settled) return;
    settled = true;
    handlers.onTitleSave(post, input.value);
  };
  const cancel = () => {
    if (settled) return;
    settled = true;
    handlers.onTitleCancel(post);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });
  input.addEventListener('blur', commit);

  return input;
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
