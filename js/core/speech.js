import { DEFAULT_SPEECH_RATE } from './constants.js';

/* ═══════════════════ SPEECH — озвучка (zh-CN) ═══════════════════ */

/* Версия приложения. Должна совпадать с CACHE в sw.js — tools/publish.sh это проверяет. */

/* Расходы на озвучку. Держим цифрами в коде: приложение офлайн и в сеть за курсом не ходит,
   поэтому и сумма, и курс обновляются руками при выпуске версии. */
export const VOICE_COST = {
  usd: 2.55,           // синтез речи через MediaFlow, суммарно за всё время
  rate: 83.29,         // ₽ за доллар, официальный курс ЦБ РФ
  updated: '25.08.2026',
  clips: 1348,         // записей слов, примеров и знаков
  syllables: 404,      // записей слогов таблицы
};

export const AUDIO_INDEX_URL = 'audio/index.json';
export const SYLLABLE_AUDIO_URL = 'audio/syllables/index.json';

export const speech = {
  voice: null,
  ready: false,
  rate: DEFAULT_SPEECH_RATE,
  clips: null,        // карта «фраза → файл записи», см. audio/index.json
  syllables: null,    // карта «слог → запись», см. audio/syllables/index.json
  player: null,       // текущий проигрыватель, чтобы обрывать предыдущую фразу

  /**
   * Сначала пробуем готовые записи: они звучат одинаково на любом устройстве и
   * не зависят от того, есть ли в системе китайский голос. Системный синтез —
   * запасной вариант для слов, которые пользователь добавил сам.
   */
  async init() {
    // cache: 'reload' обязателен: указатель растёт с каждой новой озвучкой, а браузер
    // держал старую копию — новые фразы оказывались «без звука» даже после обновления
    // приложения (найдено 25.08.2026 при проверке 130 новых записей).
    try {
      const response = await fetch(AUDIO_INDEX_URL, { cache: 'reload' });
      if (response.ok) {
        const index = await response.json();
        if (index && typeof index === 'object' && Object.keys(index).length) this.clips = index;
      }
    } catch (error) {
      this.clips = null;   // записей нет — работаем на системном голосе
    }
    try {
      const response = await fetch(SYLLABLE_AUDIO_URL, { cache: 'reload' });
      if (response.ok) {
        const index = await response.json();
        if (index && typeof index === 'object' && Object.keys(index).length) this.syllables = index;
      }
    } catch (error) {
      this.syllables = null;   // без записей таблица слогов останется без звука
    }
    if (!('speechSynthesis' in window)) { this.ready = true; return; }
    const voices = await new Promise((resolve) => {
      const existing = speechSynthesis.getVoices();
      if (existing.length) return resolve(existing);
      const timer = setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
      speechSynthesis.addEventListener('voiceschanged', () => {
        clearTimeout(timer);
        resolve(speechSynthesis.getVoices());
      }, { once: true });
    });
    this.voice = voices.find((item) => item.lang.toLowerCase().startsWith('zh')) || null;
    this.ready = true;
  },

  get available() { return Boolean(this.voice) || Boolean(this.clips); },

  hasClip(text) { return Boolean(this.clips && this.clips[text]); },

  /** Путь к образцовой записи — нужен, чтобы сравнить с ней собственное произношение. */
  clipUrl(text) {
    const clip = this.clips && this.clips[text];
    return clip ? `audio/${clip}` : null;
  },

  /** Слог таблицы: только запись. Системный голос читал бы латиницу по-английски. */
  syllableClip(syllable) { return (this.syllables && this.syllables[syllable]) || null; },

  speakSyllable(syllable) {
    const clip = this.syllableClip(syllable);
    if (!clip) return false;
    try {
      if (this.player) { this.player.pause(); this.player = null; }
      const player = new Audio(`audio/syllables/${clip.f}`);
      player.playbackRate = this.rate;
      player.play().catch(() => {});
      this.player = player;
      return true;
    } catch (error) {
      return false;
    }
  },

  /** Молча «проигрывать тишину» нельзя: без голоса зовущий получает false и показывает объяснение. */
  lastSource: null,   // 'запись' или 'синтез' — показывается в настройках при проверке

  speak(text) {
    if (!text) return false;

    const clip = this.clips && this.clips[text];
    if (clip) {
      try {
        if (this.player) { this.player.pause(); this.player = null; }
        const player = new Audio(`audio/${clip}`);
        player.playbackRate = this.rate;   // тот же ползунок скорости, что и у синтеза
        // Запись может не проиграться: файла нет в кеше и нет сети, или автозапуск
        // отклонён. Тогда молчать нельзя — переключаемся на системный голос.
        player.addEventListener('error', () => this.speakBySystem(text), { once: true });
        player.play().catch(() => this.speakBySystem(text));
        this.player = player;
        return true;
      } catch (error) {
        // не вышло проиграть запись — падаем на системный голос ниже
      }
    }

    return this.speakBySystem(text);
  },

  /** Системный голос — запасной путь, когда записи нет или она не проигралась. */
  speakBySystem(text) {
    if (!this.voice) return false;
    try {
      speechSynthesis.cancel();   // иначе фразы наслаиваются при быстрых нажатиях
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = this.voice;
      utterance.lang = this.voice.lang || 'zh-CN';
      utterance.rate = this.rate;
      speechSynthesis.speak(utterance);
      return true;
    } catch (error) {
      return false;
    }
  },

  /** Оборвать всё, что сейчас звучит. */
  stop() {
    if (this.player) { this.player.pause(); this.player = null; }
    try { speechSynthesis.cancel(); } catch (error) { /* голоса может не быть вовсе */ }
  },

  /**
   * То же самое, но обещание разрешается, когда запись доиграла.
   * Нужно для списков подряд: по таймеру слова наезжают друг на друга и обрываются,
   * а на слух это выглядит как «читает вразнобой».
   */
  speakUntilEnd(text) {
    return new Promise((resolve) => {
      if (!this.speak(text)) { resolve(false); return; }
      const player = this.player;
      if (player && this.clips && this.clips[text]) {
        const finish = () => resolve(true);
        player.addEventListener('ended', finish, { once: true });
        player.addEventListener('error', finish, { once: true });
        return;
      }
      // системный голос: у него своё событие окончания
      const check = setInterval(() => {
        if (!speechSynthesis.speaking) { clearInterval(check); resolve(true); }
      }, 120);
      setTimeout(() => { clearInterval(check); resolve(true); }, 6000);
    });
  },
};
