import { state } from '../core/state.js';
import { renderDialogList } from './dialogs-screen.js';
import { el, fill } from './dom.js';
import { renderLessonList } from './grammar.js';
import { renderPinyinList } from './pinyin-screen.js';
import { renderDrillList, renderSyllableTable, syllableSummary, syllablesDueToday } from './syllables-screen.js';

/* ——— Вкладки разделов «Порядок слов» и «Слоги» ———
   Раньше это жило в ui/dictation.js рядом с экраном диктанта пиньиня. Сам диктант удалён:
   попасть в него было нельзя ни одной кнопкой, а делал он ровно то же, что режим
   «Пиньинь на слух» в обычной тренировке (аудит 03.09.2026).                            */

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
