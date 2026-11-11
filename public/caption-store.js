// The day's caption log, kept on this device only. Records from earlier days are
// deleted on the next load. Falls back to memory when IndexedDB is unavailable.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.shusantvCaptionStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const NAME = 'shusantv-captions', STORE = 'paragraphs';
  const done = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  function createMemory(today) {
    const records = new Map();
    const purge = () => { for (const [key, record] of records) if (record.day !== today()) records.delete(key); };
    return {
      async load(stream) {
        purge();
        return [...records.values()].filter(record => record.stream === stream)
          .sort((a, b) => a.session - b.session || a.paragraph - b.paragraph);
      },
      async save(items) {
        for (const item of items) records.set(`${item.stream}|${item.session}|${item.paragraph}`, { ...item, day: today() });
      },
      async clear(stream) { for (const [key, record] of records) if (record.stream === stream) records.delete(key); },
    };
  }
  // Records: { stream, session, paragraph, at, name, text, corrected? }.
  // Operations run in call order, so a load issued after a save sees it.
  function create({ today, indexedDB = globalThis.indexedDB, IDBKeyRange = globalThis.IDBKeyRange } = {}) {
    const memory = createMemory(today);
    if (!indexedDB || !IDBKeyRange) return { ...memory, persistent: false };
    const ready = (async () => {
      const request = indexedDB.open(NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: ['day', 'stream', 'session', 'paragraph'] });
      return done(request);
    })().catch(() => null); // private browsing etc.: keep working for this page view
    let queue = Promise.resolve();
    const run = (name, mode, work) => {
      const next = queue.then(async () => {
        const db = await ready;
        if (!db) return memory[name](...work.args);
        const tx = db.transaction(STORE, mode), store = tx.objectStore(STORE);
        const value = work(store);
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
        return value?.result;
      });
      queue = next.catch(() => {});
      return next;
    };
    const op = (args, work) => Object.assign(work, { args });
    const ofStream = (day, stream) => IDBKeyRange.bound([day, stream], [day, stream, []]);
    return {
      persistent: true,
      load: stream => run('load', 'readwrite', op([stream], store => {
        store.delete(IDBKeyRange.upperBound([today()], true)); // earlier days
        return store.getAll(ofStream(today(), stream));
      })).then(records => records || []).catch(() => []),
      save: items => run('save', 'readwrite', op([items], store => {
        for (const item of items) store.put({ ...item, day: today() });
      })).catch(() => {}),
      clear: stream => run('clear', 'readwrite', op([stream], store => { store.delete(ofStream(today(), stream)); })).catch(() => {}),
    };
  }
  return { create };
});
