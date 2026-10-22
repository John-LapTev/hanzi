import { setSetting } from '../core/db.js';
import { favoritePhrases, popularPhrases, toggleFavoritePhrase } from '../core/phrases.js';
import { shuffle } from '../core/random.js';
import { speech } from '../core/speech.js';
import { state } from '../core/state.js';
import { el, fill, helpButton, toast } from './dom.js';
import { ALL_TOPICS, uiIcon } from './icons.js';

/* ——— Популярные фразы: карточки «иероглифы и пиньинь → перевод» ———
   Иван (22.10.2026): «идут иероглифы, пиньинь, нажимаю на карточку — вижу перевод; слушать
   можно и на китайском, и при переводе снова». Фразы — из программы занятий, тема — та, что
   выбрана на главной (см. core/phrases.js). Это просмотр, а не экзамен: в повторения
   не пишется, ошибок не считает.                                                       */

/** Колода текущего захода. Пересобирается, когда сменилась тема или человек пришёл заново. */
let deck = null;

/** Смотрим только избранное — кнопка «Избранное» в шапке. Держится, пока открыто приложение. */
let isFavoritesOnly = false;

/** Новый заход: колода перемешивается заново. Зовётся при входе с главной. */
export function resetPhrases() { deck = null; }

const selectedTopic = () => (state.topic === ALL_TOPICS ? null : state.topic);

function ensureDeck() {
  const topic = isFavoritesOnly ? null : selectedTopic();
  if (deck && deck.topic === topic && deck.isFavoritesOnly === isFavoritesOnly) return;
  // В избранном фраза, с которой сняли сердечко, остаётся до нового захода — иначе карточка
  // исчезала бы прямо из-под пальца
  const phrases = isFavoritesOnly ? favoritePhrases() : popularPhrases(topic);
  deck = { topic, isFavoritesOnly, phrases: shuffle(phrases), index: 0, flipped: false };
}

function favoritesToggle() {
  const count = state.favoritePhrases.size;
  return el('button', {
    class: 'chip fav-toggle', type: 'button', 'aria-pressed': isFavoritesOnly,
    title: isFavoritesOnly ? 'Показать все фразы' : 'Показать только избранные',
    onclick: () => { isFavoritesOnly = !isFavoritesOnly; renderPhrases(); },
  }, [uiIcon('heart', 16), el('span', { text: count ? `Избранное ${count}` : 'Избранное' })]);
}

function heartButton(phrase) {
  const isFavorite = state.favoritePhrases.has(phrase.hanzi);
  return el('button', {
    class: `fav-btn${isFavorite ? ' is-on' : ''}`, type: 'button', 'aria-pressed': isFavorite,
    'aria-label': isFavorite ? 'Убрать из избранного' : 'Добавить в избранное',
    title: isFavorite ? 'Убрать из избранного' : 'В избранное',
    onclick: async (event) => {
      event.stopPropagation();   // сердечко не переворачивает карточку
      try {
        await toggleFavoritePhrase(phrase.hanzi);
      } catch (error) {
        toast('Не удалось сохранить избранное — попробуй ещё раз.', true);
      }
      renderPhrases();
    },
  }, uiIcon('heart', 22));
}

function speakPhrase(phrase) {
  if (!speech.speak(phrase.hanzi, state.phraseRate)) toast('Китайского голоса в системе нет.', true);
}

/* Скорость озвучки фраз — своя, не общая из настроек (Иван 22.10.2026: «ползунок у карточек»).
   Фразы длинные, их обычно слушают медленнее, чем отдельные слова. */
const PHRASE_RATE_MIN = 0.5;
const PHRASE_RATE_MAX = 1.25;
const PHRASE_RATE_STEP = 0.05;

function rateControl(phrase) {
  const value = el('b', { text: `${state.phraseRate.toFixed(2)}×` });
  const slider = el('input', {
    type: 'range', id: 'phrase-rate', min: PHRASE_RATE_MIN, max: PHRASE_RATE_MAX, step: PHRASE_RATE_STEP,
    value: state.phraseRate, 'aria-label': 'Скорость озвучки фраз',
  });
  slider.addEventListener('input', () => {
    state.phraseRate = Number(slider.value);
    value.textContent = `${state.phraseRate.toFixed(2)}×`;
  });
  // Отпустил ползунок — фраза звучит с новой скоростью: так слышно, что выбрал
  slider.addEventListener('change', async () => {
    speakPhrase(phrase);
    try {
      await setSetting('phraseRate', state.phraseRate);
    } catch (error) {
      toast('Не удалось запомнить скорость — после перезапуска вернётся прежняя.', true);
    }
  });
  return el('label', { class: 'phrase-rate', for: 'phrase-rate' }, [
    el('span', { class: 'faint' }, ['Скорость озвучки ', value]),
    slider,
  ]);
}

const flip = () => { deck.flipped = !deck.flipped; renderPhrases(); };

function go(step) {
  const next = deck.index + step;
  if (next < 0 || next >= deck.phrases.length) return;
  deck.index = next;
  deck.flipped = false;
  renderPhrases();
}

export function renderPhrases() {
  ensureDeck();
  const topicName = deck.topic || 'все темы';
  fill('phrases-fav', favoritesToggle());
  fill('phrases-help', helpButton('Популярные фразы',
    'Разговорные фразы из программы занятий. На карточке — иероглифы и пиньинь, нажми — '
    + 'увидишь перевод. Звук — кнопкой с динамиком или S, скорость — ползунком под карточкой, '
    + 'листать — стрелками или кнопками. Сердечко — в избранное, кнопка «Избранное» сверху '
    + 'показывает только их. '
    + 'Фразы подбираются по теме, выбранной на главной: фраза про еду — та, где есть слово из «Еды».'));
  // Иван просил пометку «где-нибудь в уголке, не привлекая внимания»
  fill('phrases-note', isFavoritesOnly
    ? 'Только избранное — фразы с сердечком. Тема с главной здесь не действует.'
    : `Тема: ${topicName}. Список фраз зависит от темы, выбранной на главной.`);

  if (!deck.phrases.length && isFavoritesOnly) {
    fill('phrases-body', el('div', { class: 'card center' }, [
      el('b', { text: 'В избранном пока пусто' }),
      el('p', { class: 'faint', text: 'Нажми сердечко на карточке фразы — она появится здесь. '
        + 'Вернуться ко всем фразам — снова кнопка «Избранное».' }),
    ]));
    return;
  }
  if (!deck.phrases.length) {
    fill('phrases-body', el('div', { class: 'card center' }, [
      el('b', { text: 'В этой теме пока нет фраз' }),
      el('p', { class: 'faint', text: 'Выбери на главной другую тему или «Все темы».' }),
    ]));
    return;
  }

  const phrase = deck.phrases[deck.index];
  const soundButton = el('button', {
    class: 'speak-btn', type: 'button', 'aria-label': 'Озвучить фразу', title: 'Озвучить (S)',
    onclick: (event) => { event.stopPropagation(); speakPhrase(phrase); },
  }, uiIcon('sound', 20));

  const card = el('div', {
    class: `phrase-card${deck.flipped ? ' is-flipped' : ''}`, role: 'button', tabindex: '0',
    'aria-label': deck.flipped ? 'Скрыть перевод' : 'Показать перевод',
    onclick: flip,
  }, [
    el('div', { class: 'phrase-hanzi hanzi', text: phrase.hanzi }),
    el('div', { class: 'phrase-pinyin', text: phrase.pinyin }),
    deck.flipped
      ? el('div', { class: 'phrase-translation', text: phrase.translation })
      : el('div', { class: 'faint phrase-tap', text: 'нажми, чтобы увидеть перевод' }),
    soundButton,
    heartButton(phrase),
  ]);

  fill('phrases-body', [
    card,
    rateControl(phrase),
    el('div', { class: 'row-between phrase-nav' }, [
      el('button', { class: 'btn btn-quiet', type: 'button', disabled: deck.index === 0,
        onclick: () => go(-1) }, '‹ Прошлая'),
      el('span', { class: 'faint', text: `${deck.index + 1} из ${deck.phrases.length}` }),
      el('button', { class: 'btn', type: 'button', disabled: deck.index >= deck.phrases.length - 1,
        onclick: () => go(1) }, 'Дальше ›'),
    ]),
    el('div', { class: 'center' }, el('button', {
      class: 'btn btn-quiet btn-small', type: 'button',
      onclick: () => { deck = null; renderPhrases(); },
    }, 'Перемешать заново')),
  ]);
}

/** Клавиатура: пробел/Enter — перевернуть, стрелки — листать, S — звук. */
export function handlePhrasesKey(event) {
  if (state.screen !== 'phrases' || !deck || !deck.phrases.length) return;
  const target = event.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
  if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); flip(); return; }
  if (event.key === 'ArrowRight') { go(1); return; }
  if (event.key === 'ArrowLeft') { go(-1); return; }
  if (['s', 'S', 'ы', 'Ы'].includes(event.key)) speakPhrase(deck.phrases[deck.index]);
}
