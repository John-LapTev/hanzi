import { DEFAULT_SESSION_LIMIT } from './constants.js';
import { STROKE_SPEED_DEFAULT } from './strokes.js';
import { ALL_TOPICS } from '../ui/icons.js';

export const state = {
  words: [],
  srs: new Map(),
  stats: new Map(),
  exams: new Map(),
  grammarProgress: new Map(),
  charDict: new Map(),
  screen: 'home',
  mode: 'hanzi2ru',
  topic: ALL_TOPICS,
  unlockedLevel: 1,
  sessionLimit: DEFAULT_SESSION_LIMIT,
  dictSearch: '',
  dictTopic: ALL_TOPICS,
  lesson: null,
  drillIndex: 0,
  drillChunks: [],
  grammarTab: 'rules',
  progressTab: 'stats',
  pinyinLesson: null,
  pinyinTab: 'table',
  syllableDrill: null,
  drillHard: false,
  drillRun: 0,
  syllableProgress: new Map(),
  teacher: null,
  teacherDay: 1,
  teacherTask: null,
  teacherReturn: null,
  pinyinSeen: new Set(),
  dictation: null,
  dialog: null,
  dialogStep: 0,
  dialogHint: false,
  dialogHard: false,
  dialogDraft: '',      // набранное в разговоре, чтобы подсказка его не стирала
  strokesSearch: '',
  teacherStrokesOpen: null,   // какой прошлый день раскрыт в прописях занятия
  strokeRulesBack: 'strokes', // куда возвращает кнопка со страницы правил
  /* Откуда пришли на текущий экран. Владелец 25.08.2026: «везде должна быть кнопка именно
     назад, а переход в раздел — отдельной кнопкой рядом». Ключ — имя экрана, значение —
     { screen, day }: день нужен, чтобы вернуться в конкретное занятие программы. */
  cameFrom: {},
  strokesShowAll: false,
  strokesSeen: new Set(),
  strokesWritten: new Set(),
  strokeSpeed: STROKE_SPEED_DEFAULT,
  bulkRows: [],
  installPrompt: null,
  hard: new Map(),        // помеченные кружком трудные слова: wordId → запись прогресса
  hardReturn: 'home',     // куда вернуть кнопку «назад» из раздела трудных слов
};

