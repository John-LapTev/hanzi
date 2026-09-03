import { ALL_STORES, DB_NAME, DB_VERSION, EXPORT_SCHEMA_VERSION, MAX_LEVEL, STORE_EXAMS, STORE_GRAMMAR, STORE_HARD, STORE_SETTINGS, STORE_SRS, STORE_STATS, STORE_SYLLABLES, STORE_WORDS } from './constants.js';
import { SEED_STUDY_WORDS, SEED_WORDS, SEED_WORDS_EXTRA, SEED_WORDS_EXTRA_2, SEED_WORDS_GRAMMAR, SEED_WORDS_TRIP } from '../data/words.js';

/* ═══════════════════ DB — IndexedDB ═══════════════════
   Работа с базой идёт через «драйвер»: обычно это IndexedDB, но если браузер её не даёт
   (версия «одним файлом» по file:// — Chrome там просто не отвечает на запрос открытия),
   приложение переключается на память. Тогда всё работает и всё видно, только выученное
   не переживёт закрытия вкладки — об этом сразу говорится на экране.                    */

export let database = null;
let driver = null;
export let memoryOnly = false;      // правда ли, что база не открылась и мы живём в памяти

/** Сколько ждём ответа от браузера, прежде чем считать, что базы не будет. */
const OPEN_TIMEOUT_MS = 4000;

/** Модули не могут присваивать чужой импорт, поэтому соединение хранится здесь
    и открывается через connect(): снаружи остаётся только вызов. */
export async function connect() {
  try {
    database = await openDatabase();
    driver = indexedDbDriver(database);
    memoryOnly = false;
  } catch (error) {
    // Не падаем: без базы приложение всё равно должно открыться и показать себя
    database = null;
    driver = memoryDriver();
    memoryOnly = true;
  }
  return database;
}

/**
 * Открывает базу и создаёт хранилища. Схема меняется только здесь.
 * Три вещи, без которых открытие однажды зависало навсегда:
 *  · `onblocked` — другая вкладка держит старую версию схемы;
 *  · `versionchange` — наоборот, это мы держим базу, а обновиться хочет соседняя вкладка;
 *  · таймаут — по file:// браузер не отвечает вовсе, ни успехом, ни ошибкой.
 */
export function openDatabase() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    const timer = setTimeout(
      () => finish(reject, new Error('браузер не отвечает на запрос к базе данных')),
      OPEN_TIMEOUT_MS,
    );

    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      clearTimeout(timer);
      finish(reject, error);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_WORDS)) {
        const words = db.createObjectStore(STORE_WORDS, { keyPath: 'id', autoIncrement: true });
        words.createIndex('hanzi', 'hanzi', { unique: true });
        words.createIndex('topic', 'topic', { unique: false });
        words.createIndex('level', 'level', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SRS)) {
        const srs = db.createObjectStore(STORE_SRS, { keyPath: 'wordId' });
        srs.createIndex('due', 'due', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_STATS)) db.createObjectStore(STORE_STATS, { keyPath: 'date' });
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_GRAMMAR)) db.createObjectStore(STORE_GRAMMAR, { keyPath: 'lessonId' });
      if (!db.objectStoreNames.contains(STORE_EXAMS)) db.createObjectStore(STORE_EXAMS, { keyPath: 'level' });
      // Прогресс по слогам добавлен во второй версии схемы: старая база дополняется, не пересоздаётся
      if (!db.objectStoreNames.contains(STORE_SYLLABLES)) {
        db.createObjectStore(STORE_SYLLABLES, { keyPath: 'syllable' });
      }
      // Третья версия: слова, помеченные кружком как трудные, со своим прогрессом
      if (!db.objectStoreNames.contains(STORE_HARD)) {
        db.createObjectStore(STORE_HARD, { keyPath: 'wordId' });
      }
    };

    // Соседняя вкладка держит старую версию: ждать её бесполезно — говорим об этом прямо
    request.onblocked = () => {
      clearTimeout(timer);
      finish(reject, new Error('база открыта в другой вкладке со старой версией'));
    };

    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      // Обновиться хочет соседняя вкладка — отпускаем базу, иначе повиснет уже она
      db.addEventListener('versionchange', () => db.close());
      finish(resolve, db);
    };
    request.onerror = () => {
      clearTimeout(timer);
      finish(reject, request.error || new Error('не удалось открыть базу данных'));
    };
  });
}

/* ——— Драйвер поверх IndexedDB ——— */

function indexedDbDriver(db) {
  const run = (storeName, mode, action) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    transaction.onerror = () => reject(transaction.error);
    if (request) {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } else {
      transaction.oncomplete = () => resolve();
    }
  });

  return {
    getAll: (store) => run(store, 'readonly', (s) => s.getAll()),
    get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
    put: (store, value) => run(store, 'readwrite', (s) => s.put(value)),
    delete: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
    clear: (store) => run(store, 'readwrite', (s) => s.clear()),
    /** Пакетная запись: одна транзакция на все записи, иначе на сотне слов браузер задыхается. */
    putMany: (storeName, values) => new Promise((resolve, reject) => {
      if (!values.length) return resolve();
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      values.forEach((value) => store.put(value));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    }),
    /** Несколько хранилищ в одной транзакции: импорт применяется целиком или никак. */
    putManyAcross: (batches) => new Promise((resolve, reject) => {
      const names = batches.map((batch) => batch.store);
      if (!names.length) return resolve();
      const transaction = db.transaction(names, 'readwrite');
      batches.forEach(({ store, values }) => {
        const target = transaction.objectStore(store);
        values.forEach((value) => target.put(value));
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('запись отменена'));
    }),
  };
}

/* ——— Драйвер в памяти: тот же набор действий, только хранится в Map ———
   Ключи у хранилищ разные (id, wordId, key…), поэтому драйвер знает, какое поле у кого
   ключевое, а словам сам раздаёт номера — как это делает автоинкремент базы.          */

const KEY_FIELD = {
  [STORE_WORDS]: 'id',
  [STORE_SRS]: 'wordId',
  [STORE_STATS]: 'date',
  [STORE_SETTINGS]: 'key',
  [STORE_GRAMMAR]: 'lessonId',
  [STORE_EXAMS]: 'level',
  [STORE_SYLLABLES]: 'syllable',
  [STORE_HARD]: 'wordId',
};

function memoryDriver() {
  const tables = new Map(ALL_STORES.map((name) => [name, new Map()]));
  let nextId = 1;

  const table = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };
  const put = (name, value) => {
    const field = KEY_FIELD[name] || 'id';
    const copy = Object.assign({}, value);
    if (copy[field] === undefined) copy[field] = nextId++;
    if (name === STORE_WORDS && typeof copy.id === 'number' && copy.id >= nextId) nextId = copy.id + 1;
    table(name).set(copy[field], copy);
    return copy[field];
  };

  return {
    getAll: async (name) => Array.from(table(name).values()),
    get: async (name, key) => table(name).get(key),
    put: async (name, value) => put(name, value),
    delete: async (name, key) => { table(name).delete(key); },
    clear: async (name) => { table(name).clear(); },
    putMany: async (name, values) => { values.forEach((value) => put(name, value)); },
    putManyAcross: async (batches) => {
      batches.forEach(({ store, values }) => values.forEach((value) => put(store, value)));
    },
  };
}

/* ——— Общие операции: наружу видны только они ——— */

const useDriver = () => {
  if (!driver) throw new Error('база ещё не открыта');
  return driver;
};

export const dbGetAll = (store) => useDriver().getAll(store);
export const dbGet = (store, key) => useDriver().get(store, key);
export const dbPut = (store, value) => useDriver().put(store, value);
export const dbDelete = (store, key) => useDriver().delete(store, key);
export const dbClear = (store) => useDriver().clear(store);
const dbPutMany = (store, values) => useDriver().putMany(store, values);
const dbPutManyAcross = (batches) => useDriver().putManyAcross(batches);

export async function getSetting(key, fallback) {
  const record = await dbGet(STORE_SETTINGS, key);
  return record === undefined ? fallback : record.value;
}

export const setSetting = (key, value) => dbPut(STORE_SETTINGS, { key, value });

/** Весь стартовый словарь: бытовая основа, расширение и учебные слова. */
const allSeedWords = () => SEED_WORDS.concat(SEED_WORDS_EXTRA, SEED_WORDS_EXTRA_2,
  SEED_WORDS_TRIP, SEED_WORDS_GRAMMAR, SEED_STUDY_WORDS);

const toWordRecord = (word) => ({
  hanzi: word.hanzi,
  pinyin: word.pinyin,
  translation: word.translation,
  pos: word.pos,
  topic: word.topic,
  level: Math.min(word.hsk, MAX_LEVEL),
  hsk: word.hsk,
  example: word.example,
  tags: [],
  createdAt: new Date().toISOString(),
});

/** Первое открытие: заливаем стартовый словарь. Существующую базу не трогаем. */
export async function seedDatabaseIfEmpty() {
  const existing = await dbGetAll(STORE_WORDS);
  if (existing.length) return existing.length;
  const seed = allSeedWords().map(toWordRecord);
  await dbPutMany(STORE_WORDS, seed);
  return seed.length;
}

/**
 * Досев после обновления приложения: слова, добавленные в новой версии, попадают
 * и в уже заполненную базу. Прогресс и свои слова при этом не трогаются.
 */
export async function seedMissingWords() {
  const existing = await dbGetAll(STORE_WORDS);
  const known = new Set(existing.map((word) => word.hanzi));
  const missing = allSeedWords().filter((word) => !known.has(word.hanzi)).map(toWordRecord);
  if (missing.length) await dbPutMany(STORE_WORDS, missing);
  return missing.length;
}

/* ——— Экспорт и импорт всей базы ——— */

export async function exportDatabase() {
  const [words, srs, stats, settings, grammar, exams, syllables, hard] =
    await Promise.all(ALL_STORES.map(dbGetAll));
  return {
    app: 'hanzi',
    schema: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    words, srs, stats, settings, grammar, exams, syllables, hard,
  };
}

/** Разбирает файл и считает, что изменится. Ничего не пишет — только отчёт. */
export async function planImport(payload) {
  if (!payload || payload.app !== 'hanzi' || !Array.isArray(payload.words)) {
    throw new Error('Это не файл базы hanzi.');
  }
  if (payload.schema > EXPORT_SCHEMA_VERSION) {
    throw new Error('Файл сделан более новой версией приложения.');
  }
  const current = await dbGetAll(STORE_WORDS);
  const currentByHanzi = new Map(current.map((word) => [word.hanzi, word]));
  const fresh = payload.words.filter((word) => !currentByHanzi.has(word.hanzi));
  return {
    payload,
    newWords: fresh.length,
    knownWords: payload.words.length - fresh.length,
    progressRecords: (payload.srs || []).length,
    days: (payload.stats || []).length,
    syllables: (payload.syllables || []).length,
    syllablesLearned: (payload.syllables || []).filter((record) => record.learned).length,
    hardWords: (payload.hard || []).length,
  };
}

/* ——— Слияние вместо перезаписи ———
   Иван учит с двух устройств. Раньше импорт писал поверх: загрузил на телефон вчерашнюю
   выгрузку с компьютера — и сегодняшняя работа исчезала (аудит 03.09.2026). Теперь для
   каждой записи выбирается более свежая, а дни статистики складываются по максимуму:
   потерять сделанное хуже, чем недосчитать.                                              */

/** Что новее: сравниваем по дню последнего показа, а при равенстве — по числу повторов. */
function fresherSrs(mine, theirs) {
  if (!mine) return theirs;
  if (!theirs) return mine;
  const myDay = mine.lastSeenDay || '';
  const theirDay = theirs.lastSeenDay || '';
  if (myDay !== theirDay) return myDay > theirDay ? mine : theirs;
  return (mine.seen || 0) >= (theirs.seen || 0) ? mine : theirs;
}

/** День статистики: берём большее по каждому числу — так ни один прогон не пропадёт. */
function mergeDay(mine, theirs) {
  if (!mine) return theirs;
  if (!theirs) return mine;
  const merged = Object.assign({}, theirs, mine);
  ['reviewed', 'correct', 'errors', 'toneErrors', 'learned'].forEach((field) => {
    merged[field] = Math.max(mine[field] || 0, theirs[field] || 0);
  });
  merged.byMode = Object.assign({}, theirs.byMode, mine.byMode);
  return merged;
}

/** Экзамен: в базе и так хранится лучшая попытка — её и оставляем. */
function betterExam(mine, theirs) {
  if (!mine) return theirs;
  if (!theirs) return mine;
  if (mine.passed !== theirs.passed) return mine.passed ? mine : theirs;
  return (mine.score || 0) >= (theirs.score || 0) ? mine : theirs;
}

/** Настройки: открытый уровень назад не откатываем, остальное берём из файла. */
function mergeSettings(mine, theirs) {
  if (!mine) return theirs;
  if (!theirs) return mine;
  if (mine.key === 'unlockedLevel') {
    return (mine.value || 0) >= (theirs.value || 0) ? mine : theirs;
  }
  return theirs;
}

/** Сливает два списка записей по ключу, разрешая столкновения переданной функцией. */
function mergeRecords(currentList, incomingList, keyField, resolve) {
  const result = new Map(currentList.map((record) => [record[keyField], record]));
  incomingList.forEach((incoming) => {
    const key = incoming[keyField];
    result.set(key, resolve(result.get(key), incoming));
  });
  return Array.from(result.values());
}

/**
 * Применяет разобранный импорт: слова дополняются, прогресс переносится по иероглифам.
 * Всё пишется одной транзакцией — оборвалось на середине, значит не применилось вовсе
 * и база осталась прежней.
 */
export async function applyImport(plan) {
  const payload = plan.payload;
  const current = await dbGetAll(STORE_WORDS);
  const currentByHanzi = new Map(current.map((word) => [word.hanzi, word]));

  // Слова: новые добавляем, существующие оставляем как есть (перевод пользователя важнее).
  const incomingIdToHanzi = new Map();
  const toInsert = [];
  payload.words.forEach((word) => {
    incomingIdToHanzi.set(word.id, word.hanzi);
    if (!currentByHanzi.has(word.hanzi)) {
      const copy = Object.assign({}, word);
      delete copy.id;
      toInsert.push(copy);
    }
  });
  await dbPutMany(STORE_WORDS, toInsert);

  // Прогресс привязан к id, а id при вставке новые — сопоставляем по иероглифам.
  const after = await dbGetAll(STORE_WORDS);
  const idByHanzi = new Map(after.map((word) => [word.hanzi, word.id]));
  const remapByWord = (records) => (records || []).map((record) => {
    const hanzi = incomingIdToHanzi.get(record.wordId);
    const wordId = idByHanzi.get(hanzi);
    return wordId ? Object.assign({}, record, { wordId }) : null;
  }).filter(Boolean);

  const [srs, stats, grammar, exams, syllables, settings, hard] = await Promise.all([
    dbGetAll(STORE_SRS), dbGetAll(STORE_STATS), dbGetAll(STORE_GRAMMAR),
    dbGetAll(STORE_EXAMS), dbGetAll(STORE_SYLLABLES), dbGetAll(STORE_SETTINGS),
    dbGetAll(STORE_HARD),
  ]);

  // Пометки «трудное» и прогресс по слогам берём свежие: они только копятся
  const keepNewer = (mine, theirs) => (mine || theirs);
  await dbPutManyAcross([
    { store: STORE_SRS, values: mergeRecords(srs, remapByWord(payload.srs), 'wordId', fresherSrs) },
    { store: STORE_HARD, values: mergeRecords(hard, remapByWord(payload.hard), 'wordId', keepNewer) },
    { store: STORE_STATS, values: mergeRecords(stats, payload.stats || [], 'date', mergeDay) },
    { store: STORE_GRAMMAR, values: mergeRecords(grammar, payload.grammar || [], 'lessonId',
      (mine, theirs) => (!mine ? theirs : !theirs ? mine
        : ((mine.correct || 0) >= (theirs.correct || 0) ? mine : theirs))) },
    { store: STORE_EXAMS, values: mergeRecords(exams, payload.exams || [], 'level', betterExam) },
    { store: STORE_SYLLABLES, values: mergeRecords(syllables, payload.syllables || [], 'syllable',
      (mine, theirs) => (!mine ? theirs : !theirs ? mine
        : ((mine.streak || 0) >= (theirs.streak || 0) ? mine : theirs))) },
    { store: STORE_SETTINGS, values: mergeRecords(settings, payload.settings || [], 'key', mergeSettings) },
  ]);
}
