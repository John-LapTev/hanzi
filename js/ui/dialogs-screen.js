import { STORE_GRAMMAR } from '../core/constants.js';
import { dbPut } from '../core/db.js';
import { speech } from '../core/speech.js';
import { isLearned } from '../core/srs.js';
import { state } from '../core/state.js';
import { DIALOGS } from '../data/dialogs.js';
import { el, fill, toast } from './dom.js';
import { iconLabel, uiIcon } from './icons.js';
import { showScreen } from './screens.js';
import { renderSentence } from './sentence.js';

/* ——— Разговоры: ввод ответа по-китайски ——— */

/** Для сравнения убираем пробелы и знаки препинания — важен только состав и порядок знаков. */
export function normalizeChinese(text) {
  return String(text || '')
    .replace(/[\s]/g, '')
    .replace(/[，。？！、；：,.?!;:'"“”‘’()（）]/g, '');
}

export const characterCounts = (text) => {
  const counts = new Map();
  Array.from(text).forEach((character) => counts.set(character, (counts.get(character) || 0) + 1));
  return counts;
};

/**
 * Разбор ответа: сначала точное совпадение, потом — тот же набор знаков в другом порядке
 * (это и есть главная ошибка владельца), и лишь затем разбор по недостающим знакам.
 */
function checkDialogAnswer(typed, line) {
  const answer = normalizeChinese(typed);
  const variants = line.answers.map(normalizeChinese);
  if (!answer) return { status: 'empty' };
  if (variants.includes(answer)) return { status: 'correct' };

  const expected = variants[0];
  const answerCounts = characterCounts(answer);
  const expectedCounts = characterCounts(expected);
  const sameSet = answerCounts.size === expectedCounts.size
    && Array.from(expectedCounts.entries()).every(([character, count]) => answerCounts.get(character) === count);
  if (sameSet) return { status: 'order' };

  const missing = Array.from(expectedCounts.keys()).filter((character) => !answerCounts.has(character));
  const extra = Array.from(answerCounts.keys()).filter((character) => !expectedCounts.has(character));
  return { status: 'wrong', missing, extra };
}

/**
 * Готовность сценки к режиму «только китайский». Условия ставил владелец (14.08.2026):
 * слова этой сценки выучены (три верных повторения подряд — ошибка сбрасывает счёт)
 * и её знаки разобраны в прописях. Пока не выполнено — режим виден, но закрыт.
 */
function dialogReadiness(dialog) {
  const text = dialog.lines.map((line) => line.hanzi).join('');
  const words = state.words.filter((word) => word.hanzi.length > 1 && text.includes(word.hanzi));
  const learned = words.filter((word) => isLearned(state.srs.get(word.id))).length;
  const characters = Array.from(new Set(Array.from(text).filter((character) => /[一-龥]/.test(character))));
  const seen = characters.filter((character) => state.strokesSeen.has(character)).length;
  return {
    words: words.length,
    learned,
    characters: characters.length,
    seen,
    allowed: words.length > 0 && learned === words.length && seen === characters.length,
  };
}

export function renderDialogList() {
  fill('dialog-list', DIALOGS.map((dialog) => {
    const progress = state.grammarProgress.get(`dialog:${dialog.id}`);
    const readiness = dialogReadiness(dialog);
    const badges = [];
    if (progress && progress.done) badges.push(el('span', { class: 'badge badge-ok', text: 'пройден' }));
    badges.push(readiness.allowed
      ? el('span', { class: 'badge badge-accent', text: 'сложный открыт' })
      : el('span', { class: 'badge' }, [uiIcon('lock', 14), el('span', { text: ` ${readiness.learned}/${readiness.words}` })]));
    return el('button', {
      class: 'lesson-row', type: 'button', onclick: () => openDialog(dialog.id),
    }, [
      el('span', { class: 'lesson-title' }, [
        el('div', { text: dialog.title }),
        el('div', { class: 'faint', text: `${dialog.topic} · ${dialog.lines.filter((line) => line.role === 'you').length} твоих реплик` }),
      ]),
      el('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, badges),
    ]);
  }));
}

function openDialog(dialogId) {
  state.dialog = DIALOGS.find((item) => item.id === dialogId);
  state.dialogStep = 0;
  state.dialogHint = false;
  state.dialogHard = false;
  showScreen('dialog');
  document.getElementById('dialog-heading').textContent = state.dialog.title;
  document.getElementById('dialog-intro').textContent = state.dialog.intro;
  renderDialog();
}

/** Переключатель «с подсказками / только китайский» со счётчиком, чего не хватает. */
function renderDialogModeSwitch() {
  const readiness = dialogReadiness(state.dialog);
  const row = el('div', { class: 'chip-scroll', style: 'margin-bottom:16px' }, [
    el('button', {
      class: 'chip', type: 'button', 'aria-pressed': !state.dialogHard,
      onclick: () => { state.dialogHard = false; renderDialog(); },
    }, 'С подсказками'),
    el('button', {
      class: 'chip', type: 'button', 'aria-pressed': state.dialogHard, disabled: !readiness.allowed,
      title: readiness.allowed ? 'Ни перевода, ни пиньиня' : 'Откроется, когда выучишь слова и разберёшь знаки',
      onclick: () => { state.dialogHard = true; renderDialog(); },
    }, readiness.allowed ? [el('span', { text: 'Только китайский' })] : iconLabel('lock', 'Только китайский')),
  ]);

  const note = readiness.allowed
    ? el('p', { class: 'faint', text: 'Сложный режим открыт: ни перевода, ни транскрипции, ни подсказок.' })
    : el('p', { class: 'faint', text: `Сложный режим откроется, когда выучишь слова этой сценки (${readiness.learned} из ${readiness.words}) и разберёшь её знаки в «Чертах» (${readiness.seen} из ${readiness.characters}).` });

  return el('div', {}, [row, note]);
}

function renderDialog(feedback) {
  const dialog = state.dialog;
  const hard = state.dialogHard;
  const children = [renderDialogModeSwitch()];

  // Лента: всё, что уже сказано
  dialog.lines.slice(0, state.dialogStep).forEach((line) => {
    children.push(renderBubble(line, hard));
  });

  const line = dialog.lines[state.dialogStep];
  if (!line) {
    children.push(el('div', { class: 'card center' }, [
      el('div', { class: 'big-hanzi hanzi', text: '好', style: 'font-size:56px' }),
      el('p', { text: 'Разговор пройден целиком.' }),
      el('div', { class: 'row', style: 'justify-content:center' }, [
        el('button', {
          class: 'btn btn-quiet btn-small', type: 'button',
          onclick: () => { state.dialogStep = 0; renderDialog(); },
        }, 'Ещё раз'),
        el('button', { class: 'btn btn-small', type: 'button', onclick: () => showScreen('grammar') }, 'К разговорам'),
      ]),
    ]));
    fill('dialog-thread', children);
    return;
  }

  if (line.role === 'them') {
    children.push(renderBubble(line, hard));
    children.push(el('button', {
      class: 'btn btn-wide', type: 'button',
      onclick: () => { state.dialogStep += 1; renderDialog(); },
    }, 'Дальше →'));
    fill('dialog-thread', children);
    return;
  }

  // Реплика игрока: печатает сам
  const input = el('input', {
    type: 'text', id: 'dialog-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: 'Печатай по-китайски…', disabled: Boolean(feedback && feedback.status === 'correct'),
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submitDialogAnswer(input.value); }
  });

  // В сложном режиме — ни русской формулировки задания, ни подсказок: только «ответь по-китайски».
  const task = [
    el('p', { class: 'card-question', text: hard ? 'Твой ответ' : line.prompt }),
    input,
    el('div', { class: 'row', style: 'margin-top:12px' }, [
      el('button', { class: 'btn btn-small', type: 'button', onclick: () => submitDialogAnswer(input.value) }, 'Проверить'),
      hard ? null : el('button', {
        class: 'btn btn-quiet btn-small', type: 'button',
        onclick: () => { state.dialogHint = !state.dialogHint; renderDialog(feedback); },
      }, state.dialogHint ? 'Скрыть подсказку' : 'Подсказка'),
      el('button', {
        class: 'btn btn-quiet btn-small', type: 'button',
        onclick: () => renderDialog({ status: 'shown' }),
      }, hard ? 'Сдаюсь' : 'Не знаю'),
    ].filter(Boolean)),
  ];

  if (state.dialogHint && !hard) {
    task.push(el('div', { class: 'word-bank' }, line.bank.map((chunk) => el('span', { class: 'chip', text: chunk }))));
  }

  if (feedback) {
    if (feedback.status === 'correct') {
      task.push(el('p', { class: 'verdict is-ok', text: 'Верно' }));
      task.push(el('button', {
        class: 'btn btn-wide', type: 'button',
        onclick: () => { state.dialogStep += 1; state.dialogHint = false; renderDialog(); },
      }, 'Дальше →'));
    } else if (feedback.status === 'order') {
      task.push(el('p', { class: 'verdict is-tone', text: 'Слова верные, порядок нет' }));
      if (!hard) task.push(el('p', { class: 'faint', text: line.rule }));
      task.push(copyForReviewButton(line, feedback.typed));
    } else if (feedback.status === 'empty') {
      task.push(el('p', { class: 'verdict is-err', text: 'Пустой ответ — напиши фразу по-китайски' }));
    } else {
      task.push(el('p', { class: 'verdict is-err', text: hard ? 'Не совпало с образцом' : 'Не совсем так' }));
      if (!hard && feedback.status === 'wrong' && (feedback.missing.length || feedback.extra.length)) {
        const notes = [];
        if (feedback.missing.length) notes.push(`не хватает: ${feedback.missing.join(' ')}`);
        if (feedback.extra.length) notes.push(`лишнее: ${feedback.extra.join(' ')}`);
        task.push(el('p', { class: 'faint', text: notes.join(' · ') }));
      }
      // В сложном режиме образец показывается по-китайски: перевод только если сдался
      task.push(el('div', { class: 'example-block' }, [
        renderSentence(line.hanzi),
        hard && feedback.status !== 'shown' ? null : el('div', { class: 'sentence-pinyin', text: line.pinyin }),
        hard && feedback.status !== 'shown' ? null : el('div', { class: 'sentence-translation', text: line.translation }),
        hard ? null : el('div', { class: 'faint', text: line.rule }),
      ].filter(Boolean)));
      task.push(copyForReviewButton(line, feedback.typed));
      task.push(el('button', {
        class: 'btn btn-wide', type: 'button',
        onclick: () => { state.dialogStep += 1; state.dialogHint = false; renderDialog(); },
      }, 'Дальше →'));
    }
  }

  children.push(el('div', { class: 'card dialog-task' }, task));
  fill('dialog-thread', children);
  if (!feedback) input.focus();
}

/**
 * Живой разбор фразы делает не приложение, а Claude в Telegram-боте проекта (решение владельца
 * от 14.08.2026). Поэтому здесь — только сбор готового текста в буфер обмена.
 */
function copyForReviewButton(line, typed) {
  const text = [
    `Разбери мой ответ по-китайски.`,
    `Задание: ${line.prompt}`,
    `Мой ответ: ${typed || '—'}`,
    `Образец из приложения: ${line.hanzi}`,
  ].join('\n');
  return el('button', {
    class: 'btn btn-quiet btn-small', type: 'button', style: 'margin-top:8px',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast('Скопировано — пришли это боту, разберу подробно.');
      } catch (error) {
        toast('Браузер не дал доступ к буферу обмена.', true);
      }
    },
  }, iconLabel('copy', 'Скопировать для разбора у Клода'));
}

function renderBubble(line, hard) {
  const isYou = line.role === 'you';
  const bubble = el('div', { class: 'bubble' }, [
    isYou ? el('div', { class: 'hanzi', text: line.hanzi }) : renderSentence(line.hanzi),
    // В сложном режиме остаются только иероглифы: ни транскрипции, ни перевода
    hard ? null : el('div', { class: 'bubble-pinyin', text: line.pinyin }),
    hard ? null : el('div', { class: 'bubble-translation', text: line.translation }),
  ].filter(Boolean));
  const row = el('div', { class: isYou ? 'bubble-row is-you' : 'bubble-row' }, bubble);
  if (!isYou && speech.available) {
    bubble.append(el('button', {
      class: 'btn btn-quiet btn-small', type: 'button', style: 'margin-top:8px',
      onclick: () => speech.speak(line.hanzi),
    }, iconLabel('sound', 'Послушать')));
  }
  return row;
}

async function submitDialogAnswer(value) {
  const dialog = state.dialog;
  const line = dialog.lines[state.dialogStep];
  const feedback = checkDialogAnswer(value, line);
  feedback.typed = String(value || '').trim();
  renderDialog(feedback);

  if (feedback.status !== 'correct') return;
  const key = `dialog:${dialog.id}`;
  const progress = state.grammarProgress.get(key) || { lessonId: key, correct: 0, total: 0, done: false };
  progress.correct += 1;
  progress.total += 1;
  const answered = dialog.lines.filter((item) => item.role === 'you').length;
  if (progress.correct >= answered) {
    progress.done = true;
    if (state.dialogHard) progress.hardDone = true;   // для достижения «Без подсказок»
  }
  progress.updatedAt = new Date().toISOString();
  state.grammarProgress.set(key, progress);
  await dbPut(STORE_GRAMMAR, progress);
  if (speech.available) speech.speak(line.hanzi);
}
