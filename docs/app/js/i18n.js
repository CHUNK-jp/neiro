// i18n.js — EN/JA strings. English is the default. Pure lookup helpers are
// unit-tested in tests/; only getLang/setLang touch localStorage.

export const LANG_KEY = 'neiro-lang';
export const LANGS = ['en', 'ja'];

export const STRINGS = {
  en: {
    appTagline: '10 seconds. Infinite layers.',
    navFeed: 'Feed',
    navAbout: 'About',
    install: 'Add to Home Screen',
    langToggle: '日本語',
    recHint: 'Tap to record 10 seconds',
    recSubhint: 'Someone will add to your sound — not just listen.',
    tapToStop: 'Tap to stop',
    sec: 'sec',
    previewLabel: 'Got it. Listen back, then post.',
    previewPlay: 'Preview',
    previewStop: 'Stop',
    pitchLabel: 'Pitch',
    titlePlaceholder: 'Title (optional)',
    post: 'Post',
    discard: 'Discard',
    micDeniedTitle: 'Microphone unavailable',
    micDeniedBody:
      'Neiro needs microphone access to record. Allow the microphone from the icon near the address bar or in your site settings, then try again.',
    retry: 'Try again',
    feedTitle: 'Feed',
    feedSub: 'newest first',
    feedEmpty1: 'No sounds yet.',
    feedEmpty2: 'Record your first 10 seconds.',
    play: 'Play',
    stop: 'Stop',
    loop: 'Loop',
    layer: 'Layer',
    del: 'Delete',
    delConfirm: 'Really delete?',
    layerBanner: (title) => `Layering onto “${title}”`,
    layerBannerHint: 'The original plays while you record (headphones recommended)',
    layeredOnto: (title) => `Layered onto “${title}”`,
    layerCount: (n) => (n === 1 ? '1 layer' : `${n} layers`),
    justNow: 'just now',
    minutesAgo: (n) => `${n}m ago`,
    hoursAgo: (n) => `${n}h ago`,
    bpm: (n) => `${n} BPM`,
    ambient: 'ambient',
    defaultTitlePrefix: 'Sound',
    footerAbout: '← About Neiro',
    playError: 'Could not play this sound.',
  },
  ja: {
    appTagline: '10秒の音を、重ねる。',
    navFeed: 'フィード',
    navAbout: 'Neiroについて',
    install: 'ホーム画面に追加',
    langToggle: 'English',
    recHint: 'タップして10秒録音',
    recSubhint: 'いまの音を、誰かが重ねてくれる。',
    tapToStop: 'タップで停止',
    sec: 'sec',
    previewLabel: '録音できました。確認して投稿しましょう。',
    previewPlay: 'プレビュー再生',
    previewStop: '停止',
    pitchLabel: 'ピッチ',
    titlePlaceholder: 'タイトル（省略可）',
    post: '投稿する',
    discard: '破棄',
    micDeniedTitle: 'マイクが使えません',
    micDeniedBody:
      '録音にはマイクの許可が必要です。ブラウザのアドレスバー付近のマイクアイコン、またはサイト設定からマイクを許可して、もう一度お試しください。',
    retry: 'もう一度試す',
    feedTitle: 'Feed',
    feedSub: '新しい音から順に',
    feedEmpty1: 'まだ音がありません。',
    feedEmpty2: '最初の10秒を録音してみましょう。',
    play: '再生',
    stop: '停止',
    loop: 'ループ',
    layer: '重ねる',
    del: '削除',
    delConfirm: '本当に削除？',
    layerBanner: (title) => `「${title}」に重ねます`,
    layerBannerHint: '録音中、元の音が再生されます（ヘッドホン推奨）',
    layeredOnto: (title) => `「${title}」の音に重ねました`,
    layerCount: (n) => `${n} レイヤー`,
    justNow: 'たった今',
    minutesAgo: (n) => `${n}分前`,
    hoursAgo: (n) => `${n}時間前`,
    bpm: (n) => `${n} BPM`,
    ambient: 'アンビエント',
    defaultTitlePrefix: '音',
    footerAbout: '← Neiroについて',
    playError: 'この音を再生できませんでした。',
  },
};

// --- Pure helpers ---

export function resolveLang(stored) {
  return LANGS.includes(stored) ? stored : 'en';
}

// Returns a lookup function bound to one language, falling back to English.
export function translator(lang) {
  const table = STRINGS[resolveLang(lang)];
  return (key, ...args) => {
    const entry = key in table ? table[key] : STRINGS.en[key];
    if (entry === undefined) return key;
    return typeof entry === 'function' ? entry(...args) : entry;
  };
}

// --- Browser state ---

let currentLang = 'en';

export function getLang() {
  return currentLang;
}

export function initLang() {
  try {
    currentLang = resolveLang(localStorage.getItem(LANG_KEY));
  } catch {
    currentLang = 'en';
  }
  return currentLang;
}

export function setLang(lang) {
  currentLang = resolveLang(lang);
  try {
    localStorage.setItem(LANG_KEY, currentLang);
  } catch {
    // private mode etc. — keep in-memory language
  }
  return currentLang;
}

export function toggleLang() {
  return setLang(currentLang === 'en' ? 'ja' : 'en');
}

// Convenience translator bound to the current language.
export function t(key, ...args) {
  return translator(currentLang)(key, ...args);
}
