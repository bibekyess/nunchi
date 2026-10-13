// Languages nunchi can transcribe and translate. Add an entry here to support a new
// language end to end: the type, menus and prompt wording all derive from this list.
export const SUPPORTED_LANGS = {
  ko: { name: 'Korean', nativeName: '한국어', whisperNames: ['korean'] },
  en: { name: 'English', nativeName: 'English', whisperNames: ['english'] },
} as const;

export type Lang = keyof typeof SUPPORTED_LANGS;

export const LANG_CODES = Object.keys(SUPPORTED_LANGS) as [Lang, ...Lang[]];

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && value in SUPPORTED_LANGS;
}

/** Whisper servers report either an ISO code ("ko") or a lowercase name ("korean"). */
export function normalizeWhisperLanguage(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (isLang(v)) return v;
  for (const code of LANG_CODES) {
    if ((SUPPORTED_LANGS[code].whisperNames as readonly string[]).includes(v)) return code;
  }
  return v;
}

export function langName(lang: Lang): string {
  return SUPPORTED_LANGS[lang].name;
}
