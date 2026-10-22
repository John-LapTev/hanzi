/* ═══════════════════ PITCH — как двигался голос ═══════════════════
   Просьба владельца (19.08.2026): проверять собственное произношение, а не только слушать
   эталон. Распознавание речи для этого не годится — оно угадывает смысл и прощает тон,
   проверено на нашей же озвучке. Зато сам ход голоса меряется честно и без всяких моделей:
   берём запись с микрофона и считаем основную частоту по автокорреляции.

   Тем же способом в проекте искали брак в озвучке (см. CHANGELOG за 17.08.2026).       */

const PITCH_RATE = 16000;          // частота, к которой приводим запись
const PITCH_WINDOW = 0.04;         // окно анализа, секунды
const STEP = 0.01;
const F_MIN = 70;            // ниже — не голос
const F_MAX = 400;
const SILENCE = 0.02;        // тише — тишина
const CONFIDENCE = 0.3;      // насколько уверенно автокорреляция нашла период

/** Основная частота в одном окне; null, если голоса нет. */
function pitchAt(samples, from, size) {
  let energy = 0;
  for (let i = 0; i < size; i += 1) energy += samples[from + i] ** 2;
  if (Math.sqrt(energy / size) < SILENCE) return null;

  let mean = 0;
  for (let i = 0; i < size; i += 1) mean += samples[from + i];
  mean /= size;

  const minLag = Math.floor(PITCH_RATE / F_MAX);
  const maxLag = Math.floor(PITCH_RATE / F_MIN);
  let zero = 0;
  for (let i = 0; i < size; i += 1) zero += (samples[from + i] - mean) ** 2;
  if (zero <= 0) return null;

  let bestLag = 0;
  let bestScore = 0;
  for (let lag = minLag; lag < maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < size; i += 1) {
      sum += (samples[from + i] - mean) * (samples[from + i + lag] - mean);
    }
    const score = sum / zero;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  return bestScore > CONFIDENCE && bestLag ? PITCH_RATE / bestLag : null;
}

/** Ход голоса по всей записи: массив частот и пауз (null). */
export function pitchTrack(samples) {
  const size = Math.floor(PITCH_WINDOW * PITCH_RATE);
  const step = Math.floor(STEP * PITCH_RATE);
  const track = [];
  for (let start = 0; start + size < samples.length; start += step) {
    track.push(pitchAt(samples, start, size));
  }
  return track;
}

/** Приводит запись к 16 кГц моно — с этим считать проще и быстрее. */
export async function toSamples(blob) {
  const bytes = await blob.arrayBuffer();
  const context = new OfflineAudioContext(1, 1, PITCH_RATE);
  const decoded = await context.decodeAudioData(bytes);
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * PITCH_RATE), PITCH_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/* ——— Разбор тона ———
   Работаем в полутонах от середины собственного голоса: так разбор не зависит от того,
   низкий голос или высокий. Перед этим чистим скачки — автокорреляция иногда ошибается
   ровно на октаву, и одна такая точка ломала весь вывод.                              */

const NAMES = { 1: 'голос держится ровно', 2: 'голос идёт вверх',
  3: 'провал и подъём', 4: 'голос падает' };

/** Убирает одиночные скачки: точка, далёкая от соседей, — это ошибка измерения. */
function clean(voiced) {
  const middle = median(voiced);
  const nearby = voiced.filter((value) => Math.abs(12 * Math.log2(value / middle)) < 7);
  if (nearby.length < 5) return voiced;
  // сглаживаем по трём соседям — мелкая дрожь голоса тону не мешает
  return nearby.map((value, i) => {
    const window = nearby.slice(Math.max(0, i - 1), i + 2);
    return median(window);
  });
}

export function describeTone(track) {
  const raw = track.filter(Boolean);
  if (raw.length < 5) return { tone: null, note: 'Голоса не слышно — скажи погромче.' };

  const voiced = clean(raw);
  const middle = median(voiced);
  const st = (value) => 12 * Math.log2(value / middle);      // полутона
  const third = Math.max(1, Math.floor(voiced.length / 3));
  const head = st(median(voiced.slice(0, third)));
  const tail = st(median(voiced.slice(-third)));
  const delta = tail - head;

  const low = Math.min(...voiced);
  const lowAt = voiced.indexOf(low) / (voiced.length - 1);
  const dip = head - st(low);
  const rise = tail - st(low);

  // Третий тон: голос проседает В СЕРЕДИНЕ и возвращается. Проверяем это первым:
  // по одной дельте он неотличим то от второго, то от четвёртого.
  if (lowAt > 0.2 && lowAt < 0.8 && dip > 2.5 && rise > 1.5) {
    return { tone: 3, delta, note: NAMES[3] };
  }
  if (delta > 2) return { tone: 2, delta, note: NAMES[2] };
  if (delta < -2) return { tone: 4, delta, note: NAMES[4] };
  return { tone: 1, delta, note: NAMES[1] };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/* ——— Сравнение с эталоном ———
   Определять тон по короткой записи ненадёжно: на наших же эталонных записях правила
   угадывали только половину. Зато у каждого слова есть образцовая запись — и куда честнее
   сравнить две кривые между собой, чем сначала обе распознавать. Человеку показываем
   обе линии: видно, где голос разошёлся, даже без вердикта.                          */

/** Приводит ход голоса к 24 точкам в полутонах от собственной середины. */
export function toCurve(track) {
  const voiced = clean(track.filter(Boolean));
  if (voiced.length < 5) return null;
  const middle = median(voiced);
  const points = [];
  for (let i = 0; i < 24; i += 1) {
    const from = Math.floor((voiced.length * i) / 24);
    const to = Math.max(from + 1, Math.floor((voiced.length * (i + 1)) / 24));
    points.push(12 * Math.log2(median(voiced.slice(from, to)) / middle));
  }
  return points;
}

/** Насколько две кривые идут одинаково: 1 — след в след, 0 — врозь.
    Шкала выверена на наших записях: одно и то же слово даёт 0 полутонов расхождения,
    разные тоны того же слога — 2,3…4 полутона. Значит порог «похоже» лежит около двух. */
export function curveMatch(reference, attempt) {
  if (!reference || !attempt) return null;
  const differences = reference.map((value, i) => Math.abs(value - attempt[i]));
  const average = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  return Math.max(0, Math.min(1, 1 - average / 3));
}

export function compareWithReference(reference, attempt) {
  const match = curveMatch(reference, attempt);
  if (match === null) return { ok: false, text: 'Голоса не слышно — скажи погромче.' };
  const percent = Math.round(match * 100);
  if (match > 0.7) return { ok: true, match, text: `Похоже на образец: ${percent} %. Хорошо.` };
  if (match > 0.45) {
    return { ok: false, match,
      text: `Совпало на ${percent} %. Сравни линии — где-то голос ушёл не туда.` };
  }
  return { ok: false, match, text: `Совпало на ${percent} %. Мелодия другая — послушай образец и повтори.` };
}
