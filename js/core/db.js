import { ALL_STORES, DB_NAME, DB_VERSION, EXPORT_SCHEMA_VERSION, MAX_LEVEL, STORE_EXAMS, STORE_GRAMMAR, STORE_SETTINGS, STORE_SRS, STORE_STATS, STORE_SYLLABLES, STORE_WORDS } from './constants.js';
import { SEED_STUDY_WORDS, SEED_WORDS, SEED_WORDS_EXTRA, SEED_WORDS_EXTRA_2, SEED_WORDS_GRAMMAR, SEED_WORDS_TRIP } from '../data/words.js';

/* ═══════════════════ DB — IndexedDB ═══════════════════ */

export let database = null;

/** Модули не могут присваивать чужой импорт, поэтому соединение хранится здесь
    и открывается через connect(): снаружи остаётся только вызов. */
export async function connect() {
  database = await openDatabase();
  return database;
}

/** Открывает базу и создаёт хранилища. Схема меняется только здесь. */
export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Одна операция в транзакции. Всё общение с базой идёт через эту функцию. */
function runRequest(storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    transaction.onerror = () => reject(transaction.error);
    if (request) {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } else {
      transaction.oncomplete = () => resolve();
    }
  });
}

export const dbGetAll = (store) => runRequest(store, 'readonly', (s) => s.getAll());
export const dbGet = (store, key) => runRequest(store, 'readonly', (s) => s.get(key));
export const dbPut = (store, value) => runRequest(store, 'readwrite', (s) => s.put(value));
const dbDelete = (store, key) => runRequest(store, 'readwrite', (s) => s.delete(key));
export const dbClear = (store) => runRequest(store, 'readwrite', (s) => s.clear());

/** Пакетная запись: одна транзакция на все записи, иначе на сотне слов браузер задыхается. */
function dbPutMany(storeName, values) {
  return new Promise((resolve, reject) => {
    if (!values.length) return resolve();
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    values.forEach((value) => store.put(value));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

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
  const [words, srs, stats, settings, grammar, exams, syllables] =
    await Promise.all(ALL_STORES.map(dbGetAll));
  return {
    app: 'hanzi',
    schema: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    words, srs, stats, settings, grammar, exams, syllables,
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
  };
}

/** Применяет разобранный импорт: слова дополняются, прогресс переносится по иероглифам. */
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
  const srsRecords = (payload.srs || []).map((record) => {
    const hanzi = incomingIdToHanzi.get(record.wordId);
    const wordId = idByHanzi.get(hanzi);
    return wordId ? Object.assign({}, record, { wordId }) : null;
  }).filter(Boolean);
  await dbPutMany(STORE_SRS, srsRecords);

  await dbPutMany(STORE_STATS, payload.stats || []);
  await dbPutMany(STORE_GRAMMAR, payload.grammar || []);
  await dbPutMany(STORE_EXAMS, payload.exams || []);
  await dbPutMany(STORE_SYLLABLES, payload.syllables || []);
  await dbPutMany(STORE_SETTINGS, payload.settings || []);
}
