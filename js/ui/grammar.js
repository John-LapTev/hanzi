import { STORE_GRAMMAR } from '../core/constants.js';
import { dbPut } from '../core/db.js';
import { shuffle } from '../core/modes.js';
import { explainOrder, orderHint } from '../core/sentence-order.js';
import { speech } from '../core/speech.js';
import { state } from '../core/state.js';
import { GRAMMAR_LESSONS } from '../data/grammar.js';
import { el, fill } from './dom.js';
import { iconLabel, uiIcon } from './icons.js';
import { showScreen, syncBackButton } from './screens.js';
import { renderSentence } from './sentence.js';
import { finishTeacherReturn } from './train.js';

/* ——— Грамматика ——— */

export function renderLessonList() {
  fill('lesson-list', GRAMMAR_LESSONS.map((lesson, index) => {
    const progress = state.grammarProgress.get(lesson.id);
    const badge = progress && progress.done
      ? el('span', { class: 'badge badge-ok', text: 'пройден' })
      : el('span', { class: 'badge', text: `${lesson.drills.length} фраз` });
    return el('button', {
      class: 'lesson-row', type: 'button', onclick: () => openLesson(lesson.id, { screen: 'grammar' }),
    }, [
      el('span', { class: 'faint', text: String(index + 1) }),
      el('span', { class: 'lesson-title' }, [
        el('div', { text: lesson.title }),
        el('div', { class: 'faint', text: lesson.rule }),
      ]),
      badge,
    ]);
  }));
}

export function openLesson(lessonId, from) {
  const lesson = GRAMMAR_LESSONS.find((item) => item.id === lessonId);
  if (!lesson) return;
  if (from) state.cameFrom.lesson = from;
  // Копия с перемешанными упражнениями: сам урок портить нельзя, а порядок должен быть
  // новым при каждом заходе (просьба владельца 25.08.2026).
  state.lesson = Object.assign({}, lesson, { drills: shuffle(lesson.drills.slice()) });
  state.drillIndex = 0;
  state.drillChunks = [];
  drillBank.forIndex = null;
  showScreen('lesson');
  document.getElementById('lesson-heading').textContent = state.lesson.title;
  syncBackButton('lesson-back', 'lesson', '← К списку', 'grammar');
  renderLesson();
}

/** Пройти урок заново, не выходя с экрана: порядок упражнений будет другим. */
export function restartLesson() {
  if (state.lesson) openLesson(state.lesson.id);
}

function renderLesson(feedback) {
  const lesson = state.lesson;
  const children = [
    el('div', { class: 'lesson-rule', text: lesson.rule }),
    el('div', { class: 'card', style: 'margin-top:16px' },
      lesson.explain.map((paragraph) => el('p', { text: paragraph }))),
    el('h3', { text: 'Как это выглядит' }),
  ];

  lesson.examples.forEach((example) => {
    children.push(el('div', { class: 'example-block' }, [
      renderSentence(example.hanzi),
      el('div', { class: 'sentence-pinyin', text: example.pinyin }),
      el('div', { class: 'sentence-translation', text: example.translation }),
      el('div', { class: 'faint', text: example.note }),
      speech.available ? el('button', {
        class: 'btn btn-quiet btn-small', type: 'button', style: 'margin-top:8px',
        onclick: () => speech.speak(example.hanzi),
      }, iconLabel('sound', 'Послушать')) : null,
    ].filter(Boolean)));
  });

  children.push(el('h3', { text: 'Собери фразу' }));
  children.push(renderDrill(feedback));
  fill('lesson-body', children);
}

/* ——— Разбор порядка ———
   Показать «правильно вот так» мало: владелец просил объяснять, ПОЧЕМУ так (25.08.2026).
   Раскладываем его же фразу по ролям — кто, когда, где, что делает — и подписываем то
   правило, которое в этой фразе главное.                                                */
function orderBreakdown(chunks) {
  const parts = explainOrder(chunks);
  if (!parts.some((part) => part.role)) return null;

  const hint = orderHint(parts);
  return el('div', { class: 'order-breakdown' }, [
    el('div', { class: 'order-row' }, parts.map((part) => el('span', { class: 'order-part' }, [
      el('span', { class: 'hanzi', text: part.chunk }),
      el('span', { class: 'order-role', text: part.role || '' }),
    ]))),
    hint ? el('p', { class: 'faint', text: hint }) : null,
  ]);
}

function renderDrill(feedback) {
  const lesson = state.lesson;
  const drill = lesson.drills[state.drillIndex];

  if (!drill) {
    return el('div', { class: 'card center' }, [
      el('div', { class: 'big-hanzi hanzi', text: '对', style: 'font-size:56px' }),
      el('p', { text: 'Урок пройден.' }),
      el('div', { class: 'row', style: 'justify-content:center' }, [
        el('button', { class: 'btn btn-quiet btn-small', type: 'button',
          onclick: () => {
            state.drillIndex = 0;
            state.drillChunks = [];
            drillBank.forIndex = null;
            renderLesson();
          } }, 'Ещё раз'),
        state.teacherReturn && state.teacherReturn.step === 'grammar'
          ? el('button', { class: 'btn btn-small', type: 'button',
              onclick: () => finishTeacherReturn(true) }, 'К программе дня')
          : el('button', { class: 'btn btn-small', type: 'button',
              onclick: () => showScreen('grammar') }, 'К списку уроков'),
      ]),
    ]);
  }

  const chosen = state.drillChunks;
  const remaining = drill.chunks.filter((chunk, index) => !chosen.some((item) => item.index === index));

  const slot = el('div', { class: 'chunk-slot' }, chosen.length
    ? chosen.map((item, position) => el('button', {
        class: feedback ? (feedback.correct ? 'chunk is-ok' : 'chunk is-err') : 'chunk',
        type: 'button', disabled: Boolean(feedback),
        onclick: () => { state.drillChunks.splice(position, 1); renderLesson(); },
      }, item.text))
    : el('span', { class: 'faint', text: 'Нажимай куски снизу — они встанут сюда' }));

  const children = [
    el('p', { class: 'faint', text: `Фраза ${state.drillIndex + 1} из ${lesson.drills.length}` }),
    el('p', { class: 'card-question', text: drill.translation }),
    slot,
    // Разобранный ответ читается лучше без банка лишних кусков — см. тот же приём в заданиях дня
    feedback ? null : renderDrillBank(drill, chosen, feedback),
  ].filter(Boolean);

  if (feedback) {
    children.push(el('p', {
      class: feedback.correct ? 'verdict is-ok' : 'verdict is-err',
      text: feedback.correct ? 'Верно' : `Правильный порядок: ${drill.chunks.join(' ')}`,
    }));
    if (!feedback.correct) children.push(el('p', { class: 'faint', text: `Правило: ${lesson.rule}` }));
    children.push(orderBreakdown(drill.chunks));
    children.push(el('p', { class: 'sentence-pinyin center', text: drill.pinyin }));
    const phrase = drill.chunks.join('');
    if (speech.available) {
      // фраза звучит один раз сама — но послушать её ещё раз обычно и нужно
      children.push(el('div', { class: 'row center', style: 'margin-bottom:12px' },
        el('button', {
          class: 'btn btn-quiet btn-small', type: 'button',
          onclick: () => speech.speak(phrase),
        }, iconLabel('sound', 'Послушать ещё раз'))));
    }
    children.push(el('button', {
      class: 'btn btn-wide', type: 'button',
      onclick: () => { state.drillIndex += 1; state.drillChunks = []; renderLesson(); },
    }, 'Дальше →'));
  } else {
    children.push(el('button', {
      class: 'btn btn-wide', type: 'button', style: 'margin-top:16px',
      disabled: chosen.length !== drill.chunks.length,
      onclick: checkDrill,
    }, 'Проверить'));
  }

  return el('div', { class: 'card' }, children);
}

/**
 * Куски показываются вперемешку — иначе задание решается взглядом, а не головой.
 * Порядок фиксируется на время одной фразы, чтобы кнопки не прыгали при каждом клике.
 */
const drillBank = { forIndex: null, order: [] };
function renderDrillBank(drill, chosen, feedback) {
  if (drillBank.forIndex !== state.drillIndex) {
    drillBank.forIndex = state.drillIndex;
    drillBank.order = shuffle(drill.chunks.map((chunk, index) => index));
  }
  const row = el('div', { class: 'row', style: 'margin-top:12px' });
  drillBank.order.forEach((index) => {
    if (chosen.some((item) => item.index === index)) return;
    const text = drill.chunks[index];
    const chunk = el('button', {
      class: 'chunk', type: 'button', disabled: Boolean(feedback),
      onclick: () => { state.drillChunks.push({ index, text }); renderLesson(); },
    }, text);
    // Кусок можно послушать отдельно: некоторые слова знакомы на слух раньше, чем в лицо.
    if (speech.available && speech.hasClip(text)) {
      row.append(el('span', { class: 'chunk-pair' }, [
        chunk,
        el('button', {
          class: 'chunk-sound', type: 'button', 'aria-label': `Послушать ${text}`,
          onclick: (event) => { event.stopPropagation(); speech.speak(text); },
        }, uiIcon('sound', 20)),
      ]));
    } else {
      row.append(chunk);
    }
  });
  if (!row.children.length) row.append(el('span', { class: 'faint', text: 'Все куски расставлены' }));
  return row;
}

let drillChecking = false;

async function checkDrill() {
  // Второй клик по «Проверить» до перерисовки засчитывал ответ дважды (аудит 03.09.2026)
  if (drillChecking) return;
  drillChecking = true;
  try {
    await runDrillCheck();
  } finally {
    drillChecking = false;
  }
}

async function runDrillCheck() {
  const lesson = state.lesson;
  const drill = lesson.drills[state.drillIndex];
  const answer = state.drillChunks.map((item) => item.text).join('');
  const correct = answer === drill.chunks.join('');

  const progress = state.grammarProgress.get(lesson.id)
    || { lessonId: lesson.id, correct: 0, total: 0, done: false };
  progress.total += 1;
  if (correct) progress.correct += 1;
  if (state.drillIndex + 1 >= lesson.drills.length) progress.done = true;
  progress.updatedAt = new Date().toISOString();
  state.grammarProgress.set(lesson.id, progress);
  await dbPut(STORE_GRAMMAR, progress);

  renderLesson({ correct });
  if (correct && speech.available) speech.speak(drill.chunks.join(''));
}
