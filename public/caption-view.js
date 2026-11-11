// Caption DOM for one stream: a short live bubble on the video, and a timestamped
// log (`panel`) that the page mounts in its side panel. Network/storage are supplied.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.shusantvCaptionView = api;
})(globalThis, function () {
  let nextView = 0, lastSession = 0;
  // Orders a stream's views within the day; unique even when two start in the same millisecond.
  const newSession = () => (lastSession = Math.max(Date.now(), lastSession + 1));
  const punct = text => !text || /[。、．，！？!?]$/.test(text) ? text
    : /(です|ます|でした|ました|ません|ございます|であります)(ね|よ)?$/.test(text) ? text + '。' : text + '、';
  const clockFormat = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const clock = at => Number.isFinite(at) ? clockFormat.format(at) : '';
  const BUBBLE_PARTS = 6; // The bubble shows only the tail; the log has everything.
  function create(el, { getContext = () => ({}), isEnabled = () => false, submit = () => {}, cancel = () => {},
    store = null, stream = '', session = newSession() } = {}) {
    const doc = el.ownerDocument;
    el.innerHTML = '<div class="bubble" hidden><div class="bubble-lines"></div></div><span class="caption-note" role="status"></span>';
    const bubble = el.firstChild, lines = bubble.firstChild, note = el.lastChild;
    const panel = doc.createElement('div');
    panel.className = 'cap-view';
    panel.innerHTML = '<div class="cap-log" role="log" aria-live="off" tabindex="0" aria-label="字幕ログ（時刻付き）"></div>'
      + '<div class="cap-status" role="status"></div><button class="cap-return" type="button" hidden></button>';
    const [log, status, back] = panel.children;
    const history = shusantvCaptionHistory.createHistory(), rows = new Map(), parts = new Map(), unread = new Set(), dirty = new Set();
    const prefix = `caption${++nextView}:`;
    let following = true, alive = true, settleTimer, saveTimer = null, last = null, previous = null;
    let cleared = 0, newest = 0, generation = 0; // entry ids at or below `cleared` were erased by the viewer

    function controls() {
      back.hidden = following;
      back.textContent = unread.size ? `↓ 新着 ${unread.size} 段落` : '↓ 最新へ';
    }
    const stick = () => { if (following) log.scrollTop = log.scrollHeight; };
    function follow() { following = true; unread.clear(); stick(); controls(); }
    let lastTop = 0;
    log.addEventListener('scroll', () => {
      const top = log.scrollTop, upward = top < lastTop;
      lastTop = top;
      // Moving up never resumes following, even while still close to the end.
      following = !upward && log.scrollHeight - top - log.clientHeight < 32;
      if (following) unread.clear();
      controls();
    });
    back.addEventListener('click', follow);
    // Scroll events arrive a frame late; a caption landing in that frame would pull
    // the reader back down. Stop following as soon as they start moving away.
    function pause() {
      if (!following || log.scrollHeight <= log.clientHeight + 1) return;
      following = false; controls();
    }
    log.addEventListener('wheel', event => { if (event.deltaY < 0) pause(); }, { passive: true });
    log.addEventListener('touchmove', pause, { passive: true });
    log.addEventListener('pointerdown', event => { if (event.target === log) pause(); }); // scrollbar
    log.addEventListener('keydown', event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) pause(); });

    // ---- same-day persistence (debounced; text that is still interim is not stored) ----
    const finalText = row => [...row.parts.values()].filter(part => !part.interim).map(part => punct(part.text)).join('');
    function flush() {
      clearTimeout(saveTimer); saveTimer = null;
      const records = [];
      for (const row of dirty) {
        const text = finalText(row);
        if (!text) continue;
        const record = { stream, session, paragraph: row.id, at: row.at, name: row.name, text };
        if (row.state === 'done') record.corrected = row.corrected.textContent;
        records.push(record);
      }
      dirty.clear();
      if (records.length) store.save(records);
    }
    function queueSave(row) {
      if (!store || !stream) return;
      dirty.add(row);
      if (saveTimer === null) saveTimer = setTimeout(flush, 1500);
    }

    // ---- rows ----
    function showOriginal(row, original) {
      row.raw.hidden = !original; row.corrected.hidden = original;
      row.toggle.textContent = original ? '校正案' : '元字幕';
    }
    function makeRow(at, name) {
      const node = doc.createElement('div');
      node.className = 'cap-row';
      node.innerHTML = '<time></time><p><span class="caption-original"></span><span class="caption-corrected" hidden></span><small class="caption-proof" hidden><span></span> <button type="button" hidden>元字幕</button> <button type="button" hidden>再試行</button></small></p>';
      const [time, body] = node.children;
      const row = { node, at, name: name || null, raw: body.children[0], corrected: body.children[1], tools: body.children[2], parts: new Map() };
      time.textContent = clock(at).slice(0, 5);
      time.title = `${clock(at)}（視聴した時刻）`;
      row.status = row.tools.querySelector('span');
      [row.toggle, row.retry] = row.tools.querySelectorAll('button');
      row.toggle.onclick = () => showOriginal(row, row.raw.hidden);
      row.retry.title = '再送信します。追加料金が発生する場合があります';
      row.retry.onclick = () => request(row);
      node.captionRow = row;
      return row;
    }
    // A room can host another meeting later in the day: mark where the name changes.
    function divide(node) {
      const before = node.previousSibling?.captionRow, name = node.captionRow.name;
      if (!before?.name || !name || before.name === name) return;
      const divider = doc.createElement('div');
      divider.className = 'cap-divider';
      divider.textContent = name;
      node.parentNode.insertBefore(divider, node);
    }
    function addRow(id, at) {
      const row = makeRow(at, getContext().name);
      row.id = id; row.context = { ...getContext() };
      rows.set(id, row); log.appendChild(row.node); divide(row.node);
      previous = last; last = row;
      return row;
    }
    function removeRow(row) {
      cancelRow(row); row.node.remove(); rows.delete(row.id); dirty.delete(row); unread.delete(row.id);
      if (row === last) { last = previous; previous = null; } else if (row === previous) previous = null;
    }
    function paintBubble() {
      const nodes = [];
      for (const row of [previous, last]) {
        if (!row) continue;
        const p = doc.createElement('p');
        for (const part of [...row.parts.values()].slice(-BUBBLE_PARTS)) p.appendChild(part.node.cloneNode(true));
        nodes.push(p);
      }
      lines.replaceChildren(...nodes);
      bubble.hidden = !nodes.length;
    }

    // ---- proofreading (opt-in, new closures only) ----
    function result(row, event) {
      if (!alive || rows.get(row.id) !== row || row.job?.text !== event.text) return;
      if (event.status === 'cancelled' && row.state === 'done') return;
      row.state = event.status;
      row.tools.hidden = false;
      row.status.textContent = ({queued:'校正待ち', running:'校正中', done:'LLM校正案', error:'校正失敗・原文', cancelled:'校正停止・原文'})[event.status];
      row.toggle.hidden = event.status !== 'done';
      row.retry.hidden = event.status !== 'error' || !isEnabled();
      if (event.status === 'done') {
        row.corrected.textContent = event.correctedText;
        // Never replace the text underneath someone reading back.
        showOriginal(row, !following);
        queueSave(row);
      } else showOriginal(row, true);
      stick();
    }
    function request(row) {
      if (!isEnabled() || !row.job) return;
      cancel(row.job.id);
      submit(row.job, event => result(row, event));
    }
    function cancelRow(row) {
      if (row.job) cancel(row.job.id);
      if (row.job && row.state !== 'done') result(row, { ...row.job, status: 'cancelled' });
      row.retry.hidden = true;
    }

    function render(update) {
      if (!alive) return;
      if (update.changed) {
        const touched = new Set();
        for (const id of update.removed) {
          const part = parts.get(id);
          if (!part) continue;
          part.node.remove(); parts.delete(id); part.row.parts.delete(id); touched.add(part.row);
        }
        for (const entry of update.updated) {
          newest = Math.max(newest, entry.id);
          if (entry.id <= cleared) continue;
          const row = rows.get(entry.paragraph) || addRow(entry.paragraph, entry.at);
          let part = parts.get(entry.id);
          if (!part) {
            part = { row, node: doc.createElement('span') };
            parts.set(entry.id, part); row.parts.set(entry.id, part); row.raw.appendChild(part.node);
          }
          part.text = entry.text; part.interim = entry.interim;
          const value = entry.interim ? entry.text : punct(entry.text);
          if (part.node.textContent !== value) part.node.textContent = value;
          part.node.classList.toggle('interim', entry.interim);
          touched.add(row);
        }
        for (const row of touched) {
          if (!row.parts.size) { removeRow(row); continue; }
          const text = [...row.parts.values()].map(part => part.text).join('\n');
          if (row.job && row.job.text !== text) {
            cancelRow(row); row.job = null; row.state = null;
            showOriginal(row, true); row.toggle.hidden = true; row.status.textContent = '原文更新・校正解除';
          }
          row.text = text;
          queueSave(row);
        }
        paintBubble();
        if (update.newTextParagraphs.length) note.textContent = status.textContent = '';
        if (!following) for (const id of update.newTextParagraphs) if (rows.has(id)) unread.add(id);
        stick();
        controls();
      }
      // New closure events only: enabling proofreading never sends old text.
      for (const id of update.closedParagraphs || []) {
        const row = rows.get(id);
        if (!row || !isEnabled()) continue;
        row.job = { id: prefix + id, text: row.text, context: row.context };
        request(row);
      }
    }

    // Earlier text from today (before a reload or a source change) goes above.
    if (store && stream) {
      const expected = generation;
      Promise.resolve(store.load(stream)).then(records => {
        if (!alive || expected !== generation) return;
        const first = log.firstChild, block = doc.createDocumentFragment();
        for (const record of records) {
          if (record.session === session || !record.text) continue;
          const row = makeRow(record.at, record.name);
          row.raw.textContent = record.text;
          if (record.corrected) {
            row.corrected.textContent = record.corrected;
            row.tools.hidden = row.toggle.hidden = false;
            row.status.textContent = 'LLM校正案';
            showOriginal(row, false);
          }
          block.appendChild(row.node); divide(row.node);
        }
        log.insertBefore(block, first);
        if (first?.captionRow) divide(first);
        stick();
      }).catch(() => {});
    }
    controls();

    return {
      panel,
      updateAsr(results, now, token) {
        render(history.updateAsr(results, now, token));
        render(history.settle(now, token));
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => render(history.settle(performance.now(), token)), history.gapMs);
      },
      settle: (now, token) => render(history.settle(now, token)),
      append(text, start, end) { const update = history.appendCue(text, start, end); render(update); return update.changed; },
      interrupt() { clearTimeout(settleTimer); render(history.interrupt()); },
      resetRecognition() { clearTimeout(settleTimer); render(history.interrupt()); return history.resetRecognition(); },
      tail: n => history.tail(n),
      // Call after mounting `panel`: a hidden log has no scroll geometry to keep.
      shown: follow,
      message(text) { if (alive) note.textContent = status.textContent = text; },
      // Plain text of the log as displayed, one timestamped paragraph per line.
      text() {
        return [...log.children].map(node => {
          const row = node.captionRow;
          if (!row) return `— ${node.textContent} —`;
          const body = (row.corrected.hidden ? row.raw : row.corrected).textContent.trim();
          return body && `[${clock(row.at)}] ${body}`;
        }).filter(Boolean).join('\n');
      },
      get size() { return log.children.length; },
      // Forget today's log for this stream, on screen and on the device.
      clear() {
        generation++;
        for (const row of rows.values()) cancelRow(row);
        clearTimeout(saveTimer); saveTimer = null;
        rows.clear(); parts.clear(); dirty.clear(); unread.clear();
        cleared = newest; last = previous = null;
        log.replaceChildren(); paintBubble();
        following = true; controls();
        return store && stream ? store.clear(stream) : undefined;
      },
      cancelProofreading() { for (const row of rows.values()) cancelRow(row); },
      flush() { if (alive && store && stream) flush(); },
      stop() {
        if (!alive) return;
        if (store && stream) { render(history.interrupt()); flush(); }
        for (const row of rows.values()) cancelRow(row);
        alive = false; clearTimeout(settleTimer); history.interrupt();
        el.replaceChildren(); panel.remove();
      },
    };
  }
  return { create };
});
