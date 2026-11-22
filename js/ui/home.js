import { EXAM_READY_RATIO, MAX_LEVEL } from '../core/constants.js';
import { MODES, examReadiness, isWordAvailable, reviewWords, setHardMode, wordsOfLevel } from '../core/modes.js';
import { speech } from '../core/speech.js';
import { isLearned } from '../core/srs.js';
import { readingRulesLeft } from '../core/syllables.js';
import { state } from '../core/state.js';
import { renderDailyCard, renderTeacherCard } from './daily.js';
import { el, fill, toast } from './dom.js';
import { hardCard } from './hard-screen.js';
import { ALL_TOPICS } from './icons.js';
import { showScreen } from './screens.js';
import { resetPhrases } from './phrases-screen.js';
import { plural } from './teacher-course.js';
import { topicIcon } from './topic-icons.js';
import { beginTraining } from './train.js';

/* ——— Главная ——— */

export function renderHome() {
  renderTeacherCard();
  renderDailyCard();
  // Раздел трудных слов виден, только когда есть что повторять — иначе пустая карточка
  fill('hard-card', hardCard('home'));
  renderReviewCard();
  renderModeGrid();
  renderTopicFilter();
  renderLevelCard();
}

/**
 * Блок «Сегодня к повторению». Живёт отдельно от тренировки: своя кнопка, свои режимы,
 * а когда повторять нечего — его нет совсем (Иван 22.10.2026). Раньше здесь же звала
 * кнопка выбранного внизу режима, и повторение шло, например, «Тонами».
 */
function renderReviewCard() {
  const review = reviewWords();
  document.getElementById('review-card').classList.toggle('hidden', review.length === 0);
  if (!review.length) return;
  document.getElementById('due-count').textContent = String(review.length);
  document.getElementById('due-label').textContent = plural(review.length, 'слово', 'слова', 'слов');
  const inSession = Math.min(review.length, state.sessionLimit);
  document.getElementById('due-hint').textContent = review.length > inSession
    ? `За один заход — ${inSession}, остальные следующим. Вперемешку: иероглиф → перевод и обратно.`
    : 'Вперемешку: иероглиф → перевод и перевод → иероглиф.';
}

/**
 * Плитки режимов — сами кнопки запуска. Нажал — и ты в режиме; ни выбора, ни отдельной
 * «Начать» (Иван 22.10.2026: «кнопка „Начать“ не нужна, нажимаю — и перехожу в режим»).
 * Подсказки-описания под плитками тоже нет — по его же словам, она «не имеет смысла».
 */
function renderModeGrid() {
  const modeTiles = MODES.filter((mode) => mode.onHome !== false).map((mode) => {
    const blocked = mode.needsVoice && !speech.available;
    return modeTile(mode, {
      disabled: blocked,
      title: blocked ? 'Нужен китайский голос в системе' : mode.description,
      onclick: () => beginTraining(mode.id),
    });
  });
  // «Пиньинь» — не режим, а вход в раздел: встаёт сразу после «На слух», где были два прежних
  const afterListen = MODES.filter((mode) => mode.onHome !== false).findIndex((mode) => mode.id === 'listen') + 1;
  modeTiles.splice(afterListen, 0, modeTile(PINYIN_TILE, { title: PINYIN_TILE.description, onclick: openPinyinTraining }));
  modeTiles.push(modeTile(PHRASES_TILE, { title: PHRASES_TILE.description, onclick: openPhrases }));
  const grid = fill('mode-grid', modeTiles);
  renderDifficultySwitch();
  // Строка под плитками остаётся только как объяснение, почему часть из них погашена
  const missingVoice = MODES.some((mode) => mode.needsVoice) && !speech.available;
  const note = document.getElementById('mode-description');
  note.textContent = missingVoice ? 'Режимы со звуком выключены: в системе нет китайского голоса.' : '';
  note.classList.toggle('hidden', !missingVoice);
  return grid;
}

/* «Легко / Сложно» справа от заголовка режимов (Иван 22.10.2026): легко — выбираешь ответ,
   сложно — печатаешь сам. Выбор запоминается и общий с тренажёром слогов. */
const DIFFICULTY_CHOICES = [
  { isHard: false, label: 'Легко', title: 'Выбирать ответ из вариантов' },
  { isHard: true, label: 'Сложно', title: 'Печатать ответ самому' },
];

function renderDifficultySwitch() {
  fill('difficulty-switch', DIFFICULTY_CHOICES.map((choice) => el('button', {
    class: 'chip', type: 'button', title: choice.title,
    'aria-pressed': state.isHardMode === choice.isHard,
    onclick: () => chooseDifficulty(choice.isHard),
  }, choice.label)));
}

async function chooseDifficulty(isHard) {
  try {
    await setHardMode(isHard);
  } catch (error) {
    toast('Не удалось запомнить выбор — после перезапуска вернётся прежний.', true);
  }
  renderDifficultySwitch();
}

/** Плитка вместо двух пиньинь-режимов (Иван 22.10.2026): ведёт в раздел пиньиня. */
const PINYIN_TILE = { icon: '拼', title: 'Пиньинь',
  description: 'Раздел пиньиня. Пока правила чтения не прочитаны — откроет их, потом — тренировку слогов.' };

function modeTile(mode, attributes) {
  return el('button', Object.assign({ class: 'mode-btn', type: 'button' }, attributes),
    [el('span', { class: 'mode-icon hanzi', text: mode.icon }), el('span', { text: mode.title })]);
}

/** Популярные фразы (Иван 22.10.2026) — тоже вход в отдельный экран, а не режим движка. */
const PHRASES_TILE = { icon: '句', title: 'Популярные фразы',
  description: 'Разговорные фразы карточками: иероглифы и пиньинь, нажал — перевод. По выбранной теме.' };

function openPhrases() {
  state.cameFrom.phrases = { screen: 'home' };
  resetPhrases();
  showScreen('phrases');
}

/** Из главной — сразу на тренировку слогов; кнопка «назад» там вернёт на главную. */
function openPinyinTraining() {
  state.cameFrom.pinyin = { screen: 'home' };
  // Новичок слогов не знает — сначала правила чтения; прочитал все — сразу тренировка
  state.pinyinTab = readingRulesLeft() ? 'lessons' : 'drill';
  showScreen('pinyin');
}

export function allTopics() {
  const topics = new Set(state.words.map((word) => word.topic).filter(Boolean));
  return [ALL_TOPICS].concat(Array.from(topics).sort());
}

/** Темы плиткой с рисованными иконками: лента чипов обрезалась и прятала половину тем. */
function renderTopicFilter() {
  const grid = el('div', { class: 'topic-grid' }, allTopics().map((topic) => {
    const inTopic = (word) => topic === ALL_TOPICS || word.topic === topic;
    const open = state.words.filter((word) => inTopic(word) && isWordAvailable(word)).length;
    const locked = state.words.filter((word) => inTopic(word) && !isWordAvailable(word)).length;
    return el('button', {
      class: 'topic-tile', type: 'button', 'aria-pressed': state.topic === topic,
      onclick: () => { state.topic = topic; renderHome(); },
    }, [
      topicIcon(topic),
      el('span', {}, [
        el('div', { class: 'topic-name', text: topic }),
        el('div', { class: 'topic-count', text: open === 0 && locked > 0
          ? `${locked} слов, откроются позже`
          : locked > 0 ? `${open} слов, ещё ${locked} закрыто` : `${open} слов` }),
      ]),
    ]);
  }));
  fill('topic-filter', grid);
}

function renderLevelCard() {
  const level = state.unlockedLevel;
  const words = wordsOfLevel(level);
  const learned = words.filter((word) => isLearned(state.srs.get(word.id))).length;
  const readiness = examReadiness(level);
  const examRecord = state.exams.get(level);
  const percent = words.length ? Math.round((learned / words.length) * 100) : 0;

  const children = [
    el('div', { class: 'row-between' }, [
      el('b', { text: `Уровень ${level}` }),
      el('span', { class: 'faint', text: `выучено ${learned} из ${words.length}` }),
    ]),
    el('div', { class: 'level-bar' }, el('span', { style: `width:${percent}%` })),
  ];

  if (examRecord) {
    children.push(el('p', { class: 'faint' }, [
      el('span', { class: examRecord.passed ? 'badge badge-ok' : 'badge badge-err',
        text: examRecord.passed ? 'экзамен сдан' : 'экзамен не сдан' }),
      ` ${examRecord.score} из ${examRecord.total}, ${examRecord.date}`,
    ]));
  }
  children.push(el('p', { class: 'faint', text: readiness.allowed
    ? 'Слова уровня закреплены — экзамен открыт.'
    : `К экзамену закреплено ${readiness.ready} из ${readiness.total} слов (нужно ${Math.ceil(readiness.total * EXAM_READY_RATIO)}).` }));
  if (level < MAX_LEVEL) {
    const locked = state.words.filter((word) => word.level > state.unlockedLevel).length;
    children.push(el('p', { class: 'faint', text: `Слов на следующих уровнях: ${locked} — откроются после экзамена.` }));
  }
  children.push(el('button', {
    class: 'btn btn-quiet btn-wide', type: 'button', style: 'margin-top:12px',
    onclick: () => { state.progressTab = 'exams'; showScreen('progress'); },
  }, 'Все экзамены →'));
  fill('level-card', children);
}
