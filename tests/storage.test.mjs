import test from 'node:test';
import assert from 'node:assert/strict';
import { sortNewestFirst, selectPostsToPrune, MAX_POSTS } from '../docs/app/js/storage.js';

const post = (id, createdAt) => ({ id, createdAt, layers: [] });

test('sortNewestFirst orders posts by createdAt descending', () => {
  const posts = [post('a', 100), post('b', 300), post('c', 200)];
  assert.deepEqual(sortNewestFirst(posts).map((p) => p.id), ['b', 'c', 'a']);
});

test('sortNewestFirst does not mutate its input', () => {
  const posts = [post('a', 100), post('b', 300)];
  sortNewestFirst(posts);
  assert.deepEqual(posts.map((p) => p.id), ['a', 'b']);
});

test('selectPostsToPrune returns nothing at or under the cap', () => {
  const posts = Array.from({ length: MAX_POSTS }, (_, i) => post(`p${i}`, i));
  assert.deepEqual(selectPostsToPrune(posts), []);
});

test('selectPostsToPrune returns the oldest posts beyond the cap', () => {
  const posts = Array.from({ length: MAX_POSTS + 3 }, (_, i) => post(`p${i}`, i));
  const doomed = selectPostsToPrune(posts);
  assert.equal(doomed.length, 3);
  assert.deepEqual(doomed.map((p) => p.id).sort(), ['p0', 'p1', 'p2']);
});

test('selectPostsToPrune respects a custom max', () => {
  const posts = [post('old', 1), post('mid', 2), post('new', 3)];
  const doomed = selectPostsToPrune(posts, 2);
  assert.deepEqual(doomed.map((p) => p.id), ['old']);
});

test('MAX_POSTS default cap is 50', () => {
  assert.equal(MAX_POSTS, 50);
});
