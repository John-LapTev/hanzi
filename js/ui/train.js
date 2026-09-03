import { MAX_LEVEL, QUALITY_EASY, QUALITY_FORGOT, QUALITY_HARD } from '../core/constants.js';
import { MODES, TONE_LABELS, dueWords, finishExam, isToneReady, isWordAvailable, matchesTopic, nextQuestion, recordAnswer, session, shuffle, startExam, startSession, troubleWords } from '../core/modes.js';
import { answerJudge, renderClozeQuestion, renderJudgeQuestion, renderSentenceQuestion } from '../core/hsk.js';
import { comparePinyin, pinyinMarksToNumbers, pinyinNumbersToMarks } from '../core/pinyin.js';
import { speech } from '../core/speech.js';
import { isStarted } from '../core/srs.js';
import { state } from '../core/state.js';
import { el, fill, toast } from './dom.js';
import { hardMark } from './hard-mark.js';
import { uiIcon } from './icons.js';
import { showScreen } from './screens.js';
import { renderSentence } from './sentence.js';
import { handleSyllableKey } from './syllables-screen.js';
import { runTeacherStep } from './teacher-words.js';
import { markTeacherStep, renderTeacherDay, teacherDay } from './teacher-course.js';

/* ——— Запуск тренировки ——— */

/**
 * Для режимов со звуком берём только те слова, которые действительно прозвучат:
 * встроенная запись есть не у всех (свои слова пользователя её не имеют),
 * а системный голос может отсутствовать.
 */
function withSound(words, mode) {
  // Тоны звучат по одному знаку, поэтому у них своё, более строгое условие
  if (mode === 'tones') return words.filter(isToneReady);
  if (speech.voice) return words;
  return words.filter((word) => speech.hasClip(word.hanzi));
}

export function beginTraining() {
  const mode = MODES.find((item) => item.id === state.mode);
  const due = mode.needsVoice ? withSound(dueWords(), mode.id) : dueWords();
  let words = due.slice(0, state.sessionLimit);
  if (!words.length) {
    const started = state.words.filter((word) => isStarted(state.srs.get(word.id))
      && isWordAvailable(word) && matchesTopic(word));
    words = shuffle(mode.needsVoice ? withSound(started, mode.id) : started).slice(0, state.sessionLimit);
  }
  if (!words.length) { toast('Нечего повторять — сначала пройди новые слова.'); return; }
  if (mode.needsVoice && !speech.available) { toast('Для этого режима нужен звук: включи голос в системе.', true); return; }
  startSession({ mode: state.mode, words });
  showScreen('train');
  renderTrain();
}

export function beginExam(level) {
  startExam(level);
  showScreen('train');
  renderTrain();
}

export function beginTroubleRun() {
  const words = troubleWords(state.sessionLimit);
  if (!words.length) { toast('Ошибок пока нет — и хорошо.'); return; }
  startSession({ mode: state.mode, words });
  showScreen('train');
  renderTrain();
}

/* ——— Экран тренировки ——— */

export function renderTrain(feedback) {
  const counter = document.getElementById('train-counter');
  const progress = document.getElementById('train-progress');
  const verdictNode = document.getElementById('train-verdict');
  const keysNode = document.getElementById('train-keys');
  fill('train-actions', []);
  verdictNode.className = 'verdict';
  verdictNode.textContent = '';

  if (!session.question) { renderSessionSummary(); return; }

  const total = session.exam ? session.exam.total : session.queue.length;
  counter.textContent = session.exam
    ? `Экзамен · вопрос ${session.index + 1} из ${total}`
    : `${session.index + 1} из ${total}`;
  progress.style.width = `${Math.round((session.index / Math.max(total, 1)) * 100)}%`;

  const question = session.question;
  if (question.kind === 'choice') renderChoiceQuestion(question, feedback);
  if (question.kind === 'input') renderInputQuestion(question, feedback);
  if (question.kind === 'flip') renderFlipQuestion(question);
  if (question.kind === 'tone') renderToneQuestion(question, feedback);
  if (question.kind === 'judge') renderJudgeQuestion(question, feedback);
  if (question.kind === 'cloze') renderClozeQuestion(question, feedback);
  if (question.kind === 'sentence') renderSentenceQuestion(question, feedback);

  if (feedback) {
    verdictNode.textContent = feedback.message;
    verdictNode.className = `verdict is-${feedback.verdict === 'correct' ? 'ok' : feedback.verdict === 'tone' ? 'tone' : 'err'}`;
    if (feedback.verdict !== 'correct') {
      fill('train-actions', el('button', { class: 'btn', type: 'button', onclick: advanceQuestion }, 'Дальше →'));
    }
  }

  keysNode.textContent = question.kind === 'flip' ? 'Пробел — перевернуть · 1, 2, 3 — оценка · S — озвучить · Esc — выйти'
    : question.kind === 'input' ? (question.byEar
        ? 'Enter — проверить · 0 — не знаю · S — повторить звук · Esc — выйти'
        : 'Enter — проверить · 0 — не знаю · S — озвучить · Esc — выйти')
    : question.kind === 'tone' ? 'Клавиши 1–5 — тон · 0 — не знаю · S — повторить звук · Esc — выйти'
    : 'Клавиши 1–4 — ответ · 0 — не знаю · S — озвучить · Esc — выйти';
}

export function cardClass(feedback) {
  if (!feedback) return 'train-card';
  if (feedback.verdict === 'correct') return 'train-card is-ok';
  if (feedback.verdict === 'tone') return 'train-card is-tone';
  return 'train-card is-err';
}

export function speakButton(text, big) {
  return el('button', {
    class: big ? 'speak-btn is-big' : 'speak-btn', type: 'button',
    'aria-label': 'Озвучить', title: 'Озвучить (S)',
    onclick: () => { if (!speech.speak(text)) toast('Китайского голоса в системе нет.', true); },
  }, uiIcon('sound', 20));
}

function renderChoiceQuestion(question, feedback) {
  const word = question.word;
  const showAnswer = Boolean(feedback);

  const cardChildren = [];
  if (question.hideWord) {
    cardChildren.push(speakButton(word.hanzi, true));
    cardChildren.push(el('p', { class: 'faint', text: 'Нажми и послушай — что это значит?' }));
    if (showAnswer) {
      cardChildren.push(el('div', { class: 'big-hanzi hanzi', text: word.hanzi, style: 'font-size:64px' }));
      cardChildren.push(el('div', { class: 'card-pinyin', text: word.pinyin }));
    }
  } else if (question.optionField === 'translation') {
    // Здесь проверяется перевод, а не чтение, поэтому в обычной тренировке пиньинь виден
    // сразу: на слух знак разобрать удаётся не всегда (просьба владельца). На экзамене
    // подсказки быть не должно — там он появляется только вместе с ответом.
    cardChildren.push(el('div', { class: 'big-hanzi hanzi', text: word.hanzi }));
    if (!session.exam || showAnswer) {
      cardChildren.push(el('div', { class: 'card-pinyin', text: word.pinyin }));
    }
    if (speech.available) cardChildren.push(speakButton(word.hanzi));
  } else {
    cardChildren.push(el('div', { class: 'card-question', text: word.translation }));
    if (showAnswer) cardChildren.push(el('div', { class: 'card-pinyin', text: word.pinyin }));
  }

  /* Кружок помечает изучаемое КИТАЙСКОЕ слово. Поэтому он стоит у вариантов только там,
     где варианты и есть иероглифы. Когда выбираешь русский перевод, помечать русское слово
     бессмысленно (Иван 03.09.2026: «я же не русское слово учу») — там кружок один,
     в углу карточки, и относится к загаданному слову.                                  */
  const markOptions = question.optionField === 'hanzi';
  if (!markOptions) cardChildren.push(hardMark(word, 'card-mark'));

  const options = question.options.map((option, index) => {
    const isCorrect = index === question.correctIndex;
    const chosen = feedback && feedback.chosenIndex === index;
    const classes = ['option'];
    if (showAnswer && isCorrect) classes.push('is-ok');
    if (showAnswer && chosen && !isCorrect) classes.push('is-err');
    const label = option[question.optionField];
    const button = el('button', {
      class: classes.join(' '), type: 'button', disabled: session.answered,
      onclick: () => answerChoice(index),
    }, [
      el('span', { class: 'option-key', text: String(index + 1) }),
      el('span', { class: `option-body${markOptions ? ' hanzi' : ''}`, text: label }),
    ]);
    // Кружок — отдельная кнопка рядом, а не внутри варианта: иначе нажатие на метку
    // засчитывалось бы как ответ, да и кнопка внутри кнопки — неверная разметка.
    return markOptions ? el('div', { class: 'option-row' }, [button, hardMark(option)]) : button;
  });

  fill('train-body', [
    el('div', { class: cardClass(feedback) }, cardChildren),
    el('div', { class: 'options' }, options.concat(feedback ? [] : [unknownButton()])),
  ]);
}

/**
 * «Не знаю» вместо угадывания: случайно ткнув верный вариант, человек получил бы
 * зачёт за слово, которого не помнит, и оно ушло бы из повторений. Прямая просьба владельца.
 */
function unknownButton() {
  return el('button', {
    class: 'btn btn-quiet btn-wide', type: 'button', style: 'margin-top:6px',
    onclick: answerUnknown,
  }, 'Не знаю — показать ответ');
}

async function answerUnknown() {
  if (session.answered) return;
  session.answered = true;
  const question = session.question;
  const word = question.word;
  await recordAnswer(word, 'wrong');
  const message = question.kind === 'tone'
    ? `${question.syllable} — ${TONE_LABELS.find((tone) => tone.tone === question.correctTone).title}`
    : `${word.hanzi} — ${word.pinyin} — ${word.translation}`;
  renderTrain({ verdict: 'wrong', message });
}

function renderInputQuestion(question, feedback) {
  const word = question.word;
  // Без примера в поле: подсказка «ni3 hao3» раскрывала ответ на первом же слове 你好.
  const input = el('input', {
    type: 'text', id: 'pinyin-input', autocomplete: 'off', autocapitalize: 'off',
    spellcheck: 'false', disabled: session.answered,
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); answerPinyin(input.value); }
  });

  // Живое превью: набрал ni3 — сразу видишь nǐ. Иначе цифры в поле сбивают с толку.
  const preview = el('div', { class: 'pinyin-preview', text: ' ' });
  input.addEventListener('input', () => {
    const marked = pinyinNumbersToMarks(input.value.trim());
    preview.textContent = marked || ' ';
  });

  // В диктанте иероглиф скрыт до ответа — иначе это не проверка слуха
  const cardChildren = [];
  if (question.byEar && !feedback) {
    cardChildren.push(speakButton(word.hanzi, true));
    cardChildren.push(el('p', { class: 'faint', text: 'Слушай и запиши пиньинь. Тон — цифрой сразу после слога' }));
  } else {
    cardChildren.push(el('div', { class: 'big-hanzi hanzi', text: word.hanzi }));
    if (feedback) {
      cardChildren.push(el('div', { class: 'card-pinyin', text: word.pinyin }));
      cardChildren.push(el('div', { class: 'card-translation', text: word.translation }));
    } else {
      cardChildren.push(el('p', { class: 'faint', text: 'Напечатай пиньинь. Тон — цифрой сразу после слога' }));
    }
    if (speech.available) cardChildren.push(speakButton(word.hanzi));
  }

  // В режимах без вариантов ответа кружок стоит в углу карточки — метка нужна всюду
  cardChildren.push(hardMark(word, 'card-mark'));

  fill('train-body', [
    el('div', { class: cardClass(feedback) }, cardChildren),
    el('div', { class: 'options' }, [
      input,
      preview,
      el('div', { class: 'tone-legend' }, TONE_LABELS.map((tone) => el('span', {
        class: 'tone-legend-item',
      }, [
        el('b', { class: 'hanzi', text: tone.mark }),
        el('span', { text: tone.tone === 5 ? 'без тона' : `тон ${tone.tone}` }),
      ]))),
      el('button', {
        class: 'btn btn-wide', type: 'button', disabled: session.answered,
        onclick: () => answerPinyin(input.value),
      }, 'Проверить'),
      feedback ? null : unknownButton(),
    ].filter(Boolean)),
  ]);
  if (!session.answered) {
    input.focus();
    if (question.byEar) speech.speak(word.hanzi);   // диктант сразу проигрывает слово
  }
}

function renderFlipQuestion(question) {
  const word = question.word;
  const front = [el('div', { class: 'big-hanzi hanzi', text: word.hanzi })];
  if (speech.available) front.push(speakButton(word.hanzi));

  const back = [
    el('div', { class: 'big-hanzi hanzi', text: word.hanzi, style: 'font-size:64px' }),
    el('div', { class: 'card-pinyin', text: word.pinyin }),
    el('div', { class: 'card-translation', text: word.translation }),
  ];
  if (word.example && word.example.hanzi) {
    back.push(el('div', { class: 'example-block', style: 'text-align:left;margin-top:8px' }, [
      renderSentence(word.example.hanzi),
      el('div', { class: 'sentence-pinyin', text: word.example.pinyin || '' }),
      el('div', { class: 'sentence-translation', text: word.example.translation || '' }),
    ]));
  }
  if (speech.available) back.push(speakButton(word.hanzi));

  const card = el('div', { class: 'train-card' },
    (session.flipped ? back : front).concat([hardMark(word, 'card-mark')]));
  const actions = session.flipped
    ? el('div', { class: 'options' }, [
        el('button', { class: 'option', type: 'button', onclick: () => answerFlashcard(QUALITY_FORGOT) },
          [el('span', { class: 'option-key', text: '1' }), 'Не помню']),
        el('button', { class: 'option', type: 'button', onclick: () => answerFlashcard(QUALITY_HARD) },
          [el('span', { class: 'option-key', text: '2' }), 'Трудно']),
        el('button', { class: 'option', type: 'button', onclick: () => answerFlashcard(QUALITY_EASY) },
          [el('span', { class: 'option-key', text: '3' }), 'Легко']),
      ])
    : el('div', { class: 'options' }, el('button', {
        class: 'btn btn-wide', type: 'button', onclick: flipCard,
      }, 'Перевернуть (пробел)'));

  fill('train-body', [card, actions]);
}

function renderToneQuestion(question, feedback) {
  // Знак показываем сразу (просьба владельца): по одной латинице непонятно, о каком слове
  // речь, а у 不 и 一 тон в сочетаниях меняется — без знака это выглядит противоречием.
  const cardChildren = [
    speakButton(question.sound, true),
    el('div', { class: 'big-hanzi hanzi', style: 'font-size:52px', text: question.sound }),
    el('div', { class: 'card-question', text: question.letters }),
    el('p', { class: 'faint', text: 'Какой тон прозвучал?' }),
  ];
  if (question.shifted) {
    cardChildren.push(el('p', { class: 'faint',
      text: `В слове ${question.word.hanzi} тон меняется по правилу — здесь он звучит иначе, `
        + 'чем у знака отдельно.' }));
  }
  if (feedback) {
    cardChildren.push(el('div', { class: 'card-pinyin', text: `${question.syllable} · ${question.word.translation}` }));
  }

  const options = TONE_LABELS.map((tone, index) => {
    const isCorrect = tone.tone === question.correctTone;
    const chosen = feedback && feedback.chosenIndex === index;
    const classes = ['option'];
    if (feedback && isCorrect) classes.push('is-ok');
    if (feedback && chosen && !isCorrect) classes.push('is-err');
    return el('button', {
      class: classes.join(' '), type: 'button', disabled: session.answered,
      onclick: () => answerTone(index),
    }, [
      el('span', { class: 'option-key', text: String(index + 1) }),
      el('span', { class: 'option-tone hanzi', text: tone.mark }),
      el('span', { text: tone.title }),
    ]);
  });

  cardChildren.push(hardMark(question.word, 'card-mark'));

  fill('train-body', [
    el('div', { class: cardClass(feedback) }, cardChildren),
    el('div', { class: 'options' }, options.concat(feedback ? [] : [unknownButton()])),
  ]);
  if (!feedback && !session.answered) speech.speak(question.sound);
}

/* ——— Ответы ——— */

let advanceTimer = null;
export function scheduleAdvance() {
  clearTimeout(advanceTimer);
  advanceTimer = setTimeout(advanceQuestion, 700);
}

function advanceQuestion() {
  clearTimeout(advanceTimer);
  session.index += 1;
  nextQuestion();
  renderTrain();
}

export async function answerChoice(index) {
  if (session.answered) return;
  session.answered = true;
  const question = session.question;
  const correct = index === question.correctIndex;
  await recordAnswer(question.word, correct ? 'correct' : 'wrong');
  const right = question.options[question.correctIndex];
  renderTrain({
    verdict: correct ? 'correct' : 'wrong',
    chosenIndex: index,
    message: correct ? 'Верно' : `Правильно: ${right.hanzi} — ${right.pinyin} — ${right.translation}`,
  });
  if (correct) scheduleAdvance();
}

async function answerPinyin(value) {
  if (session.answered) return;
  const typed = String(value || '').trim();
  if (!typed) { toast('Напечатай пиньинь — например ni3 hao3'); return; }
  session.answered = true;
  const question = session.question;
  const verdict = comparePinyin(typed, question.word.pinyin);
  await recordAnswer(question.word, verdict);
  const messages = {
    correct: 'Верно',
    tone: `Слог верный, тон нет: ${question.word.pinyin} (${pinyinMarksToNumbers(question.word.pinyin)})`,
    wrong: `Правильно: ${question.word.pinyin} (${pinyinMarksToNumbers(question.word.pinyin)})`,
  };
  renderTrain({ verdict, message: messages[verdict] });
  if (verdict === 'correct') scheduleAdvance();
}

async function answerTone(index) {
  if (session.answered) return;
  session.answered = true;
  const question = session.question;
  const chosen = TONE_LABELS[index].tone;
  const correct = chosen === question.correctTone;
  await recordAnswer(question.word, correct ? 'correct' : 'wrong');
  const rightTone = TONE_LABELS.find((tone) => tone.tone === question.correctTone);
  renderTrain({
    verdict: correct ? 'correct' : 'wrong',
    chosenIndex: index,
    message: correct ? 'Верно' : `Здесь ${rightTone.title}: ${question.syllable}`,
  });
  if (correct) scheduleAdvance();
}

function flipCard() {
  if (session.flipped || !session.question || session.question.kind !== 'flip') return;
  session.flipped = true;
  renderFlipQuestion(session.question);
}

/* Самооценка карточки идёт в SM-2 как есть: «Не помню» — провал, «Трудно» — тройка,
   «Легко» — пятёрка. Раньше оценка выбрасывалась и обе кнопки давали одно и то же,
   а «лёгкость» слова могла только падать: при качестве 4 прибавка ровно нулевая,
   и за месяцы все слова сползали к минимуму (аудит 03.09.2026). */
async function answerFlashcard(quality) {
  if (session.answered || !session.flipped) return;
  session.answered = true;
  const verdict = quality === QUALITY_FORGOT ? 'wrong' : 'correct';
  await recordAnswer(session.question.word, verdict, quality);
  advanceQuestion();
}

async function renderSessionSummary() {
  document.getElementById('train-counter').textContent = '';
  document.getElementById('train-progress').style.width = '100%';
  document.getElementById('train-keys').textContent = '';

  if (session.exam) {
    const result = await finishExam();
    const passed = result.passed;
    fill('train-body', el('div', { class: 'train-card' }, [
      el('div', { class: 'big-hanzi hanzi', text: passed ? '好' : '再', style: 'font-size:72px' }),
      el('div', { class: 'card-question', text: passed
        ? (result.isHsk ? 'Пробный HSK 1 сдан' : result.isFinal ? 'Итоговый экзамен сдан' : 'Экзамен сдан')
        : (result.isHsk ? 'Пробный HSK 1 не сдан' : result.isFinal ? 'Итоговый экзамен не сдан' : 'Экзамен не сдан') }),
      el('div', { class: 'card-translation', text: `${result.score} правильных из ${result.total}` }),
      el('p', { class: 'faint', text: passed
        ? (result.isHsk ? 'По объёму и формату это уровень настоящего HSK 1. Настоящий сдают в аккредитованном центре — там же выдают сертификат.'
          : result.isFinal ? 'Весь словарь приложения пройден. Дальше — новые слова и темы.'
          : result.level < MAX_LEVEL ? `Уровень ${result.level + 1} открыт — новые слова уже в тренировках.`
          : 'Все уровни пройдены, открылся итоговый экзамен.')
        : `Нужно ${result.passScore}. Повтори слова и приходи снова — попыток сколько угодно.` }),
    ]));
    session.exam = null;
  } else {
    const total = session.correct + session.wrong;
    fill('train-body', el('div', { class: 'train-card' }, [
      el('div', { class: 'big-hanzi hanzi', text: '完', style: 'font-size:72px' }),
      el('div', { class: 'card-question', text: 'Сессия закончена' }),
      el('div', { class: 'card-translation', text: `${session.correct} верно из ${total}` }),
      el('p', { class: 'faint', text: session.wrong
        ? 'Слова с ошибками вернутся завтра — так они и запоминаются.'
        : 'Ни одной ошибки.' }),
    ]));
  }

  session.active = false;
  const fromTeacher = Boolean(state.teacherReturn);
  // Шаг программы закрывается только безошибочным проходом: иначе «сделано» стоит
  // там, где половина ответов была мимо (замечание владельца 17.08.2026).
  const clean = session.wrong === 0;
  const actions = [];
  if (fromTeacher && !clean) {
    actions.push(el('p', { class: 'faint center', style: 'margin-bottom:12px',
      text: 'Шаг закроется, когда пройдёшь без ошибок. Ошибки уже в очереди — прогони их.' }));
    actions.push(el('button', { class: 'btn', type: 'button', onclick: () => {
      const back = state.teacherReturn;
      state.teacherReturn = null;
      const entry = teacherDay(back.day);
      runTeacherStep(entry, back.step);
    } }, 'Пройти ещё раз'));
  }
  actions.push(el('button', {
    class: fromTeacher && !clean ? 'btn btn-quiet' : 'btn', type: 'button',
    onclick: () => {
      if (finishTeacherReturn(clean)) return;
      showScreen('home');
    },
  }, fromTeacher ? 'К программе дня' : 'На главную'));
  fill('train-actions', actions);
  document.getElementById('train-verdict').textContent = '';
}

/** Тренировка, запущенная программой, возвращает в день. Шаг закрывается только
    пройденной до конца сессией: иначе «выйти» на первом вопросе засчитывало бы день. */
export function finishTeacherReturn(completed) {
  const back = state.teacherReturn;
  if (!back) return false;
  state.teacherReturn = null;
  if (completed) markTeacherStep(back.day, back.step);
  state.teacherDay = back.day;
  showScreen('teacher-day');
  renderTeacherDay();
  return true;
}

/** Прогнать тот же набор заново, не выходя с экрана: слова те же, порядок новый. */
export function restartTraining() {
  if (!session.restart) return;
  clearTimeout(advanceTimer);
  startSession(session.restart);
  renderTrain();
}

export function exitTraining() {
  session.active = false;
  session.exam = null;
  clearTimeout(advanceTimer);
  if (finishTeacherReturn(false)) return;   // тренировку открыла программа — возвращаемся в день
  showScreen('home');
}

/* ——— Клавиатура ——— */

export function handleKeydown(event) {
  if (state.screen === 'syllable-drill') { handleSyllableKey(event); return; }
  if (state.screen !== 'train' || !session.question) return;
  const target = event.target;
  const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
  const question = session.question;

  if (event.key === 'Escape') { exitTraining(); return; }
  if (typing && event.key !== 'Escape') return;

  if (event.key === 's' || event.key === 'S' || event.key === 'ы' || event.key === 'Ы') {
    const text = question.kind === 'tone' ? question.sound : question.word.hanzi;
    if (!speech.speak(text)) toast('Китайского голоса в системе нет.', true);
    return;
  }
  if (event.key === ' ' && question.kind === 'flip') { event.preventDefault(); flipCard(); return; }
  if (event.key === 'Enter') {
    event.preventDefault();
    if (session.answered) advanceQuestion();
    else if (question.kind === 'flip' && !session.flipped) flipCard();
    return;
  }

  if (event.key === '0' && question.kind !== 'flip') { answerUnknown(); return; }

  const digit = Number(event.key);
  if (!digit) return;
  if ((question.kind === 'choice' || question.kind === 'cloze' || question.kind === 'sentence')
    && digit >= 1 && digit <= question.options.length) answerChoice(digit - 1);
  if (question.kind === 'judge' && (digit === 1 || digit === 2)) answerJudge(digit - 1, digit === 1);
  if (question.kind === 'tone' && digit >= 1 && digit <= TONE_LABELS.length) answerTone(digit - 1);
  if (question.kind === 'flip' && session.flipped && digit >= 1 && digit <= 3) {
    answerFlashcard([QUALITY_FORGOT, QUALITY_HARD, QUALITY_EASY][digit - 1]);
  }
}
