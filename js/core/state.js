import { teacherDay } from '../ui/teacher-course.js';
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
  strokesSearch: '',
  teacherStrokesOpen: null,   // какой прошлый день раскрыт в прописях занятия
  strokeRulesBack: 'strokes', // куда возвращает кнопка со страницы правил
  strokesShowAll: false,
  strokesSeen: new Set(),
  strokesWritten: new Set(),
  strokeSpeed: STROKE_SPEED_DEFAULT,
  bulkRows: [],
  installPrompt: null,
};

/** Собирает элемент. Текст кладём только через textContent — чужие данные в разметку не попадают. */
