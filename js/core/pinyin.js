/* ═══════════════════ PINYIN — цифры ↔ диакритика ═══════════════════ */

const TONE_ROWS = {
  a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', 'ü': 'ǖǘǚǜ',
};

/** Обратная таблица: символ с диакритикой → базовая буква и номер тона. */
const MARK_TO_PLAIN = (() => {
  const map = new Map();
  Object.keys(TONE_ROWS).forEach((letter) => {
    TONE_ROWS[letter].split('').forEach((marked, index) => {
      map.set(marked, { letter, tone: index + 1 });
    });
  });
  return map;
})();

/** Куда ставится знак тона: на a/e, в сочетании ou — на o, иначе на последнюю гласную. */
function toneMarkPosition(letters) {
  const lower = letters.toLowerCase();
  const a = lower.indexOf('a');
  if (a >= 0) return a;
  const e = lower.indexOf('e');
  if (e >= 0) return e;
  const ou = lower.indexOf('ou');
  if (ou >= 0) return ou;
  for (let index = lower.length - 1; index >= 0; index -= 1) {
    if ('aeiouü'.includes(lower[index])) return index;
  }
  return -1;
}

/** «hao3» → «hǎo». Нейтральный тон (5) и слоги без цифры остаются без знака. */
function markSyllable(letters, tone) {
  const normalized = letters.replace(/v/g, 'ü').replace(/V/g, 'Ü');
  if (!tone || tone === 5) return normalized;
  const position = toneMarkPosition(normalized);
  if (position < 0) return normalized;
  const vowel = normalized[position];
  const row = TONE_ROWS[vowel.toLowerCase()];
  if (!row) return normalized;
  const marked = row[tone - 1];
  return normalized.slice(0, position) + (vowel === vowel.toUpperCase() ? marked.toUpperCase() : marked)
    + normalized.slice(position + 1);
}

/** «ni3 hao3» → «nǐ hǎo». Строку без цифр возвращает как есть. */
export function pinyinNumbersToMarks(text) {
  return String(text || '').replace(/([a-zA-ZüÜvV]+)([1-5])/g, (match, letters, tone) => markSyllable(letters, Number(tone)));
}

/** «nǐ hǎo» → «ni3 hao3». Нужно для подсказки «печатай так». */
export function pinyinMarksToNumbers(text) {
  return String(text || '').split(/\s+/).filter(Boolean).map((syllable) => {
    let tone = 0;
    const letters = syllable.split('').map((character) => {
      const plain = MARK_TO_PLAIN.get(character);
      if (!plain) return character;
      tone = plain.tone;
      return plain.letter;
    }).join('');
    return tone ? letters + tone : letters;
  }).join(' ');
}

/** Только буквы: диакритика снята, v заменён на ü, регистр и пробелы убраны. */
export function pinyinLetters(text) {
  return String(text || '').toLowerCase()
    .split('').map((character) => {
      const plain = MARK_TO_PLAIN.get(character);
      return plain ? plain.letter : character;
    }).join('')
    .replace(/v/g, 'ü')
    .replace(/[^a-zü]/g, '');
}

/** Последовательность тонов. Нейтральный (5) отбрасываем: его не пишут и не слышат. */
function pinyinToneSequence(text) {
  const source = String(text || '');
  const tones = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const plain = MARK_TO_PLAIN.get(character);
    if (plain) tones.push(plain.tone);
    else if (character >= '1' && character <= '5') tones.push(Number(character));
  }
  return tones.filter((tone) => tone !== 5).join('');
}

/**
 * Сравнение ответа: слог и тон проверяются отдельно — прямое требование владельца.
 * Возвращает 'correct' | 'tone' (слоги верны, тон нет) | 'wrong'.
 */
export function comparePinyin(input, expected) {
  if (pinyinLetters(input) !== pinyinLetters(expected)) return 'wrong';
  return pinyinToneSequence(input) === pinyinToneSequence(expected) ? 'correct' : 'tone';
}

export const splitSyllables = (pinyin) => String(pinyin || '').trim().split(/\s+/).filter(Boolean);

/** Номер тона одного слога: 1–4 по диакритике, 5 если знака нет. */
export function syllableTone(syllable) {
  for (const character of String(syllable || '')) {
    const plain = MARK_TO_PLAIN.get(character);
    if (plain) return plain.tone;
  }
  return 5;
}
