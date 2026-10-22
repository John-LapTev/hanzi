import { STORE_WORDS, USER_LEVEL } from '../core/constants.js';
import { dbPut } from '../core/db.js';
import { isWordAvailable } from '../core/modes.js';
import { pinyinLetters, pinyinNumbersToMarks } from '../core/pinyin.js';
import { speech } from '../core/speech.js';
import { isLearned, isStarted } from '../core/srs.js';
import { state } from '../core/state.js';
import { el, fill, toast } from './dom.js';
import { allTopics } from './home.js';
import { ALL_TOPICS, iconLabel } from './icons.js';
import { showScreen } from './screens.js';
import { closeCharSheet, openCharSheet, renderSentence } from './sentence.js';

/* ——— Словарь ——— */

export async function saveWord(word) {
  const exists = state.words.find((item) => item.hanzi === word.hanzi);
  if (exists) throw new Error('Такое слово уже есть.');
  const record = Object.assign({ tags: [], hsk: 0, createdAt: new Date().toISOString() }, word);
  const id = await dbPut(STORE_WORDS, record);
  record.id = id;
  state.words.push(record);
  return record;
}

export function renderDictionary() {
  const topics = allTopics();
  fill('dict-topics', topics.map((topic) => el('button', {
    class: 'chip', type: 'button', 'aria-pressed': state.dictTopic === topic,
    onclick: () => { state.dictTopic = topic; renderDictionary(); },
  }, topic)));

  const search = state.dictSearch.trim().toLowerCase();
  // Латиницу ищем по слогам без тонов; для кириллицы этот путь отключаем —
  // иначе пустой остаток от «вода» совпадёт с любым словом.
  const searchLetters = pinyinLetters(search);
  const visible = state.words.filter((word) => {
    if (state.dictTopic !== ALL_TOPICS && word.topic !== state.dictTopic) return false;
    if (!search) return true;
    return word.hanzi.includes(search)
      || (searchLetters !== '' && pinyinLetters(word.pinyin).includes(searchLetters))
      || word.translation.toLowerCase().includes(search);
  }).sort((first, second) => first.level - second.level || first.id - second.id);

  document.getElementById('dict-count').textContent =
    `${visible.length} слов · всего в базе ${state.words.length}`;

  fill('dict-list', visible.map((word) => {
    const record = state.srs.get(word.id);
    const locked = !isWordAvailable(word);
    const status = locked ? el('span', { class: 'badge', text: `уровень ${word.level}` })
      : isLearned(record) ? el('span', { class: 'badge badge-ok', text: 'выучено' })
      : isStarted(record) ? el('span', { class: 'badge badge-accent', text: 'в работе' })
      : el('span', { class: 'badge', text: 'новое' });
    return el('button', {
      class: locked ? 'word-row is-locked' : 'word-row', type: 'button',
      onclick: () => openWordSheet(word),
    }, [
      el('span', { class: 'hanzi', text: word.hanzi }),
      el('span', { class: 'word-meta' }, [
        el('div', { class: 'word-pinyin', text: word.pinyin }),
        el('div', { class: 'word-translation', text: word.translation }),
      ]),
      status,
    ]);
  }));
}

function openWordSheet(word) {
  const record = state.srs.get(word.id);
  const children = [
    el('div', { class: 'big-hanzi hanzi', text: word.hanzi, style: 'font-size:64px' }),
    el('div', { class: 'card-pinyin', id: 'char-sheet-title', text: word.pinyin }),
    el('div', { class: 'card-translation', text: word.translation }),
    el('p', { class: 'faint', text: [word.pos, word.topic, `уровень ${word.level || 'свой'}`].filter(Boolean).join(' · ') }),
  ];
  // Разбор по знакам: у составных слов («为什么» — целых три) сразу видно, из чего они собраны
  const parts = Array.from(word.hanzi).filter((character) => /[一-鿿]/.test(character));
  if (parts.length > 1 && parts.every((character) => state.charDict.has(character))) {
    children.push(el('div', { class: 'word-parts' }, parts.map((character) => {
      const info = state.charDict.get(character);
      return el('button', {
        class: 'word-part', type: 'button', onclick: () => openCharSheet(character),
      }, [
        el('span', { class: 'hanzi', text: character }),
        el('span', { class: 'faint', text: info.pinyin }),
        el('span', { class: 'faint', text: info.translation }),
      ]);
    })));
  }

  if (word.example && word.example.hanzi) {
    children.push(el('div', { class: 'example-block', style: 'text-align:left' }, [
      renderSentence(word.example.hanzi),
      el('div', { class: 'sentence-pinyin', text: word.example.pinyin || '' }),
      el('div', { class: 'sentence-translation', text: word.example.translation || '' }),
    ]));
  }
  if (record) {
    children.push(el('p', { class: 'faint', text:
      `Показов: ${record.seen} · ошибок: ${record.errors} · ошибок тона: ${record.toneErrors} · следующий показ: ${record.due}` }));
  }
  const row = el('div', { class: 'row', style: 'justify-content:center;margin-top:16px' });
  if (speech.available) {
    row.append(el('button', { class: 'btn btn-quiet btn-small', type: 'button',
      onclick: () => speech.speak(word.hanzi) }, iconLabel('sound', 'Слово')));
    if (word.example && word.example.hanzi) {
      row.append(el('button', { class: 'btn btn-quiet btn-small', type: 'button',
        onclick: () => speech.speak(word.example.hanzi) }, iconLabel('sound', 'Пример')));
    }
  }
  row.append(el('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: closeCharSheet }, 'Закрыть'));
  children.push(row);
  fill('char-sheet-body', children);
  document.getElementById('char-sheet').classList.add('is-open');
}

/* ——— Массовый импорт списком ——— */

export function parseBulkInput(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/[;\t]/).map((part) => part.trim());
    const hanzi = parts[0];
    let pinyin = parts[1] || '';
    let translation = parts[2] || '';
    if (!pinyin || !translation) {
      // Подставляем известное из встроенного словаря иероглифов.
      const guessed = Array.from(hanzi).map((character) => state.charDict.get(character)).filter(Boolean);
      if (!pinyin && guessed.length === Array.from(hanzi).length) {
        pinyin = guessed.map((entry) => entry.pinyin).join(' ');
      }
      if (!translation && guessed.length === Array.from(hanzi).length) {
        translation = guessed.map((entry) => entry.translation).join(', ');
      }
    }
    const duplicate = state.words.some((word) => word.hanzi === hanzi);
    return {
      hanzi,
      pinyin: pinyinNumbersToMarks(pinyin),
      translation,
      include: Boolean(hanzi) && Boolean(translation) && !duplicate,
      duplicate,
    };
  });
}

export function renderBulkPreview() {
  const rows = state.bulkRows;
  if (!rows.length) { fill('bulk-preview', el('p', { class: 'faint', text: 'Пока пусто.' })); return; }
  const ready = rows.filter((row) => row.include).length;

  const table = el('table', { class: 'preview-table' }, [
    el('thead', {}, el('tr', {}, [
      el('th', { text: '' }), el('th', { text: 'Иероглифы' }),
      el('th', { text: 'Пиньинь' }), el('th', { text: 'Перевод' }), el('th', { text: '' }),
    ])),
    el('tbody', {}, rows.map((row, index) => {
      const checkbox = el('input', { type: 'checkbox', 'aria-label': `Добавить ${row.hanzi}` });
      checkbox.checked = row.include;
      checkbox.addEventListener('change', () => {
        state.bulkRows[index].include = checkbox.checked;
        renderBulkPreview();
      });
      return el('tr', {}, [
        el('td', {}, checkbox),
        el('td', { class: 'hanzi', text: row.hanzi }),
        el('td', { text: row.pinyin || '—' }),
        el('td', { text: row.translation || '—' }),
        el('td', {}, row.duplicate ? el('span', { class: 'badge', text: 'уже есть' })
          : !row.translation ? el('span', { class: 'badge badge-err', text: 'нет перевода' }) : ''),
      ]);
    })),
  ]);

  fill('bulk-preview', [
    el('h3', { text: `Проверь перед добавлением: ${ready} из ${rows.length}` }),
    el('div', { class: 'table-wrap' }, table),
    el('button', {
      class: 'btn', type: 'button', disabled: ready === 0, style: 'margin-top:16px',
      onclick: applyBulkImport,
    }, `Добавить ${ready} слов`),
  ]);
}

async function applyBulkImport() {
  const rows = state.bulkRows.filter((row) => row.include);
  let added = 0;
  for (const row of rows) {
    try {
      await saveWord({
        hanzi: row.hanzi,
        pinyin: row.pinyin,
        translation: row.translation,
        pos: '',
        topic: 'Мои слова',
        level: USER_LEVEL,
        example: null,
      });
      added += 1;
    } catch (error) {
      // Дубликат — пропускаем молча, он и так помечен в таблице.
    }
  }
  state.bulkRows = [];
  document.getElementById('bulk-input').value = '';
  fill('bulk-preview', []);
  toast(`Добавлено слов: ${added}`);
  showScreen('dict');
}
