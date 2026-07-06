import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultTitle,
  lineageLabel,
  layerCountLabel,
  stackKindLabel,
  timeAgo,
  sanitizeTitle,
  MAX_TITLE_LENGTH,
  filterFavorites,
} from '../docs/app/js/feed.js';
import { translator } from '../docs/app/js/i18n.js';

const en = translator('en');
const ja = translator('ja');

test('defaultTitle formats month/day hour:minute with zero padding', () => {
  const d = new Date(2026, 6, 4, 9, 5); // 2026-07-04 09:05
  assert.equal(defaultTitle(d, en), 'Sound 07/04 09:05');
  assert.equal(defaultTitle(d, ja), '音 07/04 09:05');
});

test('lineageLabel names the parent post in both languages', () => {
  const post = { parentId: 'x', parentTitle: 'Rooftop rain' };
  assert.equal(lineageLabel(post, en), 'Layered onto “Rooftop rain”');
  assert.equal(lineageLabel(post, ja), '「Rooftop rain」の音に重ねました');
});

test('lineageLabel is empty for root posts', () => {
  assert.equal(lineageLabel({ parentId: null, parentTitle: null }, en), '');
});

test('layerCountLabel pluralizes in English', () => {
  assert.equal(layerCountLabel({ layers: [{}] }, en), '1 layer');
  assert.equal(layerCountLabel({ layers: [{}, {}, {}] }, en), '3 layers');
  assert.equal(layerCountLabel({}, en), '0 layers');
  assert.equal(layerCountLabel({ layers: [{}, {}] }, ja), '2 レイヤー');
});

test('stackKindLabel shows tempo when a rhythmic layer anchors the stack', () => {
  const post = {
    layers: [
      { analysis: { kind: 'ambient', bpm: 0 } },
      { analysis: { kind: 'rhythmic', bpm: 120 } },
    ],
  };
  assert.equal(stackKindLabel(post, en), '120 BPM');
});

test('stackKindLabel falls back to ambient', () => {
  const post = { layers: [{ analysis: { kind: 'ambient', bpm: 0 } }] };
  assert.equal(stackKindLabel(post, en), 'ambient');
  assert.equal(stackKindLabel({ layers: [{}] }, en), 'ambient');
});

test('timeAgo buckets minutes, hours, then dates', () => {
  const now = Date.now();
  assert.equal(timeAgo(now - 30 * 1000, now, en), 'just now');
  assert.equal(timeAgo(now - 5 * 60 * 1000, now, en), '5m ago');
  assert.equal(timeAgo(now - 3 * 60 * 60 * 1000, now, en), '3h ago');
  assert.equal(timeAgo(now - 5 * 60 * 1000, now, ja), '5分前');
  const old = new Date(2026, 0, 15).getTime();
  assert.equal(timeAgo(old, now, en), '1/15');
});

test('sanitizeTitle trims whitespace', () => {
  assert.equal(sanitizeTitle('  Rooftop rain  '), 'Rooftop rain');
});

test('sanitizeTitle caps at MAX_TITLE_LENGTH characters', () => {
  const long = 'x'.repeat(50);
  const result = sanitizeTitle(long);
  assert.equal(result.length, MAX_TITLE_LENGTH);
  assert.equal(result, 'x'.repeat(MAX_TITLE_LENGTH));
});

test('sanitizeTitle returns null for blank or whitespace-only input', () => {
  assert.equal(sanitizeTitle('   '), null);
  assert.equal(sanitizeTitle(''), null);
  assert.equal(sanitizeTitle(undefined), null);
  assert.equal(sanitizeTitle(null), null);
});

test('filterFavorites returns all posts unfiltered when off', () => {
  const posts = [{ id: 'a', favorite: true }, { id: 'b' }, { id: 'c', favorite: false }];
  assert.deepEqual(filterFavorites(posts, false), posts);
});

test('filterFavorites keeps only favorited posts when on, preserving order', () => {
  const posts = [{ id: 'a', favorite: true }, { id: 'b' }, { id: 'c', favorite: true }];
  assert.deepEqual(filterFavorites(posts, true).map((p) => p.id), ['a', 'c']);
});

test('filterFavorites treats missing/undefined favorite as not favorited', () => {
  const posts = [{ id: 'a' }, { id: 'b', favorite: undefined }, { id: 'c', favorite: false }];
  assert.deepEqual(filterFavorites(posts, true), []);
});
