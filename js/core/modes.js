import { HSK_PASS_RATIO, EXAM_MIN_REPETITIONS, EXAM_PASS_SCORE, EXAM_QUESTION_COUNT, EXAM_READY_RATIO, FINAL_EXAM_LEVEL, FINAL_EXAM_QUESTIONS, FINAL_EXAM_RATIO, MAX_LEVEL, OPTIONS_PER_QUESTION, QUALITY_FORGOT, QUALITY_GOOD, QUALITY_HARD, STORE_EXAMS, STORE_SRS } from './constants.js';
import { dbGet, dbPut, setSetting } from './db.js';
import { pinyinLetters, splitSyllables, syllableTone } from './pinyin.js';
import { pickRandom, shuffle } from './random.js';
import { speech } from './speech.js';
import { applySm2, createSrsRecord, dayKey, isDue, isLearned, isStarted } from './srs.js';
import { state } from './state.js';
import { updateDayStats } from './stats.js';
import { toast } from '../ui/dom.js';
import { ALL_TOPICS } from '../ui/icons.js';

/* ═══════════════════ MODES — режимы тренировки и экзамен ═══════════════════ */

export { shuffle };   // экраны берут перемешивание отсюда — сам алгоритм в core/random.js

export const MODES = [
  { id: 'hanzi2ru', icon: '字', title: 'Иероглиф → перевод',
    description: 'Показан иероглиф, выбираешь перевод из четырёх вариантов.', needsVoice: false },
  { id: 'ru2hanzi', icon: '译', title: 'Перевод → иероглиф',
    description: 'Показан перевод, выбираешь иероглиф из четырёх вариантов.', needsVoice: false },
  { id: 'listen', icon: '耳', title: 'На слух',
    description: 'Играет озвучка, текста нет — выбираешь перевод на слух.', needsVoice: true },
  { id: 'pinyin', icon: '拼', title: 'Пиньинь по иероглифу',
    description: 'Иероглиф на экране, звука нет — печатаешь его пиньинь с номером тона: ni3 hao3.', needsVoice: false },
  { id: 'flashcard', icon: '卡', title: 'Карточка',
    description: 'Лицо — иероглиф, оборот — пиньинь, перевод и пример. Оцениваешь себя сам.', needsVoice: false },
  { id: 'tones', icon: '声', title: 'Тоны',
    description: 'Играет слог — определяешь его тон из пяти.', needsVoice: true },
  { id: 'dictation', icon: '写', title: 'Пиньинь на слух',
    description: 'Наоборот: экран пустой, есть только звук — записываешь услышанное: ni3 hao3.', needsVoice: true },
];

export const TONE_LABELS = [
  { tone: 1, mark: 'ā', title: '1-й — ровный, высокий' },
  { tone: 2, mark: 'á', title: '2-й — восходящий' },
  { tone: 3, mark: 'ǎ', title: '3-й — падающе-восходящий' },
  { tone: 4, mark: 'à', title: '4-й — резко падающий' },
  { tone: 5, mark: 'a', title: 'нейтральный' },
];

const EXAM_MODES = ['hanzi2ru', 'ru2hanzi', 'pinyin'];

export const session = {
  active: false,
  mode: 'hanzi2ru',
  queue: [],
  index: 0,
  correct: 0,
  wrong: 0,
  answered: false,
  flipped: false,
  question: null,
  exam: null,        // { level, asked, correct } — если идёт экзамен уровня
  restart: null,     // параметры запуска: по ним кнопка «Заново» повторяет прогон
  repeatedIds: new Set(),
  recentSyllables: [],   // последние слоги в тренировке тонов, чтобы не повторялись подряд
  plan: null,            // заранее собранные вопросы (пробный HSK)
};

/** Три неверных варианта: сначала из той же темы (так сложнее и полезнее), потом любые. */
export function pickDistractors(word, pool, field) {
  const sameTopic = pool.filter((item) => item.id !== word.id && item.topic === word.topic
    && item[field] !== word[field]);
  const others = pool.filter((item) => item.id !== word.id && item.topic !== word.topic
    && item[field] !== word[field]);
  const chosen = [];
  const seen = new Set([word[field]]);
  shuffle(sameTopic).concat(shuffle(others)).forEach((item) => {
    if (chosen.length >= OPTIONS_PER_QUESTION - 1 || seen.has(item[field])) return;
    seen.add(item[field]);
    chosen.push(item);
  });
  return chosen;
}

export function buildChoiceQuestion(word, pool, field) {
  const options = shuffle(pickDistractors(word, pool, field).concat([word]));
  return { options, correctIndex: options.findIndex((item) => item.id === word.id) };
}

const hanziCharacters = (text) => Array.from(text).filter((character) => /[一-龥]/.test(character));

/**
 * Для тренировки тонов годятся только слова, где число слогов равно числу знаков.
 * Иначе показанный слог и озвученный знак разойдутся: у 一点儿 два слога и три знака,
 * и приложение показывало «yi», а произносило всё слово целиком.
 * Плюс у знака должна быть запись (или работать системный синтез) — иначе будет тишина.
 */
export function isToneReady(word) {
  const characters = hanziCharacters(word.hanzi);
  if (!characters.length || splitSyllables(word.pinyin).length !== characters.length) return false;
  return speech.voice ? true : characters.every((character) => speech.hasClip(character));
}

/** Берём один слог слова вместе с его иероглифом — они гарантированно соответствуют. */
/* У 不 и 一 тон меняется в зависимости от соседа: 不是 читается bú, а сам знак — bù.
   Спрашивать такой слог как «тон знака» нечестно: владелец получил 不 дважды с разными
   ответами и справедливо назвал это бредом. Теперь такие случаи помечаются. */
const TONE_SHIFTING = new Set(['不', '一']);

function buildToneQuestion(word) {
  const syllables = splitSyllables(word.pinyin);
  const characters = hanziCharacters(word.hanzi);
  const index = syllables.length > 1 ? Math.floor(Math.random() * syllables.length) : 0;
  const syllable = syllables[index] || word.pinyin;
  const sound = characters[index] || word.hanzi;
  return {
    sound,
    syllable,
    letters: pinyinLetters(syllable),
    correctTone: syllableTone(syllable),
    shifted: TONE_SHIFTING.has(sound) && word.hanzi.length > 1,
  };
}

/** Вопрос = данные для экрана. Рисует его слой UI, здесь только смысл. */
function buildQuestion(word, pool, mode) {
  if (mode === 'hanzi2ru' || mode === 'listen') {
    const choice = buildChoiceQuestion(word, pool, 'translation');
    return { kind: 'choice', mode, word, options: choice.options, correctIndex: choice.correctIndex,
      optionField: 'translation', hideWord: mode === 'listen' };
  }
  if (mode === 'ru2hanzi') {
    const choice = buildChoiceQuestion(word, pool, 'hanzi');
    return { kind: 'choice', mode, word, options: choice.options, correctIndex: choice.correctIndex,
      optionField: 'hanzi', hideWord: false };
  }
  if (mode === 'pinyin') return { kind: 'input', mode, word };
  // Диктант — тот же ввод пиньиня, только слово не показывается: его надо услышать.
  if (mode === 'dictation') return { kind: 'input', mode, word, byEar: true };
  if (mode === 'tones') return Object.assign({ kind: 'tone', mode, word }, buildToneQuestion(word));
  return { kind: 'flip', mode, word };
}

/** Оценка ответа переводится в качество SM-2: ошибка тона — не полный провал, а «трудно». */
export function qualityFromVerdict(verdict) {
  if (verdict === 'correct') return QUALITY_GOOD;
  if (verdict === 'tone') return QUALITY_HARD;
  return QUALITY_FORGOT;
}

export function startSession(options) {
  session.active = true;
  session.mode = options.mode;
  // Порядок каждый раз новый: отбор слов идёт по сроку повторения, а вот показывать их
  // в одной и той же последовательности нельзя — запоминается очерёдность, а не слова
  // (просьба владельца 25.08.2026). Заодно это делает кнопку «Заново» осмысленной.
  session.queue = shuffle(options.words.slice());
  session.restart = options;      // чем запускали — чтобы прогнать тот же набор заново
  session.index = 0;
  session.correct = 0;
  session.wrong = 0;
  session.answered = false;
  session.flipped = false;
  session.exam = options.exam || null;
  session.repeatedIds = new Set();
  session.recentSyllables = [];
  session.plan = null;
  session.question = null;
  nextQuestion();
}

/* Сколько последних слогов помним в тренировке тонов, чтобы они не шли подряд. */
const TONE_MEMORY = 4;

export function nextQuestion() {
  session.answered = false;
  session.flipped = false;
  // Пробный HSK собирает все задания заранее: там важен состав частей, а не случайный режим.
  if (session.plan) {
    session.question = session.plan[session.index] || null;
    return;
  }
  const word = session.queue[session.index];
  if (!word) { session.question = null; return; }
  /* Неверные варианты берём только из открытых слов: иначе среди ответов всплывают слова
     закрытых уровней, которых человек в глаза не видел (Иван 03.09.2026 — «что это за
     слово, я его не проходил»). Заодно это честнее: выбор идёт между знакомыми. */
  const pool = state.words.filter((item) => item.id !== word.id && isWordAvailable(item));
  const mode = session.exam ? pickRandom(session.exam.modes) : session.mode;

  let question = buildQuestion(word, pool.length >= 3 ? pool : state.words, mode);   // словарь целиком — только если открытых слов совсем мало
  // Разные слова дают один и тот же слог (hǎo в 好 и в 你好) — подряд это выглядит
  // как повтор вопроса. Перебираем варианты, пока слог не окажется свежим.
  if (question.kind === 'tone') {
    for (let attempt = 0; attempt < 6 && session.recentSyllables.includes(question.letters); attempt += 1) {
      question = buildQuestion(word, state.words, mode);
    }
    // У односложного слова выбирать нечего — тогда меняем его местами со следующим подходящим.
    if (session.recentSyllables.includes(question.letters)) {
      for (let index = session.index + 1; index < session.queue.length; index += 1) {
        const candidate = buildQuestion(session.queue[index], state.words, mode);
        if (session.recentSyllables.includes(candidate.letters)) continue;
        const current = session.queue[session.index];
        session.queue[session.index] = session.queue[index];
        session.queue[index] = current;
        question = candidate;
        break;
      }
    }
    session.recentSyllables.push(question.letters);
    if (session.recentSyllables.length > TONE_MEMORY) session.recentSyllables.shift();
  }
  session.question = question;
}

/** Ошибочное слово возвращается в конец текущей сессии — но только один раз, иначе она не кончится. */
function requeueWord(word) {
  if (session.repeatedIds.has(word.id)) return;
  session.repeatedIds.add(word.id);
  session.queue.push(word);
}

/**
 * Записывает ответ: обновляет SM-2, статистику дня и очередь.
 * Экзамен намеренно не трогает интервалы — он только проверяет, а не учит.
 */
export async function recordAnswer(word, verdict, explicitQuality) {
  // В карточках человек оценивает себя сам, и его оценка точнее вердикта «верно/неверно»
  const quality = explicitQuality === undefined ? qualityFromVerdict(verdict) : explicitQuality;
  if (verdict === 'correct') session.correct += 1; else session.wrong += 1;

  if (session.exam) {
    session.exam.asked += 1;
    if (verdict === 'correct') session.exam.correct += 1;
    return;
  }

  const previous = state.srs.get(word.id) || createSrsRecord(word.id);
  const updated = applySm2(previous, quality);
  if (verdict === 'wrong') updated.errors += 1;
  if (verdict === 'tone') updated.toneErrors += 1;
  const becameLearned = !isLearned(previous) && isLearned(updated);

  // В память кладём сразу — тренировка не должна вставать из-за медленной или сломанной базы.
  state.srs.set(word.id, updated);
  try {
    await dbPut(STORE_SRS, updated);
    await updateDayStats({
      reviewed: 1,
      correct: verdict === 'correct' ? 1 : 0,
      errors: verdict === 'wrong' ? 1 : 0,
      toneErrors: verdict === 'tone' ? 1 : 0,
      learned: becameLearned ? 1 : 0,
      mode: session.mode,
    });
  } catch (error) {
    // Раньше отказ базы обрывал обработчик посреди ответа: карточка замирала, кнопки
    // не работали и ни слова на экране (аудит 03.09.2026). Теперь говорим прямо.
    toast('Не удалось сохранить ответ: браузер отказал в записи. Сессию лучше начать заново.', true);
  }

  if (verdict !== 'correct') requeueWord(word);
}

/* ——— Уровни и экзамен ——— */

export const wordsOfLevel = (level) => state.words.filter((word) => word.level === level);

/** Уровень готов к экзамену, когда почти все его слова закреплены двумя верными повторениями. */
export function examReadiness(level) {
  const words = wordsOfLevel(level);
  const ready = words.filter((word) => {
    const record = state.srs.get(word.id);
    return record && record.repetitions >= EXAM_MIN_REPETITIONS;
  }).length;
  const ratio = words.length ? ready / words.length : 0;
  return { total: words.length, ready, ratio, allowed: words.length > 0 && ratio >= EXAM_READY_RATIO };
}

/** Готовность к итоговому: он открывается только после всех экзаменов уровней. */
export function finalExamReadiness() {
  const passedLevels = [1, 2, 3].filter((level) => (state.exams.get(level) || {}).passed).length;
  return { passedLevels, allowed: passedLevels >= MAX_LEVEL };
}

export function startExam(level) {
  const isFinal = level === FINAL_EXAM_LEVEL;
  const pool = isFinal
    ? state.words.filter((word) => word.level >= 1 && word.level <= MAX_LEVEL)
    : wordsOfLevel(level);
  // В итоговом добавляем и режим «на слух» — если голос есть, проверка становится честнее.
  const modeIds = isFinal ? EXAM_MODES.concat('listen') : EXAM_MODES;
  const modes = modeIds.filter((mode) => {
    const definition = MODES.find((item) => item.id === mode);
    return !definition.needsVoice || speech.available;
  });
  const questions = shuffle(pool).slice(0, isFinal ? FINAL_EXAM_QUESTIONS : EXAM_QUESTION_COUNT);
  startSession({
    mode: modes[0],
    words: questions,
    exam: { level, asked: 0, correct: 0, modes, total: questions.length, isFinal },
  });
}

export async function finishExam() {
  const exam = session.exam;
  const passScore = exam.isHsk ? Math.ceil(exam.total * HSK_PASS_RATIO)
    : exam.isFinal ? Math.ceil(exam.total * FINAL_EXAM_RATIO)
    : Math.min(EXAM_PASS_SCORE, exam.total);
  const passed = exam.correct >= passScore;
  const record = {
    level: exam.level,
    passed,
    score: exam.correct,
    total: exam.total,
    date: dayKey(),
  };
  // В базе держим лучшую попытку: сданный экзамен не должен «отменяться» слабым результатом.
  const previous = await dbGet(STORE_EXAMS, exam.level);
  const isBetter = !previous || (record.passed && !previous.passed) || record.score > previous.score;
  const best = isBetter ? record : previous;
  await dbPut(STORE_EXAMS, best);
  state.exams.set(exam.level, best);

  if (!exam.isFinal && passed && state.unlockedLevel === exam.level && exam.level < MAX_LEVEL) {
    state.unlockedLevel = exam.level + 1;
    await setSetting('unlockedLevel', state.unlockedLevel);
  }
  return Object.assign({}, record, { isFinal: Boolean(exam.isFinal), isHsk: Boolean(exam.isHsk), passScore });
}

/* ——— Отбор слов для обычной тренировки ——— */

/* Свои слова лежат на уровне 0 и потому доступны всегда, слова уровней — по мере сдачи экзаменов. */
export const isWordAvailable = (word) => word.level <= state.unlockedLevel;

export function matchesTopic(word) {
  return state.topic === ALL_TOPICS || word.topic === state.topic;
}

/** Слова к повторению: доступные по уровню, подходящие по теме, с наступившим сроком. */
export function dueWords() {
  const today = dayKey();
  return state.words
    .filter((word) => isWordAvailable(word) && matchesTopic(word))
    .filter((word) => isDue(state.srs.get(word.id) || createSrsRecord(word.id), today))
    .sort((first, second) => {
      const firstRecord = state.srs.get(first.id);
      const secondRecord = state.srs.get(second.id);
      // Сначала начатые (их пора закрепить), потом новые — в порядке уровня.
      const firstStarted = isStarted(firstRecord) ? 0 : 1;
      const secondStarted = isStarted(secondRecord) ? 0 : 1;
      if (firstStarted !== secondStarted) return firstStarted - secondStarted;
      return first.level - second.level || first.id - second.id;
    });
}

/** Слова с наибольшим числом ошибок — для кнопки «прогнать только их». */
export function troubleWords(limit) {
  return state.words
    .map((word) => ({ word, record: state.srs.get(word.id) }))
    .filter((item) => item.record && (item.record.errors + item.record.toneErrors) > 0)
    .sort((first, second) => (second.record.errors + second.record.toneErrors)
      - (first.record.errors + first.record.toneErrors))
    .slice(0, limit)
    .map((item) => item.word);
}
