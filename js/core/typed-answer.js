/* ═══════════════════ TYPED-ANSWER — проверка ответа, напечатанного самому ═══════════════════
   Режим «Сложно» (Иван 22.10.2026): «правильный ответ надо самостоятельно вписать, а не
   выбрать. Ответ иероглифами — пишем иероглифами, должна быть активна китайская раскладка.
   Русский — русскими буквами».

   Перевод проверяется мягко: у слова часто несколько значений через запятую, пояснения
   в скобках, ё и е пишут как придётся, а опечатка — не незнание слова. Иероглифы — строго:
   там опечатка и есть другое слово.                                                        */

const CJK = /[㐀-鿿]/;
const LATIN = /[a-z]/i;
const CYRILLIC = /[а-яё]/i;

/* Сколько опечаток прощаем: короткое слово от одной буквы меняет смысл (мир / мой),
   длинное — нет. Длина считается по правильному ответу. */
const TYPO_FREE_BELOW = 4;
const ONE_TYPO_BELOW = 8;

const VARIANT_SEPARATORS = /[,;/]|\sили\s/;
const CHINESE_PUNCTUATION = /[\s，。？！、；：,.?!;:'"“”‘’()（）]/g;

/** Русский текст без регистра, ё, пояснений в скобках и знаков: сравниваем смысл, а не оформление. */
function normalizeRussian(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[-–—]/g, ' ')
    .replace(/[^a-zа-я0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Перевод-предложение («Здравствуй, красавица!») — один ответ целиком: запятая в нём не
   разделяет варианты, иначе «здравствуй» засчитывалось бы за всю фразу. Предложение узнаём
   по знаку в конце. Таких переводов в словаре — «Мои фразы» Ивана.                        */
const SENTENCE_END = /[?!.…]\s*$/;
const isSentence = (translation) => SENTENCE_END.test(String(translation || '').trim());

/* Во фразе слова переставляют («можно мне лапшу» / «мне можно лапшу») и чаще ошибаются в
   буквах: прощаем перестановку и одну опечатку на каждые десять букв, но не меньше двух. */
const SENTENCE_TYPO_STEP = 10;

/** Все значения слова: «жить, проживать» — это два правильных ответа и ещё целиком. */
function translationVariants(translation) {
  const withoutNotes = String(translation || '').replace(/\([^)]*\)/g, ' ');
  if (isSentence(translation)) return [normalizeRussian(withoutNotes)];
  const parts = withoutNotes.split(VARIANT_SEPARATORS).map(normalizeRussian).filter(Boolean);
  return [...new Set(parts.concat(normalizeRussian(withoutNotes)))];
}

const sortedWords = (text) => text.split(' ').sort().join(' ');

function compareSentence(typed, translation) {
  const answer = normalizeRussian(typed);
  const expected = translationVariants(translation)[0];
  if (!answer) return 'wrong';
  if (answer === expected) return 'correct';
  const allowed = Math.max(2, Math.floor(expected.length / SENTENCE_TYPO_STEP));
  const isClose = sortedWords(answer) === sortedWords(expected)
    || editDistance(answer, expected) <= allowed
    || editDistance(sortedWords(answer), sortedWords(expected)) <= allowed;
  return isClose ? 'typo' : 'wrong';
}

/** Число правок (вставка, удаление, замена буквы), которое превращает одну строку в другую. */
function editDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (unused, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current.push(Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost));
    }
    previous = current;
  }
  return previous[right.length];
}

function allowedTypos(expected) {
  if (expected.length < TYPO_FREE_BELOW) return 0;
  return expected.length < ONE_TYPO_BELOW ? 1 : 2;
}

/**
 * Перевод, напечатанный по-русски.
 * @returns {'correct'|'typo'|'wrong'} typo — смысл верный, в написании опечатка
 */
export function compareTranslation(typed, translation) {
  if (isSentence(translation)) return compareSentence(typed, translation);
  const answers = String(typed || '').split(VARIANT_SEPARATORS).map(normalizeRussian).filter(Boolean);
  const variants = translationVariants(translation);
  if (answers.some((answer) => variants.includes(answer))) return 'correct';
  const isClose = answers.some((answer) => variants.some((variant) =>
    editDistance(answer, variant) <= allowedTypos(variant)));
  return isClose ? 'typo' : 'wrong';
}

/** Иероглифы — точное совпадение; пробелы и знаки препинания не считаются. */
export function compareHanzi(typed, hanzi) {
  const clean = (text) => String(text || '').replace(CHINESE_PUNCTUATION, '');
  return clean(typed) === clean(hanzi) ? 'correct' : 'wrong';
}

/**
 * Напечатано не той раскладкой — это не ошибка в слове, и засчитывать её как незнание
 * нечестно. Возвращает, что не так, или null.
 * @param {'translation'|'hanzi'} field — чем надо было ответить
 * @returns {'need-hanzi'|'need-russian'|null}
 */
export function layoutMismatch(typed, field) {
  const text = String(typed || '');
  if (field === 'hanzi') return CJK.test(text) ? null : 'need-hanzi';
  if (CJK.test(text) || (LATIN.test(text) && !CYRILLIC.test(text))) return 'need-russian';
  return null;
}
