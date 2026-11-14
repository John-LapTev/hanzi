import { setSetting } from '../core/db.js';
import { speech } from '../core/speech.js';
import { state } from '../core/state.js';
import { createStrokeStage, loadStrokeData, sliderToSpeed, speedToSlider, strokeSpeedTitle, svgEl } from '../core/strokes.js';
import { TEACHER_DAYS } from '../data/teacher-days.js';
import { el, fill, toast } from './dom.js';
import { iconLabel, uiIcon } from './icons.js';
import { showScreen } from './screens.js';
import { lookupCharacter } from './sentence.js';
import { toggleStrokeWritten } from './strokes-screen.js';
import { markTeacherStep, plural, teacherDay, teacherStepDone } from './teacher-course.js';

/* ——— Прописи занятия ———
   Отдельный экран внутри программы: в нижней панели его нет, попасть можно только из дня.
   Показывает знаки этого занятия, а прошлые дни — свёрнутыми полосками, чтобы вернуться
   к ним было можно, но они не мешали. Отметки «прописал» общие с разделом «Написание». */

export function teacherDayCharacters(entry) {
  const seen = new Set();
  (entry.words || []).forEach((hanzi) => {
    Array.from(hanzi).forEach((character) => {
      if (/[一-龥]/.test(character)) seen.add(character);
    });
  });
  return Array.from(seen);
}

/** Сетка знаков с отметками — та же, что в разделе «Написание». */
function strokeGrid(characters, data) {
  return el('div', { class: 'stroke-grid' }, characters.map((character) => {
    const written = state.strokesWritten.has(character);
    const known = Boolean(data[character]);
    return el('div', { class: 'stroke-slot' }, [
      el('button', {
        class: 'stroke-cell hanzi', type: 'button',
        onclick: () => (known ? openStrokeViewer(character) : toast('Для этого знака нет прописей.', true)),
      }, character),
      el('button', {
        class: `stroke-mark${written ? ' is-written' : ''}`, type: 'button',
        'aria-pressed': written,
        'aria-label': written ? `${character}: снять отметку` : `${character}: отметить как прописанный`,
        title: written ? 'Прописан от руки — нажми, чтобы снять' : 'Отметить, что прописал в тетради',
        onclick: (event) => { event.stopPropagation(); toggleStrokeWritten(character); },
      }, written ? uiIcon('check', 13) : null),
    ]);
  }));
}

export async function renderTeacherStrokes() {
  const entry = teacherDay(state.teacherDay);
  const body = document.getElementById('teacher-strokes-body');
  if (!entry) { showScreen('teacher'); return; }
  document.getElementById('teacher-strokes-heading').textContent = `День ${entry.day} · прописи`;
  fill(body, el('p', { class: 'faint', text: 'Открываю прописи…' }));

  let data;
  try {
    data = await loadStrokeData();
  } catch (error) {
    fill(body, el('div', { class: 'card' }, [
      el('b', { text: 'Не удалось открыть прописи' }),
      el('p', { class: 'faint', text: `${error.message}. Проверь, что приложение запущено через tools/serve.sh.` }),
    ]));
    return;
  }

  const today = teacherDayCharacters(entry);
  const written = today.filter((character) => state.strokesWritten.has(character)).length;
  const done = teacherStepDone(entry.day, 'write');

  const children = [
    el('div', { class: 'card' }, [
      el('div', { class: 'row-between' }, [
        el('div', {}, [
          el('b', { text: 'Правила написания' }),
          el('div', { class: 'faint', text: 'Почему черты идут именно в таком порядке' }),
        ]),
        el('button', { class: 'btn btn-quiet btn-small', type: 'button',
          onclick: () => { state.strokeRulesBack = 'teacher-strokes'; showScreen('stroke-rules'); },
        }, 'Разобраться'),
      ]),
    ]),
    el('p', { class: 'faint', text: `${today.length} ${plural(today.length, 'знак', 'знака', 'знаков')} `
      + `из ${entry.words.length} ${plural(entry.words.length, 'слова', 'слов', 'слов')} этого дня: `
      + 'в слове их бывает два-три, а повторы считаются один раз. Нажми на любой — покажу, как писать. '
      + `Кружок справа — отметка, что прописал в тетради (${written} из ${today.length}).` }),
    strokeGrid(today, data),
  ];

  // Прошлые дни — свёрнутыми полосками: вернуться можно, но под ногами не мешаются
  const earlier = TEACHER_DAYS.filter((item) => item.day < entry.day && (item.words || []).length);
  if (earlier.length) {
    children.push(el('h3', { text: 'Прошлые дни', style: 'margin-top:24px' }));
    earlier.reverse().forEach((item) => {
      const characters = teacherDayCharacters(item);
      const open = state.teacherStrokesOpen === item.day;
      children.push(el('div', { class: 'card', style: 'padding:12px 16px' }, [
        el('button', {
          class: 'day-fold', type: 'button', 'aria-expanded': open,
          onclick: () => {
            state.teacherStrokesOpen = open ? null : item.day;
            renderTeacherStrokes();
          },
        }, [
          el('span', {}, [
            el('b', { text: `День ${item.day}` }),
            el('span', { class: 'faint', text: ` · ${item.title}` }),
          ]),
          el('span', { class: `fold-arrow${open ? ' is-open' : ''}` }, uiIcon('down', 16)),
        ]),
        open ? strokeGrid(characters, data) : null,
      ]));
    });
  }

  const ready = written >= today.length && today.length > 0;
  children.push(el('div', { class: 'center', style: 'margin-top:20px' }, el('button', {
    class: done || !ready ? 'btn btn-quiet btn-wide' : 'btn btn-wide', type: 'button',
    disabled: !done && !ready,
    title: ready ? '' : 'Отметь кружком каждый знак — тогда шаг закроется',
    onclick: async () => {
      await markTeacherStep(entry.day, 'write');
      showScreen('teacher-day');
    },
  }, done ? 'Шаг уже отмечен · вернуться в день'
    : ready ? 'Прописал — вернуться в день'
    : iconLabel('lock', `Отметь все знаки · ${written} из ${today.length}`))));

  fill(body, children);
}

/** Отмечаем, что знак разобран в прописях — от этого зависит доступ к сложным разговорам. */
async function markStrokeSeen(character) {
  if (state.strokesSeen.has(character)) return;
  state.strokesSeen.add(character);
  await setSetting('strokesSeen', Array.from(state.strokesSeen));
}

/**
 * Подпись под знаком в просмотре прописей. Если знака нет в словаре знаков, ищем слово,
 * где он встречается: пустая строка вместо чтения и значения выглядит как поломка
 * (Иван прислал 遍, 03.09.2026).
 */
function characterCaption(character, info) {
  if (info) return `${info.pinyin} — ${info.translation}`;
  const word = state.words
    .filter((item) => item.hanzi.includes(character))
    .sort((first, second) => first.hanzi.length - second.hanzi.length)[0];
  if (word) return `Отдельно этот знак не изучаем — он из слова ${word.hanzi} (${word.pinyin}) — ${word.translation}`;
  return 'Этого знака пока нет в словаре — только пропись.';
}

export async function openStrokeViewer(character) {
  const data = await loadStrokeData();
  const entry = data[character];
  if (!entry) { toast('Для этого знака нет прописей.', true); return; }
  markStrokeSeen(character);

  const stage = createStrokeStage(character, entry);
  const counter = el('span', { class: 'stroke-counter', text: `${stage.total} черт` });
  const info = lookupCharacter(character);
  let step = 0;

  const overlay = document.getElementById('dialog');
  const close = () => {
    // Без остановки показ продолжал крутиться на оторванных от документа узлах
    // ещё десятки секунд на медленной скорости (аудит 03.09.2026)
    stage.pause(step);
    overlay.classList.add('hidden');
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };

  // Шаги по чертам ходят вперёд и назад и упираются в края: цикл сбивал с толку.
  const arrowIcon = (direction) => {
    const svg = svgEl('svg', { class: 'arrow-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    const path = svgEl('path', {
      d: direction === 'back' ? 'M15 5 L8 12 L15 19' : 'M9 5 L16 12 L9 19',
      fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    svg.append(path);
    return svg;
  };
  const backButton = el('button', { class: 'btn btn-quiet btn-small btn-arrow', type: 'button',
    'aria-label': 'Предыдущая черта' }, arrowIcon('back'));
  const forwardButton = el('button', { class: 'btn btn-quiet btn-small btn-arrow', type: 'button',
    'aria-label': 'Следующая черта' }, arrowIcon('forward'));

  const syncSteps = () => {
    backButton.disabled = step <= 0;
    forwardButton.disabled = step >= stage.total;
    counter.textContent = step === 0 ? `${stage.total} черт` : `черта ${step} из ${stage.total}`;
  };

  /* Показ ведёт тот же счётчик шагов — после него можно сразу листать назад.
     Кнопка на время показа становится паузой: остановился, полистал стрелками,
     продолжил с того же места (просьба владельца 17.08.2026).                    */
  let playing = false;
  const playButton = el('button', { class: 'btn btn-small', type: 'button' },
    iconLabel('play', 'Показать'));

  const syncPlayButton = () => {
    fill(playButton, playing ? iconLabel('stop', 'Пауза')
      : iconLabel('play', step > 0 && step < stage.total ? 'Продолжить' : 'Показать'));
  };

  const playAll = async (from = 0) => {
    step = from;
    playing = true;
    syncSteps();
    syncPlayButton();
    const finished = await stage.play((current) => { step = current; syncSteps(); }, from);
    if (finished) {
      playing = false;
      syncPlayButton();
    }
  };

  const pausePlay = () => {
    playing = false;
    stage.pause(step);
    syncSteps();
    syncPlayButton();
  };

  playButton.addEventListener('click', () => {
    if (playing) { pausePlay(); return; }
    // с конца начинаем заново, иначе продолжаем с текущей черты
    playAll(step >= stage.total ? 0 : step);
  });

  const goToStep = (next) => {
    playing = false;                      // ручное листание прерывает показ
    step = Math.min(Math.max(next, 0), stage.total);
    stage.showSteps(step);
    syncSteps();
    syncPlayButton();
  };

  backButton.addEventListener('click', () => goToStep(step - 1));
  forwardButton.addEventListener('click', () => goToStep(step + 1));

  // Скорость — ползунок на всю ширину квадрата: слева подпись, справа текущая ступень.
  const speedValue = el('span', { class: 'faint speed-value', text: strokeSpeedTitle(state.strokeSpeed) });
  const speedInput = el('input', {
    type: 'range', min: '-1', max: '1', step: '0.04',
    value: String(speedToSlider(state.strokeSpeed)), class: 'speed-range',
    'aria-label': 'Скорость показа черт',
  });
  speedInput.addEventListener('input', () => {
    state.strokeSpeed = sliderToSpeed(Number(speedInput.value));
    speedValue.textContent = strokeSpeedTitle(state.strokeSpeed);
  });
  // Двойной щелчок по ползунку возвращает обычную скорость — просьба владельца
  speedInput.addEventListener('dblclick', () => {
    speedInput.value = '0';
    speedInput.dispatchEvent(new Event('input', { bubbles: true }));
    speedInput.dispatchEvent(new Event('change', { bubbles: true }));
  });

  speedInput.addEventListener('change', async () => {
    await setSetting('strokeSpeed', state.strokeSpeed);
    playAll(0);
  });
  const speedBar = el('div', { class: 'speed-bar' }, [
    el('span', { class: 'faint', text: 'Скорость' }),
    speedInput,
    speedValue,
  ]);

  fill('dialog-body', [
    el('div', { class: 'row-between' }, [
      el('b', { id: 'dialog-title', class: 'hanzi', style: 'font-size:28px', text: character }),
      counter,
    ]),
      el('p', { class: 'faint', text: characterCaption(character, info) }),
    el('div', { class: 'stroke-stage' }, stage.svg),
    speedBar,
    el('div', { class: 'stroke-steps' }, [
      backButton,
      el('span', { class: 'faint', text: 'по одной черте' }),
      forwardButton,
    ]),
    el('div', { class: 'row', style: 'justify-content:center;margin-top:14px' }, [
      playButton,
      speech.available
        ? el('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => speech.speak(character) }, uiIcon('sound', 20))
        : null,
      el('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: close }, 'Закрыть'),
    ]),
  ]);
  overlay.classList.remove('hidden');
  document.addEventListener('keydown', onKey, true);
  playAll(0);
}
