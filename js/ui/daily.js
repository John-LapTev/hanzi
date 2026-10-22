import { BASIC_MODE, reviewWords } from '../core/modes.js';
import { speech } from '../core/speech.js';
import { dayKey } from '../core/srs.js';
import { state } from '../core/state.js';
import { GRAMMAR_LESSONS } from '../data/grammar.js';
import { el, fill } from './dom.js';
import { openLesson } from './grammar.js';
import { uiIcon } from './icons.js';
import { showScreen } from './screens.js';
import { teacherFigure } from './teacher-figure.js';
import { startSyllableDrill, syllableSummary, syllablesDueToday } from './syllables-screen.js';
import { teacherDay, teacherSummary } from './teacher-course.js';
import { beginReview, beginTraining } from './train.js';

/* ——— Занятие дня ———
   Просьба владельца: одна кнопка на случай, когда нет времени выбирать самому. Внутри
   понемногу отовсюду — слова, слоги, правило порядка слов, — минут на пятнадцать.
   Новых механик занятие не вводит: это список из трёх дел с отметками, а сами дела
   открывают уже существующие режимы. Отметка ставится по факту, из сегодняшних данных. */

const DAILY_SYLLABLES = 10;

/** Сколько карточек отвечено сегодня — по дневной статистике. */
function answeredToday() {
  return (state.stats.get(dayKey()) || {}).reviewed || 0;
}

/** Сколько слогов отвечено сегодня — по отметке дня в записи слога. */
function syllablesAnsweredToday() {
  const today = dayKey();
  return Array.from(state.syllableProgress.values())
    .filter((record) => record.lastDay === today).length;
}

/** Разобран ли сегодня хоть один урок порядка слов. */
function grammarTouchedToday() {
  const today = dayKey();
  return Array.from(state.grammarProgress.values())
    .some((record) => (record.updatedAt || '').slice(0, 10) === today);
}

const DAILY_GOALS = {
  words: 10,
  syllables: 8,
};

/** Три дела дня: что открыть и как понять, что дело сделано. */
function dailySteps() {
  const dueSyllables = syllablesDueToday();
  const summary = syllableSummary();

  let syllableScope = { kind: 'fresh', title: 'Новые слоги' };
  let syllableNote = 'Десять слогов, которых ты ещё не слышал.';
  if (dueSyllables.length) {
    syllableScope = { kind: 'due', title: 'Повторение' };
    syllableNote = `${dueSyllables.length} слогов вернулись на проверку.`;
  } else if (summary.work) {
    syllableScope = { kind: 'started', title: 'Начатые слоги' };
    syllableNote = 'Те, где цепочка идёт, но три подряд ещё не набраны.';
  }

  const lesson = GRAMMAR_LESSONS.find((item) => !(state.grammarProgress.get(item.id) || {}).done)
    || GRAMMAR_LESSONS[0];

  return [
    {
      id: 'words',
      title: 'Слова',
      /* Есть что повторять — это повторение, как у блока «Сегодня к повторению». Нечего —
         новые слова базовым режимом: цель дня — десять ответов, и без новых слов её не набрать.
         (Иван 22.10.2026) */
      note: reviewWords().length
        ? `${Math.min(reviewWords().length, state.sessionLimit)} слов по срокам повторения.`
        : 'Повторять сегодня нечего — новые слова: иероглиф → перевод.',
      done: answeredToday() >= DAILY_GOALS.words,
      progress: `${Math.min(answeredToday(), DAILY_GOALS.words)} / ${DAILY_GOALS.words}`,
      start: () => { if (reviewWords().length) beginReview(); else beginTraining(BASIC_MODE); },
    },
    {
      id: 'syllables',
      title: 'Пиньинь',
      note: syllableNote,
      done: syllablesAnsweredToday() >= DAILY_GOALS.syllables,
      progress: `${Math.min(syllablesAnsweredToday(), DAILY_GOALS.syllables)} / ${DAILY_GOALS.syllables}`,
      start: () => { startSyllableDrill(syllableScope); },
      blocked: !speech.syllables,
    },
    {
      id: 'grammar',
      title: 'Порядок слов',
      note: lesson ? lesson.title : 'Все уроки пройдены — можно повторить любой.',
      done: grammarTouchedToday(),
      progress: grammarTouchedToday() ? 'сделано' : 'урок',
      start: () => { if (lesson) openLesson(lesson.id, { screen: 'home' }); },
    },
  ];
}

/** Вход в режим учителя с главной: показывает, на каком дне курс. */
export function renderTeacherCard() {
  const summary = teacherSummary();
  const started = Boolean(state.teacher);
  const current = teacherDay(summary.current);
  fill('teacher-card', el('div', { class: 'card teacher-home' }, [
    el('div', { class: 'teacher-home-top' }, [
      teacherFigure(),
      el('div', { class: 'teacher-home-text' }, [
        el('div', { class: 'row-between' }, [
          el('b', { text: 'Режим учителя' }),
          el('span', { class: 'faint', text: started
            ? `день ${summary.current} из ${summary.total}` : 'программа на месяц' }),
        ]),
        el('p', { class: 'faint', style: 'margin:6px 0 0', text: started
          ? (current ? current.title : 'курс пройден')
          : 'Ежедневные занятия: слова, письмо, фразы и слоги. Ведёт по порядку, ничего не пропуская.' }),
      ]),
    ]),
    el('button', { class: 'btn btn-wide', type: 'button', style: 'margin-top:14px',
      onclick: () => showScreen('teacher') }, started ? 'Продолжить' : 'Открыть программу'),
  ]));
}

export function renderDailyCard() {
  const steps = dailySteps();
  const doneCount = steps.filter((step) => step.done).length;

  fill('daily-card', el('div', { class: 'card' }, [
    el('div', { class: 'row-between' }, [
      el('b', { text: 'Занятие дня' }),
      el('span', { class: 'faint', text: doneCount === steps.length
        ? 'всё сделано' : `${doneCount} из ${steps.length} · 10–15 минут` }),
    ]),
    el('div', { class: 'daily-steps' }, steps.map((step) => el('button', {
      class: `daily-step${step.done ? ' is-done' : ''}`, type: 'button',
      disabled: Boolean(step.blocked),
      onclick: step.start,
    }, [
      el('span', { class: 'daily-mark' }, step.done ? uiIcon('check', 15) : null),
      el('span', { class: 'daily-text' }, [
        el('div', { text: step.title }),
        el('div', { class: 'faint', text: step.note }),
      ]),
      el('span', { class: 'faint', text: step.progress }),
    ]))),
  ]));
}
