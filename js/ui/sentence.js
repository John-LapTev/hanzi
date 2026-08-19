import { USER_LEVEL } from '../core/constants.js';
import { speech } from '../core/speech.js';
import { state } from '../core/state.js';
import { saveWord } from './dict.js';
import { el, fill, toast } from './dom.js';
import { iconLabel } from './icons.js';

/* ——— Разбор предложения: клик по иероглифу ——— */

export function renderSentence(text) {
  const node = el('div', { class: 'sentence' });
  Array.from(text).forEach((character) => {
    if (!/[一-鿿]/.test(character)) { node.append(character); return; }
    node.append(el('button', {
      type: 'button', class: 'hanzi', onclick: () => openCharSheet(character),
    }, character));
  });
  return node;
}

/** Пиньинь примера собираем по иероглифам — иначе пришлось бы вбивать его руками. */
export function guessSentencePinyin(sentence) {
  const syllables = Array.from(sentence)
    .filter((character) => /[一-鿿]/.test(character))
    .map((character) => (state.charDict.get(character) || {}).pinyin || '');
  return syllables.every(Boolean) ? syllables.join(' ') : '';
}

export function lookupCharacter(character) {
  const known = state.words.find((word) => word.hanzi === character);
  if (known) return { pinyin: known.pinyin, translation: known.translation, inDictionary: true };
  const entry = state.charDict.get(character);
  if (entry) return { pinyin: entry.pinyin, translation: entry.translation, inDictionary: false };
  return null;
}

export function openCharSheet(character) {
  const info = lookupCharacter(character);
  const children = [
    el('div', { class: 'big-hanzi hanzi', text: character, style: 'font-size:72px' }),
    el('div', { class: 'card-pinyin', id: 'char-sheet-title', text: info ? info.pinyin : 'нет в словаре' }),
    el('div', { class: 'card-translation', text: info ? info.translation : 'Значение этого знака мне неизвестно.' }),
  ];
  const row = el('div', { class: 'row', style: 'justify-content:center;margin-top:16px' });
  if (speech.available) {
    row.append(el('button', { class: 'btn btn-quiet btn-small', type: 'button',
      onclick: () => speech.speak(character) }, iconLabel('sound', 'Озвучить')));
  }
  if (info && !info.inDictionary) {
    row.append(el('button', { class: 'btn btn-small', type: 'button',
      onclick: () => addCharacterAsWord(character, info) }, '+ В изучаемые'));
  } else if (info) {
    row.append(el('span', { class: 'badge badge-accent', text: 'уже в словах' }));
  }
  row.append(el('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: closeCharSheet }, 'Закрыть'));
  children.push(row);

  fill('char-sheet-body', children);
  document.getElementById('char-sheet').classList.add('is-open');
}

export function closeCharSheet() {
  document.getElementById('char-sheet').classList.remove('is-open');
}

async function addCharacterAsWord(character, info) {
  await saveWord({
    hanzi: character,
    pinyin: info.pinyin,
    translation: info.translation,
    pos: 'иероглиф',
    topic: 'Мои слова',
    level: USER_LEVEL,
    example: null,
  });
  closeCharSheet();
  toast(`${character} добавлен в изучаемые`);
}
