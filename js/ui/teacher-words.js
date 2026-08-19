import { isToneReady, shuffle, startSession } from '../core/modes.js';
import { speech } from '../core/speech.js';
import { createSrsRecord, dayKey, isDue } from '../core/srs.js';
import { state } from '../core/state.js';
import { fill, toast } from './dom.js';
import { openLesson } from './grammar.js';
import { iconLabel } from './icons.js';
import { showScreen } from './screens.js';
import { startSyllableDrill } from './syllables-screen.js';
import { teacherDay, teacherWordsBefore } from './teacher-course.js';
import { startTeacherBuild, startTeacherPhraseStep, startTeacherTyping } from './teacher-tasks.js';
import { renderTrain } from './train.js';

/* ——— Слова дня подряд ———
   Ждём конца каждой записи и только потом делаем паузу: по таймеру записи наезжали
   друг на друга, обрывались и звучали не в том порядке, в каком написаны.          */

const WORD_PAUSE = 450;
let wordsInTurnRun = 0;

/** Подсветить слово, которое звучит прямо сейчас. Перерисовывать весь день ради этого
    не нужно — меняем класс у одной плитки. */
function markSpeakingWord(hanzi) {
  document.querySelectorAll('.day-word.is-speaking')
    .forEach((node) => node.classList.remove('is-speaking'));
  if (!hanzi) return;
  const node = Array.from(document.querySelectorAll('.day-word'))
    .find((item) => item.dataset.hanzi === hanzi);
  if (node) node.classList.add('is-speaking');
}

/** Кнопка над словами: пока идёт прогон, она останавливает. */
export function setPlayAllButton(playing, list) {
  const button = document.getElementById('day-play-all');
  if (!button) return;
  fill(button, playing ? iconLabel('stop', 'Остановить') : iconLabel('sound', 'Прослушать все'));
  button.onclick = () => (playing ? stopWordsInTurn() : speakWordsInTurn(list));
}

function stopWordsInTurn() {
  wordsInTurnRun += 1;
  speech.stop();
  markSpeakingWord(null);
  const entry = teacherDay(state.teacherDay);
  setPlayAllButton(false, (entry && entry.words) || []);
}

/** Одно слово по нажатию: подсветка держится, пока звучит запись. */
export async function speakSingleWord(hanzi) {
  stopWordsInTurn();
  const run = wordsInTurnRun + 1;
  wordsInTurnRun = run;
  markSpeakingWord(hanzi);
  const played = await speech.speakUntilEnd(hanzi);
  if (!played) toast('Китайского голоса в системе нет.', true);
  if (run === wordsInTurnRun) markSpeakingWord(null);
}

async function speakWordsInTurn(list) {
  const run = wordsInTurnRun + 1;      // повторное нажатие отменяет прошлый прогон
  wordsInTurnRun = run;
  setPlayAllButton(true, list);
  for (const word of list) {
    if (run !== wordsInTurnRun || state.screen !== 'teacher-day') { markSpeakingWord(null); return; }
    markSpeakingWord(word);
    const played = await speech.speakUntilEnd(word);
    if (!played) {
      toast('Китайского голоса в системе нет.', true);
      stopWordsInTurn();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, WORD_PAUSE));
  }
  if (run === wordsInTurnRun) stopWordsInTurn();
}

/** Каждый шаг открывает уже существующий режим приложения — своих механик здесь нет. */
export function runTeacherStep(entry, step) {
  if (step === 'learn') {
    startTeacherWords(entry);
    return;
  }
  if (step === 'review') {
    startTeacherReview(entry);
    return;
  }
  if (step === 'warmup') {
    startTeacherWarmup(entry);
    return;
  }
  if (step === 'ear' || step === 'speak') {
    startTeacherPhraseStep(entry, step);
    return;
  }
  if (step === 'grammar') {
    state.teacherReturn = { day: entry.day, step: 'grammar' };
    openLesson(entry.lesson);
    return;
  }
  if (step === 'tones') {
    startTeacherTones(entry);
    return;
  }
  if (step === 'write') {
    // Свой экран прописей: только знаки занятия и кнопка возврата в день
    state.teacherStrokesOpen = null;
    showScreen('teacher-strokes');
    return;
  }
  if (step === 'listen') {
    startSyllableDrill({ kind: 'fresh', title: `День ${entry.day} · слоги`, teacherDay: entry.day });
    return;
  }
  if (step === 'build') {
    startTeacherBuild(entry);
    return;
  }
  startTeacherTyping(entry);
}

/* ——— Упражнения режима учителя ——— */

/** Слова дня — обычная тренировка, но набор задаёт программа, а не сроки повторения. */
function startTeacherWords(entry) {
  const words = entry.words
    .map((hanzi) => state.words.find((item) => item.hanzi === hanzi))
    .filter(Boolean);
  if (!words.length) { toast('Слова этого дня не найдены в словаре.', true); return; }
  state.teacherReturn = { day: entry.day, step: 'learn' };
  startSession({ mode: 'hanzi2ru', words });
  showScreen('train');
  renderTrain();
}

/* ——— Разминка в начале дня ———
   Порядок такой: сперва то, что пора повторить по срокам (иначе слова первой недели
   выпадут к третьей), потом вчерашнее, потом остальное пройденное. Всё — с русского на
   китайский: узнавать легко, вспоминать трудно, а в разговоре нужно именно второе. */

const TEACHER_WARMUP_SIZE = 15;

function teacherWarmupWords(entry) {
  const learned = teacherWordsBefore(entry.day);
  if (!learned.length) return [];
  const today = dayKey();
  const due = learned.filter((word) => isDue(state.srs.get(word.id) || createSrsRecord(word.id), today));
  const yesterday = teacherDay(entry.day - 1);
  const fresh = ((yesterday && yesterday.words) || [])
    .map((hanzi) => learned.find((item) => item.hanzi === hanzi))
    .filter(Boolean);

  const picked = [];
  [due, fresh, shuffle(learned.slice())].forEach((group) => {
    group.forEach((word) => {
      if (picked.length < TEACHER_WARMUP_SIZE && !picked.includes(word)) picked.push(word);
    });
  });
  return picked;
}

/** Сколько слов курса просрочено — показываем прямо в карточке шага. */
export function teacherDueCount(entry) {
  const today = dayKey();
  return teacherWordsBefore(entry.day)
    .filter((word) => isDue(state.srs.get(word.id) || createSrsRecord(word.id), today)).length;
}

function startTeacherWarmup(entry) {
  const words = teacherWarmupWords(entry);
  if (!words.length) { toast('Повторять пока нечего.', true); return; }
  state.teacherReturn = { day: entry.day, step: 'warmup' };
  startSession({ mode: 'ru2hanzi', words });
  showScreen('train');
  renderTrain();
}

/** Тоны слов дня: слово звучит, ответ — его тон. Без этого человека не понимают,
    даже если все слова он знает. */
function startTeacherTones(entry) {
  const words = (entry.words || [])
    .map((hanzi) => state.words.find((item) => item.hanzi === hanzi))
    .filter(Boolean)
    .filter(isToneReady);
  if (!words.length) { toast('Для этих слов тон не определить.', true); return; }
  state.teacherReturn = { day: entry.day, step: 'tones' };
  startSession({ mode: 'tones', words });
  showScreen('train');
  renderTrain();
}

/** День без новых слов: прогоняем пройденное, начиная с того, что пора повторить. */
const TEACHER_REVIEW_SIZE = 15;

export function startTeacherReview(entry, asStep = true) {
  const learned = teacherWordsBefore(entry.day + (asStep ? 0 : 1));
  if (!learned.length) { toast('Повторять пока нечего.', true); return; }
  const today = dayKey();
  const due = learned.filter((word) => isDue(state.srs.get(word.id) || createSrsRecord(word.id), today));
  const rest = shuffle(learned.filter((word) => !due.includes(word)));
  const words = due.concat(rest).slice(0, TEACHER_REVIEW_SIZE);
  if (asStep) state.teacherReturn = { day: entry.day, step: 'review' };
  startSession({ mode: 'ru2hanzi', words });
  showScreen('train');
  renderTrain();
}
