import { STORE_SYLLABLES } from './constants.js';
import { dbPut } from './db.js';
import { shuffle } from './random.js';
import { speech } from './speech.js';
import { addDays, dayKey } from './srs.js';
import { state } from './state.js';
import { updateDayStats } from './stats.js';

/* ═══════════════════ SYLLABLES — учёт прогресса по слогам таблицы пиньиня ═══════════════════
   Только счёт и отбор: какие слоги пора освежить, что считать выученным, из чего собрать
   набор для прогона. Экраны живут в ui/syllables-screen.js — раньше всё это лежало там же
   одним файлом на восемьсот строк (аудит 03.09.2026).                                       */

/* ——— Прогресс по слогам ———
   Условие владельца: слог считается изученным после ТРЁХ верных ответов подряд.
   Ошибка обнуляет цепочку, и если слог уже был изучен — статус снимается: три подряд
   нужно набрать заново.                                                              */

export const SYLLABLE_STREAK_TO_LEARN = 3;

/* Изученный слог возвращается на проверку по расширяющимся промежуткам — иначе «пройдено»
   быстро перестало бы соответствовать правде: через месяц половина забывается. */
const SYLLABLE_REVIEW_DAYS = [3, 10, 30, 90];

export function syllableRecord(syllable) {
  return state.syllableProgress.get(syllable)
    || { syllable, streak: 0, right: 0, wrong: 0, learned: false, lastRun: -99 };
}

/** Сколько заходов прошло с тех пор, как слог последний раз попадался. */
export function runsSinceSeen(syllable) {
  const record = state.syllableProgress.get(syllable);
  return state.drillRun - (record && record.lastRun !== undefined ? record.lastRun : -99);
}

/**
 * Собирает очередь захода. Слог, который только что был, не должен возвращаться сразу:
 * память ещё свежа и ответ угадывается. Но если подходящих слогов не набирается,
 * правило ослабляется по шагам — иначе под конец таблицы очередь оказалась бы пустой.
 */
export function pickDrillQueue(pool, size, ordered) {
  const unique = pool.filter((syllable, position) => pool.indexOf(syllable) === position);
  const take = (list, count) => {
    if (ordered) return list.slice(0, count);
    const bag = list.slice();
    const picked = [];
    while (picked.length < count && bag.length) {
      picked.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
    }
    return picked;
  };

  // Сначала берём тех, кто дольше всех «отдыхал»: слог, только что показанный,
  // возвращать бессмысленно — ответ помнится. Если таких мало, добираем остальными,
  // иначе под конец таблицы набор оказался бы неполным.
  const queue = [];
  for (const gap of [2, 1, 0]) {
    const rested = unique.filter((syllable) => runsSinceSeen(syllable) > gap && !queue.includes(syllable));
    queue.push(...take(rested, size - queue.length));
    if (queue.length >= Math.min(size, unique.length)) return queue;
  }
  const rest = unique.filter((syllable) => !queue.includes(syllable));
  queue.push(...take(rest, size - queue.length));
  return queue;
}

/** Состояние клетки для раскраски: 'new' · 'work' (были ошибки или начат) · 'learned'. */
export function syllableStatus(syllable) {
  const record = state.syllableProgress.get(syllable);
  if (!record) return 'new';
  if (record.learned) return 'learned';
  return record.right || record.wrong ? 'work' : 'new';
}

/** Отмечает, что слог показан в этом заходе — чтобы он не вернулся сразу же. */
export async function markSyllableShown(syllables) {
  await Promise.all(syllables.map(async (syllable) => {
    const record = syllableRecord(syllable);
    record.lastRun = state.drillRun;
    state.syllableProgress.set(syllable, record);
    await dbPut(STORE_SYLLABLES, record);
  }));
}

export async function noteSyllableAnswer(syllable, correct) {
  const record = syllableRecord(syllable);
  // Слоги — тоже занятие: без этой отметки день, проведённый за ними, рвал серию
  // и не попадал в график (аудит 03.09.2026).
  updateDayStats({ reviewed: 1, correct: correct ? 1 : 0, errors: correct ? 0 : 1, mode: 'syllables' });
  if (correct) {
    record.right += 1;
    record.streak += 1;
    if (record.streak >= SYLLABLE_STREAK_TO_LEARN) {
      const wasLearned = record.learned;
      record.learned = true;
      // первый раз — короткий промежуток, дальше всё длиннее
      record.reviewStep = wasLearned ? Math.min((record.reviewStep || 0) + 1, SYLLABLE_REVIEW_DAYS.length - 1) : 0;
      record.due = addDays(dayKey(), SYLLABLE_REVIEW_DAYS[record.reviewStep]);
    }
  } else {
    record.wrong += 1;
    record.streak = 0;
    record.learned = false;      // сбился — набирай три подряд заново
    record.reviewStep = 0;
    record.due = null;
  }
  record.lastDay = dayKey();
  state.syllableProgress.set(syllable, record);
  await dbPut(STORE_SYLLABLES, record);
}

/** Изученные слоги, которым пора на проверку: срок наступил. */
export function syllablesDueToday() {
  const today = dayKey();
  return Array.from(state.syllableProgress.values())
    .filter((record) => record.learned && record.due && record.due <= today)
    .map((record) => record.syllable);
}

/** Сводка по всей таблице: сколько изучено, в работе и не начато. */
export function syllableSummary() {
  const all = Object.keys(speech.syllables || {});
  let learned = 0;
  let work = 0;
  all.forEach((syllable) => {
    const status = syllableStatus(syllable);
    if (status === 'learned') learned += 1;
    else if (status === 'work') work += 1;
  });
  return { total: all.length, learned, work, fresh: all.length - learned - work };
}

/** Слоги, которые чаще всего не узнаются: для набора «мои ошибки». */
export function troubleSyllables() {
  return Array.from(state.syllableProgress.values())
    .filter((record) => record.wrong > 0 && !record.learned)
    .sort((left, right) => right.wrong - left.wrong)
    .map((record) => record.syllable);
}
