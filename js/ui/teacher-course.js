import { setSetting } from '../core/db.js';
import { punctuatePinyin } from '../core/pinyin.js';
import { dayKey } from '../core/srs.js';
import { state } from '../core/state.js';
import { MY_PHRASES } from '../data/my-phrases.js';
import { TEACHER_DAYS } from '../data/teacher-days.js';
import { el, fill } from './dom.js';
import { hardCard } from './hard-screen.js';
import { hardMark } from './hard-mark.js';
import { iconLabel, uiIcon } from './icons.js';
import { showScreen } from './screens.js';
import { teacherDayCharacters } from './teacher-strokes.js';
import { EXAM_PASS_SHARE, startTeacherExam } from './teacher-tasks.js';
import { runTeacherStep, setPlayAllButton, speakSingleWord, startTeacherReview, teacherDueCount } from './teacher-words.js';

/* ——— Режим учителя: ведение по программе ———
   Прогресс по словам общий с обычным режимом, но шаги дня программа не пропускает:
   даже знакомое слово проговаривается заново — так же, как это делал бы репетитор
   (уточнение владельца 16.08.2026).                                                */

const TEACHER_STEPS = {
  recall: { title: 'Карточки: впиши перевод', note: 'Видишь фразу по-китайски — печатаешь по-русски, что она значит. Вариантов на выбор нет.', minutes: 8 },
  warmup: { title: 'Повторение', note: 'Начинаем со старого: что пора освежить и вчерашнее — с русского.', minutes: 12 },
  learn: { title: 'Новые слова', note: 'Карточки со звуком: посмотри и послушай каждое.', minutes: 5 },
  write: { title: 'Прописать в тетради', note: 'Напиши слова от руки и отметь, что сделал.', minutes: 15 },
  review: { title: 'Повторение', note: 'Слова прошлых дней — те, что пора освежить.', minutes: 8 },
  grammar: { title: 'Правило дня', note: 'Одна структура: почему слова стоят именно так.', minutes: 6 },
  build: { title: 'Собрать фразу', note: 'Из кусков, среди которых есть лишние.', minutes: 5 },
  type: { title: 'Напечатать фразу', note: 'По-китайски, с клавиатуры, без подсказок.', minutes: 6 },
  tones: { title: 'Тоны', note: 'Слушаешь слово дня и определяешь тон — иначе не поймут.', minutes: 5 },
  ear: { title: 'Фразы на слух', note: 'Только звук, без текста: что тебе сказали?', minutes: 6 },
  speak: { title: 'Сказать вслух', note: 'Прочитай сам, потом сверься с записью.', minutes: 6 },
  listen: { title: 'Слоги на слух', note: 'Короткий блок, чтобы ухо не отставало.', minutes: 4 },
};

/* Шаги, которые программа пока не показывает и не ждёт для закрытия дня. «Тоны» — Иван
   (14.11.2026): «скрой раздел „Тоны“, пусть не будет обязательным для перехода на следующий
   день. С ним много проблем и много надо доработать». Код шага остаётся: доработаем — уберём
   отсюда. Обычный режим «Тоны» на главной это не трогает.                                  */
const PAUSED_STEPS = new Set(['tones']);

/* «Мои фразы» — Иван (22.11.2026): «в самом конце отдельной графой, тоже как день, только мои
   бытовые фразы». Это не день курса: он всегда открыт, не двигает программу и не считается
   в пройденных днях. Шаги — по его списку: карточки с вписыванием перевода («только вписывать,
   не выбирать»), прописи, фразы на слух, сказать вслух; слоги на слух здесь не нужны.     */
export const MY_PHRASES_DAY = 'mine';
const MY_PHRASES_STEPS = ['recall', 'write', 'ear', 'speak'];
const MY_PHRASES_ENTRY = {
  day: MY_PHRASES_DAY, kind: 'mine', title: 'Мои фразы',
  words: MY_PHRASES.map((item) => item.hanzi),
  phrases: MY_PHRASES.map((item) => ({
    hanzi: item.hanzi, pinyin: punctuatePinyin(item.hanzi, item.pinyin), translation: item.translation,
  })),
};

/** Подпись дня в заголовках: «День 5» или «Мои фразы». */
export const dayLabel = (entry) => (entry.kind === 'mine' ? entry.title : `День ${entry.day}`);

/** Какие задания открыты в этот день: сложное подключается, когда набран запас слов. */
function teacherStepsFor(entry) {
  if (entry.kind === 'mine') return MY_PHRASES_STEPS;
  if (entry.kind === 'exam') return ['type'];
  const steps = [];
  if (entry.day >= 2 && (entry.words || []).length) steps.push('warmup');
  if ((entry.words || []).length) steps.push('learn', 'write');
  else steps.push('review');
  if (entry.lesson) steps.push('grammar');
  if (entry.day >= 4 && entry.phrases.length) steps.push('build');
  if (entry.day >= 11 && entry.phrases.length) steps.push('type');
  if (entry.phrases.length) steps.push('ear', 'speak');
  if ((entry.words || []).length) steps.push('tones');
  steps.push('listen');
  return steps.filter((step) => !PAUSED_STEPS.has(step));
}

/** Сколько знаков занятия отмечено кружком «прописал». Отметку дня нельзя поставить
    раньше, чем отмечены все: иначе шаг закрывается, не открывая прописей. */
function teacherWriteProgress(entry) {
  const characters = teacherDayCharacters(entry);
  return {
    total: characters.length,
    done: characters.filter((character) => state.strokesWritten.has(character)).length,
  };
}

/** Все слова, пройденные курсом до этого дня — из них берём и повторение, и лишние куски. */
export function teacherWordsBefore(day) {
  const hanzi = new Set();
  TEACHER_DAYS.filter((entry) => entry.day < day)
    .forEach((entry) => (entry.words || []).forEach((item) => hanzi.add(item)));
  return state.words.filter((word) => hanzi.has(word.hanzi));
}

export const teacherDay = (day) => (day === MY_PHRASES_DAY ? MY_PHRASES_ENTRY
  : TEACHER_DAYS.find((entry) => entry.day === day) || null);

export function teacherProgress() {
  return state.teacher || { day: 1, steps: {}, startedAt: null, finishedDays: [] };
}

/** Отметки хранятся по дню и шагу: «день 3, слова» — сделано. */
export function teacherStepDone(day, step) {
  const progress = teacherProgress();
  return Boolean((progress.steps[day] || {})[step]);
}

export async function markTeacherStep(day, step) {
  const progress = teacherProgress();
  progress.steps[day] = Object.assign({}, progress.steps[day], { [step]: true });
  if (!progress.startedAt) progress.startedAt = dayKey();
  // Возвращение после перерыва — отдельная награда: бросают обычно именно здесь
  if (daysAway(progress.lastDay) >= 3) progress.returned = true;
  progress.lastDay = dayKey();

  closeFinishedDays(progress);
  state.teacher = progress;
  await setSetting('teacher', progress);
  renderTeacher();
}

/**
 * Закрыть дни, где сделаны все шаги, и сдвинуть текущий день дальше. Дни идут по порядку,
 * поэтому закрытие одного может сразу открыть и закрыть следующий. Нужна не только после
 * отметки шага: когда шаг ставят на паузу (как «Тоны»), день, которому не хватало только
 * его, должен закрыться сам, без лишнего прохода.
 * @returns {boolean} закрылся ли хоть один день
 */
export function closeFinishedDays(progress) {
  if (!progress.steps || !Array.isArray(progress.finishedDays)) return false;
  let closed = false;
  TEACHER_DAYS.forEach((entry) => {
    const done = progress.steps[entry.day] || {};
    if (progress.finishedDays.includes(entry.day)) return;
    if (!teacherStepsFor(entry).every((step) => done[step])) return;
    progress.finishedDays.push(entry.day);
    if (progress.day === entry.day && entry.day < TEACHER_DAYS.length) progress.day = entry.day + 1;
    closed = true;
  });
  return closed;
}

/** Сколько дней курса позади и сколько осталось — для шкалы и подписи. */
export function teacherSummary() {
  const progress = teacherProgress();
  const done = progress.finishedDays.length;
  return {
    done,
    total: TEACHER_DAYS.length,
    left: TEACHER_DAYS.length - done,
    current: Math.min(progress.day, TEACHER_DAYS.length),
    started: progress.startedAt,
    away: daysAway(progress.lastDay),
  };
}

/** Сколько дней человек не заходил. Курс от перерыва не сдвигается и не сгорает —
    просто предупреждаем и предлагаем сперва освежить пройденное. */
function daysAway(lastDay) {
  if (!lastDay) return 0;
  const gap = Math.round((new Date(dayKey()) - new Date(lastDay)) / 86400000);
  return gap > 1 ? gap : 0;
}

/* ——— Режим учителя: экраны курса и дня ——— */

export function renderTeacher() {
  const summary = teacherSummary();
  const share = Math.round((summary.done / summary.total) * 100);
  const children = [
    el('div', { class: 'card' }, [
      el('div', { class: 'row-between' }, [
        el('b', { text: `День ${summary.current} из ${summary.total}` }),
        el('span', { class: 'faint', text: summary.left
          ? `осталось ${summary.left} ${plural(summary.left, 'день', 'дня', 'дней')}`
          : 'курс пройден' }),
      ]),
      el('div', { class: 'progress-line', style: 'margin:10px 0 8px' },
        el('span', { style: `width:${share}%` })),
      el('p', { class: 'faint', style: 'margin:0',
        text: 'Час в день: новые слова, письмо от руки, фразы и слоги. Каждый десятый день — экзамен.' }),
    ]),
  ];

  // Пропуск — обычное дело. Ни серия, ни день не сгорают: предлагаем сперва освежить
  if (summary.away && summary.done) {
    children.push(el('div', { class: 'card', style: 'margin-top:16px' }, [
      el('b', { text: `Перерыв ${summary.away} ${plural(summary.away, 'день', 'дня', 'дней')}` }),
      el('p', { class: 'faint', text: 'Ничего не пропало, день остался тот же. Начни с повторения — '
        + 'вернём то, что подзабылось, и пойдём дальше.' }),
      el('button', { class: 'btn btn-small', type: 'button',
        onclick: () => startTeacherReview(teacherDay(summary.current), false) }, 'Освежить пройденное'),
    ]));
  }

  const current = teacherDay(summary.current);
  if (current) {
    children.push(el('button', {
      class: 'btn btn-wide', type: 'button', style: 'margin-top:16px',
      onclick: () => openTeacherDay(current.day),
    }, summary.done >= summary.total ? 'Повторить последний день' : `Заниматься · ${current.title}`));
  }

  children.push(el('h3', { text: 'Программа' }));
  children.push(el('div', { class: 'stack' }, TEACHER_DAYS.map((entry) => {
    const done = teacherProgress().finishedDays.includes(entry.day);
    const isCurrent = entry.day === summary.current;
    const locked = entry.day > summary.current;
    return el('button', {
      class: `lesson-row${isCurrent ? ' is-current' : ''}`, type: 'button', disabled: locked,
      onclick: () => openTeacherDay(entry.day),
    }, [
      el('span', { class: 'faint', text: String(entry.day) }),
      el('span', { class: 'lesson-title' }, [
        el('div', { text: entry.title }),
        el('div', { class: 'faint', text: entry.kind === 'exam'
          ? `${entry.phrases.length} фраз напечатать самому`
          : (entry.words || []).length ? `${entry.words.length} новых слов`
          : 'повторение пройденного' }),
      ]),
      done ? el('span', { class: 'badge badge-ok', text: 'пройден' })
        : locked ? el('span', { class: 'badge' }, uiIcon('lock', 16))
        : el('span', { class: 'badge', text: isCurrent ? 'сегодня' : 'открыт' }),
    ]);
  })));

  // Отдельной графой в самом конце (Иван 22.11.2026): всегда открыта и пополняется его фразами
  const mineDone = MY_PHRASES_STEPS.filter((step) => teacherStepDone(MY_PHRASES_DAY, step)).length;
  children.push(el('h3', { text: 'Мои фразы' }));
  children.push(el('button', {
    class: 'lesson-row', type: 'button', onclick: () => openTeacherDay(MY_PHRASES_DAY),
  }, [
    el('span', { class: 'faint' }, uiIcon('heart', 16)),
    el('span', { class: 'lesson-title' }, [
      el('div', { text: 'Бытовые фразы для жизни' }),
      el('div', { class: 'faint', text: `${MY_PHRASES.length} ${plural(MY_PHRASES.length, 'фраза', 'фразы', 'фраз')} · пополняются по твоим просьбам` }),
    ]),
    el('span', { class: mineDone === MY_PHRASES_STEPS.length ? 'badge badge-ok' : 'badge',
      text: `${mineDone} из ${MY_PHRASES_STEPS.length}` }),
  ]));

  fill('teacher-body', children);
}

/** Русское число словами: «осталось 3 дня». */
export function plural(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function openTeacherDay(day) {
  state.teacherDay = day;
  showScreen('teacher-day');
  renderTeacherDay();
}

export function renderTeacherDay() {
  const entry = teacherDay(state.teacherDay);
  if (!entry) { showScreen('teacher'); return; }

  document.getElementById('teacher-day-heading').textContent = entry.kind === 'mine'
    ? entry.title : `День ${entry.day} · ${entry.title}`;
  const steps = teacherStepsFor(entry);
  const isMine = entry.kind === 'mine';
  const children = [];

  if (entry.kind === 'exam') {
    children.push(el('div', { class: 'card' }, [
      el('b', { text: 'Экзамен' }),
      el('p', { class: 'faint', text: `Проверяем всё, что прошли: ${entry.wordsSoFar} `
        + `${plural(entry.wordsSoFar, 'слово', 'слова', 'слов')}, `
        + `${entry.phrases.length} ${plural(entry.phrases.length, 'фраза', 'фразы', 'фраз')}. Три части: понять на слух, сказать вслух, напечатать `
        + `самому по-китайски. Порог — ${EXAM_PASS_SHARE} %; слова из фраз, где ошибёшься, `
        + 'вернутся в повторение.' }),
      el('button', { class: 'btn btn-wide', type: 'button',
        onclick: () => startTeacherExam(entry) }, 'Начать экзамен'),
    ]));
    fill('teacher-day-body', children);
    return;
  }

  if ((entry.words || []).length) children.push(el('div', { class: 'card' }, [
    el('div', { class: 'row-between' }, [
      el('b', { text: isMine ? 'Фразы' : 'Слова дня' }),
      // обработчик вешает setPlayAllButton — он же меняет её на «Остановить»
      el('button', { class: 'btn btn-quiet btn-small', type: 'button', id: 'day-play-all' },
        iconLabel('sound', 'Прослушать все')),
    ]),
    // Фразы длиннее слов — им нужна строка во всю ширину, с пиньинем по фразе и пояснением
    el('div', { class: isMine ? 'day-words is-phrases' : 'day-words' }, entry.words.map((hanzi, index) => {
      const word = state.words.find((item) => item.hanzi === hanzi);
      const pinyin = isMine ? entry.phrases[index].pinyin : word && word.pinyin;
      // Знак мог встречаться внутри прошлых слов — тогда это не повтор, а знакомая деталь.
      // Владелец принял такие слова за повторение старого, поэтому подписываем прямо.
      const familiar = hanzi.length === 1 && TEACHER_DAYS
        .filter((item) => item.day < entry.day)
        .some((item) => (item.words || []).some((w) => w.length > 1 && w.includes(hanzi)));
      const card = el('button', {
        // Нажал — услышал (просьба владельца). Разбор слова — в разделе «Слова»
        class: 'day-word', type: 'button', 'aria-label': `Послушать ${hanzi}`,
        dataset: { hanzi },
        onclick: () => speakSingleWord(hanzi),
      }, [
        el('span', { class: 'hanzi', text: hanzi }),
        el('span', { class: 'pinyin', text: pinyin || '' }),
        el('span', { class: 'faint', text: word ? word.translation : '' }),
        familiar ? el('span', { class: 'word-note', text: 'знак уже встречался' }) : null,
        isMine && MY_PHRASES[index].note ? el('span', { class: 'phrase-note', text: MY_PHRASES[index].note }) : null,
      ]);
      // Кружок в углу: слово дня можно сразу отправить в трудные, не дожидаясь тренировки
      // (просьба Ивана 03.09.2026). Обёртка нужна, чтобы кнопка не оказалась внутри кнопки.
      if (!word) return card;
      return el('div', { class: 'day-word-slot' }, [card, hardMark(word, 'card-mark')]);
    })),
  ]));

  steps.forEach((step) => {
    const info = TEACHER_STEPS[step];
    const done = teacherStepDone(entry.day, step);
    const due = step === 'warmup' ? teacherDueCount(entry) : 0;
    children.push(el('div', { class: `card${done ? ' is-ok' : ''}` }, [
      el('div', { class: 'row-between' }, [
        el('b', { text: info.title }),
        done ? el('span', { class: 'badge badge-ok', text: 'сделано' })
          : due ? el('span', { class: 'badge', text: `${due} ${plural(due, 'слово', 'слова', 'слов')} ждёт` })
          : null,
      ]),
      el('p', { class: 'faint', text: info.note }),
      // кнопки шага — во flex-строке: у кнопки со значком другая базовая линия,
      // и рядом с обычной она вставала на другом уровне
      el('div', { class: 'step-actions' }, [
        el('button', {
          class: done ? 'btn btn-quiet btn-small' : 'btn btn-small', type: 'button',
          onclick: () => runTeacherStep(entry, step),
        }, step === 'write' ? 'Открыть прописи' : done ? 'Пройти ещё раз' : 'Начать'),
        // Тетрадь приложению не видна — отметку ставит сам человек. Но открыть шаг
        // можно только через прописи: там каждый знак отмечается своим кружком
        step === 'write' && !done ? (() => {
          const written = teacherWriteProgress(entry);
          const ready = written.done >= written.total && written.total > 0;
          return el('button', {
            class: 'btn btn-quiet btn-small', type: 'button',
            disabled: !ready,
            title: ready ? 'Отметить шаг сделанным'
              : `Сначала отметь все знаки в прописях: ${written.done} из ${written.total}`,
            onclick: () => markTeacherStep(entry.day, 'write').then(renderTeacherDay),
          }, ready ? [el('span', { text: 'Прописал' })]
            : iconLabel('lock', `Прописал · ${written.done} из ${written.total}`));
        })() : null,
      ]),
    ]));
  });

  // Трудные слова идут отдельным блоком в самом низу: день закрывается и без них
  const hard = hardCard('teacher-day');
  if (hard) {
    children.push(el('h3', { text: 'Не по программе' }));
    children.push(hard);
  }

  fill('teacher-day-body', children);
  setPlayAllButton(false, entry.words || []);
}
