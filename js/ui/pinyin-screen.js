import { setSetting } from '../core/db.js';
import { speech } from '../core/speech.js';
import { state } from '../core/state.js';
import { PINYIN_LESSONS } from '../data/pinyin-lessons.js';
import { el, fill, toast } from './dom.js';
import { uiIcon } from './icons.js';
import { showScreen } from './screens.js';

/* ——— Раздел «Пиньинь»: разбор чтения и проверка на слух ——— */

export function renderPinyinList() {
  const children = PINYIN_LESSONS.map((lesson, index) => {
    const done = state.pinyinSeen.has(lesson.id);
    return el('button', {
      class: 'lesson-row', type: 'button', onclick: () => openPinyinLesson(lesson.id),
    }, [
      el('span', { class: 'faint', text: String(index + 1) }),
      el('span', { class: 'lesson-title' }, [
        el('div', { text: lesson.title }),
        el('div', { class: 'faint', text: lesson.rows.length ? `${lesson.rows.length} примеров со звуком` : 'вводный' }),
      ]),
      done ? el('span', { class: 'badge badge-ok', text: 'прочитано' }) : el('span', { class: 'badge', text: 'урок' }),
    ]);
  });

  fill('pinyin-list', children);
}

async function openPinyinLesson(lessonId) {
  const lesson = PINYIN_LESSONS.find((item) => item.id === lessonId);
  state.pinyinLesson = lesson;
  if (!state.pinyinSeen.has(lessonId)) {
    state.pinyinSeen.add(lessonId);
    await setSetting('pinyinSeen', Array.from(state.pinyinSeen));
  }
  showScreen('pinyin-lesson');
  document.getElementById('pinyin-lesson-heading').textContent = lesson.title;
  renderPinyinLesson();
}

function renderPinyinLesson() {
  const lesson = state.pinyinLesson;
  const children = [
    el('div', { class: 'card' }, lesson.intro.map((paragraph) => el('p', { text: paragraph }))),
  ];

  if (lesson.rows.length) {
    children.push(el('h3', { text: 'Слушай и повторяй' }));
    lesson.rows.forEach((row) => {
      children.push(el('div', { class: 'sound-row' }, [
        el('button', {
          class: 'sound-play', type: 'button', 'aria-label': `Озвучить ${row.hanzi}`,
          disabled: !speech.available,
          onclick: () => { if (!speech.speak(row.hanzi)) toast('Китайского голоса в системе нет.', true); },
        }, uiIcon('play', 18)),
        el('span', { class: 'sound-body' }, [
          el('div', {}, [
            el('span', { class: 'hanzi', style: 'font-size:26px', text: row.hanzi }),
            el('span', { class: 'sound-pinyin', text: row.pinyin }),
          ]),
          el('div', { class: 'faint', text: row.translation }),
          el('div', { class: 'sound-hint', text: row.hint }),
        ]),
      ]));
    });
  }

  (lesson.notes || []).forEach((note) => {
    children.push(el('p', { class: 'faint', style: 'margin-top:12px', text: note }));
  });

  const index = PINYIN_LESSONS.indexOf(lesson);
  const next = PINYIN_LESSONS[index + 1];
  children.push(el('div', { class: 'row', style: 'margin-top:24px' }, [
    next ? el('button', {
      class: 'btn', type: 'button', onclick: () => openPinyinLesson(next.id),
    }, `Дальше: ${next.title}`) : null,
    el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => showScreen('grammar') }, 'К списку'),
  ].filter(Boolean)));

  fill('pinyin-lesson-body', children);
}

/* ——— Проверка на слух: услышал слово — выбери его запись ——— */
