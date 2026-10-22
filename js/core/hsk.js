import { FINAL_EXAM_LEVEL, HSK_PASS_RATIO, MAX_LEVEL, STORE_EXAMS } from './constants.js';
import { pickRandom, shuffle } from './random.js';
import { speech } from './speech.js';
import { state } from './state.js';
import { buildChoiceQuestion, recordAnswer, session, startSession } from './modes.js';
import { el, fill } from '../ui/dom.js';
import { answerChoice, cardClass, renderTrain, scheduleAdvance, speakButton } from '../ui/train.js';

/* ═══════════════════ HSK — пробный экзамен по структуре официального ═══════════════════
   Вынесено из core/modes.js: самостоятельный кусок со своими константами, планом заданий
   и тремя экранами (аудит 03.09.2026).                                                  */

/* ——— Пробный HSK 1: тот же формат, что у официального экзамена ———
   Официальный HSK сдаётся только в аккредитованном центре — приложение может дать лишь
   тренировку по его структуре. Отсюда и название: «пробный».
   Формат HSK 1: 20 заданий на слух + 20 на чтение, проходной балл 60%.               */

export const HSK_LEVEL = 101;                 // условный номер, чтобы хранить результат рядом с экзаменами
export const HSK_LISTEN_JUDGE = 10;           // слушаешь слово — верно ли утверждение
export const HSK_LISTEN_CHOICE = 10;          // слушаешь слово — выбираешь перевод
export const HSK_READ_CLOZE = 10;             // вставляешь пропущенное слово
export const HSK_READ_SENTENCE = 10;          // выбираешь перевод предложения
export { HSK_PASS_RATIO };   // объявлена в constants.js — её же считает finishExam

export const hskQuestionCount = () => HSK_LISTEN_JUDGE + HSK_LISTEN_CHOICE + HSK_READ_CLOZE + HSK_READ_SENTENCE;

/** Пробный HSK открывается, когда пройден весь словарь — то есть сдан итоговый экзамен. */
export function hskReadiness() {
  const finalRecord = state.exams.get(FINAL_EXAM_LEVEL);
  return {
    finalPassed: Boolean(finalRecord && finalRecord.passed),
    voice: speech.available,
    allowed: Boolean(finalRecord && finalRecord.passed) && speech.available,
  };
}

/** Слова с примерами нужны для заданий на чтение — без примера предложения не составить. */
const wordsWithExample = (pool) => pool.filter((word) => word.example && word.example.hanzi
  && word.example.translation && word.hanzi.length > 1 && word.example.hanzi.includes(word.hanzi));

function buildHskPlan() {
  const pool = state.words.filter((word) => word.level >= 1 && word.level <= MAX_LEVEL);
  const withExample = wordsWithExample(pool);
  const plan = [];

  // Часть 1 — на слух: верно ли утверждение о значении
  shuffle(pool).slice(0, HSK_LISTEN_JUDGE).forEach((word) => {
    const trueStatement = Math.random() < 0.5;
    const other = pickRandom(pool.filter((item) => item.id !== word.id));
    plan.push({
      kind: 'judge', mode: 'hsk', word,
      statement: trueStatement ? word.translation : other.translation,
      answer: trueStatement,
    });
  });

  // Часть 2 — на слух: выбрать перевод
  shuffle(pool).slice(0, HSK_LISTEN_CHOICE).forEach((word) => {
    const choice = buildChoiceQuestion(word, pool.filter((item) => item.id !== word.id), 'translation');
    plan.push({ kind: 'choice', mode: 'hsk', word, options: choice.options,
      correctIndex: choice.correctIndex, optionField: 'translation', hideWord: true });
  });

  // Часть 3 — чтение: вставить пропущенное слово
  shuffle(withExample).slice(0, HSK_READ_CLOZE).forEach((word) => {
    const choice = buildChoiceQuestion(word, pool.filter((item) => item.id !== word.id), 'hanzi');
    plan.push({ kind: 'cloze', mode: 'hsk', word, options: choice.options,
      correctIndex: choice.correctIndex, optionField: 'hanzi',
      sentence: word.example.hanzi.replace(word.hanzi, '＿＿'), translation: word.example.translation });
  });

  // Часть 4 — чтение: выбрать перевод предложения
  shuffle(withExample).slice(0, HSK_READ_SENTENCE).forEach((word) => {
    const others = shuffle(withExample.filter((item) => item.id !== word.id)).slice(0, 3);
    const options = shuffle(others.concat([word]));
    plan.push({ kind: 'sentence', mode: 'hsk', word, options,
      correctIndex: options.findIndex((item) => item.id === word.id),
      sentence: word.example.hanzi });
  });

  return plan;
}

export function startHskExam() {
  const plan = buildHskPlan();
  startSession({
    mode: 'hsk',
    words: plan.map((question) => question.word),
    exam: { level: HSK_LEVEL, asked: 0, correct: 0, modes: ['hsk'], total: plan.length, isHsk: true },
  });
  session.plan = plan;
  session.question = plan[0];
}

/* ——— Рендер заданий HSK ——— */

export function renderJudgeQuestion(question, feedback) {
  const showAnswer = Boolean(feedback);
  const buttons = [true, false].map((value, index) => {
    const isCorrect = value === question.answer;
    const chosen = feedback && feedback.chosenIndex === index;
    const classes = ['option'];
    if (showAnswer && isCorrect) classes.push('is-ok');
    if (showAnswer && chosen && !isCorrect) classes.push('is-err');
    return el('button', {
      class: classes.join(' '), type: 'button', disabled: session.answered,
      onclick: () => answerJudge(index, value),
    }, [
      el('span', { class: 'option-key', text: String(index + 1) }),
      el('span', { text: value ? 'Верно' : 'Неверно' }),
    ]);
  });

  const cardChildren = [
    speakButton(question.word.hanzi, true),
    el('p', { class: 'faint', text: 'Слушай и реши: это утверждение верное?' }),
    el('div', { class: 'card-question', text: `«${question.statement}»` }),
  ];
  if (showAnswer) {
    cardChildren.push(el('div', { class: 'hanzi', style: 'font-size:38px', text: question.word.hanzi }));
    cardChildren.push(el('div', { class: 'card-pinyin', text: `${question.word.pinyin} — ${question.word.translation}` }));
  }

  fill('train-body', [
    el('div', { class: cardClass(feedback) }, cardChildren),
    el('div', { class: 'options' }, buttons),
  ]);
  if (!feedback && !session.answered) speech.speak(question.word.hanzi);
}

export function renderClozeQuestion(question, feedback) {
  const showAnswer = Boolean(feedback);
  const options = question.options.map((option, index) => {
    const isCorrect = index === question.correctIndex;
    const chosen = feedback && feedback.chosenIndex === index;
    const classes = ['option'];
    if (showAnswer && isCorrect) classes.push('is-ok');
    if (showAnswer && chosen && !isCorrect) classes.push('is-err');
    return el('button', {
      class: classes.join(' '), type: 'button', disabled: session.answered,
      onclick: () => answerChoice(index),
    }, [
      el('span', { class: 'option-key', text: String(index + 1) }),
      el('span', { class: 'hanzi', text: option.hanzi }),
    ]);
  });

  const cardChildren = [
    el('div', { class: 'sentence', style: 'font-size:26px', text: question.sentence }),
    el('p', { class: 'faint', text: 'Какое слово пропущено?' }),
  ];
  if (showAnswer) cardChildren.push(el('div', { class: 'card-translation', text: question.translation }));

  fill('train-body', [
    el('div', { class: cardClass(feedback) }, cardChildren),
    el('div', { class: 'options' }, options),
  ]);
}

export function renderSentenceQuestion(question, feedback) {
  const showAnswer = Boolean(feedback);
  const options = question.options.map((option, index) => {
    const isCorrect = index === question.correctIndex;
    const chosen = feedback && feedback.chosenIndex === index;
    const classes = ['option'];
    if (showAnswer && isCorrect) classes.push('is-ok');
    if (showAnswer && chosen && !isCorrect) classes.push('is-err');
    return el('button', {
      class: classes.join(' '), type: 'button', disabled: session.answered,
      onclick: () => answerChoice(index),
    }, [
      el('span', { class: 'option-key', text: String(index + 1) }),
      el('span', { text: option.example.translation }),
    ]);
  });

  const cardChildren = [
    el('div', { class: 'sentence', style: 'font-size:26px', text: question.sentence }),
    el('p', { class: 'faint', text: 'Что означает эта фраза?' }),
  ];
  if (showAnswer && speech.available) cardChildren.push(speakButton(question.sentence));

  fill('train-body', [
    el('div', { class: cardClass(feedback) }, cardChildren),
    el('div', { class: 'options' }, options),
  ]);
}

export async function answerJudge(index, value) {
  if (session.answered) return;
  session.answered = true;
  const question = session.question;
  const correct = value === question.answer;
  await recordAnswer(question.word, correct ? 'correct' : 'wrong');
  renderTrain({
    verdict: correct ? 'correct' : 'wrong',
    chosenIndex: index,
    message: correct ? 'Верно' : `${question.word.hanzi} — ${question.word.translation}`,
  });
  if (correct) scheduleAdvance();
}
