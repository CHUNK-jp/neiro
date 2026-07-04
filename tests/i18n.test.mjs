import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, resolveLang, translator } from '../docs/app/js/i18n.js';

test('resolveLang defaults to English', () => {
  assert.equal(resolveLang(null), 'en');
  assert.equal(resolveLang('fr'), 'en');
  assert.equal(resolveLang('ja'), 'ja');
  assert.equal(resolveLang('en'), 'en');
});

test('every English key exists in Japanese and vice versa', () => {
  const enKeys = Object.keys(STRINGS.en).sort();
  const jaKeys = Object.keys(STRINGS.ja).sort();
  assert.deepEqual(enKeys, jaKeys);
});

test('translator looks up plain strings and templates', () => {
  const en = translator('en');
  const ja = translator('ja');
  assert.equal(en('post'), 'Post');
  assert.equal(ja('post'), '投稿する');
  assert.equal(en('minutesAgo', 7), '7m ago');
  assert.equal(ja('layerBanner', 'rain'), '「rain」に重ねます');
});

test('translator falls back to the key for unknown entries', () => {
  const en = translator('en');
  assert.equal(en('nope-not-a-key'), 'nope-not-a-key');
});
