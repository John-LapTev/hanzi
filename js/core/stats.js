import { MAX_LEVEL, STORE_STATS } from './constants.js';
import { dbPut } from './db.js';
import { addDays, dayKey, isLearned } from './srs.js';
import { state } from './state.js';
import { DIALOGS } from '../data/dialogs.js';
import { GRAMMAR_LESSONS } from '../data/grammar.js';
import { TEACHER_DAYS } from '../data/teacher-days.js';
import { teacherProgress } from '../ui/teacher-course.js';

/* ═══════════════════ STATS — дневные счётчики, серия, факты для достижений ═══════════════════
   Только цифры. Экраны прогресса и настроек живут в ui/progress.js и ui/settings.js:
   рисование в слое логики было ошибкой (аудит 03.09.2026).                                   */

export async function updateDayStats(delta) {
  const key = dayKey();
  const existing = state.stats.get(key)
    || { date: key, reviewed: 0, correct: 0, errors: 0, toneErrors: 0, learned: 0, byMode: {} };
  existing.reviewed += delta.reviewed || 0;
  existing.correct += delta.correct || 0;
  existing.errors += delta.errors || 0;
  existing.toneErrors += delta.toneErrors || 0;
  existing.learned += delta.learned || 0;
  if (delta.mode) existing.byMode[delta.mode] = (existing.byMode[delta.mode] || 0) + 1;
  state.stats.set(key, existing);
  await dbPut(STORE_STATS, existing);
}

/** Дней подряд с занятиями. Сегодняшний «прогул» ещё не рвёт цепочку — день не кончился. */
export function calcStreak() {
  let cursor = dayKey();
  if (!(state.stats.get(cursor) || {}).reviewed) cursor = addDays(cursor, -1);
  let streak = 0;
  while ((state.stats.get(cursor) || {}).reviewed > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export const ACHIEVEMENTS = [
  { id: 'first-session', name: 'Первый шаг', note: 'первая пройденная тренировка',
    icon: 'Приветствия', check: (facts) => facts.reviewed > 0 },
  { id: 'streak-7', name: 'Неделя подряд', note: '7 дней занятий без пропусков',
    icon: 'Время', check: (facts) => facts.streak >= 7 },
  { id: 'streak-30', name: 'Месяц подряд', note: '30 дней занятий без пропусков',
    icon: 'Время', check: (facts) => facts.streak >= 30 },
  { id: 'learned-25', name: 'Двадцать пять', note: '25 выученных слов',
    icon: 'Учёба', check: (facts) => facts.learned >= 25 },
  { id: 'learned-100', name: 'Сотня слов', note: '100 выученных слов',
    icon: 'Учёба', check: (facts) => facts.learned >= 100 },
  { id: 'exam-1', name: 'Первый экзамен', note: 'сдан экзамен уровня',
    icon: 'Вопросы', check: (facts) => facts.examsPassed >= 1 },
  { id: 'exam-all', name: 'Все уровни', note: 'сданы экзамены всех уровней',
    icon: 'Магазин', check: (facts) => facts.examsPassed >= MAX_LEVEL },
  { id: 'grammar-all', name: 'Порядок в голове', note: 'пройдены все уроки порядка слов',
    icon: 'Общение', check: (facts) => facts.lessonsDone >= GRAMMAR_LESSONS.length },
  { id: 'dialogs-all', name: 'Разговорчивый', note: 'пройдены все разговоры',
    icon: 'Транспорт', check: (facts) => facts.dialogsDone >= DIALOGS.length },
  { id: 'strokes-50', name: 'Каллиграф', note: '50 знаков разобрано в прописях',
    icon: 'Дом', check: (facts) => facts.strokesSeen >= 50 },
  { id: 'clean-day', name: 'День без ошибок', note: '20 повторений за день и ни одной ошибки',
    icon: 'Здоровье', check: (facts) => facts.cleanDay },
  { id: 'hard-dialog', name: 'Без подсказок', note: 'разговор пройден в режиме «только китайский»',
    icon: 'Техника', check: (facts) => facts.hardDialog },

  // Программа учителя: награды за настоящие вехи курса, а не за посещаемость
  { id: 'teacher-start', name: 'Сел за парту', note: 'первый день программы пройден',
    icon: 'Учёба', check: (facts) => facts.teacherDays >= 1 },
  { id: 'teacher-third', name: 'Первая треть', note: 'сдан экзамен десятого дня',
    icon: 'Вопросы', check: (facts) => facts.teacherExams >= 1 },
  { id: 'teacher-half', name: 'Половина пути', note: 'сдан экзамен двадцатого дня',
    icon: 'Время', check: (facts) => facts.teacherExams >= 2 },
  { id: 'teacher-done', name: 'Готов к поездке', note: 'вся программа месяца пройдена',
    icon: 'Транспорт', check: (facts) => facts.teacherDays >= TEACHER_DAYS.length },
  { id: 'teacher-return', name: 'Вернулся', note: 'занятие после перерыва — самое трудное',
    icon: 'Приветствия', check: (facts) => facts.teacherReturned },
  { id: 'written-150', name: 'Своей рукой', note: '150 знаков прописано в тетради',
    icon: 'Дом', check: (facts) => facts.written >= 150 },
];

export function achievementFacts() {
  const days = Array.from(state.stats.values());
  const learned = state.words.filter((word) => isLearned(state.srs.get(word.id))).length;
  const examsPassed = Array.from(state.exams.values()).filter((record) => record.passed && record.level <= MAX_LEVEL).length;
  const grammarValues = Array.from(state.grammarProgress.values());
  return {
    reviewed: days.reduce((sum, day) => sum + day.reviewed, 0),
    streak: calcStreak(),
    learned,
    examsPassed,
    lessonsDone: grammarValues.filter((item) => item.done && !item.lessonId.startsWith('dialog:')).length,
    dialogsDone: grammarValues.filter((item) => item.done && item.lessonId.startsWith('dialog:')).length,
    strokesSeen: state.strokesSeen.size,
    cleanDay: days.some((day) => day.reviewed >= 20 && day.errors === 0),
    hardDialog: grammarValues.some((item) => item.hardDone),
    teacherDays: teacherProgress().finishedDays.length,
    teacherExams: TEACHER_DAYS.filter((entry) => entry.kind === 'exam'
      && teacherProgress().finishedDays.includes(entry.day)).length,
    teacherReturned: Boolean(teacherProgress().returned),
    written: state.strokesWritten.size,
  };
}
