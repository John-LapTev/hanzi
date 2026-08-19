import { STORE_SRS } from '../core/constants.js';
import { dbPut } from '../core/db.js';
import { qualityFromVerdict, shuffle } from '../core/modes.js';
import { speech } from '../core/speech.js';
import { applySm2, createSrsRecord } from '../core/srs.js';
import { state } from '../core/state.js';
import { TEACHER_DAYS } from '../data/teacher-days.js';
import { characterCounts, normalizeChinese } from './dialogs-screen.js';
import { el, fill, toast } from './dom.js';
import { iconLabel, uiIcon } from './icons.js';
import { showScreen } from './screens.js';
import { markTeacherStep, renderTeacherDay, teacherWordsBefore } from './teacher-course.js';

/* ——— Сборка фразы из кусков, среди которых есть лишние ——— */

const TEACHER_DECOYS = 4;      // сколько лишних кусков подмешать

export function startTeacherBuild(entry) {
  const phrases = entry.phrases.slice(0, 3);
  if (!phrases.length) { toast('Для этого дня фраз пока нет.', true); return; }
  state.teacherTask = {
    kind: 'build', day: entry.day, phrases, index: 0, chosen: [], bank: [], done: 0,
  };
  buildTeacherBank();
  showScreen('teacher-task');
  renderTeacherTask();
}

/** Куски фразы плюс чужие слова: иначе ответ собирается перебором, без понимания.
    Лишние берём только из пройденного — незнакомое слово отсеивается само собой
    и задание становится не сложнее, а легче. */
function buildTeacherBank() {
  const task = state.teacherTask;
  const phrase = task.phrases[task.index];
  const parts = splitPhraseParts(phrase.hanzi);
  const learned = teacherWordsBefore(task.day + 1);
  const pool = (learned.length >= TEACHER_DECOYS * 2 ? learned : state.words)
    .map((word) => word.hanzi)
    .filter((hanzi) => !phrase.hanzi.includes(hanzi));
  const decoys = shuffle(pool).slice(0, TEACHER_DECOYS);
  task.bank = shuffle(parts.map((text, index) => ({ text, index })).concat(
    decoys.map((text, index) => ({ text, index: -1 - index }))));
  task.chosen = [];
}

/** Режем фразу на слова словаря: так куски осмысленные, а не по одному знаку. */
function splitPhraseParts(text) {
  const clean = text.replace(/[，。？！、；：]/g, '');
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

/* ——— Фразы на слух и проговаривание вслух ———
   Понимание речи и собственный голос — то, ради чего всё затевалось: в Китае с ним будут
   говорить, а не показывать иероглифы. Распознавания речи здесь нет и быть не может
   (оно уходит в интернет, а приложение офлайн), поэтому проговаривание проверяет сам
   человек: сказал → услышал эталон → честно отметил, совпало или нет.               */

const TEACHER_PHRASE_STEP_SIZE = 4;

/* Пока слов мало, на слух выбирают из четырёх переводов. Дальше это уже слишком просто:
   с шестого дня услышанное записывают сами, по-китайски (просьба владельца 17.08.2026). */
const EAR_TYPING_FROM_DAY = 6;
const earIsTyped = (day) => day >= EAR_TYPING_FROM_DAY;

export function startTeacherPhraseStep(entry, kind) {
  // В первые дни фраза всего одна — тогда добираем словами дня: они звучат так же,
  // и выбор из четырёх переводов остаётся осмысленным (замечание владельца 17.08.2026).
  const phrases = entry.phrases.slice(0, TEACHER_PHRASE_STEP_SIZE);
  if (phrases.length < TEACHER_PHRASE_STEP_SIZE) {
    const words = (entry.words || [])
      .map((hanzi) => state.words.find((item) => item.hanzi === hanzi))
      .filter(Boolean)
      .map((word) => ({ hanzi: word.hanzi, pinyin: word.pinyin, translation: word.translation }));
    phrases.push(...shuffle(words).slice(0, TEACHER_PHRASE_STEP_SIZE - phrases.length));
  }
  if (!phrases.length) { toast('Для этого дня фраз пока нет.', true); return; }
  state.teacherTask = { kind, day: entry.day, phrases, index: 0, done: 0, revealed: false };
  showScreen('teacher-task');
  renderTeacherTask();
  if (kind === 'ear') speech.speak(phrases[0].hanzi);
}

/* ——— Экзамен: три части вместо одной ———
   Печать по-китайски проверяет умение обращаться с клавиатурой, а не язык. Поэтому
   экзамен идёт тремя заходами: понял на слух → сказал сам → написал. Порог 80 %,
   а слова из проваленных фраз возвращаются в повторение — это важнее самой оценки. */

export const EXAM_PASS_SHARE = 80;

export function startTeacherExam(entry) {
  const phrases = shuffle(entry.phrases.slice());
  if (!phrases.length) { toast('Фразы для экзамена не найдены.', true); return; }
  const third = Math.max(1, Math.round(phrases.length / 3));
  const parts = [
    { kind: 'ear', phrases: phrases.slice(0, third) },
    { kind: 'speak', phrases: phrases.slice(third, third * 2) },
    { kind: 'type', phrases: phrases.slice(third * 2) },
  ].filter((part) => part.phrases.length);

  state.teacherTask = {
    kind: parts[0].kind, day: entry.day, phrases: parts[0].phrases, index: 0, done: 0,
    revealed: false, exam: true, parts, part: 0, examDone: 0, examTotal: phrases.length,
    examWrong: [],
  };
  showScreen('teacher-task');
  renderTeacherTask();
  if (parts[0].kind === 'ear') speech.speak(parts[0].phrases[0].hanzi);
}

/** Переход к следующей части экзамена; накопленный счёт сохраняем. */
function nextExamPart(task) {
  const done = task.examDone + task.done;
  const wrong = task.examWrong.concat(task.mistakes || []);
  const part = task.part + 1;
  if (part >= task.parts.length) {
    task.examDone = done;
    task.examWrong = wrong;
    return false;
  }
  state.teacherTask = Object.assign({}, task, {
    kind: task.parts[part].kind, phrases: task.parts[part].phrases,
    index: 0, done: 0, revealed: false, mistakes: [], chosen: [], bank: [],
    options: null, optionsFor: null, part, examDone: done, examWrong: wrong,
  });
  renderTeacherTask();
  if (task.parts[part].kind === 'ear') speech.speak(task.parts[part].phrases[0].hanzi);
  return true;
}

/** Слова из проваленных фраз возвращаются в повторение уже завтра.
    Сама оценка забудется, а вот эти слова — нет: их снова спросят. */
async function returnExamMistakes(phrases) {
  const seen = new Set();
  for (const phrase of phrases) {
    for (const part of splitPhraseParts(phrase.hanzi)) {
      const word = state.words.find((item) => item.hanzi === part);
      if (!word || seen.has(word.id)) continue;
      seen.add(word.id);
      const previous = state.srs.get(word.id) || createSrsRecord(word.id);
      const updated = applySm2(previous, qualityFromVerdict('wrong'));
      updated.errors += 1;
      state.srs.set(word.id, updated);
      await dbPut(STORE_SRS, updated);
    }
  }
  return seen.size;
}

/** Варианты перевода: правильный плюс чужие фразы курса — на слух выбирать труднее.
    Если фраз ещё мало (первые дни), добираем переводами слов, иначе выбирать не из чего. */
function earOptions(phrase, day) {
  const fromPhrases = TEACHER_DAYS
    .filter((entry) => entry.day <= day)
    .flatMap((entry) => entry.phrases || [])
    .map((item) => item.translation);
  const fromWords = teacherWordsBefore(day + 1).map((word) => word.translation);
  const others = Array.from(new Set(fromPhrases.concat(fromWords)))
    .filter((text) => text !== phrase.translation);
  return shuffle([phrase.translation].concat(shuffle(others).slice(0, 3)));
}

function renderEarTask(task, phrase, feedback) {
  if (earIsTyped(task.day)) return renderEarTyping(task, phrase, feedback);
  if (!task.options || task.optionsFor !== phrase.hanzi) {
    task.options = earOptions(phrase, task.day);
    task.optionsFor = phrase.hanzi;
  }
  return [
    el('div', { class: 'card center' }, [
      el('button', { class: 'btn btn-round', type: 'button', 'aria-label': 'Повторить фразу',
        onclick: () => speech.speak(phrase.hanzi) }, uiIcon('sound', 20)),
      el('p', { class: 'faint', style: 'margin-top:16px', text: 'Послушай и выбери, что это значит.' }),
      feedback ? el('div', { class: 'sentence' }, phrase.hanzi) : null,
      feedback ? el('div', { class: 'sentence-pinyin', text: phrase.pinyin }) : null,
    ]),
    el('div', { class: 'options' }, task.options.map((option) => {
      const chosen = feedback && feedback.answer === option;
      const right = option === phrase.translation;
      const mark = feedback ? (right ? ' is-ok' : chosen ? ' is-err' : '') : '';
      return el('button', {
        class: `option${mark}`, type: 'button', disabled: Boolean(feedback),
        onclick: () => checkTeacherAnswer(option),
      }, option);
    })),
  ];
}

/** То же задание, но ответ печатают: звучит фраза, на экране ничего. */
function renderEarTyping(task, phrase, feedback) {
  return [
    el('div', { class: 'card center' }, [
      el('button', { class: 'btn btn-round', type: 'button', 'aria-label': 'Повторить фразу',
        onclick: () => speech.speak(phrase.hanzi) }, uiIcon('sound', 20)),
      el('p', { class: 'faint', style: 'margin-top:14px',
        text: 'Послушай и запиши по-китайски то, что услышал.' }),
      feedback ? el('div', { class: 'sentence' }, phrase.hanzi) : null,
      feedback ? el('div', { class: 'sentence-pinyin', text: phrase.pinyin }) : null,
      feedback ? el('p', { class: 'faint', text: phrase.translation }) : null,
    ]),
    el('input', {
      type: 'text', id: 'teacher-answer', autocomplete: 'off', autocapitalize: 'off',
      spellcheck: 'false', placeholder: '写中文…', 'aria-label': 'Ответ по-китайски',
      value: feedback ? feedback.answer : '', disabled: Boolean(feedback),
    }),
  ];
}

function renderSpeakTask(task, phrase) {
  if (!task.revealed) {
    return [
      el('div', { class: 'card center' }, [
        el('div', { class: 'card-question', text: phrase.translation }),
        el('p', { class: 'faint', style: 'margin-top:16px',
          text: 'Скажи это по-китайски вслух — вслух, не про себя. Потом сверишься с записью.' }),
      ]),
      el('div', { class: 'center' }, el('button', {
        class: 'btn btn-wide', type: 'button',
        onclick: () => { task.revealed = true; renderTeacherTask(); speech.speak(phrase.hanzi); },
      }, 'Сказал — проверить себя')),
    ];
  }
  return [
    el('div', { class: 'card center' }, [
      el('div', { class: 'sentence' }, phrase.hanzi),
      el('div', { class: 'sentence-pinyin', text: phrase.pinyin }),
      el('p', { class: 'faint', text: phrase.translation }),
      // Голый значок владелец не замечал — у кнопки эталона есть подпись
      el('button', { class: 'btn btn-quiet btn-small', type: 'button', style: 'margin-top:12px',
        onclick: () => speech.speak(phrase.hanzi) }, iconLabel('sound', 'Послушать, как правильно')),
    ]),
    el('div', { class: 'center' }, [
      el('button', { class: 'btn btn-wide', type: 'button', onclick: () => {
        task.done += 1;
        task.revealed = false;
        task.index += 1;
        renderTeacherTask();
      } }, 'Сказал так же'),
      el('button', { class: 'btn btn-quiet btn-wide', type: 'button', onclick: () => {
        task.mistakes = (task.mistakes || []).concat(phrase);
        task.revealed = false;
        task.index += 1;
        renderTeacherTask();
      } }, 'Вышло иначе'),
    ]),
  ];
}

/* ——— Печать фразы с клавиатуры ——— */

export function startTeacherTyping(entry) {
  const phrases = entry.phrases.slice(0, TEACHER_PHRASE_STEP_SIZE);
  if (!phrases.length) { toast('Для этого дня фраз пока нет.', true); return; }
  state.teacherTask = { kind: 'type', day: entry.day, phrases, index: 0, done: 0 };
  showScreen('teacher-task');
  renderTeacherTask();
}

export function renderTeacherTask(feedback) {
  const task = state.teacherTask;
  if (!task) { showScreen('teacher'); return; }

  const phrase = task.phrases[task.index];
  const heading = document.getElementById('teacher-task-heading');
  const partName = task.kind === 'ear' ? 'что тебе сказали'
    : task.kind === 'speak' ? 'скажи вслух' : 'напечатай фразу';
  heading.textContent = task.exam ? `Экзамен · ${partName}`
    : task.kind === 'build' ? 'Собери фразу'
    : task.kind === 'ear' ? 'Что тебе сказали?'
    : task.kind === 'speak' ? 'Скажи вслух' : 'Напечатай фразу';

  if (task.index >= task.phrases.length) {
    // У экзамена частей несколько: пока они не кончились, показываем переход, а не итог
    if (task.exam && task.part + 1 < task.parts.length) {
      const nextKind = task.parts[task.part + 1].kind;
      fill('teacher-task-body', el('div', { class: 'card center' }, [
        el('b', { text: 'Часть пройдена' }),
        el('p', { class: 'faint', text: nextKind === 'ear' ? 'Дальше — понять на слух.'
          : nextKind === 'speak' ? 'Дальше — сказать вслух.' : 'Дальше — напечатать самому.' }),
        el('button', { class: 'btn btn-wide', type: 'button',
          onclick: () => nextExamPart(task) }, 'Продолжить'),
      ]));
      return;
    }

    const done = task.exam ? task.examDone + task.done : task.done;
    const total = task.exam ? task.examTotal : task.phrases.length;
    const share = Math.round((done / total) * 100);
    const passed = !task.exam || share >= EXAM_PASS_SHARE;
    fill('teacher-task-body', el('div', { class: 'card center' }, [
      el('div', { class: 'today-count' }, [`Верно `, el('b', { text: String(done) }),
        ` из ${total}`]),
      el('p', { class: 'faint', text: task.exam
        ? (passed ? `Экзамен сдан: ${share} %. Следующий блок открыт.`
          : `Нужно ${EXAM_PASS_SHARE} %, вышло ${share} %. Слова из фраз, где ошибся, вернутся в повторение — приходи снова, попыток сколько угодно.`)
        : done === total ? 'Задание пройдено.'
        : 'Шаг закроется, когда все ответы будут верными — прогони ошибки.' }),
      // Ошибки не должны просто исчезнуть: разбор сразу, пока фраза ещё в голове
      (task.mistakes || []).length && !task.exam ? el('button', {
        class: 'btn btn-wide', type: 'button', onclick: () => {
          state.teacherTask = Object.assign({}, task, {
            phrases: task.mistakes, index: 0, done: 0, mistakes: [], chosen: [], bank: [],
          });
          if (task.kind === 'build') buildTeacherBank();
          renderTeacherTask();
        },
      }, `Прогнать ошибки · ${task.mistakes.length}`) : null,
      el('button', {
        class: (task.mistakes || []).length && !task.exam ? 'btn btn-quiet btn-wide' : 'btn btn-wide',
        type: 'button',
        onclick: async () => {
          const wrong = task.exam ? task.examWrong.concat(task.mistakes || []) : [];
          // Обычный шаг закрывается только безошибочным проходом; у экзамена свой порог
          const clean = task.exam ? passed : done === total;
          if (clean) markTeacherStep(task.day, task.exam ? 'type' : task.kind);
          state.teacherTask = null;
          showScreen(task.exam ? 'teacher' : 'teacher-day');
          if (!task.exam) renderTeacherDay();
          if (wrong.length) await returnExamMistakes(wrong);
        },
      }, 'Готово'),
    ]));
    return;
  }

  const counter = el('p', { class: 'faint center', text: `${task.index + 1} из ${task.phrases.length}` });

  if (task.kind === 'speak') {
    fill('teacher-task-body', [counter].concat(renderSpeakTask(task, phrase)));
    return;
  }

  const children = task.kind === 'ear'
    ? [counter].concat(renderEarTask(task, phrase, feedback))
    : [
      counter,
      el('div', { class: 'card center' }, [
        el('div', { class: 'card-question', text: phrase.translation }),
        task.kind === 'type' && !task.exam
          ? el('p', { class: 'faint', text: 'Переключи раскладку на китайский и набери фразу.' })
          : null,
        feedback ? el('div', { class: 'sentence', style: 'margin-top:12px' }, phrase.hanzi) : null,
        feedback ? el('div', { class: 'sentence-pinyin', text: phrase.pinyin }) : null,
      ]),
    ];

  if (task.kind === 'ear') {
    // варианты уже нарисованы: проверка идёт по нажатию, кнопки «Проверить» здесь нет
  } else if (task.kind === 'build') {
    const slot = el('div', { class: 'drill-slot' }, task.chosen.length
      ? task.chosen.map((item, position) => el('button', {
          class: 'chunk', type: 'button', disabled: Boolean(feedback),
          onclick: () => { task.chosen.splice(position, 1); renderTeacherTask(); },
        }, item.text))
      : el('span', { class: 'faint', text: 'Нажимай куски снизу' }));
    children.push(slot);

    const bank = el('div', { class: 'row', style: 'margin-top:12px' });
    task.bank.forEach((item) => {
      if (task.chosen.includes(item)) return;
      bank.append(el('button', {
        class: 'chunk', type: 'button', disabled: Boolean(feedback),
        onclick: () => { task.chosen.push(item); renderTeacherTask(); },
      }, item.text));
    });
    children.push(bank);
  } else {
    children.push(el('input', {
      type: 'text', id: 'teacher-answer', autocomplete: 'off', autocapitalize: 'off',
      spellcheck: 'false', placeholder: '写中文…', 'aria-label': 'Ответ по-китайски',
      value: feedback ? feedback.answer : '', disabled: Boolean(feedback),
    }));
  }

  if (feedback) {
    children.push(el('p', {
      class: feedback.correct ? 'verdict is-ok' : 'verdict is-err',
      role: 'status', 'aria-live': 'polite',
      text: feedback.correct ? 'Верно'
        : `Правильно: ${task.kind === 'ear' && !earIsTyped(task.day) ? phrase.translation : phrase.hanzi}`,
    }));
    if (!feedback.correct && feedback.hint) {
      children.push(el('p', { class: 'faint center', text: feedback.hint }));
    }
    if (!feedback.correct) children.push(teacherPhraseBreakdown(phrase));
    children.push(el('div', { class: 'center' }, el('button', {
      class: 'btn btn-wide', type: 'button', onclick: () => {
        task.index += 1;
        if (task.kind === 'build' && task.index < task.phrases.length) buildTeacherBank();
        renderTeacherTask();
        const next = task.phrases[task.index];
        if (task.kind === 'ear' && next) speech.speak(next.hanzi);
      },
    }, 'Дальше')));
  } else if (task.kind !== 'ear' || earIsTyped(task.day)) {
    children.push(el('div', { class: 'center' }, [
      el('button', { class: 'btn btn-wide', type: 'button', onclick: () => checkTeacherAnswer() }, 'Проверить'),
      task.exam ? null : el('button', {
        class: 'btn btn-quiet btn-wide', type: 'button',
        onclick: () => renderTeacherTask({ correct: false, answer: '' }),
      }, 'Не знаю'),
    ]));
  }

  fill('teacher-task-body', children);
  const field = document.getElementById('teacher-answer');
  if (field && !feedback) {
    field.focus();
    field.addEventListener('keydown', (event) => { if (event.key === 'Enter') checkTeacherAnswer(); });
  }
}

/** Разбор правильной фразы по кускам: сам знак, как читается, что значит.
    Без преподавателя «неверно» само по себе ничему не учит. */
function teacherPhraseBreakdown(phrase) {
  const parts = splitPhraseParts(phrase.hanzi);
  return el('div', { class: 'card', style: 'margin-top:12px' }, [
    el('div', { class: 'row-between' }, [
      el('b', { text: 'Разбор' }),
      el('button', { class: 'btn btn-quiet btn-small', type: 'button',
        onclick: () => speech.speak(phrase.hanzi) }, iconLabel('sound', 'Послушать')),
    ]),
    el('div', { class: 'stack', style: 'margin-top:8px' }, parts.map((text) => {
      const word = state.words.find((item) => item.hanzi === text);
      return el('div', { class: 'row-between' }, [
        el('span', { class: 'hanzi', text }),
        el('span', { class: 'faint', text: word ? `${word.pinyin} · ${word.translation}` : '' }),
      ]);
    })),
  ]);
}

function checkTeacherAnswer(chosen) {
  const task = state.teacherTask;
  const phrase = task.phrases[task.index];
  let answer;
  if (task.kind === 'ear') {
    answer = chosen;
  } else if (task.kind === 'build') {
    answer = task.chosen.map((item) => item.text).join('');
  } else {
    const field = document.getElementById('teacher-answer');
    answer = field ? field.value : '';
  }

  if (task.kind === 'ear' && earIsTyped(task.day)) {
    const field = document.getElementById('teacher-answer');
    const typed = field ? field.value : '';
    const right = normalizeChinese(typed) === normalizeChinese(phrase.hanzi);
    if (right) task.done += 1;
    else task.mistakes = (task.mistakes || []).concat(phrase);
    if (!right) speech.speak(phrase.hanzi);
    renderTeacherTask({ correct: right, answer: typed,
      hint: right ? '' : sameCharacterSet(typed, phrase.hanzi)
        ? 'Знаки верные, но порядок другой.' : '' });
    return;
  }

  if (task.kind === 'ear') {
    const right = answer === phrase.translation;
    if (right) task.done += 1;
    else task.mistakes = (task.mistakes || []).concat(phrase);
    renderTeacherTask({ correct: right, answer, hint: '' });
    return;
  }

  const correct = normalizeChinese(answer) === normalizeChinese(phrase.hanzi);
  if (correct) task.done += 1;
  else if (!task.exam) task.mistakes = (task.mistakes || []).concat(phrase);

  // Подсказываем, в чём именно промах: те же знаки не в том порядке — частая ошибка
  let hint = '';
  if (!correct && answer) {
    hint = sameCharacterSet(answer, phrase.hanzi)
      ? 'Слова верные, но порядок другой.'
      : 'Не хватает нужных слов или есть лишние.';
  }
  if (!correct) speech.speak(phrase.hanzi);   // правильный ответ надо ещё и услышать
  renderTeacherTask({ correct, answer, hint });
}

/** Тот же набор знаков в другом порядке? Map напрямую не сравнить — сверяем пары. */
function sameCharacterSet(left, right) {
  const asPairs = (text) => Array.from(characterCounts(normalizeChinese(text)).entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return JSON.stringify(asPairs(left)) === JSON.stringify(asPairs(right));
}
