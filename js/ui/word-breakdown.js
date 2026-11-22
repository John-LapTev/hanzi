import { el, fill } from './dom.js';
import { lookupCharacter } from './sentence.js';

/* ——— Слово по знакам после ошибки ———
   Иван (14.11.2026): «когда делаем ошибку и у нас несколько иероглифов, например 不客气, —
   чтобы каждый иероглиф был в отдельном квадратике и на него можно нажать, чтобы всплыл
   перевод конкретного иероглифа. Смысл — большие слова разбить на иероглифы и посмотреть,
   из чего оно состоит». Подробная карточка знака осталась в разделе «Слова», а здесь —
   быстрый взгляд, не уходя из тренировки.                                                 */

const HANZI = /[一-鿿]/;

/** Ряд квадратиков по знаку и окошко с переводом нажатого. Для слова из одного знака — null. */
export function wordBreakdown(word) {
  const characters = Array.from(word.hanzi).filter((character) => HANZI.test(character));
  if (characters.length < 2) return null;

  const tip = el('div', { class: 'char-tip', role: 'status', 'aria-live': 'polite' });
  tip.hidden = true;
  let activeIndex = null;

  // Один и тот же знак может стоять дважды (谢谢), поэтому выбор держим по месту, а не по знаку
  const select = (index) => {
    activeIndex = activeIndex === index ? null : index;
    tiles.forEach((tile, position) => {
      tile.classList.toggle('is-active', position === activeIndex);
      tile.setAttribute('aria-pressed', String(position === activeIndex));
    });
    tip.hidden = activeIndex === null;
    if (activeIndex !== null) fill(tip, characterInfo(characters[activeIndex]));
  };

  const tiles = characters.map((character, index) => el('button', {
    class: 'char-tile hanzi', type: 'button', 'aria-pressed': 'false',
    'aria-label': `Что значит ${character}`,
    onclick: () => select(index),
  }, character));

  return el('div', { class: 'word-breakdown' }, [
    el('p', { class: 'faint', text: 'Из чего слово — нажми на знак' }),
    el('div', { class: 'char-tiles' }, tiles),
    tip,
  ]);
}

function characterInfo(character) {
  const info = lookupCharacter(character);
  if (!info) {
    return [el('span', { class: 'hanzi', text: character }),
      el('span', { class: 'faint', text: 'этого знака нет в словаре' })];
  }
  return [
    el('span', { class: 'hanzi', text: character }),
    el('b', { text: info.pinyin }),
    el('span', { text: info.translation }),
  ];
}
