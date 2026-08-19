import { TONE_LABELS, isWordAvailable, shuffle } from '../core/modes.js';
import { comparePinyin, pinyinMarksToNumbers, pinyinNumbersToMarks } from '../core/pinyin.js';
import { speech } from '../core/speech.js';
import { state } from '../core/state.js';
import { renderDialogList } from './dialogs-screen.js';
import { el, fill, toast } from './dom.js';
import { renderLessonList } from './grammar.js';
import { uiIcon } from './icons.js';
import { renderPinyinList } from './pinyin-screen.js';
import { showScreen } from './screens.js';
import { renderDrillList, renderSyllableTable, syllableSummary, syllablesDueToday } from './syllables-screen.js';

/* ——— Диктант пиньиня: слышишь слово — записываешь его латиницей сам ———
   Просьба владельца: не выбирать из готовых вариантов, а писать самому, как слышится.
   Тон проверяется отдельно от слогов — та же логика, что и в тренировке ввода.        */

const DICTATION_LENGTH = 8;

function startPinyinDictation() {
  const pool = state.words.filter((word) => isWordAvailable(word) && word.pinyin);
  if (pool.length < 4) { toast('Слов пока мало для диктанта.'); return; }
  state.dictation = {
    words: shuffle(pool).slice(0, DICTATION_LENGTH),
    index: 0,
    correct: 0,
    toneOnly: 0,
    answered: false,
  };
  showScreen('pinyin-dictation');
  renderDictation();
}

function renderDictation(feedback) {
  const run = state.dictation;
  const word = run.words[run.index];

  if (!word) {
    fill('pinyin-dictation-body', el('div', { class: 'train-card' }, [
      el('div', { class: 'big-hanzi hanzi', text: '写', style: 'font-size:64px' }),
      el('div', { class: 'card-question', text: 'Диктант закончен' }),
      el('div', { class: 'card-translation', text: `${run.correct} верно из ${run.words.length}` }),
      run.toneOnly ? el('p', { class: 'faint', text: `Из них ${run.toneOnly} раз слоги были верные, а тон нет.` }) : null,
      el('div', { class: 'row', style: 'justify-content:center;margin-top:16px' }, [
        el('button', { class: 'btn btn-small', type: 'button', onclick: startPinyinDictation }, 'Ещё раз'),
        el('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => showScreen('grammar') }, 'К урокам'),
      ]),
    ].filter(Boolean)));
    return;
  }

  const input = el('input', {
    type: 'text', id: 'dictation-input', autocomplete: 'off', autocapitalize: 'off',
    spellcheck: 'false', disabled: run.answered,
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); answerDictation(input.value); }
  });
  const preview = el('div', { class: 'pinyin-preview', text: ' ' });
  input.addEventListener('input', () => {
    preview.textContent = pinyinNumbersToMarks(input.value.trim()) || ' ';
  });

  const cardChildren = [
    el('button', {
      class: 'speak-btn is-big', type: 'button', 'aria-label': 'Повторить',
      onclick: () => speech.speak(word.hanzi),
    }, uiIcon('sound', 20)),
    el('p', { class: 'faint', text: 'Слушай и запиши пиньинь. Тон — цифрой после слога' }),
  ];
  if (feedback) {
    cardChildren.push(el('div', { class: 'hanzi', style: 'font-size:44px', text: word.hanzi }));
    cardChildren.push(el('div', { class: 'card-pinyin', text: word.pinyin }));
    cardChildren.push(el('div', { class: 'card-translation', text: word.translation }));
  }

  const cardClasses = feedback
    ? `train-card is-${feedback.verdict === 'correct' ? 'ok' : feedback.verdict === 'tone' ? 'tone' : 'err'}`
    : 'train-card';

  const children = [
    el('p', { class: 'faint center', text: `${run.index + 1} из ${run.words.length}` }),
    el('div', { class: cardClasses }, cardChildren),
    el('div', { class: 'options' }, [
      input,
      preview,
      el('div', { class: 'tone-legend' }, TONE_LABELS.map((tone) => el('span', { class: 'tone-legend-item' }, [
        el('b', { class: 'hanzi', text: tone.mark }),
        el('span', { text: tone.tone === 5 ? 'без тона' : `тон ${tone.tone}` }),
      ]))),
      feedback ? null : el('button', {
        class: 'btn btn-wide', type: 'button', onclick: () => answerDictation(input.value),
      }, 'Проверить'),
      feedback ? null : el('button', {
        class: 'btn btn-quiet btn-wide', type: 'button', style: 'margin-top:6px',
        onclick: () => renderDictation({ verdict: 'wrong', shown: true }),
      }, 'Не знаю — показать ответ'),
    ].filter(Boolean)),
  ];

  if (feedback) {
    const messages = {
      correct: 'Верно',
      tone: `Слоги верные, тон нет: ${word.pinyin} (${pinyinMarksToNumbers(word.pinyin)})`,
      wrong: `Правильно: ${word.pinyin} (${pinyinMarksToNumbers(word.pinyin)})`,
    };
    children.push(el('p', {
      class: `verdict is-${feedback.verdict === 'correct' ? 'ok' : feedback.verdict === 'tone' ? 'tone' : 'err'}`,
      text: messages[feedback.verdict],
    }));
    children.push(el('button', {
      class: 'btn btn-wide', type: 'button',
      onclick: () => { run.index += 1; run.answered = false; renderDictation(); },
    }, 'Дальше →'));
  }

  fill('pinyin-dictation-body', children);
  if (!feedback) {
    input.focus();
    speech.speak(word.hanzi);
  }
}

function answerDictation(value) {
  const run = state.dictation;
  if (run.answered) return;
  const typed = String(value || '').trim();
  if (!typed) { toast('Запиши, как услышал — например ni3 hao3'); return; }
  run.answered = true;
  const word = run.words[run.index];
  const verdict = comparePinyin(typed, word.pinyin);
  if (verdict === 'correct') run.correct += 1;
  if (verdict === 'tone') run.toneOnly += 1;
  renderDictation({ verdict });
}

export function switchGrammarTab(tab) {
  state.grammarTab = tab;
  document.querySelectorAll('[data-grammar-tab]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.grammarTab === tab));
  });
  document.getElementById('grammar-rules').classList.toggle('hidden', tab !== 'rules');
  document.getElementById('grammar-dialogs').classList.toggle('hidden', tab !== 'dialogs');
  const titles = { rules: 'Порядок слов', dialogs: 'Разговоры' };
  document.getElementById('grammar-heading').textContent = titles[tab] || 'Порядок слов';
  if (tab === 'dialogs') renderDialogList();
  else renderLessonList();
}

export function switchPinyinTab(tab) {
  state.pinyinTab = tab;
  document.querySelectorAll('[data-pinyin-tab]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.pinyinTab === tab));
  });
  document.getElementById('pinyin-table').classList.toggle('hidden', tab !== 'table');
  document.getElementById('pinyin-lessons').classList.toggle('hidden', tab !== 'lessons');
  document.getElementById('pinyin-drill').classList.toggle('hidden', tab !== 'drill');
  const titles = { table: 'Слоги', lessons: 'Правила чтения', drill: 'Тренировка слогов' };
  document.getElementById('pinyin-heading').textContent = titles[tab] || 'Слоги';
  renderSyllableProgress();
  if (tab === 'lessons') renderPinyinList();
  else if (tab === 'drill') renderDrillList();
  else renderSyllableTable();
}

/** Общая шкала «пройдено слогов»: висит под вкладками, видна и в таблице, и в тренировке. */
function renderSyllableProgress() {
  const summary = syllableSummary();
  if (!summary.total) { fill('syllable-progress', []); return; }
  const share = Math.round((summary.learned / summary.total) * 100);
  fill('syllable-progress', el('div', { class: 'card', style: 'margin-bottom:16px' }, [
    el('div', { class: 'row-between' }, [
      el('b', { text: 'Пройдено слогов' }),
      el('b', { text: `${summary.learned} из ${summary.total}` }),
    ]),
    el('div', { class: 'progress-line', style: 'margin:10px 0 8px' },
      el('span', { style: `width:${share}%` })),
    el('p', { class: 'faint', style: 'margin:0', text: (() => {
      const parts = [];
      if (summary.work) parts.push(`в работе ${summary.work}`);
      if (summary.fresh) parts.push(`не начато ${summary.fresh}`);
      const due = syllablesDueToday().length;
      if (due) parts.push(`ждут повторения ${due}`);
      return parts.length
        ? `${parts.join(', ')}. Слог засчитывается после трёх верных подряд.`
        : 'Слог засчитывается после трёх верных ответов подряд.';
    })() }),
  ]));
}
