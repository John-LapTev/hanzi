import { state } from './state.js';

/* ═══════════════════ STROKES — порядок черт ═══════════════════
   Данные лежат отдельным файлом (data/strokes.json, 232 знака): для каждой черты —
   её контур и средняя линия, по которой ведёт кисть. Источник — hanzi-writer-data
   (ARPHIC PUBLIC LICENSE, см. data/LICENSE-strokes.txt). Анимация своя, библиотек нет.

   Система координат данных: 1024×1024, ось Y направлена вверх, глиф лежит от -124 до 900.
   Поэтому группа переворачивается: translate(0, 900) scale(1, -1).                        */

const STROKES_URL = 'data/strokes.json';
const STROKE_VIEWBOX = 1024;
const STROKE_TRANSFORM = 'translate(0, 900) scale(1, -1)';
const STROKE_BRUSH_WIDTH = 128;
const STROKE_SPEED = 0.9;          // миллисекунд на единицу длины черты при обычной скорости

/* Скорость показа черт — плавная, а не ступенчатая: насколько сдвинул ползунок, настолько
   и быстрее (просьба владельца). 1 — обычный темп, больше — быстрее, меньше — медленнее.
   Ползунок ходит от −1 до 1, а скорость растёт по степени: так обычная скорость приходится
   ровно на середину, а края дают трёхкратное замедление и ускорение. */
const STROKE_SPEED_RANGE = 3;
export const STROKE_SPEED_DEFAULT = 1;
export const STROKE_SPEED_MIN = 1 / STROKE_SPEED_RANGE;
export const STROKE_SPEED_MAX = STROKE_SPEED_RANGE;

export const speedToSlider = (speed) => Math.log(speed) / Math.log(STROKE_SPEED_RANGE);
export const sliderToSpeed = (position) => STROKE_SPEED_RANGE ** position;

/** Подпись к текущему положению ползунка — понятная, без множителей и процентов. */
export function strokeSpeedTitle(speed) {
  if (speed < 0.55) return 'совсем медленно';
  if (speed < 0.9) return 'медленно';
  if (speed <= 1.15) return 'обычно';
  if (speed <= 1.9) return 'быстро';
  return 'очень быстро';
}
const STROKE_PAUSE_MS = 220;       // пауза между чертами
const SVG_NS = 'http://www.w3.org/2000/svg';

const strokeStore = { data: null, loading: null };

/** Данные грузятся один раз и только когда открыли раздел — полмегабайта на старте ни к чему. */
export function loadStrokeData() {
  if (strokeStore.data) return Promise.resolve(strokeStore.data);
  // В версии «одним файлом» (tools/build-standalone.py) прописи вшиты прямо в страницу:
  // по file:// браузер запрещает читать соседние файлы, а посмотреть приложение надо.
  if (window.HANZI_STROKES_INLINE) {
    strokeStore.data = window.HANZI_STROKES_INLINE;
    return Promise.resolve(strokeStore.data);
  }
  if (!strokeStore.loading) {
    strokeStore.loading = fetch(STROKES_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`не удалось прочитать ${STROKES_URL}`);
        return response.json();
      })
      .then((data) => { strokeStore.data = data; return data; })
      .catch((error) => { strokeStore.loading = null; throw error; });
  }
  return strokeStore.loading;
}

export const svgEl = (tag, attributes) => {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
};

const medianToPath = (median) => median.map((point, index) =>
  `${index === 0 ? 'M' : 'L'} ${point[0]} ${point[1]}`).join(' ');

/**
 * Рисует знак и возвращает управление анимацией.
 * Приём тот же, что у прописей: контур черты работает маской, а внутри неё
 * «едет» толстая линия по средней — получается ощущение движения кисти.
 */
export function createStrokeStage(character, entry) {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${STROKE_VIEWBOX} ${STROKE_VIEWBOX}`,
    role: 'img',
    'aria-label': `Порядок черт знака ${character}`,
  });

  // Разлиновка, как в тетради для иероглифов
  const guides = svgEl('g', { class: 'stroke-grid-lines' });
  const half = STROKE_VIEWBOX / 2;
  guides.append(
    svgEl('line', { x1: half, y1: 0, x2: half, y2: STROKE_VIEWBOX }),
    svgEl('line', { x1: 0, y1: half, x2: STROKE_VIEWBOX, y2: half }),
  );
  svg.append(svgEl('rect', { class: 'stroke-frame', x: 1, y: 1, width: STROKE_VIEWBOX - 2, height: STROKE_VIEWBOX - 2, rx: 24 }), guides);

  const glyph = svgEl('g', { transform: STROKE_TRANSFORM });
  svg.append(glyph);

  const defs = svgEl('defs', {});
  glyph.append(defs);

  const strokes = entry.s.map((path, index) => {
    const ghost = svgEl('path', { class: 'stroke-ghost', d: path });
    const clipId = `stroke-clip-${index}`;
    const clip = svgEl('clipPath', { id: clipId });
    clip.append(svgEl('path', { d: path }));
    defs.append(clip);

    const brushGroup = svgEl('g', { 'clip-path': `url(#${clipId})` });
    const brush = svgEl('path', {
      class: 'stroke-live',
      d: medianToPath(entry.m[index]),
      'stroke-width': STROKE_BRUSH_WIDTH,
    });
    brushGroup.append(brush);

    const filled = svgEl('path', { class: 'stroke-done', d: path, opacity: 0 });
    glyph.append(ghost, brushGroup, filled);
    return { brush, filled };
  });

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const resetStroke = ({ brush, filled }) => {
    const length = brush.getTotalLength() + STROKE_BRUSH_WIDTH;
    brush.style.transition = 'none';
    brush.style.strokeDasharray = String(length);
    brush.style.strokeDashoffset = String(length);
    brush.style.opacity = '1';
    filled.setAttribute('opacity', '0');
    return length;
  };

  /* isStale говорит, что показ уже перезапустили. Без этой проверки отложенный шаг
     дорисовывал свою черту уже на новом, чистом знаке — она оставалась висеть. */
  const drawStroke = (stroke, isStale) => new Promise((resolve) => {
    const length = resetStroke(stroke);
    const speed = state.strokeSpeed || STROKE_SPEED_DEFAULT;
    const duration = reduceMotion ? 0 : Math.max(120, (length * STROKE_SPEED) / speed);
    // Даём браузеру применить исходное состояние, иначе перехода не будет
    requestAnimationFrame(() => {
      // Прерванную черту не гасим: показ мог встать на паузу, и тогда её надо оставить
      // на экране целиком. Убирает лишнее следующий запуск — он начинается с showUpTo.
      if (isStale && isStale()) { resolve(); return; }
      stroke.brush.style.transition = `stroke-dashoffset ${duration}ms linear`;
      stroke.brush.style.strokeDashoffset = '0';
      setTimeout(() => {
        if (isStale && isStale()) { resolve(); return; }
        stroke.filled.setAttribute('opacity', '1');
        stroke.brush.style.opacity = '0';
        resolve();
      }, duration);
    });
  });

  let runToken = 0;

  const showUpTo = (count) => {
    strokes.forEach((stroke, index) => {
      resetStroke(stroke);
      if (index < count) {
        stroke.brush.style.opacity = '0';
        stroke.filled.setAttribute('opacity', '1');
      }
    });
  };

  return {
    svg,
    total: strokes.length,
    /** Проигрывает знак с черты `from`; onStep получает номер текущей черты.
        Возвращает true, если дошёл до конца, и false, если показ прервали. */
    async play(onStep, from = 0) {
      const token = ++runToken;
      showUpTo(from);
      for (let index = from; index < strokes.length; index += 1) {
        if (token !== runToken) return false;
        if (onStep) onStep(index + 1);
        await drawStroke(strokes[index], () => token !== runToken);
        if (token !== runToken) return false;
        await new Promise((resolve) => setTimeout(resolve, STROKE_PAUSE_MS));
      }
      return true;
    },

    /** Останавливает показ и оставляет на экране столько черт, сколько успели нарисовать —
        включая ту, что рисовалась в этот момент: иначе она пропадала, а при продолжении
        выскакивала разом (замечание владельца 17.08.2026). */
    pause(shown) {
      runToken += 1;
      showUpTo(shown);
    },
    /** Показывает первые count черт мгновенно — для режима «по шагам». */
    showSteps(count) {
      runToken += 1;   // прерываем автопоказ, если он идёт
      showUpTo(count);
    },
  };
}
