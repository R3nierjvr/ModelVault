// Turns names in non-Latin scripts (Russian, Chinese, Japanese, Korean, Greek, Arabic …) into English.
// Online translation first (Google's free endpoint, then MyMemory); spelling Cyrillic in Latin letters if both fail.
const NON_LATIN = /[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Greek}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}]/u;
export const needsTranslation = (s) => NON_LATIN.test(String(s || ''));

function guessLang(s) {
  if (/\p{Script=Cyrillic}/u.test(s)) return /[іїєґ]/i.test(s) ? 'uk' : 'ru';
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s)) return 'ja';
  if (/\p{Script=Hangul}/u.test(s)) return 'ko';
  if (/\p{Script=Han}/u.test(s)) return 'zh-CN';
  if (/\p{Script=Greek}/u.test(s)) return 'el';
  if (/\p{Script=Arabic}/u.test(s)) return 'ar';
  if (/\p{Script=Hebrew}/u.test(s)) return 'he';
  if (/\p{Script=Thai}/u.test(s)) return 'th';
  return 'auto';
}

const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g' };
export function transliterate(s) {
  return String(s).replace(/\p{Script=Cyrillic}/gu, (ch) => {
    const low = ch.toLowerCase(), t = CYR[low] ?? '';
    return ch !== low && t ? t[0].toUpperCase() + t.slice(1) : t;
  });
}

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^["'«»\s]+|["'«»\s.]+$/g, '').trim();

async function viaGoogle(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 ModelVault' } });
  if (!r.ok) throw new Error(`Google ${r.status}`);
  const j = await r.json();
  const out = (j?.[0] || []).map((seg) => seg?.[0] || '').join('');
  if (!out.trim()) throw new Error('Google returned nothing');
  return out;
}
async function viaMyMemory(text) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`${guessLang(text)}|en`)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`MyMemory ${r.status}`);
  const j = await r.json();
  const out = j?.responseData?.translatedText;
  if (!out || Number(j.responseStatus) !== 200 || /MYMEMORY WARNING|INVALID/i.test(out)) throw new Error('MyMemory refused');
  return out;
}

export class Translator {
  constructor(db) {
    this.db = db;
    db.exec('CREATE TABLE IF NOT EXISTS translations (src TEXT PRIMARY KEY, en TEXT NOT NULL, via TEXT NOT NULL)');
  }
  /** English version of `text`, or the text unchanged when it is already in Latin letters. */
  async toEnglish(text) {
    const src = String(text || '').trim();
    if (!needsTranslation(src)) return { en: src, via: 'none' };
    const hit = this.db.prepare('SELECT en, via FROM translations WHERE src = ?').get(src);
    if (hit) return { en: hit.en, via: hit.via };
    let en = '', via = '';
    for (const [name, fn] of [['google', viaGoogle], ['mymemory', viaMyMemory]]) {
      try { en = tidy(await fn(src)); if (en && !needsTranslation(en)) { via = name; break; } } catch { /* try the next one */ }
    }
    if (!via) { en = tidy(transliterate(src)); via = needsTranslation(en) ? 'none' : 'letters'; }
    if (!en) en = src;
    // Only remember real translations; spelling-only results get another try next time.
    if (via === 'google' || via === 'mymemory') this.db.prepare('INSERT OR REPLACE INTO translations(src, en, via) VALUES (?, ?, ?)').run(src, en, via);
    return { en, via };
  }
}
