import { setSetting } from '../core/db.js';
import { isWordAvailable } from '../core/modes.js';
import { isStarted } from '../core/srs.js';
import { state } from '../core/state.js';
import { loadStrokeData } from '../core/strokes.js';
import { STROKE_RULES } from '../data/stroke-rules.js';
import { el, fill } from './dom.js';
import { uiIcon } from './icons.js';
import { openStrokeViewer, renderTeacherStrokes } from './teacher-strokes.js';

/* ——— Раздел «Написание»: сетка знаков и просмотр анимации ——— */

/** Знаки берём из слов, которые Иван уже начал учить — как он и просил. */
function studiedCharacters() {
  const seen = new Set();
  state.words.forEach((word) => {
    if (!isStarted(state.srs.get(word.id))) return;
    Array.from(word.hanzi).forEach((character) => {
      if (/[一-龥]/.test(character)) seen.add(character);
    });
  });
  return Array.from(seen);
}

function availableCharacters() {
  const seen = new Set();
  state.words.filter(isWordAvailable).forEach((word) => {
    Array.from(word.hanzi).forEach((character) => {
      if (/[一-龥]/.test(character)) seen.add(character);
    });
  });
  return Array.from(seen);
}

/** Страница правил: каждое правило со своими знаками, знак открывает анимацию написания. */
export function renderStrokeRules() {
  fill('stroke-rules-body', STROKE_RULES.map((rule, index) => el('div', { class: 'card' }, [
    el('div', { class: 'row-between' }, [
      el('b', { text: `${index + 1}. ${rule.title}` }),
    ]),
    el('p', { class: 'faint', style: 'margin:8px 0 12px', text: rule.note }),
    el('div', { class: 'rule-examples' }, rule.examples.map((character) => el('button', {
      class: 'rule-example hanzi', type: 'button',
      'aria-label': `Показать, как пишется ${character}`,
      onclick: () => openStrokeViewer(character),
    }, character))),
  ])));
}

/** Ставит и снимает отметку «прописал от руки». Нажатие повторно снимает — просил владелец. */
export async function toggleStrokeWritten(character) {
  if (state.strokesWritten.has(character)) state.strokesWritten.delete(character);
  else state.strokesWritten.add(character);
  await setSetting('strokesWritten', Array.from(state.strokesWritten));
  // Отметки общие для обоих экранов прописей — перерисовываем тот, что открыт
  if (state.screen === 'teacher-strokes') renderTeacherStrokes();
  else renderStrokes();
}

export async function renderStrokes() {
  const grid = document.getElementById('strokes-grid');
  fill(grid, el('p', { class: 'faint', text: 'Открываю прописи…' }));

  let data;
  try {
    data = await loadStrokeData();
  } catch (error) {
    fill(grid, el('div', { class: 'card' }, [
      el('b', { text: 'Не удалось открыть прописи' }),
      el('p', { class: 'faint', text: `${error.message}. Проверь, что приложение запущено через tools/serve.sh.` }),
    ]));
    return;
  }

  const search = state.strokesSearch.trim();
  const studied = studiedCharacters().filter((character) => data[character]);
  const source = state.strokesShowAll ? availableCharacters().filter((character) => data[character]) : studied;
  const visible = search ? source.filter((character) => character.includes(search)) : source;

  const children = [];
  if (!studied.length && !state.strokesShowAll) {
    children.push(el('div', { class: 'card' }, [
      el('b', { text: 'Пока пусто' }),
      el('p', { class: 'faint', text: 'Знаки появляются здесь, когда слово попало в тренировку. Пройди сессию — и возвращайся.' }),
      el('button', {
        class: 'btn btn-small', type: 'button',
        onclick: () => { state.strokesShowAll = true; renderStrokes(); },
      }, 'Показать все знаки'),
    ]));
  } else {
    children.push(el('p', { class: 'faint', text: state.strokesShowAll
      ? `Все знаки открытых уровней: ${visible.length}`
      : `Знаки из твоих слов: ${visible.length}. Нажми на любой — покажу, как писать.` }));
    children.push(el('div', { class: 'stroke-grid' }, visible.map((character) => {
      const written = state.strokesWritten.has(character);
      return el('div', { class: 'stroke-slot' }, [
        el('button', {
          class: 'stroke-cell hanzi', type: 'button', onclick: () => openStrokeViewer(character),
        }, character),
        // Отметка «прописал в тетради»: своя, ручная — приложение само её не ставит
        el('button', {
          class: `stroke-mark${written ? ' is-written' : ''}`, type: 'button',
          'aria-pressed': written,
          'aria-label': written ? `${character}: снять отметку` : `${character}: отметить как прописанный`,
          title: written ? 'Прописан от руки — нажми, чтобы снять' : 'Отметить, что прописал в тетради',
          onclick: (event) => { event.stopPropagation(); toggleStrokeWritten(character); },
        }, written ? uiIcon('check', 13) : null),
      ]);
    })));
    if (!state.strokesShowAll) {
      children.push(el('button', {
        class: 'btn btn-quiet btn-small', type: 'button', style: 'margin-top:16px',
        onclick: () => { state.strokesShowAll = true; renderStrokes(); },
      }, 'Показать вообще все знаки'));
    } else {
      children.push(el('button', {
        class: 'btn btn-quiet btn-small', type: 'button', style: 'margin-top:16px',
        onclick: () => { state.strokesShowAll = false; renderStrokes(); },
      }, 'Только мои слова'));
    }
  }
  fill(grid, children);
}
