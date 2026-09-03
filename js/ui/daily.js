import { dueWords } from '../core/modes.js';
import { speech } from '../core/speech.js';
import { dayKey } from '../core/srs.js';
import { state } from '../core/state.js';
import { svgEl } from '../core/strokes.js';
import { GRAMMAR_LESSONS } from '../data/grammar.js';
import { el, fill } from './dom.js';
import { openLesson } from './grammar.js';
import { uiIcon } from './icons.js';
import { showScreen } from './screens.js';
import { startSyllableDrill, syllableSummary, syllablesDueToday } from './syllables-screen.js';
import { teacherDay, teacherSummary } from './teacher-course.js';
import { beginTraining } from './train.js';

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
      note: dueWords().length
        ? `${Math.min(dueWords().length, state.sessionLimit)} карточек по срокам повторения.`
        : 'Повторить пройденное — на интервалы это не повлияет.',
      done: answeredToday() >= DAILY_GOALS.words,
      progress: `${Math.min(answeredToday(), DAILY_GOALS.words)} / ${DAILY_GOALS.words}`,
      start: () => { beginTraining(); },
    },
    {
      id: 'syllables',
      title: 'Слоги',
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
/** Учитель: соломенная шляпа доули на шнурке, халат с запáхом, указка в руке.
    Единственная крупная картинка в приложении — по ней сразу видно, что это программа. */
function teacherFigure() {
  const svg = svgEl('svg', { viewBox: '0 0 96 124', width: 62, height: 80,
    'aria-hidden': 'true', class: 'teacher-figure' });

  const straw = '#d7b169';           // соломенная шляпа
  const strawDark = '#a9823c';
  const robe = 'var(--accent)';      // халат — акцентом приложения
  const robeDark = '#6b6ff0';
  const skin = '#e8c9a8';
  const ink = '#3a3f52';
  const line = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

  // шея и шнурок шляпы уходят под подбородок
  svg.append(svgEl('rect', { x: 43, y: 48, width: 10, height: 10, fill: skin }));
  svg.append(svgEl('path', Object.assign({ d: 'M32 36 C35 50 41 57 48 58' },
    line, { stroke: strawDark, 'stroke-width': 1.8 })));
  svg.append(svgEl('path', Object.assign({ d: 'M64 36 C61 50 55 57 48 58' },
    line, { stroke: strawDark, 'stroke-width': 1.8 })));

  // халат до пола, с запáхом направо
  svg.append(svgEl('path', { d: 'M31 62 C31 57 38 55 48 55 C58 55 65 57 65 62 L73 112 L23 112 Z',
    fill: robe }));
  svg.append(svgEl('path', Object.assign({ d: 'M48 55 L35 88' },
    line, { stroke: robeDark, 'stroke-width': 2.2 })));
  svg.append(svgEl('path', Object.assign({ d: 'M48 56 L56 60' },   // ворот
    line, { stroke: robeDark, 'stroke-width': 2.2 })));

  // рукава — широкие, плавные, частью силуэта
  svg.append(svgEl('path', { d: 'M32 62 C26 70 22 82 21 92 C25 94 30 93 31 89 L34 72 Z', fill: robe }));
  svg.append(svgEl('path', { d: 'M64 62 C72 60 80 54 85 47 C82 42 77 41 74 44 L64 58 Z', fill: robe }));
  // кисть правой руки и указка
  svg.append(svgEl('circle', { cx: 84, cy: 45, r: 4.6, fill: skin }));
  svg.append(svgEl('path', Object.assign({ d: 'M86 42 L95 20' },
    line, { stroke: ink, 'stroke-width': 2.8 })));
  // кушак поверх халата
  svg.append(svgEl('rect', { x: 26, y: 78, width: 44, height: 9, rx: 3.5, fill: robeDark }));
  svg.append(svgEl('path', Object.assign({ d: 'M48 87 L48 96' },   // узел кушака
    line, { stroke: robeDark, 'stroke-width': 3 })));

  // голова, лицо, борода клинышком
  svg.append(svgEl('circle', { cx: 48, cy: 42, r: 12.5, fill: skin }));
  svg.append(svgEl('circle', { cx: 43.5, cy: 41, r: 1.7, fill: ink }));
  svg.append(svgEl('circle', { cx: 52.5, cy: 41, r: 1.7, fill: ink }));
  svg.append(svgEl('path', Object.assign({ d: 'M44 47 C46 49 50 49 52 47' },
    line, { stroke: ink, 'stroke-width': 1.6 })));
  svg.append(svgEl('path', Object.assign({ d: 'M40 37.5 C42 36 44 36 45.5 37M50.5 37 C52 36 54 36 56 37.5' },
    line, { stroke: ink, 'stroke-width': 1.5, opacity: '.8' })));

  // шляпа доули: конус, поля, плетение
  svg.append(svgEl('path', { d: 'M48 3 L71 32 L25 32 Z', fill: straw }));
  svg.append(svgEl('ellipse', { cx: 48, cy: 33, rx: 31, ry: 6.5, fill: straw }));
  svg.append(svgEl('path', Object.assign({ d: 'M35 25 C42 28 54 28 61 25' },
    line, { stroke: strawDark, 'stroke-width': 1.5, opacity: '.85' })));
  svg.append(svgEl('path', Object.assign({ d: 'M29 33 C38 37 58 37 67 33' },
    line, { stroke: strawDark, 'stroke-width': 1.5, opacity: '.7' })));

  // подол и туфли
  svg.append(svgEl('path', Object.assign({ d: 'M23 112 L73 112' },
    line, { stroke: robeDark, 'stroke-width': 2.4 })));
  svg.append(svgEl('rect', { x: 31, y: 112, width: 13, height: 6, rx: 3, fill: ink }));
  svg.append(svgEl('rect', { x: 52, y: 112, width: 13, height: 6, rx: 3, fill: ink }));
  return svg;
}

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
