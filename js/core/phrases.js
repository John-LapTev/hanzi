import { TEACHER_DAYS } from '../data/teacher-days.js';
import { setSetting } from './db.js';
import { speech } from './speech.js';
import { state } from './state.js';

/* ═══════════════════ PHRASES — фразы: разбор на слова и «популярные фразы» ═══════════════════
   Иван (22.10.2026) попросил режим «Популярные фразы»: карточки «иероглифы и пиньинь → перевод»,
   хотя бы сотня, по выбранной теме. Новых фраз для этого не пишем: в программе занятий уже есть
   почти три сотни разговорных фраз — живых, проверенных и целиком озвученных. Писать новые
   значило бы заново озвучивать их за деньги и заново вычитывать.

   Темы у фраз своей нет — она выводится из слов: фраза про еду та, где есть слово из темы
   «Еда». Одна фраза может попасть в несколько тем, и это честно.                          */

const PUNCTUATION = /[，。？！、；：]/g;

/** Режем фразу на слова словаря: так куски осмысленные, а не по одному знаку. */
export function splitPhraseParts(text) {
  const clean = text.replace(PUNCTUATION, '');
  const known = state.words.map((word) => word.hanzi).sort((a, b) => b.length - a.length);
  const parts = [];
  let rest = clean;
  while (rest) {
    const match = known.find((word) => rest.startsWith(word));
    if (match) { parts.push(match); rest = rest.slice(match.length); continue; }
    parts.push(rest[0]);
    rest = rest.slice(1);
  }
  return parts;
}

/** Темы фразы — темы слов, из которых она состоит. */
function phraseTopics(phrase) {
  const topics = new Set();
  splitPhraseParts(phrase.hanzi).forEach((part) => {
    const word = state.words.find((item) => item.hanzi === part);
    if (word && word.topic) topics.add(word.topic);
  });
  return topics;
}

/**
 * Популярные фразы выбранной темы: из программы занятий, без повторов, только озвученные —
 * карточка без звука в этом режиме бесполезна. Порядок — как в программе, от простого.
 * @param {string|null} topic — тема с главной; null — все темы
 */
export function popularPhrases(topic) {
  const seen = new Set();
  const phrases = [];
  TEACHER_DAYS.forEach((day) => (day.phrases || []).forEach((phrase) => {
    if (seen.has(phrase.hanzi) || !speech.hasClip(phrase.hanzi)) return;
    seen.add(phrase.hanzi);
    if (!topic || phraseTopics(phrase).has(topic)) phrases.push(phrase);
  }));
  return phrases;
}

/* ——— Избранное ———
   Иван (22.10.2026): «на карточку сердечко — добавляем в избранное, и кнопка „Избранное“:
   смотрим карточки только избранного». Своего номера у фразы нет, ключ — сами иероглифы:
   в наборе они не повторяются. Тема с главной на избранное не действует — оно своё.      */

export const favoritePhrases = () => popularPhrases(null).filter((phrase) => state.favoritePhrases.has(phrase.hanzi));

/** Сердечко: добавить или убрать. Возвращает новое состояние. */
export async function toggleFavoritePhrase(hanzi) {
  const isFavorite = !state.favoritePhrases.has(hanzi);
  if (isFavorite) state.favoritePhrases.add(hanzi); else state.favoritePhrases.delete(hanzi);
  await setSetting('favoritePhrases', Array.from(state.favoritePhrases));
  return isFavorite;
}
