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
    editTitle: 'Edit title',
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
    mixNav: 'MIX Studio',
    mixFeedTitle: 'FEED',
    mixFeedSub: 'Select sounds from your archive to mix.',
    mixContinue: (n) => `Continue with ${n} sound${n === 1 ? '' : 's'}`,
    mixUsed: (n) => `used in ${n} mix${n === 1 ? '' : 'es'}`,
    mixEmpty: 'No sounds in your archive yet — record some first.',
    mixTextureTitle: 'TEXTURE',
    mixTextureSub: 'Choose how each sound should feel.',
    mixNext: 'Continue',
    mixTexRaw: 'Natural',
    mixTexEcho: 'Echo',
    mixTexWobble: 'Wobble',
    mixTexWarm: 'Warm',
    mixMoodTitle: "TODAY'S INNER WEATHER",
    mixMoodSub: 'Not the real forecast — how does your heart feel right now?',
    mixMoodLabel: 'MOOD',
    mixMoodSunny: 'Sunny mood',
    mixMoodSunnyDesc: 'Clear and light-hearted',
    mixMoodRain: 'Rainy mood',
    mixMoodRainDesc: 'Quiet and settled',
    mixMoodNight: 'Night-quiet',
    mixMoodNightDesc: 'Deep, alone with yourself',
    mixMoodBreeze: 'Still breeze',
    mixMoodBreezeDesc: 'Nothing to rush for',
    mixMusicLabel: 'Add musical foundation',
    mixMusicDesc: 'A quiet drone, pad or pulse is generated to match your mood — made on the spot, no outside tracks or AI.',
    mixBtn: 'Mix',
    mixGen0: 'Gathering fragments…',
    mixGen1: 'Layering textures…',
    mixGen2: 'Weaving the timeline…',
    mixGen3: 'Finishing touches…',
    mixGenSub: 'Weaving your fragments into one thread of time',
    mixReady: 'Ready',
    mixShare: 'Share',
    mixPost: 'Post to Feed',
    mixPosted: 'Posted!',
    mixNew: '+ Make another mix',
    mixMetaWith: (n) => `${n} sounds ・ with foundation`,
    mixMetaWithout: (n) => `${n} sounds ・ no foundation`,
    mixUntitled: 'Untitled mix',
    tabRecord: 'Record',
    tabMix: 'MIX',
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
    editTitle: 'タイトルを編集',
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
    mixNav: 'MIXスタジオ',
    mixFeedTitle: 'FEED',
    mixFeedSub: '撮り貯めた音からMIXする音源を選んで。',
    mixContinue: (n) => `${n}個の音でMIXへ`,
    mixUsed: (n) => `${n}回`,
    mixEmpty: 'アーカイブに音がまだありません。まず録音してみて。',
    mixTextureTitle: '音の質感',
    mixTextureSub: '各音源をどう響かせるか選んで。',
    mixNext: '次へ',
    mixTexRaw: 'そのまま',
    mixTexEcho: '残響',
    mixTexWobble: '揺らぎ',
    mixTexWarm: '包む',
    mixMoodTitle: '今日の心の天気',
    mixMoodSub: '実際の天気じゃなくていい。今、心の中はどんな空模様？',
    mixMoodLabel: 'ムード',
    mixMoodSunny: '晴れやかな気分',
    mixMoodSunnyDesc: '澄んで軽やかな心',
    mixMoodRain: '雨のような気分',
    mixMoodRainDesc: 'しっとり静かに沈む',
    mixMoodNight: '夜のような静けさ',
    mixMoodNightDesc: '深く、ひとりの時間',
    mixMoodBreeze: '凪いだ気分',
    mixMoodBreezeDesc: 'なにも急がない時間',
    mixMusicLabel: '音楽的な土台を足す',
    mixMusicDesc: 'ムードに合わせて静かなドローン・パッド・パルスをその場で生成します。外部の曲や生成AIは使いません。',
    mixBtn: 'MIXする',
    mixGen0: '素材を集めています…',
    mixGen1: '質感を重ねています…',
    mixGen2: '時間軸を編んでいます…',
    mixGen3: '仕上げています…',
    mixGenSub: '断片を、ひとつの時間に編んでいます',
    mixReady: 'できあがりました',
    mixShare: 'シェア',
    mixPost: 'Feedに投稿',
    mixPosted: '投稿しました！',
    mixNew: '+ 別のMIXを作る',
    mixMetaWith: (n) => `${n}個のSOUND ・ 土台あり`,
    mixMetaWithout: (n) => `${n}個のSOUND ・ 土台なし`,
    mixUntitled: '無題のMIX',
    tabRecord: '録音',
    tabMix: 'MIX',
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
