// Editor UI language (the person editing). Separate from a device's display locale.
// Add a language by adding a catalog entry + a LANGS row. (docs/design.md §4.4)
const catalogs = {
  ko: {
    tag: 'editor · M1',
    lang: '편집기 언어',
    device: '화면',
    localeLabel: '디스플레이 로케일',
    resolutionLabel: '해상도',
    resolutionCustom: '직접 입력',
    rotate: '⟳ 가로/세로 전환',
    settingsTitle: '설정',
    close: '닫기',
    saved: '저장됨',
    saving: '저장 중…',
    openDisplay: '디스플레이 열기 ↗',
    apply: '적용',
    inspector: '속성',
    selectHint: '위젯을 선택하세요.',
    type: '유형',
    delete: '삭제',
    addItem: '+ 추가',
    add: (name) => `+ ${name}`,
    addWidget: '위젯 추가',
    categoryBasic: '기본',
    categoryData: '데이터',
    categoryMedia: '미디어',
    applied: (n) => `적용됨 · 연결된 디스플레이 ${n}대`,
    loadFail: (m) => `로드 실패: ${m}`,
  },
  en: {
    tag: 'editor · M1',
    lang: 'Editor language',
    device: 'Display',
    localeLabel: 'Display locale',
    resolutionLabel: 'Resolution',
    resolutionCustom: 'Custom',
    rotate: '⟳ Rotate',
    settingsTitle: 'Settings',
    close: 'Close',
    saved: 'Saved',
    saving: 'Saving…',
    openDisplay: 'Open display ↗',
    apply: 'Apply',
    inspector: 'Properties',
    selectHint: 'Select a widget.',
    type: 'Type',
    delete: 'Delete',
    addItem: '+ Add',
    add: (name) => `+ ${name}`,
    addWidget: 'Add widget',
    categoryBasic: 'Basic',
    categoryData: 'Data',
    categoryMedia: 'Media',
    applied: (n) => `Applied · ${n} display(s) connected`,
    loadFail: (m) => `Load failed: ${m}`,
  },
};

export const LANGS = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
];

// Display locales offered in the device locale picker.
export const LOCALES = [
  { code: 'ko-KR', label: '한국어 (ko-KR)' },
  { code: 'en-US', label: 'English (en-US)' },
  { code: 'en-GB', label: 'English UK (en-GB)' },
  { code: 'ja-JP', label: '日本語 (ja-JP)' },
  { code: 'zh-CN', label: '中文 (zh-CN)' },
  { code: 'de-DE', label: 'Deutsch (de-DE)' },
  { code: 'fr-FR', label: 'Français (fr-FR)' },
  { code: 'es-ES', label: 'Español (es-ES)' },
];

// Manual resolution presets ("A" — docs/design.md §14/D6). A future auto-detect
// ("B") would report the display's real viewport over WS and populate the same
// Device.resolutionW/H fields; this list stays as the manual fallback/override.
export const RESOLUTIONS = [
  { w: 1920, h: 1080, label: '1920 × 1080 (16:9)' },
  { w: 1280, h: 720, label: '1280 × 720 (16:9)' },
  { w: 1080, h: 1920, label: '1080 × 1920 (9:16)' },
  { w: 800, h: 480, label: '800 × 480' },
  { w: 480, h: 800, label: '480 × 800' },
];

let lang = localStorage.getItem('paneo:lang') || 'ko';

export function getLang() { return lang; }
export function setLang(l) {
  lang = catalogs[l] ? l : 'ko';
  localStorage.setItem('paneo:lang', lang);
}
export function t(key, arg) {
  const v = (catalogs[lang] || catalogs.ko)[key];
  return typeof v === 'function' ? v(arg) : v ?? key;
}
