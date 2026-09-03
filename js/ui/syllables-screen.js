import { STORE_SYLLABLES } from '../core/constants.js';
import { dbPut, setSetting } from '../core/db.js';
import { TONE_LABELS, shuffle } from '../core/modes.js';
import { pinyinLetters, splitSyllables, syllableTone } from '../core/pinyin.js';
import { speech } from '../core/speech.js';
import { addDays, dayKey } from '../core/srs.js';
import { state } from '../core/state.js';
import { SYLLABLE_STREAK_TO_LEARN, markSyllableShown, noteSyllableAnswer, pickDrillQueue, runsSinceSeen, syllableRecord, syllableStatus, syllableSummary, syllablesDueToday, troubleSyllables } from '../core/syllables.js';
import { updateDayStats } from '../core/stats.js';
import { FINAL_HINTS, INITIAL_HINTS, SYLLABLE_INITIALS, SYLLABLE_ROWS, SYLLABLE_TRAPS } from '../data/syllables.js';
import { el, fill, toast } from './dom.js';
import { iconLabel, uiIcon } from './icons.js';
import { goBack, showScreen, syncBackButton } from './screens.js';
import { closeCharSheet } from './sentence.js';
import { markTeacherStep, renderTeacherDay, teacherDay } from './teacher-course.js';

// Экраны рядом берут учёт слогов через этот же файл — им незачем знать про core/syllables.js
export { syllableSummary, syllablesDueToday };

/* ——— Таблица слогов: сетка, карточка слога, тренировка на слух ——— */

/** Разбирает слог на инициаль и финаль — по ним берутся подсказки произношения. */
function syllableParts(syllable) {
  for (const initial of ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l',
                         'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's']) {
    if (syllable.startsWith(initial)) {
      const row = SYLLABLE_ROWS.find((item) => item.cells[initial] === syllable);
      return { initial, final: row ? row.final : syllable.slice(initial.length) };
    }
  }
  const row = SYLLABLE_ROWS.find((item) => item.alone === syllable);
  return { initial: '', final: row ? row.final : syllable };
}

/** Приблизительное русское звучание: инициаль плюс финаль, без претензии на точность. */
function syllableInRussian(syllable) {
  const { initial, final } = syllableParts(syllable);
  const head = initial ? (INITIAL_HINTS[initial] || {}).ru || '' : '';
  const tail = (FINAL_HINTS[final] || {}).ru || final;
  if (!initial) return tail;
  // «сь» + «яо» слились бы в «сьяо»: мягкий знак перед я/е/ю не нужен
  const softened = /^[ьи]/.test(tail) || /^[яеёюи]/.test(tail);
  return (softened ? head.replace(/ь$/, '') : head) + tail;
}

export function renderSyllableTable() {
  const table = el('table', { class: 'syllable-table' });
  const head = el('tr', {}, [el('th', { class: 'corner', text: '' }),
    el('th', { class: 'alone', text: '—' })]);
  SYLLABLE_INITIALS.forEach((initial) => head.append(el('th', { text: initial })));
  table.append(el('thead', {}, head));

  const body = el('tbody');
  SYLLABLE_ROWS.forEach((row) => {
    const line = el('tr', {}, el('th', { class: 'final', text: row.final.replace(/^v/, 'ü') }));
    line.append(el('td', {}, row.alone ? syllableButton(row.alone) : null));
    SYLLABLE_INITIALS.forEach((initial) => {
      const syllable = row.cells[initial];
      line.append(el('td', {}, syllable ? syllableButton(syllable) : null));
    });
    body.append(line);
  });
  table.append(body);

  fill('syllable-table', table);
  bindHorizontalWheel(document.getElementById('syllable-table'));

  fill('syllable-hint', [
    el('div', { class: 'syllable-legend' }, [
      el('span', {}, [el('i', { class: 'learned' }), 'изучен']),
      el('span', {}, [el('i', { class: 'work' }), 'начат или с ошибками']),
      el('span', {}, [el('i', {}), 'ещё не трогал']),
    ]),
    el('p', { class: 'faint center', style: 'margin-top:12px',
      text: 'Таблица шире экрана — её можно тянуть вбок. Пустая клетка значит, что такого слога в языке нет.' }),
  ]);
}

/**
 * Колесо мыши над таблицей листает её вбок — иначе на компьютере широкую сетку
 * приходится таскать ползунком. Пока курсор внутри таблицы, страница не едет даже на краю:
 * так прокрутка не «проваливается» вниз в самый неудобный момент (просьба владельца).
 * Движение сглаживаем сами: браузерный smooth-scroll на частых событиях колеса дёргается.
 */
const WHEEL_EASING = 0.18;          // доля пути за кадр: больше — резче

function bindHorizontalWheel(node) {
  if (!node || node.dataset.wheelBound) return;
  node.dataset.wheelBound = 'yes';

  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let target = node.scrollLeft;
  let animating = false;

  const step = () => {
    const distance = target - node.scrollLeft;
    if (Math.abs(distance) < 0.5) {
      node.scrollLeft = target;
      animating = false;
      return;
    }
    node.scrollLeft += distance * WHEEL_EASING;
    requestAnimationFrame(step);
  };

  // ползунок и палец двигают таблицу сами — держим цель в согласии с реальным положением
  node.addEventListener('scroll', () => { if (!animating) target = node.scrollLeft; });

  node.addEventListener('wheel', (event) => {
    if (!event.deltaY || event.shiftKey) return;
    const limit = node.scrollWidth - node.clientWidth;
    if (limit <= 0) return;
    event.preventDefault();
    target = Math.max(0, Math.min(limit, target + event.deltaY));
    if (!smooth) { node.scrollLeft = target; return; }
    if (!animating) {
      animating = true;
      requestAnimationFrame(step);
    }
  }, { passive: false });
}

/** Слог с тоном — ровно так, как он звучит в записи. Без записи вернём как есть. */
function syllableWithTone(syllable) {
  const clip = speech.syllableClip(syllable);
  return clip && clip.s ? clip.s : syllable;
}

/**
 * Знак, который звучит ровно этим слогом с этим тоном — чтобы попутно запоминалось слово.
 * Ищем среди уже описанных знаков: у них есть и чтение, и перевод.
 */
function syllableExample(syllable) {
  const spoken = syllableWithTone(syllable);
  const clip = speech.syllableClip(syllable);
  // если запись сделана с конкретного знака, он и есть лучший пример
  if (clip && clip.c && state.charDict.has(clip.c)) {
    return Object.assign({ character: clip.c, sameTone: true }, state.charDict.get(clip.c));
  }

  // Только точное совпадение вместе с тоном: слово с другим тоном создало бы неверную
  // ассоциацию, а это хуже, чем отсутствие примера (решение владельца 15.08.2026).
  for (const [character, info] of state.charDict) {
    if (info.pinyin === spoken) return Object.assign({ character, sameTone: true }, info);
  }
  return null;
}

/**
 * Слово из словаря, где этот слог звучит в живой речи. Изолированный слог синтез
 * произносит хуже, чем внутри слова, — поэтому даём возможность послушать «в контексте».
 */
function syllableInWord(syllable) {
  const spoken = syllableWithTone(syllable);
  return state.words.find((word) => splitSyllables(word.pinyin)
    .some((part) => part.toLowerCase() === spoken.toLowerCase()) && speech.hasClip(word.hanzi)) || null;
}

/** Подпись тона словами: «2-й — восходящий». Для нейтрального — «без тона». */
function toneName(syllable) {
  const tone = syllableTone(syllableWithTone(syllable));
  const label = TONE_LABELS.find((item) => item.tone === tone);
  if (!label) return '';
  return tone === 5 ? 'нейтральный тон' : label.title.replace('-й — ', '-й тон, ');
}

/** Кнопка «послушать в слове»: в живой речи слог звучит чётче, чем сам по себе. */
function syllableInWordButton(syllable) {
  const word = syllableInWord(syllable);
  if (!word) return null;
  return el('button', {
    class: 'btn btn-quiet btn-small', type: 'button', style: 'margin-top:8px',
    onclick: () => speech.speak(word.hanzi),
  }, iconLabel('sound', `в слове ${word.hanzi} — ${word.translation}`));
}

/** Строчка «это слово: 妈 — мама» под ответом. Если знака нет — ничего не рисуем. */
function syllableExampleLine(syllable) {
  const example = syllableExample(syllable);
  if (!example) return null;
  return el('p', { class: 'faint syllable-example' }, [
    'такое слово: ',
    el('b', { class: 'hanzi', text: example.character }),
    ` ${example.pinyin} — ${example.translation}`,
  ]);
}

function syllableButton(syllable) {
  const status = syllableStatus(syllable);
  const mark = { learned: ' изучен', work: ' в работе', new: '' }[status];
  return el('button', {
    class: `syllable-cell${status === 'learned' ? ' is-learned' : ''}${status === 'work' ? ' is-work' : ''}`,
    type: 'button', 'data-syllable': syllable, 'aria-label': `${syllable}${mark}`,
    onclick: () => openSyllableCard(syllable),
  }, syllable);
}

/** Карточка слога: звук, русское приближение и разбор по частям. */
function openSyllableCard(syllable) {
  speech.speakSyllable(syllable);
  const { initial, final } = syllableParts(syllable);
  const clip = speech.syllableClip(syllable);
  const initialHint = INITIAL_HINTS[initial];
  const finalHint = FINAL_HINTS[final] || {};

  const children = [
    el('div', { class: 'sheet-syllable', id: 'char-sheet-title', text: syllable }),
    el('div', { class: 'card-pinyin', text: `примерно по-русски: ${syllableInRussian(syllable)}` }),
    el('div', { class: 'row center', style: 'margin:12px 0' }, [
      el('button', {
        class: 'btn', type: 'button', disabled: !clip,
        onclick: () => speech.speakSyllable(syllable),
      }, iconLabel('sound', 'Послушать')),
    ]),
  ];

  // Слоги, которых нет в первом тоне, озвучены своим — иначе синтез их коверкает
  if (clip && clip.c) {
    children.push(el('p', { class: 'faint center',
      text: `записано голосом на знаке ${clip.c} (${clip.s})` }));
  } else if (clip && syllableTone(clip.s) !== 1) {
    children.push(el('p', { class: 'faint center',
      text: `в первом тоне такого слога нет — звучит как ${clip.s}` }));
  }

  const inWord = syllableInWord(syllable);
  if (inWord) {
    children.push(el('div', { class: 'row center', style: 'margin:8px 0' },
      el('button', {
        class: 'btn btn-quiet btn-small', type: 'button',
        onclick: () => speech.speak(inWord.hanzi),
      }, iconLabel('sound', `в слове ${inWord.hanzi} — ${inWord.translation}`))));
  }

  const example = syllableExample(syllable);
  if (example) {
    children.push(el('p', { class: 'faint syllable-example' }, [
      'такое слово: ',
      el('b', { class: 'hanzi', text: example.character }),
      ` ${example.pinyin} — ${example.translation}`,
    ]));
  }

  const progress = state.syllableProgress.get(syllable);
  if (progress) {
    children.push(el('p', { class: 'faint center', text: progress.learned
      ? `Изучен · верно ${progress.right}, ошибок ${progress.wrong}`
      : `Верных подряд: ${progress.streak} из ${SYLLABLE_STREAK_TO_LEARN}`
        + (progress.wrong ? ` · ошибок ${progress.wrong}` : '') }));
  }

  if (initialHint) {
    children.push(el('div', { class: 'card' }, [
      el('b', { text: `Начало: ${initial}` }),
      el('p', { class: 'faint', text: initialHint.note }),
    ]));
  }
  children.push(el('div', { class: 'card' }, [
    el('b', { text: `Конец: ${final.replace(/^v/, 'ü')}` }),
    el('p', { class: 'faint', text: finalHint.note || `Звучит как «${finalHint.ru || final}».` }),
  ]));

  const examples = state.words.filter((word) => {
    const first = splitSyllables(word.pinyin)[0];
    return first && pinyinLetters(first) === syllable;
  }).slice(0, 4);
  if (examples.length) {
    children.push(el('h3', { text: 'Слова с этим слогом' }));
    children.push(el('div', { class: 'stack' }, examples.map((word) => el('button', {
      class: 'lesson-row', type: 'button', onclick: () => { speech.speak(word.hanzi); },
    }, [
      el('span', { class: 'hanzi', style: 'font-size:26px', text: word.hanzi }),
      el('span', { class: 'lesson-title' }, [
        el('div', { text: word.pinyin }),
        el('div', { class: 'faint', text: word.translation }),
      ]),
    ]))));
  }

  children.push(el('div', { class: 'row center', style: 'margin-top:14px' },
    el('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: closeCharSheet }, 'Закрыть')));

  fill('char-sheet-body', children);
  document.getElementById('char-sheet').classList.add('is-open');
}

/* ——— Тренировка «слушай и пиши» ——— */

const SYLLABLE_DRILL_SIZE = 10;

export function renderDrillList() {
  const ready = Boolean(speech.syllables);
  const children = [];

  if (!ready) {
    fill('pinyin-drill-list', el('div', { class: 'card' },
      el('p', { class: 'faint', text: 'Записи слогов не загрузились: обнови страницу.' })));
    return;
  }

  // Уровень сложности общий для всех наборов: сначала узнавать, потом записывать самому
  children.push(el('div', { class: 'row', style: 'margin-bottom:14px' }, [
    el('button', {
      class: 'chip', type: 'button', 'aria-pressed': state.drillHard === false,
      onclick: () => { state.drillHard = false; renderDrillList(); },
    }, 'Выбрать из четырёх'),
    el('button', {
      class: 'chip', type: 'button', 'aria-pressed': state.drillHard === true,
      onclick: () => { state.drillHard = true; renderDrillList(); },
    }, 'Написать самому'),
  ]));

  children.push(el('div', { class: 'card' }, [
    el('b', { text: 'Вся таблица' }),
    el('p', { class: 'faint', text: state.drillHard
      ? 'Десять случайных слогов со всей таблицы: слушаешь и записываешь латиницей.'
      : 'Десять случайных слогов со всей таблицы: слушаешь и выбираешь запись из четырёх похожих.' }),
    el('button', {
      class: 'btn btn-wide', type: 'button',
      onclick: () => startSyllableDrill({ kind: 'all', title: 'Вся таблица' }),
    }, 'Начать'),
  ]));

  // Разбор по строкам и столбцам таблицы — так слоги вспоминаются группами, а не вразнобой
  const due = syllablesDueToday();
  if (due.length) {
    children.push(el('div', { class: 'card' }, [
      el('b', { text: 'Повторить сегодня' }),
      el('p', { class: 'faint', text: `Слоги, засчитанные раньше, вернулись на проверку: ${due.length}. `
        + 'Так «пройдено» остаётся правдой, а не разовым успехом.' }),
      el('button', {
        class: 'btn btn-wide', type: 'button',
        onclick: () => startSyllableDrill({ kind: 'due', title: 'Повторение' }),
      }, 'Повторить'),
    ]));
  }

  const summary = syllableSummary();
  if (summary.fresh) {
    children.push(el('div', { class: 'card' }, [
      el('b', { text: 'Ещё ни разу не слышал' }),
      el('p', { class: 'faint', text: `Слоги, которые тебе ещё не попадались: ${summary.fresh}.` }),
      el('button', {
        class: 'btn btn-wide', type: 'button',
        onclick: () => startSyllableDrill({ kind: 'fresh', title: 'Новые слоги' }),
      }, 'Взять новые'),
    ]));
  }
  if (summary.work) {
    children.push(el('div', { class: 'card' }, [
      el('b', { text: 'Начатые — добить до трёх' }),
      el('p', { class: 'faint', text: `Слоги, где цепочка уже идёт, но трёх верных подряд ещё нет: ${summary.work}.` }),
      el('button', {
        class: 'btn btn-wide btn-quiet', type: 'button',
        onclick: () => startSyllableDrill({ kind: 'started', title: 'Начатые слоги' }),
      }, 'Закрепить'),
    ]));
  }

  const trouble = troubleSyllables();
  if (trouble.length) {
    children.push(el('div', { class: 'card' }, [
      el('b', { text: 'Мои ошибки' }),
      el('p', { class: 'faint', text: `Слоги, где ты сбивался: ${trouble.slice(0, 8).join(', ')}`
        + (trouble.length > 8 ? ` и ещё ${trouble.length - 8}` : '') }),
      el('button', {
        class: 'btn btn-wide btn-quiet', type: 'button',
        onclick: () => startSyllableDrill({ kind: 'trouble', title: 'Мои ошибки' }),
      }, 'Прогнать ошибки'),
    ]));
  }

  children.push(el('h3', { text: 'Одна строка таблицы' }));
  children.push(el('p', { class: 'faint', text: 'Все слоги с одинаковым концом — слышно, чем отличаются начала.' }));
  children.push(el('div', { class: 'chip-scroll' }, SYLLABLE_ROWS.map((row) => el('button', {
    class: 'chip', type: 'button',
    onclick: () => startSyllableDrill({ kind: 'final', key: row.final, title: `Конец −${row.final.replace(/^v/, 'ü')}` }),
  }, `−${row.final.replace(/^v/, 'ü')}`))));

  children.push(el('h3', { text: 'Один столбец таблицы' }));
  children.push(el('p', { class: 'faint', text: 'Все слоги с одинаковым началом — слышно, как меняются концы.' }));
  children.push(el('div', { class: 'chip-scroll' }, SYLLABLE_INITIALS.map((initial) => el('button', {
    class: 'chip', type: 'button',
    onclick: () => startSyllableDrill({ kind: 'initial', key: initial, title: `Начало ${initial}−` }),
  }, `${initial}−`))));

  children.push(el('h3', { text: 'Трудные пары' }));
  SYLLABLE_TRAPS.forEach((trap) => {
    children.push(el('div', { class: 'card' }, [
      el('b', { text: trap.title }),
      el('p', { class: 'faint', text: trap.note }),
      el('button', {
        class: 'btn btn-wide btn-quiet', type: 'button',
        onclick: () => startSyllableDrill({ kind: 'trap', trap, title: trap.title }),
      }, 'Только эти слоги'),
    ]));
  });

  fill('pinyin-drill-list', children);
}

/** Набор слогов для тренировки: вся таблица, одна строка, один столбец или трудная пара. */
function drillPool(scope) {
  const all = Object.keys(speech.syllables || {});
  if (!scope || scope.kind === 'all') return all;

  // «Новые» — те, что ни разу не звучали; «начатые» — с недобранной цепочкой.
  if (scope.kind === 'fresh') return all.filter((syllable) => syllableStatus(syllable) === 'new');
  if (scope.kind === 'started') {
    return all.filter((syllable) => syllableStatus(syllable) === 'work')
      .sort((left, right) => (state.syllableProgress.get(right).streak || 0)
        - (state.syllableProgress.get(left).streak || 0));   // ближе к трём — раньше
  }
  if (scope.kind === 'trouble') return troubleSyllables();
  if (scope.kind === 'due') return syllablesDueToday();

  if (scope.kind === 'final') {
    const row = SYLLABLE_ROWS.find((item) => item.final === scope.key);
    if (!row) return all;
    return [row.alone, ...Object.values(row.cells)].filter(Boolean);
  }
  if (scope.kind === 'initial') {
    return SYLLABLE_ROWS.map((row) => row.cells[scope.key]).filter(Boolean);
  }
  const wanted = scope.trap.pairs.flat();
  return all.filter((syllable) => {
    const { initial, final } = syllableParts(syllable);
    return wanted.includes(initial) || wanted.includes(final);
  });
}

export async function startSyllableDrill(scope) {
  const pool = drillPool(scope);
  if (!pool.length) return;

  state.drillRun += 1;
  await setSetting('drillRun', state.drillRun);

  // «Новые» идут по порядку таблицы — так первый круг покрывает её целиком, без скачков
  const ordered = scope.kind === 'fresh' || scope.kind === 'started'
    || scope.kind === 'trouble' || scope.kind === 'due';
  const queue = pickDrillQueue(pool, SYLLABLE_DRILL_SIZE, ordered);
  if (!queue.length) return;

  state.syllableDrill = {
    queue, position: 0, right: 0, wrong: [],
    title: scope.title, hard: state.drillHard, pool, options: [],
    teacherDay: scope.teacherDay || null,   // набор запущен днём программы — вернём туда
    scope,                                  // чем запускали — по нему кнопка «Заново»
  };
  await markSyllableShown(queue);
  if (!state.drillHard) buildSyllableOptions();
  showScreen('syllable-drill');
  renderSyllableDrill();
}

/** Кнопка возврата ведёт туда, откуда набор запущен: из дня программы — обратно в день,
    а не в общий раздел слогов (жалоба владельца 25.08.2026: «зачем я перехожу к слогам»). */
function syncSyllableBack(run) {
  const day = run && run.teacherDay;
  state.cameFrom['syllable-drill'] = day ? { screen: 'teacher-day', day } : { screen: 'pinyin' };
  syncBackButton('syllable-back', 'syllable-drill', '← К слогам', 'pinyin');
}

/** Выход из прогона — туда же, куда ведёт кнопка «назад»: клавиша Esc уводила в общий
    раздел слогов даже из дня программы, мимо этой самой логики (аудит 03.09.2026). */
function exitSyllableDrill() {
  const run = state.syllableDrill;
  goBack('syllable-drill', 'pinyin');
  if (run) run.finished = true;
}

/** Прогнать набор заново: слоги подбираются снова, порядок другой. */
export function restartSyllableDrill() {
  const run = state.syllableDrill;
  if (run && run.scope) startSyllableDrill(run.scope);
}

/** Варианты ответа берём похожие: те же начало или конец, иначе слог виден без звука. */
function buildSyllableOptions() {
  const run = state.syllableDrill;
  const answer = run.queue[run.position];
  const { initial, final } = syllableParts(answer);
  const all = Object.keys(speech.syllables || {});

  // Похожесть — это общий конец либо общее начало. Отсутствие начала (a, yi, wo)
  // общим признаком не считаем: иначе в варианты лезут слоги, ничем не близкие на слух.
  const near = all.filter((syllable) => {
    if (syllable === answer) return false;
    const parts = syllableParts(syllable);
    if (parts.final === final) return true;
    return Boolean(initial) && parts.initial === initial;
  });
  const options = [answer];
  const source = shuffle(near.length >= 3 ? near : all.filter((item) => item !== answer));
  source.forEach((syllable) => { if (options.length < 4) options.push(syllable); });
  run.options = shuffle(options);
}

function renderSyllableDrill(feedback) {
  const run = state.syllableDrill;
  if (!run) return;

  if (run.position >= run.queue.length) {
    syncSyllableBack(run);
    const children = [
      el('div', { class: 'card center' }, [
        el('div', { class: 'today-count' }, [`Верно `, el('b', { text: String(run.right) }),
          ` из ${run.queue.length}`]),
        el('p', { class: 'faint', text: run.wrong.length
          ? `Ошибся: ${run.wrong.join(', ')} — эти слоги стоит послушать ещё раз.`
          : 'Все слоги записаны верно.' }),
        run.teacherDay && run.wrong.length
          ? el('p', { class: 'faint', text: 'Шаг дня закроется, когда пройдёшь без ошибок.' })
          : null,
        el('p', { class: 'faint', text: (() => {
          const summary = syllableSummary();
          return `Засчитано слогов: ${summary.learned} из ${summary.total}.`;
        })() }),
        run.wrong.length ? el('button', {
          class: 'btn btn-wide', type: 'button', onclick: () => repeatWrongSyllables(),
        }, 'Прогнать ошибки') : null,
        run.teacherDay && !run.wrong.length ? el('button', {
          class: 'btn btn-wide', type: 'button', onclick: () => {
            const day = run.teacherDay;
            state.syllableDrill = null;
            markTeacherStep(day, 'listen');
            state.teacherDay = day;
            showScreen('teacher-day');
            renderTeacherDay();
          },
        }, 'К программе дня') : null,
        el('button', { class: 'btn btn-quiet btn-wide', type: 'button',
          onclick: () => {
            const day = run.teacherDay;
            if (!day) { showScreen('pinyin'); return; }
            state.teacherDay = day;
            showScreen('teacher-day');
            renderTeacherDay();
          },
        }, run.teacherDay ? 'К программе дня' : 'К слогам'),
      ]),
    ];
    fill('syllable-drill-body', children);
    return;
  }

  const syllable = run.queue[run.position];
  document.getElementById('syllable-drill-heading').textContent = run.title;
  syncSyllableBack(run);

  const card = [
    el('button', {
      class: 'btn btn-round', type: 'button', 'aria-label': 'Повторить звук',
      onclick: () => speech.speakSyllable(syllable),
    }, uiIcon('sound', 20)),
    feedback ? el('div', { class: 'sheet-syllable', text: syllableWithTone(syllable) }) : null,
    feedback ? el('p', { class: 'faint',
      text: [`примерно по-русски: ${syllableInRussian(syllable)}`, toneName(syllable)]
        .filter(Boolean).join(' · ') }) : null,
    feedback ? syllableExampleLine(syllable) : null,
    feedback ? syllableInWordButton(syllable) : null,
  ];

  if (run.hard) {
    card.push(el('input', {
      type: 'text', id: 'syllable-answer', autocomplete: 'off', autocapitalize: 'off',
      autocorrect: 'off', spellcheck: 'false', placeholder: 'запиши слог латиницей',
      'aria-label': 'Ответ', value: feedback ? feedback.answer : '',
      disabled: Boolean(feedback),
    }));
  }

  const children = [
    el('p', { class: 'faint center', text: `${run.position + 1} из ${run.queue.length}` }),
    el('div', { class: `card center${feedback ? (feedback.verdict === 'ok' ? ' is-ok' : ' is-err') : ''}` }, card),
  ];

  if (!run.hard) {
    children.push(el('div', { class: 'options' }, run.options.map((option, index) => {
      const chosen = feedback && feedback.answer === option;
      const right = feedback && option === syllable;
      return el('button', {
        class: `option${right ? ' is-ok' : ''}${chosen && !right ? ' is-err' : ''}`,
        type: 'button', disabled: Boolean(feedback),
        onclick: () => checkSyllableAnswer(syllable, false, option),
      }, [
        el('span', { class: 'option-key', text: String(index + 1) }),
        el('span', { text: syllableWithTone(option) }),
      ]);
    })));
  }

  if (feedback) {
    children.push(el('p', { class: 'verdict', role: 'status', 'aria-live': 'polite',
      text: feedback.verdict === 'ok' ? 'Верно' : `Нет, это ${syllableWithTone(syllable)}` }));
    children.push(el('div', { class: 'center' }, el('button', {
      class: 'btn btn-wide', type: 'button', onclick: () => {
        run.position += 1;
        if (!run.hard && run.position < run.queue.length) buildSyllableOptions();
        renderSyllableDrill();
      },
    }, 'Дальше')));
  } else {
    children.push(el('div', { class: 'center' }, [
      run.hard ? el('button', { class: 'btn btn-wide', type: 'button',
        onclick: () => checkSyllableAnswer(syllable) }, 'Проверить') : null,
      el('button', { class: 'btn btn-quiet btn-wide', type: 'button',
        onclick: () => checkSyllableAnswer(syllable, true) }, 'Не знаю'),
    ]));
  }

  fill('syllable-drill-body', children);
  if (feedback) {
    // после ответа кнопка «Дальше» может оказаться под нижним меню — подводим её к глазам
    const next = [...document.querySelectorAll('#syllable-drill-body button')]
      .find((button) => button.textContent.trim() === 'Дальше');
    if (next) next.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  if (!feedback) {
    if (run.hard) {
      const field = document.getElementById('syllable-answer');
      field.focus();
      field.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') checkSyllableAnswer(syllable);
      });
    }
    speech.speakSyllable(syllable);
  }
}

/** Клавиатура в тренировке слогов: цифры выбирают вариант, S повторяет звук, Esc выходит. */
export function handleSyllableKey(event) {
  const run = state.syllableDrill;
  if (!run) return;
  const typing = event.target && event.target.tagName === 'INPUT';

  if (event.key === 'Escape') { exitSyllableDrill(); return; }
  if (event.key === 's' || event.key === 'S' || event.key === 'ы' || event.key === 'Ы') {
    if (!typing) speech.speakSyllable(run.queue[run.position]);
    return;
  }
  if (typing) return;

  const next = [...document.querySelectorAll('#syllable-drill-body button')]
    .find((button) => button.textContent.trim() === 'Дальше');
  if (event.key === 'Enter' && next) { next.click(); return; }
  // Только пока ответа нет: иначе «0» после верного ответа обнулял уже засчитанный слог
  // и три верных подряд приходилось набирать заново (аудит 03.09.2026).
  if (event.key === '0' && !next) { checkSyllableAnswer(run.queue[run.position], true); return; }

  const digit = Number(event.key);
  if (!run.hard && digit >= 1 && digit <= run.options.length && !next) {
    checkSyllableAnswer(run.queue[run.position], false, run.options[digit - 1]);
  }
}

/** Ошибки прогоняются тем же набором — так слог закрепляется сразу, а не «когда-нибудь». */
function repeatWrongSyllables() {
  const run = state.syllableDrill;
  // Разбор ошибок сразу после набора — исключение: тут повтор как раз нужен.
  // teacherDay и scope переносим: без них прогон терял связь с днём программы,
  // и кнопка возврата уводила в общий раздел слогов (владелец, 25.08.2026).
  state.syllableDrill = {
    queue: shuffle(run.wrong.slice()), position: 0, right: 0, wrong: [],
    title: run.title, hard: run.hard, pool: run.pool, options: [],
    teacherDay: run.teacherDay || null, scope: run.scope || null,
  };
  if (!run.hard) buildSyllableOptions();
  renderSyllableDrill();
}

function checkSyllableAnswer(syllable, giveUp, option) {
  const run = state.syllableDrill;
  let answer = '';
  if (!giveUp) {
    if (run.hard) {
      const field = document.getElementById('syllable-answer');
      answer = field ? field.value : '';
    } else {
      answer = option || '';
    }
  }
  // сравниваем звучание: тон в этой тренировке не спрашивается, ü можно записать как v
  const normalized = run.hard ? pinyinLetters(answer) : answer;
  const verdict = !giveUp && normalized === syllable ? 'ok' : 'wrong';
  if (verdict === 'ok') run.right += 1;
  else if (!run.wrong.includes(syllable)) run.wrong.push(syllable);
  noteSyllableAnswer(syllable, verdict === 'ok').catch(() => {
    toast('Не удалось сохранить прогресс по слогу.', true);
  });
  renderSyllableDrill({ verdict, answer });
}
