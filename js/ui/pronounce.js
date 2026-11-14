import { compareWithReference, pitchTrack, toCurve, toSamples } from '../core/pitch.js';
import { canRecord, startRecording } from '../core/recorder.js';
import { speech } from '../core/speech.js';
import { svgEl } from '../core/strokes.js';
import { compareSound, soundProfile } from '../core/voice-match.js';
import { el, toast } from './dom.js';
import { iconLabel, uiIcon } from './icons.js';

/* ═══════════════════ PRONOUNCE — проверка собственного произношения ═══════════════════
   Две проверки сразу, как и просил владелец: одна слушает мелодию (тон), другая — сами
   звуки (то ли слово сказано). Обе сравнивают запись с образцовой записью этой же фразы
   и работают без всяких моделей: тон — по ходу основной частоты (core/pitch.js), звуки —
   по спектру с выравниванием во времени (core/voice-match.js). Запись никуда не уходит,
   всё считается прямо в браузере.

   Модуль общий для заданий программы и раздела трудных слов: раньше все эти семьдесят
   строк были скопированы в оба экрана, и тексты вердиктов уже успели разойтись
   (аудит 03.09.2026).                                                                  */

/** Раскладывает запись на то, что нужно обеим проверкам: кривую высоты и портрет звучания. */
export async function analyseClip(blob) {
  const samples = await toSamples(blob);
  return { curve: toCurve(pitchTrack(samples)), profile: soundProfile(samples) };
}

export async function analyseUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('запись недоступна');
  return analyseClip(await response.blob());
}

/** Общий вывод по двум проверкам: сначала звуки, потом мелодия — в таком порядке их и чинят. */
function verdictOf(sound, tone) {
  if (sound.ok && tone.ok) return { ok: true, text: 'Похоже на образец — и звуки, и мелодия.' };
  if (sound.ok) return { ok: false, text: 'Звуки на месте, а мелодия разошлась — смотри линии.' };
  if (tone.ok) return { ok: false, text: 'Мелодия верная, а звуки смазались — послушай образец ещё раз.' };
  return { ok: false, text: 'Пока не похоже. Послушай образец и повтори за ним.' };
}

/**
 * Записывает попытку и сравнивает её с образцом. Состояние держит вызывающий экран
 * (у него свой объект задания), поэтому сюда передаётся и объект, и функция перерисовки —
 * так один и тот же разбор работает и в задании программы, и в трудных словах.
 */
export async function recordAttempt(holder, hanzi, rerender) {
  if (!canRecord()) { toast('Этот браузер не даёт доступ к микрофону.', true); return; }
  if (holder.recording || holder.asking) return;   // разрешение уже просим — второй раз не надо
  const referenceUrl = speech.clipUrl(hanzi);
  if (!referenceUrl) { toast('Для этой фразы нет образцовой записи — сравнить не с чем.', true); return; }
  try {
    // Разрешение на микрофон браузер спрашивает у человека, и ответа может не быть долго.
    // Поэтому сначала показываем, что ждём, и только потом начинаем запись.
    holder.asking = true;
    holder.attempt = null;
    rerender();
    const stop = await startRecording();
    holder.asking = false;
    holder.recording = true;
    rerender();
    holder.stopRecording = async () => {
      holder.recording = false;
      holder.checking = true;
      rerender();
      try {
        const blob = await stop();
        const [reference, attempt] = await Promise.all([analyseUrl(referenceUrl), analyseClip(blob)]);
        const sound = compareSound(reference.profile, attempt.profile);
        const tone = compareWithReference(reference.curve, attempt.curve);
        holder.attempt = Object.assign(verdictOf(sound, tone), {
          sound, tone, reference: reference.curve, attempt: attempt.curve,
        });
      } catch (error) {
        holder.attempt = { ok: false, text: 'Не получилось разобрать запись. Попробуй ещё раз.' };
      }
      holder.checking = false;
      rerender();
    };
  } catch (error) {
    holder.asking = false;
    holder.recording = false;
    toast('Микрофон не разрешён — проверить произношение не выйдет.', true);
    rerender();
  }
}

/** Обе проверки по строке: что со звуками и что с мелодией. */
export function attemptDetails(attempt) {
  if (!attempt || !attempt.sound || !attempt.tone) return null;
  const line = (label, result) => el('div', { class: 'check-line' }, [
    uiIcon(result.ok ? 'check' : 'close', 14),
    el('span', {}, [
      el('b', { text: `${label}: ` }),
      el('span', { text: result.text }),
    ]),
  ]);
  return el('div', { class: 'check-list' }, [
    line('Звуки', attempt.sound),
    line('Мелодия', attempt.tone),
  ]);
}

/** Две линии рядом: образец и собственная попытка. Видно, где голос ушёл не туда. */
export function pitchChart(reference, attempt) {
  if (!reference || !attempt) return null;
  const WIDTH = 280;
  const HEIGHT = 90;
  const LIMIT = 9;                     // полутонов вверх и вниз от середины голоса
  const path = (points) => points.map((value, index) => {
    const x = (index / (points.length - 1)) * WIDTH;
    const y = HEIGHT / 2 - (Math.max(-LIMIT, Math.min(LIMIT, value)) / LIMIT) * (HEIGHT / 2 - 6);
    return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  const svg = svgEl('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: 'pitch-chart',
    role: 'img', 'aria-label': 'Ход голоса: образец и твоя попытка' });
  svg.append(svgEl('line', { x1: 0, y1: HEIGHT / 2, x2: WIDTH, y2: HEIGHT / 2,
    stroke: 'currentColor', 'stroke-width': '1', opacity: '0.15' }));
  svg.append(svgEl('path', { d: path(reference), fill: 'none', stroke: 'currentColor',
    'stroke-width': '2.5', opacity: '0.35', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  svg.append(svgEl('path', { d: path(attempt), fill: 'none', stroke: 'var(--accent)',
    'stroke-width': '2.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return el('div', { class: 'pitch-box' }, [
    svg,
    el('p', { class: 'faint pitch-legend', text: 'бледная линия — образец, яркая — твоя попытка' }),
  ]);
}

/** Кнопка записи со всеми её состояниями: просим микрофон, пишем, слушаем. */
export function recordButton(holder, hanzi, rerender, wide) {
  if (!canRecord()) return null;
  return el('button', {
    class: holder.recording ? `btn${wide ? ' btn-wide' : ''}` : `btn btn-quiet${wide ? ' btn-wide' : ''}`,
    type: 'button', disabled: Boolean(holder.asking || holder.checking),
    onclick: () => (holder.recording ? holder.stopRecording() : recordAttempt(holder, hanzi, rerender)),
  }, holder.asking ? iconLabel('sound', 'Разреши микрофон…')
    : holder.recording ? iconLabel('stop', 'Готово, проверь')
    : iconLabel('sound', 'Записать себя и проверить'));
}
