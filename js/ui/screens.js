import { state } from '../core/state.js';
import { renderSettings, switchProgressTab } from '../core/stats.js';
import { renderDictionary } from './dict.js';
import { switchGrammarTab, switchPinyinTab } from './dictation.js';
import { renderHome } from './home.js';
import { renderPlayerBadge } from './rank.js';
import { closeCharSheet } from './sentence.js';
import { renderStrokeRules, renderStrokes } from './strokes-screen.js';
import { renderTeacher, renderTeacherDay } from './teacher-course.js';
import { renderTeacherStrokes } from './teacher-strokes.js';
import { renderTeacherTask } from './teacher-tasks.js';

const SCREEN_TITLES = {
  home: 'Китайский с нуля',
  train: 'Тренировка',
  dict: 'Слова',
  add: 'Новое слово',
  bulk: 'Список слов',
  grammar: 'Порядок слов',
  lesson: 'Урок',
  dialog: 'Разговор',
  teacher: 'Режим учителя',
  'teacher-day': 'День программы',
  'teacher-task': 'Задание',
  'teacher-strokes': 'Прописи занятия',
  strokes: 'Написание',
  'stroke-rules': 'Правила написания',
  pinyin: 'Слоги',
  'syllable-drill': 'Слушай и пиши',
  'pinyin-lesson': 'Пиньинь',
  'pinyin-dictation': 'Диктант',
  progress: 'Прогресс',
  settings: 'Настройки',
};

const TAB_FOR_SCREEN = { home: 'home', train: 'home', dict: 'dict', add: 'dict', bulk: 'dict',
  grammar: 'grammar', lesson: 'grammar', dialog: 'grammar', strokes: 'strokes',
  pinyin: 'pinyin', 'syllable-drill': 'pinyin',
  'pinyin-lesson': 'pinyin', 'pinyin-dictation': 'pinyin', 'stroke-rules': 'strokes',
  teacher: 'home', 'teacher-day': 'home', 'teacher-task': 'home', 'teacher-strokes': 'home',
  progress: 'progress', settings: 'settings' };

export function showScreen(name) {
  state.screen = name;
  document.querySelectorAll('.screen').forEach((node) => {
    node.classList.toggle('is-active', node.id === `screen-${name}`);
  });
  document.querySelectorAll('.tab').forEach((tab) => {
    if (TAB_FOR_SCREEN[name] === tab.dataset.go) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  document.getElementById('header-title').textContent = SCREEN_TITLES[name] || '';
  document.getElementById('tabbar').classList.toggle('hidden', name === 'train');
  document.body.classList.toggle('is-training', name === 'train');
  closeCharSheet();
  renderPlayerBadge();
  window.scrollTo(0, 0);

  if (name === 'home') renderHome();
  if (name === 'dict') renderDictionary();
  if (name === 'grammar') switchGrammarTab(state.grammarTab);
  if (name === 'pinyin') switchPinyinTab(state.pinyinTab);
  if (name === 'strokes') renderStrokes();
  if (name === 'stroke-rules') {
    renderStrokeRules();
    const back = document.getElementById('stroke-rules-back');
    back.textContent = state.strokeRulesBack === 'teacher-strokes' ? '← К прописям занятия' : '← К знакам';
    back.onclick = () => showScreen(state.strokeRulesBack || 'strokes');
  }
  if (name === 'teacher') renderTeacher();
  if (name === 'teacher-day') renderTeacherDay();
  if (name === 'teacher-task') renderTeacherTask();
  if (name === 'teacher-strokes') renderTeacherStrokes();
  if (name === 'progress') switchProgressTab(state.progressTab);
  if (name === 'settings') renderSettings();
}
