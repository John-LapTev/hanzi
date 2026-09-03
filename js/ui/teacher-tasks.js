import { STORE_SRS } from '../core/constants.js';
import { dbPut } from '../core/db.js';
import { updateDayStats } from '../core/stats.js';
import { qualityFromVerdict, shuffle } from '../core/modes.js';
import { releaseMicrophone } from '../core/recorder.js';
import { speech } from '../core/speech.js';
import { applySm2, createSrsRecord } from '../core/srs.js';
import { state } from '../core/state.js';
import { TEACHER_DAYS } from '../data/teacher-days.js';
import { characterCounts, normalizeChinese } from './dialogs-screen.js';
import { el, fill, toast } from './dom.js';
import { iconLabel, uiIcon } from './icons.js';
import { attemptDetails, pitchChart, recordButton } from './pronounce.js';
import { showScreen } from './screens.js';
import { markTeacherStep, renderTeacherDay, teacherDay, teacherWordsBefore } from './teacher-course.js';

/* ——— Откуда берём фразы для заданий ———
   Раньше каждое задание жило внутри своего дня: четыре фразы — и всё. Владелец попросил
   больше упражнений и, главное, чтобы в них шли слова прошлых дней (25.08.2026): словарь
   копится, значит и материала для фраз становится больше, а старое повторяется само.
   Поэтому берём фразы своего дня и добираем из пройденных — до нужного объёма.        */

/** Все фразы дней с первого по этот, без повторов: одна и та же фраза встречается в разных днях. */
function phrasesUpTo(day) {
  const seen = new Set();
  const out = [];
  TEACHER_DAYS.filter((entry) => entry.day <= day).forEach((entry) => {
    (entry.phrases || []).forEach((phrase) => {
      if (seen.has(phrase.hanzi)) return;
      seen.add(phrase.hanzi);
      out.push(phrase);
    });
  });
  return out;
}

/** Фразы для задания: примерно две трети сегодняшних, остальное — из пройденных дней.
    Доля важна: если брать только сегодняшние, старое перестанет попадаться, а ради
    повторения всё и затевалось. */
const TODAY_SHARE = 2 / 3;

function taskPhrases(entry, size) {
  const today = shuffle((entry.phrases || []).slice());
  const seen = new Set(today.map((phrase) => phrase.hanzi));
  const earlier = shuffle(phrasesUpTo(entry.day - 1).filter((phrase) => !seen.has(phrase.hanzi)));
  const fromToday = today.slice(0, Math.ceil(size * TODAY_SHARE));
  const chosen = fromToday.concat(earlier.slice(0, size - fromToday.length));
  // если прошлых не хватило (первые дни) — добираем сегодняшними, чтобы набор был полным
  if (chosen.length < size) chosen.push(...today.slice(fromToday.length, fromToday.length + size - chosen.length));
  return shuffle(chosen);
}

/* ——— Сборка фразы из кусков, среди которых есть лишние ——— */

const TEACHER_DECOYS = 4;      // сколько лишних кусков подмешать
const TEACHER_BUILD_SIZE = 6;  // сколько фраз собрать за подход

export function startTeacherBuild(entry) {
  const phrases = taskPhrases(entry, TEACHER_BUILD_SIZE);
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

/* Сколько фраз в подходе. На слух — самое ценное задание (в Китае будут говорить, а не
   показывать иероглифы), поэтому там больше всего; проговаривание вслух короче — оно
   утомительнее. Раньше везде было по четыре (просьба увеличить — 25.08.2026).          */
const PHRASE_STEP_SIZE = { ear: 10, speak: 6, type: 6 };

/* Пока слов мало, на слух выбирают из четырёх переводов. Дальше это уже слишком просто:
   с шестого дня услышанное записывают сами, по-китайски (просьба владельца 17.08.2026). */
const EAR_TYPING_FROM_DAY = 6;
/* Услышанное записывают сами — независимо от длины фразы. Я было ограничил это короткими
   («пятнадцать знаков с голоса не наберёшь»), но владелец возразил: в том и смысл, чтобы
   вспоминать иероглифы и порядок слов из головы, а готовые варианты перед глазами это
   убивают (25.08.2026). Длина фразы значения не имеет. */
const earIsTyped = (day) => day >= EAR_TYPING_FROM_DAY;

export function startTeacherPhraseStep(entry, kind) {
  const size = PHRASE_STEP_SIZE[kind] || 6;
  const phrases = taskPhrases(entry, size);
  // В первые дни фраз мало даже вместе с прошлыми — тогда добираем словами дня: они
  // звучат так же, и выбор из четырёх переводов остаётся осмысленным (владелец, 17.08.2026).
  if (phrases.length < size) {
    const words = teacherWordsBefore(entry.day + 1)
      .map((word) => ({ hanzi: word.hanzi, pinyin: word.pinyin, translation: word.translation }))
      .filter((word) => !phrases.some((phrase) => phrase.hanzi === word.hanzi));
    phrases.push(...shuffle(words).slice(0, size - phrases.length));
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

/* ——— Повторение по кускам ———
   Длинную фразу целиком не повторишь: пока доберёшься до конца, забудешь начало. Поэтому
   режем её на речевые группы — по знакам препинания, а длинные части ещё по два слова —
   и даём проговорить по частям, прежде чем сказать целиком. Приём известный (shadowing),
   и у нас для него всё есть: почти каждый кусок озвучен отдельной записью.             */

const GROUP_MAX_WORDS = 3;        // больше трёх слов подряд уже не удержать в голове

/**
 * Куски фразы для повторения: сначала по знакам препинания — это естественные речевые
 * группы, — а слишком длинные части ещё по три слова. Каждый кусок хранит и слова
 * отдельно: собственной записи у склейки вроде 你叫什么 нет, зато есть у каждого слова,
 * и подряд они звучат как надо.
 */
/* Служебные слова не начинают кусок: «我的护照» разрывать на «我» и «的护照» нельзя —
   的 без хозяина не значит ничего. Такое слово прилипает к предыдущему куску. */
const NEVER_STARTS = new Set(['的', '了', '吗', '吧', '呢', '个', '们', '一下', '儿']);

export function speechGroups(hanzi) {
  const groups = [];
  hanzi.split(/[，。？！、；：]/).filter((piece) => piece.trim()).forEach((piece) => {
    const words = splitPhraseParts(piece);
    let chunk = [];
    words.forEach((word) => {
      const full = chunk.length >= GROUP_MAX_WORDS;
      if (full && !NEVER_STARTS.has(word)) {
        groups.push({ text: chunk.join(''), words: chunk });
        chunk = [];
      }
      chunk.push(word);
    });
    if (chunk.length) groups.push({ text: chunk.join(''), words: chunk });
  });
  return groups;
}

/** Проигрывает кусок: своей записью, если она есть, иначе словами подряд. */
async function playGroup(group) {
  if (speech.clipUrl(group.text)) { await speech.speakUntilEnd(group.text); return; }
  for (const word of group.words) await speech.speakUntilEnd(word);
}

/** Куски фразы: нажимаешь — звучит, повторяешь вслух, идёшь дальше. */
function shadowingBlock(task, hanzi) {
  const groups = speechGroups(hanzi);
  if (groups.length < 2) return null;

  const playAll = async () => {
    if (task.playingGroups) { speech.stop(); task.playingGroups = false; renderTeacherTask(); return; }
    task.playingGroups = true;
    renderTeacherTask();
    for (const group of groups) {
      if (!task.playingGroups) return;
      await playGroup(group);
      // тишина после куска: это время на повтор вслух
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    task.playingGroups = false;
    renderTeacherTask();
  };

  return el('div', { class: 'shadow-block' }, [
    el('p', { class: 'faint', text: 'Повтори по кускам: слушаешь — говоришь вслух — дальше.' }),
    el('div', { class: 'shadow-groups' }, groups.map((group) => el('button', {
      class: 'shadow-group', type: 'button', onclick: () => playGroup(group),
    }, [
      el('span', { class: 'hanzi', text: group.text }),
      uiIcon('sound', 15),
    ]))),
    el('div', { class: 'center' }, el('button', {
      class: 'btn btn-quiet btn-small', type: 'button', onclick: playAll,
    }, task.playingGroups ? iconLabel('stop', 'Остановить')
      : iconLabel('play', 'Подряд, с паузами на повтор'))),
  ]);
}

function renderSpeakTask(task, phrase) {
  if (!task.revealed) {
    const lines = [
      el('div', { class: 'card center' }, [
        el('div', { class: 'card-question', text: phrase.translation }),
        el('p', { class: 'faint', style: 'margin-top:16px',
          text: 'Скажи это по-китайски вслух — вслух, не про себя. Потом сверишься с записью.' }),
        task.attempt
          ? el('p', { class: task.attempt.ok ? 'verdict is-ok' : 'verdict is-err',
              style: 'margin-top:14px', text: task.attempt.text })
          : null,
        task.attempt ? attemptDetails(task.attempt) : null,
        task.attempt ? pitchChart(task.attempt.reference, task.attempt.attempt) : null,
        task.checking ? el('p', { class: 'faint', style: 'margin-top:14px', text: 'Слушаю…' }) : null,
      ]),
      (() => {
        const button = recordButton(task, phrase.hanzi, renderTeacherTask, true);
        return button ? el('div', { class: 'center' }, button) : null;
      })(),
      el('div', { class: 'center' }, el('button', {
        class: 'btn btn-wide', type: 'button',
        onclick: () => {
          task.attempt = null;
          releaseMicrophone();
          task.revealed = true;
          renderTeacherTask();
          speech.speak(phrase.hanzi);
        },
      }, 'Сказал — проверить себя')),
    ];
    return lines;
  }
  return [
    el('div', { class: 'card center' }, [
      el('div', { class: 'sentence' }, phrase.hanzi),
      el('div', { class: 'sentence-pinyin', text: phrase.pinyin }),
      el('p', { class: 'faint', text: phrase.translation }),
      // Голый значок владелец не замечал — у кнопки эталона есть подпись
      el('button', { class: 'btn btn-quiet btn-small', type: 'button', style: 'margin-top:12px',
        onclick: () => speech.speak(phrase.hanzi) }, iconLabel('sound', 'Послушать, как правильно')),
      shadowingBlock(task, phrase.hanzi),
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
  const phrases = taskPhrases(entry, PHRASE_STEP_SIZE.type);
  if (!phrases.length) { toast('Для этого дня фраз пока нет.', true); return; }
  state.teacherTask = { kind: 'type', day: entry.day, phrases, index: 0, done: 0 };
  showScreen('teacher-task');
  renderTeacherTask();
}

/** Пройти то же задание заново: фразы подбираются снова, значит и набор будет другим. */
export function restartTeacherTask() {
  const task = state.teacherTask;
  if (!task) return;
  const entry = teacherDay(task.day);
  if (!entry) return;
  if (task.exam) { startTeacherExam(entry); return; }
  if (task.kind === 'build') { startTeacherBuild(entry); return; }
  if (task.kind === 'type') { startTeacherTyping(entry); return; }
  startTeacherPhraseStep(entry, task.kind);
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
    // Класс тот же, что в уроках грамматики: у своего `drill-slot` стилей не было вовсе,
    // и поле сборки шло без пунктирной рамки (аудит 03.09.2026)
    const slot = el('div', { class: 'chunk-slot' }, task.chosen.length
      ? task.chosen.map((item, position) => el('button', {
          class: 'chunk', type: 'button', disabled: Boolean(feedback),
          onclick: () => { task.chosen.splice(position, 1); renderTeacherTask(); },
        }, item.text))
      : el('span', { class: 'faint', text: 'Нажимай куски снизу' }));
    children.push(slot);

    /* После проверки лишние куски убираем совсем: ответ уже дан, и разглядывать варианты,
       которые могли бы подойти, незачем — только мешают читать разбор (Иван 03.09.2026). */
    const bank = el('div', { class: 'row', style: 'margin-top:12px' });
    if (!feedback) task.bank.forEach((item) => {
      if (task.chosen.includes(item)) return;
      const chunk = el('button', {
        class: 'chunk', type: 'button', disabled: Boolean(feedback),
        onclick: () => { task.chosen.push(item); renderTeacherTask(); },
      }, item.text);
      // Кусок можно послушать отдельно — как в уроках грамматики (просьба владельца 26.08.2026):
      // на слух слово часто узнаётся раньше, чем в лицо.
      if (speech.available && speech.hasClip(item.text)) {
        bank.append(el('span', { class: 'chunk-pair' }, [
          chunk,
          el('button', {
            class: 'chunk-sound', type: 'button', 'aria-label': `Послушать ${item.text}`,
            onclick: (event) => { event.stopPropagation(); speech.speak(item.text); },
          }, uiIcon('sound', 20)),
        ]));
      } else {
        bank.append(chunk);
      }
    });
    if (!feedback) children.push(bank);
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
      // «Не знаю» — это тоже ответ, и неверный. Раньше кнопка просто показывала правильный
      // вариант, ничего не записывая: задание кончалось словами «прогони ошибки», а списка
      // ошибок не было — шаг нельзя было ни закрыть, ни переделать (аудит 03.09.2026).
      task.exam ? null : el('button', {
        class: 'btn btn-quiet btn-wide', type: 'button',
        onclick: () => giveUpTeacherAnswer(),
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

/** Отмечает занятие в дневной статистике. Фразы, слоги и трудные слова тоже учёба:
    без этого день, проведённый за ними, считался прогулом (аудит 03.09.2026). */
function countPhraseAnswer(correct) {
  const task = state.teacherTask;
  updateDayStats({ reviewed: 1, correct: correct ? 1 : 0, errors: correct ? 0 : 1,
    mode: `teacher:${task ? task.kind : 'phrase'}` });
}

/** Честно засчитывает «не знаю»: фраза уходит в ошибки и вернётся в конце задания. */
function giveUpTeacherAnswer() {
  const task = state.teacherTask;
  const phrase = task.phrases[task.index];
  task.mistakes = (task.mistakes || []).concat(phrase);
  countPhraseAnswer(false);
  speech.speak(phrase.hanzi);
  renderTeacherTask({ correct: false, answer: '', hint: '' });
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
    countPhraseAnswer(right);
    speech.speak(phrase.hanzi);   // фразу нужно услышать в любом случае, не только при ошибке
    renderTeacherTask({ correct: right, answer: typed,
      hint: right ? '' : sameCharacterSet(typed, phrase.hanzi)
        ? 'Знаки верные, но порядок другой.' : '' });
    return;
  }

  if (task.kind === 'ear') {
    const right = answer === phrase.translation;
    if (right) task.done += 1;
    else task.mistakes = (task.mistakes || []).concat(phrase);
    countPhraseAnswer(right);
    renderTeacherTask({ correct: right, answer, hint: '' });
    return;
  }

  const correct = normalizeChinese(answer) === normalizeChinese(phrase.hanzi);
  if (correct) task.done += 1;
  // Ошибки копим и на экзамене: части «на слух» и «сказать вслух» так и делали, а печатные
  // фразы выпадали — экзамен обещал вернуть их слова в повторение и не возвращал
  // (аудит 03.09.2026).
  else task.mistakes = (task.mistakes || []).concat(phrase);

  // Подсказываем, в чём именно промах: те же знаки не в том порядке — частая ошибка
  let hint = '';
  if (!correct && answer) {
    hint = sameCharacterSet(answer, phrase.hanzi)
      ? 'Слова верные, но порядок другой.'
      : 'Не хватает нужных слов или есть лишние.';
  }
  countPhraseAnswer(correct);
  /* Фраза звучит и при верном ответе: Иван собрал «他也很好。», получил «Верно» и тишину
     (03.09.2026). В уроках грамматики звук был как раз при верном ответе — теперь одинаково. */
  speech.speak(phrase.hanzi);
  renderTeacherTask({ correct, answer, hint });
}

/** Тот же набор знаков в другом порядке? Map напрямую не сравнить — сверяем пары. */
function sameCharacterSet(left, right) {
  const asPairs = (text) => Array.from(characterCounts(normalizeChinese(text)).entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return JSON.stringify(asPairs(left)) === JSON.stringify(asPairs(right));
}
