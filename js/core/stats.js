import { APP_VERSION, AUDIO_CACHE, CHART_DAYS, EXAM_PASS_SCORE, EXAM_QUESTION_COUNT, EXAM_READY_RATIO, FINAL_EXAM_LEVEL, FINAL_EXAM_QUESTIONS, FINAL_EXAM_RATIO, MAX_LEVEL, STORE_EXAMS, STORE_GRAMMAR, STORE_SRS, STORE_STATS } from './constants.js';
import { applyImport, dbClear, dbPut, exportDatabase, planImport, setSetting } from './db.js';
import { HSK_LEVEL, HSK_LISTEN_CHOICE, HSK_LISTEN_JUDGE, HSK_PASS_RATIO, HSK_READ_CLOZE, HSK_READ_SENTENCE, examReadiness, finalExamReadiness, hskQuestionCount, hskReadiness, session, startHskExam, troubleWords } from './modes.js';
import { AUDIO_INDEX_URL, SYLLABLE_AUDIO_URL, VOICE_COST, speech } from './speech.js';
import { addDays, dayKey, isLearned, isStarted } from './srs.js';
import { state } from './state.js';
import { DIALOGS } from '../data/dialogs.js';
import { GRAMMAR_LESSONS } from '../data/grammar.js';
import { TEACHER_DAYS } from '../data/teacher-days.js';
import { loadEverything, start } from '../main.js';
import { askConfirm, el, fill, toast } from '../ui/dom.js';
import { renderHome } from '../ui/home.js';
import { iconLabel, uiIcon } from '../ui/icons.js';
import { renderPlayerCard } from '../ui/rank.js';
import { showScreen } from '../ui/screens.js';
import { teacherProgress } from '../ui/teacher-course.js';
import { topicIcon } from '../ui/topic-icons.js';
import { beginExam, beginTroubleRun, renderTrain } from '../ui/train.js';

/* ═══════════════════ STATS — streak, график, счётчики ═══════════════════ */

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
function calcStreak() {
  let cursor = dayKey();
  if (!(state.stats.get(cursor) || {}).reviewed) cursor = addDays(cursor, -1);
  let streak = 0;
  while ((state.stats.get(cursor) || {}).reviewed > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function renderChart() {
  const today = dayKey();
  const days = [];
  for (let offset = CHART_DAYS - 1; offset >= 0; offset -= 1) {
    const key = addDays(today, -offset);
    days.push({ key, value: (state.stats.get(key) || {}).learned || 0 });
  }
  const maximum = Math.max(1, ...days.map((day) => day.value));
  const width = 320;
  const height = 120;
  const gap = 2;
  const barWidth = (width - gap * (CHART_DAYS - 1)) / CHART_DAYS;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height + 16}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `График выученных слов за ${CHART_DAYS} дней`);

  // Столбики красим акцент-градиентом дизайн-системы — он живёт в defs самого SVG.
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  gradient.setAttribute('id', 'chart-gradient');
  gradient.setAttribute('x1', '0'); gradient.setAttribute('y1', '0');
  gradient.setAttribute('x2', '0'); gradient.setAttribute('y2', '1');
  [['0%', '#a78bfa'], ['100%', '#60a5fa']].forEach(([offset, color]) => {
    const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', color);
    gradient.append(stop);
  });
  defs.append(gradient);
  svg.append(defs);

  days.forEach((day, index) => {
    const barHeight = day.value ? Math.max(2, (day.value / maximum) * height) : 1;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(index * (barWidth + gap)));
    rect.setAttribute('y', String(height - barHeight));
    rect.setAttribute('width', String(barWidth));
    rect.setAttribute('height', String(barHeight));
    rect.setAttribute('rx', '1');
    if (!day.value) rect.setAttribute('opacity', '0.25');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${day.key}: ${day.value}`;
    rect.append(title);
    svg.append(rect);
  });

  const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  axis.setAttribute('class', 'chart-axis');
  axis.setAttribute('x1', '0'); axis.setAttribute('y1', String(height));
  axis.setAttribute('x2', String(width)); axis.setAttribute('y2', String(height));
  svg.append(axis);

  const labelLeft = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  labelLeft.setAttribute('x', '0'); labelLeft.setAttribute('y', String(height + 12));
  labelLeft.textContent = `${CHART_DAYS} дней назад`;
  const labelRight = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  labelRight.setAttribute('x', String(width)); labelRight.setAttribute('y', String(height + 12));
  labelRight.setAttribute('text-anchor', 'end');
  labelRight.textContent = 'сегодня';
  svg.append(labelLeft, labelRight);
  return svg;
}

/* ——— Экзамены: видно все, включая закрытые, и что нужно для допуска ——— */

/**
 * Экзамены уровней — внутренняя проверка приложения, а не HSK: они закрепляют то,
 * что пройдено здесь. Итоговый экзамен собирает все уровни разом и потому строже.
 */
function examPlan() {
  return [1, 2, 3].map((level) => {
    const readiness = examReadiness(level);
    const record = state.exams.get(level);
    const previousPassed = level === 1 || (state.exams.get(level - 1) || {}).passed;
    return {
      level,
      title: `Экзамен уровня ${level}`,
      questions: EXAM_QUESTION_COUNT,
      pass: EXAM_PASS_SCORE,
      readiness,
      record,
      previousPassed,
      unlocked: Boolean(previousPassed) && readiness.allowed,
    };
  });
}

function renderExams() {
  const children = [
    el('p', { class: 'muted', text: 'Это внутренние экзамены приложения: они проверяют слова, которые ты здесь прошёл. К официальному HSK отношения не имеют.' }),
  ];

  examPlan().forEach((exam) => {
    const needed = Math.ceil(exam.readiness.total * EXAM_READY_RATIO);
    const percent = exam.readiness.total ? Math.round((exam.readiness.ready / exam.readiness.total) * 100) : 0;
    const card = el('div', { class: exam.unlocked ? 'card exam-card' : 'card exam-card is-locked' }, [
      el('div', { class: 'row-between' }, [
        el('b', { class: 'exam-title' }, exam.unlocked ? [el('span', { text: exam.title })] : iconLabel('lock', exam.title)),
        exam.record
          ? el('span', { class: exam.record.passed ? 'badge badge-ok' : 'badge badge-err',
              text: exam.record.passed ? `сдан ${exam.record.score}/${exam.record.total}` : `не сдан ${exam.record.score}/${exam.record.total}` })
          : el('span', { class: 'badge', text: `${exam.questions} вопросов` }),
      ]),
      el('div', { class: 'level-bar' }, el('span', { style: `width:${percent}%` })),
      el('p', { class: 'faint', text: `Закреплено слов: ${exam.readiness.ready} из ${exam.readiness.total}. Для допуска нужно ${needed}. Слово закрепляется после двух верных повторений.` }),
      el('div', { class: exam.previousPassed ? 'exam-requirement is-done' : 'exam-requirement' }, [
        el('span', { class: 'exam-mark' }, exam.previousPassed ? uiIcon('check', 14) : el('span', { text: '·' })),
        el('span', { text: exam.level === 1 ? 'Уровень открыт с самого начала' : `Сдан экзамен уровня ${exam.level - 1}` }),
      ]),
      el('div', { class: exam.readiness.allowed ? 'exam-requirement is-done' : 'exam-requirement' }, [
        el('span', { class: 'exam-mark' }, exam.readiness.allowed ? uiIcon('check', 14) : el('span', { text: '·' })),
        el('span', { text: `Закрепить ${needed} слов уровня ${exam.level}` }),
      ]),
    ]);

    if (exam.unlocked) {
      card.append(el('button', {
        class: 'btn btn-wide', type: 'button', style: 'margin-top:16px',
        onclick: () => beginExam(exam.level),
      }, exam.record && exam.record.passed ? 'Пересдать' : 'Сдавать'));
    }
    children.push(card);
  });

  // Итоговый экзамен — единственный, который претендует на серьёзность
  const finalReadiness = finalExamReadiness();
  const finalRecord = state.exams.get(FINAL_EXAM_LEVEL);
  const finalCard = el('div', { class: finalReadiness.allowed ? 'card exam-card' : 'card exam-card is-locked' }, [
    el('div', { class: 'row-between' }, [
      el('b', { class: 'exam-title' }, finalReadiness.allowed ? [el('span', { text: 'Итоговый экзамен' })] : iconLabel('lock', 'Итоговый экзамен')),
      finalRecord
        ? el('span', { class: finalRecord.passed ? 'badge badge-ok' : 'badge badge-err',
            text: `${finalRecord.score}/${finalRecord.total}` })
        : el('span', { class: 'badge', text: `${FINAL_EXAM_QUESTIONS} вопросов` }),
    ]),
    el('p', { class: 'faint', text: `Все уровни разом, ${FINAL_EXAM_QUESTIONS} вопросов вперемешку, проходной балл — ${Math.round(FINAL_EXAM_RATIO * 100)}% (${Math.ceil(FINAL_EXAM_QUESTIONS * FINAL_EXAM_RATIO)} правильных). Здесь спрашивают и перевод, и иероглиф, и пиньинь на слух.` }),
    el('div', { class: finalReadiness.allowed ? 'exam-requirement is-done' : 'exam-requirement' }, [
      el('span', { class: 'exam-mark' }, finalReadiness.allowed ? uiIcon('check', 14) : el('span', { text: '·' })),
      el('span', { text: `Сдать экзамены всех трёх уровней (сдано ${finalReadiness.passedLevels} из ${MAX_LEVEL})` }),
    ]),
  ]);
  if (finalReadiness.allowed) {
    finalCard.append(el('button', {
      class: 'btn btn-wide', type: 'button', style: 'margin-top:16px',
      onclick: () => beginExam(FINAL_EXAM_LEVEL),
    }, finalRecord && finalRecord.passed ? 'Пересдать' : 'Сдавать итоговый'));
  }
  children.push(finalCard);

  // Пробный HSK 1 — по структуре настоящего экзамена
  const hsk = hskReadiness();
  const hskRecord = state.exams.get(HSK_LEVEL);
  const hskCard = el('div', { class: hsk.allowed ? 'card exam-card' : 'card exam-card is-locked' }, [
    el('div', { class: 'row-between' }, [
      el('b', { class: 'exam-title' }, hsk.allowed ? [el('span', { text: 'Пробный HSK 1' })] : iconLabel('lock', 'Пробный HSK 1')),
      hskRecord
        ? el('span', { class: hskRecord.passed ? 'badge badge-ok' : 'badge badge-err',
            text: `${hskRecord.score}/${hskRecord.total}` })
        : el('span', { class: 'badge', text: `${hskQuestionCount()} заданий` }),
    ]),
    el('p', { class: 'faint', text: `Собран по структуре официального экзамена: ${HSK_LISTEN_JUDGE + HSK_LISTEN_CHOICE} заданий на слух и ${HSK_READ_CLOZE + HSK_READ_SENTENCE} на чтение, проходной балл ${Math.round(HSK_PASS_RATIO * 100)}%.` }),
    el('p', { class: 'faint', text: 'Настоящий HSK сдают в аккредитованном центре — сертификат приложение выдать не может. Но если уверенно сдаёшь этот, к настоящему ты готов.' }),
    el('div', { class: hsk.finalPassed ? 'exam-requirement is-done' : 'exam-requirement' }, [
      el('span', { class: 'exam-mark' }, hsk.finalPassed ? uiIcon('check', 14) : el('span', { text: '·' })),
      el('span', { text: 'Сдан итоговый экзамен приложения' }),
    ]),
    el('div', { class: hsk.voice ? 'exam-requirement is-done' : 'exam-requirement' }, [
      el('span', { class: 'exam-mark' }, hsk.voice ? uiIcon('check', 14) : el('span', { text: '·' })),
      el('span', { text: 'Работает озвучка — половина заданий на слух' }),
    ]),
  ]);
  if (hsk.allowed) {
    hskCard.append(el('button', {
      class: 'btn btn-wide', type: 'button', style: 'margin-top:16px',
      onclick: () => { startHskExam(); showScreen('train'); renderTrain(); },
    }, hskRecord && hskRecord.passed ? 'Пересдать' : 'Сдавать пробный HSK'));
  }
  children.push(hskCard);

  fill('progress-body', children);
}

/* ——— Достижения ——— */

const ACHIEVEMENTS = [
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

function achievementFacts() {
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

function renderAchievements() {
  const facts = achievementFacts();
  const earned = ACHIEVEMENTS.filter((item) => item.check(facts));
  const children = [
    renderPlayerCard(),
    el('h2', { text: 'Достижения' }),
    el('p', { class: 'muted', text: `Получено ${earned.length} из ${ACHIEVEMENTS.length}. Остальные видны сразу — чтобы понимать, к чему идти.` }),
    el('div', { class: 'badge-grid' }, ACHIEVEMENTS.map((item) => {
      const done = item.check(facts);
      return el('div', { class: done ? 'achievement' : 'achievement is-locked' }, [
        topicIcon(item.icon, 40),
        el('div', { class: 'achievement-name', text: item.name }),
        el('div', { class: 'achievement-note', text: done ? 'получено' : item.note }),
      ]);
    })),
  ];
  fill('progress-body', children);
}

export function switchProgressTab(tab) {
  state.progressTab = tab;
  document.querySelectorAll('[data-progress-tab]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.progressTab === tab));
  });
  const titles = { stats: 'Прогресс', exams: 'Экзамены', awards: 'Достижения' };
  document.getElementById('progress-heading').textContent = titles[tab];
  if (tab === 'stats') renderProgress();
  else if (tab === 'exams') renderExams();
  else renderAchievements();
}

function renderProgress() {
  const learned = state.words.filter((word) => isLearned(state.srs.get(word.id))).length;
  const started = state.words.filter((word) => {
    const record = state.srs.get(word.id);
    return isStarted(record) && !isLearned(record);
  }).length;
  const fresh = state.words.length - learned - started;
  const streak = calcStreak();
  const today = state.stats.get(dayKey()) || { reviewed: 0, errors: 0 };
  const trouble = troubleWords(10);

  const children = [
    el('div', { class: 'card center' }, [
      el('div', { class: 'today-count' }, el('b', { text: String(streak) })),
      el('div', { class: 'muted', text: streak === 0 ? 'дней подряд — начни сегодня'
        : streak === 1 ? 'день подряд' : 'дней подряд' }),
      el('p', { class: 'faint', text: `Сегодня: ${today.reviewed} повторений, ошибок ${today.errors}` }),
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'stat-grid' }, [
        el('div', {}, [el('b', { text: String(learned) }), el('span', { text: 'выучено' })]),
        el('div', {}, [el('b', { text: String(started) }), el('span', { text: 'в работе' })]),
        el('div', {}, [el('b', { text: String(fresh) }), el('span', { text: 'не начато' })]),
      ]),
    ]),
    el('h2', { text: 'Выучено по дням' }),
    el('div', { class: 'card' }, renderChart()),
    el('h2', { text: 'Чаще всего ошибаешься' }),
  ];

  if (!trouble.length) {
    children.push(el('p', { class: 'faint', text: 'Ошибок пока нет — список появится, когда будут.' }));
  } else {
    children.push(el('div', {}, trouble.map((word) => {
      const record = state.srs.get(word.id);
      return el('div', { class: 'word-row' }, [
        el('span', { class: 'hanzi', text: word.hanzi }),
        el('span', { class: 'word-meta' }, [
          el('div', { class: 'word-pinyin', text: word.pinyin }),
          el('div', { class: 'word-translation', text: word.translation }),
        ]),
        el('span', { class: 'badge badge-err', text: `${record.errors + record.toneErrors}` }),
      ]);
    })));
    children.push(el('button', {
      class: 'btn btn-wide', type: 'button', style: 'margin-top:16px', onclick: beginTroubleRun,
    }, 'Прогнать только их'));
  }

  fill('progress-body', children);
}

/* ——— Настройки ——— */

/**
 * Голос даёт система, а не приложение: скачать и «вшить» чужой системный голос нельзя.
 * Поэтому вместо сухого «голоса нет» показываем, что именно нажать в своей системе.
 */
/* ——— Самопроверка звука ———
   Когда человек говорит «звука нет», гадать бесполезно: причин пять, и они разные.
   Проверка проходит весь путь — указатель записей, скачивание файла, само
   воспроизведение — и пишет, на чём именно оборвалось.                              */

export async function checkSound() {
  const box = document.getElementById('sound-check-result');
  fill(box, el('p', { class: 'faint', text: 'Проверяю…' }));
  const строки = [];
  const слово = '你好';

  строки.push(speech.clips
    ? `Записи на месте: ${Object.keys(speech.clips).length}.`
    : 'Указатель записей не загрузился — приложение не знает, где брать звук.');

  const file = speech.clips && speech.clips[слово];
  if (file) {
    try {
      const response = await fetch(`audio/${file}`, { cache: 'no-store' });
      const blob = response.ok ? await response.blob() : null;
      строки.push(response.ok
        ? `Файл скачивается: ${Math.round(blob.size / 1024)} КБ.`
        : `Файл не отдаётся: ответ ${response.status}.`);
    } catch (error) {
      строки.push(`Файл не скачался: ${error.message}.`);
    }
  }

  const итог = await new Promise((resolve) => {
    const player = new Audio(`audio/${file}`);
    player.addEventListener('playing', () => resolve('Запись играет — звук работает.'));
    player.addEventListener('error', () => resolve('Браузер не смог проиграть файл.'));
    player.play().catch((error) => resolve(`Браузер отклонил воспроизведение: ${error.name}. `
      + 'Обычно это значит, что звук вкладки выключен или система его глушит.'));
    setTimeout(() => resolve('Ответа от плеера нет — похоже, звук заблокирован системой.'), 4000);
  });
  строки.push(итог);

  строки.push(speech.voice
    ? `Системный голос: ${speech.voice.name}.`
    : 'Системного голоса нет — но для слов приложения он и не нужен.');
  строки.push(`Версия приложения: ${APP_VERSION}.`);

  fill(box, строки.map((line) => el('p', { class: 'faint', style: 'margin:4px 0', text: line })));
}

function voiceHelp() {
  // Со встроенными записями звук работает и без системного голоса — это главное, что нужно сказать.
  if (speech.clips) {
    return [
      el('p', { text: `Звук работает: в приложение встроено ${Object.keys(speech.clips).length} записей произношения. Они лежат внутри и не требуют ни интернета, ни голосов системы.` }),
      el('p', { class: 'faint', text: 'Системный голос нужен только для слов, которые ты добавил сам, — для них записи нет. Если он не найден, такие слова будут молчать.' }),
    ];
  }

  const steps = [
    ['Chrome на компьютере', 'обычно приносит китайский голос сам — открой приложение в Chrome и нажми «Проверить снова».'],
    ['Windows', 'Параметры → Время и язык → Речь → Добавить голоса → «Китайский (упрощённое письмо, Китай)».'],
    ['Android', 'Настройки → Спец. возможности → Синтез речи → Google → Установить языки → китайский.'],
    ['iPhone и iPad', 'Настройки → Универсальный доступ → Устный контент → Голоса → Китайский.'],
    ['macOS', 'Системные настройки → Универсальный доступ → Устный контент → Системный голос → Управление голосами → китайский.'],
  ];
  const list = el('div', { class: 'stack', style: 'margin-top:12px' }, steps.map(([system, action]) =>
    el('div', { class: 'faint' }, [el('b', { text: `${system}: ` }), action])));

  return [
    el('p', { text: 'Китайского голоса в системе нет — режимы «На слух» и «Тоны» выключены, кнопки озвучки молчат.' }),
    list,
    el('button', {
      class: 'btn btn-quiet btn-small', type: 'button', style: 'margin-top:12px',
      onclick: async () => {
        speech.voice = null;
        speech.ready = false;
        await speech.init();
        renderSettings();
        renderHome();
        toast(speech.available ? 'Голос найден — звуковые режимы включены.' : 'Голос всё ещё не виден.', !speech.available);
      },
    }, '↻ Проверить снова'),
  ];
}

export function renderSettings() {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.getElementById('settings-theme').textContent = dark ? 'Выключить' : 'Включить';
  document.getElementById('rate-value').textContent = speech.rate.toFixed(2);
  document.getElementById('rate-input').value = String(speech.rate);
  document.getElementById('limit-value').textContent = String(state.sessionLimit);
  document.getElementById('limit-input').value = String(state.sessionLimit);

  document.getElementById('app-version').textContent = APP_VERSION;

  const rubles = Math.round(VOICE_COST.usd * VOICE_COST.rate);
  fill('voice-cost', [
    el('div', { class: 'cost-row' }, [
      el('b', { class: 'cost-sum', text: `$${VOICE_COST.usd.toFixed(2)}` }),
      el('span', { class: 'cost-dash', text: '—' }),
      el('b', { class: 'cost-sum', text: `${rubles} ₽` }),
      el('span', { class: 'faint cost-rate',
        text: `курс ${VOICE_COST.rate.toFixed(2)} ₽ · ${VOICE_COST.updated}` }),
    ]),
    el('p', { class: 'faint', style: 'margin:14px 0 0',
      text: `${VOICE_COST.clips + VOICE_COST.syllables} записей: `
        + `${VOICE_COST.clips} слов и фраз, ${VOICE_COST.syllables} слогов` }),
  ]);

  // Chrome прячет установку в меню — показываем свою кнопку, когда браузер разрешил.
  document.getElementById('install-card').classList.toggle('hidden', !state.installPrompt);

  refreshOfflineStatus();       // сколько записей уже лежит офлайн

  const status = document.getElementById('voice-status');
  if (speech.clips) fill(status, voiceHelp());
  else if (speech.voice) fill(status, [`Голос системы: ${speech.voice.name} (${speech.voice.lang}).`]);
  else fill(status, voiceHelp());
  document.getElementById('rate-test').disabled = !speech.available;

  const canShareFiles = Boolean(navigator.canShare
    && navigator.canShare({ files: [new File([''], 'p.json', { type: 'application/json' })] }));
  document.getElementById('share-btn').classList.toggle('hidden', !canShareFiles);
  document.getElementById('share-hint').textContent = canShareFiles
    ? 'Кнопка «Отправить файл» откроет выбор приложения — Telegram, почта, что угодно.'
    : 'Это устройство не умеет отправлять файлы напрямую — скачай файл и перешли его сам.';
}

/**
 * Отправляет файл базы через системное окно «Поделиться» — так его можно сразу закинуть
 * себе в Telegram и открыть на другом устройстве, не роясь в папке загрузок.
 * Где такого окна нет (обычно на компьютере) — просто скачиваем файл.
 */
/**
 * Кладёт все записи произношения в кеш, чтобы озвучка работала полностью без интернета.
 * Иначе запись подтягивается только при первом прослушивании — в офлайне её просто нет.
 */
/* ——— Сколько записей уже лежит офлайн ———
   Просьба владельца: кнопка не должна молчать. Пока непонятно, скачано всё или половина,
   человек жмёт её вслепую и не знает, надо ли ещё раз.                                */

async function audioOfflineStatus() {
  const [words, syllables] = await Promise.all([
    fetch(AUDIO_INDEX_URL).then((response) => response.json()),
    fetch(SYLLABLE_AUDIO_URL).then((response) => response.json()),
  ]);
  const urls = Object.values(words).map((name) => `audio/${name}`)
    .concat(Object.values(syllables).map((item) => `audio/syllables/${item.f}`));

  const cache = await caches.open(AUDIO_CACHE);
  const found = await Promise.all(urls.map((url) => cache.match(url).then(Boolean)));
  return { total: urls.length, ready: found.filter(Boolean).length };
}

/** Обновляет надпись и вид кнопки: скачано всё — зелёным, часть — предложением докачать. */
export async function refreshOfflineStatus() {
  const button = document.getElementById('offline-btn');
  const status = document.getElementById('offline-status');
  const card = button.closest('.card');
  if (!('caches' in window)) { status.textContent = 'Этот браузер не умеет хранить записи офлайн.'; return; }

  status.textContent = 'Считаю, что уже скачано…';
  try {
    const { total, ready } = await audioOfflineStatus();
    const left = total - ready;
    card.classList.toggle('is-ok', left === 0);
    if (left === 0) {
      fill(button, iconLabel('check', 'Всё скачано'));
      status.textContent = `Все ${total} записей лежат в памяти — интернет для озвучки не нужен.`;
    } else if (ready === 0) {
      fill(button, [el('span', { text: 'Скачать всю озвучку' })]);
      status.textContent = `Пока не скачано ничего из ${total} записей. Они подтягиваются `
        + 'по мере прослушивания, но можно забрать все разом.';
    } else {
      fill(button, [el('span', { text: `Докачать ${left}` })]);
      status.textContent = `Скачано ${ready} из ${total}. Остальные подтянутся сами при `
        + 'прослушивании — или нажми, чтобы забрать разом.';
    }
  } catch (error) {
    status.textContent = 'Не удалось проверить, что скачано.';
  }
}

export async function cacheAllAudio() {
  const button = document.getElementById('offline-btn');
  const status = document.getElementById('offline-status');
  button.disabled = true;

  try {
    const [words, syllables] = await Promise.all([
      fetch(AUDIO_INDEX_URL).then((response) => response.json()),
      fetch(SYLLABLE_AUDIO_URL).then((response) => response.json()),
    ]);
    const urls = Object.values(words).map((name) => `audio/${name}`)
      .concat(Object.values(syllables).map((item) => `audio/syllables/${item.f}`));

    const cache = await caches.open(AUDIO_CACHE);   // тот же кеш, что у Service Worker
    let done = 0;
    let failed = 0;
    const PARALLEL = 8;

    const worker = async () => {
      while (urls.length) {
        const url = urls.pop();
        try {
          const hit = await cache.match(url);
          if (!hit) await cache.add(url);
        } catch (error) {
          failed += 1;
        }
        done += 1;
        if (done % 25 === 0) status.textContent = `Скачано ${done}…`;
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));

    if (failed) {
      status.textContent = `${done - failed} записей на месте, ${failed} не скачались — попробуй ещё раз.`;
    } else {
      await refreshOfflineStatus();
    }
  } catch (error) {
    status.textContent = 'Не вышло скачать записи — проверь интернет и попробуй снова.';
  } finally {
    button.disabled = false;
    if (!document.getElementById('offline-status').textContent.includes('не скачались')) {
      await refreshOfflineStatus();
    }
  }
}

export async function shareDatabase() {
  const payload = await exportDatabase();
  const file = new File([JSON.stringify(payload, null, 2)], `hanzi-${dayKey()}.json`,
    { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Мой прогресс в hanzi' });
      toast('Отправлено. На другом устройстве открой файл кнопкой «Загрузить».');
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') return;   // человек передумал — это не ошибка
    }
  }
  await exportToFile();
}

export async function exportToFile() {
  const payload = await exportDatabase();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `hanzi-${dayKey()}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Файл выгружен — сохрани его в надёжном месте.');
}

export async function importFromFile(file) {
  try {
    const text = await file.text();
    const plan = await planImport(JSON.parse(text));
    const agreed = await askConfirm({
      title: 'Что будет добавлено',
      text: `В файле ${plan.payload.words.length} слов: новых ${plan.newWords}, уже есть ${plan.knownWords}. `
        + `Записей прогресса ${plan.progressRecords}, дней статистики ${plan.days}. `
        + (plan.syllables
          ? `Прогресс по слогам: ${plan.syllables} записей, из них засчитано ${plan.syllablesLearned}.`
          : 'Прогресса по слогам в файле нет — он выгружен старой версией приложения.'),
      hint: 'Слова, которые уже есть, останутся как есть. Прогресс и статистика из файла перезапишут текущие.',
      confirmLabel: 'Загрузить',
      exportFirst: true,
    });
    if (!agreed) return;
    await applyImport(plan);
    await loadEverything();
    showScreen('home');
    toast(plan.syllables
      ? `Загружено: ${plan.newWords} новых слов и ${plan.syllables} записей по слогам.`
      : `Загружено: ${plan.newWords} новых слов. Прогресса по слогам в файле не было.`);
  } catch (error) {
    toast(`Не вышло прочитать файл: ${error.message}`, true);
  }
}

export async function resetProgress() {
  const agreed = await askConfirm({
    title: 'Сбросить прогресс?',
    text: 'Удалятся интервалы повторений, статистика по дням, результаты экзаменов и пройденные уроки грамматики. Сами слова останутся на месте.',
    hint: 'Это не отменить. Если файл базы ещё не выгружен — выгрузи сначала.',
    confirmLabel: 'Сбросить',
    exportFirst: true,
  });
  if (!agreed) return;
  await Promise.all([dbClear(STORE_SRS), dbClear(STORE_STATS), dbClear(STORE_EXAMS), dbClear(STORE_GRAMMAR)]);
  await setSetting('unlockedLevel', 1);
  await loadEverything();
  showScreen('home');
  toast('Прогресс сброшен.');
}

/* ——— Тема ——— */

async function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  // Кнопка показывает, что произойдёт по нажатию: луна — уйти в тёмную, солнце — вернуться в светлую.
  fill('theme-toggle', uiIcon(theme === 'dark' ? 'sun' : 'moon', 20));
  document.querySelector('meta[name="theme-color"]')
    .setAttribute('content', theme === 'dark' ? '#0f1117' : '#f6f7fb');
  await setSetting('theme', theme);
  if (state.screen === 'settings') renderSettings();
}

export const toggleTheme = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
