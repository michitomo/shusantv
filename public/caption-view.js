// Viewing-session caption DOM. Network/configuration is supplied by the page.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.shusantvCaptionView = api;
})(globalThis, function () {
  let nextView = 0;
  const punct = text => !text || /[。、．，！？!?]$/.test(text) ? text
    : /(です|ます|でした|ました|ません|ございます|であります)(ね|よ)?$/.test(text) ? text + '。' : text + '、';
  function create(el, { getContext = () => ({}), isEnabled = () => false, submit = () => {}, cancel = () => {} } = {}) {
    el.innerHTML = '<div class="bubble" role="region" aria-label="視聴中の字幕。上へスクロールで追尾停止"></div><div class="caption-controls"><span class="caption-note"></span><button class="caption-return" type="button" hidden>ライブに戻る</button></div>';
    const bubble = el.querySelector('.bubble'), note = el.querySelector('.caption-note'), back = el.querySelector('button');
    const history = shusantvCaptionHistory.createHistory(), rows = new Map(), fragments = new Map(), unread = new Set();
    const prefix = `caption${++nextView}:`, hint = '字幕履歴: 上へスクロール（最大2000件・保存なし）';
    let following = true, alive = true, anchoring = false, settleTimer;
    function controls() {
      back.hidden = following; note.hidden = !following;
      back.textContent = `${unread.size ? `新着 ${unread.size} 段落 · ` : ''}ライブに戻る`;
    }
    function follow() { following = true; unread.clear(); bubble.scrollTop = bubble.scrollHeight; controls(); }
    function anchored(change, kept = null) {
      if (anchoring) { change(); return; }
      const top = bubble.getBoundingClientRect().top;
      const keptNodes = kept && new Set([...fragments].filter(([id]) => kept.has(id)).map(([, node]) => node));
      const visible = [...rows.values()].flatMap(row => {
        const raw = [...row.raw.children].filter(node => !keptNodes || keptNodes.has(node));
        return row.corrected.hidden ? raw : raw.length ? [row.corrected] : [];
      });
      const anchor = following ? null : visible.find(node => node.getBoundingClientRect().bottom > top);
      const anchorTop = anchor?.getBoundingClientRect().top;
      anchoring = true;
      try { change(); } finally { anchoring = false; }
      if (following) bubble.scrollTop = bubble.scrollHeight;
      else if (anchor?.isConnected && !anchor.closest('[hidden]')) bubble.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
    }
    bubble.addEventListener('scroll', () => {
      following = bubble.scrollHeight - bubble.scrollTop - bubble.clientHeight < 8;
      if (following) unread.clear();
      controls();
    });
    el.addEventListener('click', event => event.stopPropagation());
    back.addEventListener('click', follow);
    function showOriginal(row, original) {
      row.raw.hidden = !original; row.corrected.hidden = original;
      row.toggle.textContent = original ? '校正案' : '元字幕';
    }
    function result(row, event) {
      if (!alive || rows.get(row.id) !== row || row.job?.text !== event.text) return;
      if (event.status === 'cancelled' && row.state === 'done') return;
      anchored(() => {
        row.state = event.status;
        row.tools.hidden = false;
        row.status.textContent = ({queued:'校正待ち', running:'校正中', done:'LLM校正案', error:'校正失敗・原文', cancelled:'校正停止・原文'})[event.status];
        row.toggle.hidden = event.status !== 'done';
        row.retry.hidden = event.status !== 'error' || !isEnabled();
        if (event.status === 'done') {
          row.corrected.textContent = event.correctedText;
          // Never replace the text underneath someone reading history.
          showOriginal(row, !following);
        } else showOriginal(row, true);
      });
    }
    function request(row) {
      if (!isEnabled() || !row.job) return;
      cancel(row.job.id);
      submit(row.job, event => result(row, event));
    }
    function addRow(id) {
      const node = document.createElement('p');
      node.innerHTML = '<span class="caption-original"></span><span class="caption-corrected" hidden></span><small class="caption-proof" hidden><span></span> <button type="button" hidden>元字幕</button> <button type="button" hidden>再試行</button></small>';
      const row = { id, node, context: { ...getContext() }, raw: node.children[0], corrected: node.children[1], tools: node.children[2] };
      row.status = row.tools.querySelector('span');
      [row.toggle, row.retry] = row.tools.querySelectorAll('button');
      row.toggle.onclick = () => anchored(() => showOriginal(row, row.raw.hidden));
      row.retry.title = '再送信します。追加料金が発生する場合があります';
      row.retry.onclick = () => request(row);
      rows.set(id, row); bubble.appendChild(node);
      return row;
    }
    function cancelRow(row) {
      if (row.job) cancel(row.job.id);
      if (row.job && row.state !== 'done') result(row, { ...row.job, status: 'cancelled' });
      row.retry.hidden = true;
    }
    function render(update) {
      if (!alive) return;
      if (update.changed) {
        const kept = new Set(update.entries.map(entry => entry.id)), paragraphs = new Map();
        for (const entry of update.entries) {
          if (!paragraphs.has(entry.paragraph)) paragraphs.set(entry.paragraph, []);
          paragraphs.get(entry.paragraph).push(entry);
        }
        anchored(() => {
          for (const [id, entries] of paragraphs) {
            const row = rows.get(id) || addRow(id);
            const text = entries.map(entry => entry.text).join('\n');
            if (row.job && row.job.text !== text) {
              cancelRow(row); row.job = null; row.state = null;
              showOriginal(row, true); row.toggle.hidden = true; row.status.textContent = '原文更新・校正解除';
            }
            row.text = text;
            for (const entry of entries) {
              let fragment = fragments.get(entry.id);
              if (!fragment) { fragment = document.createElement('span'); fragments.set(entry.id, fragment); row.raw.appendChild(fragment); }
              const value = entry.interim ? entry.text : punct(entry.text);
              if (fragment.textContent !== value) fragment.textContent = value;
              fragment.classList.toggle('interim', entry.interim);
            }
          }
          for (const [id, node] of fragments) if (!kept.has(id)) { node.remove(); fragments.delete(id); }
          for (const [id, row] of rows) if (!paragraphs.has(id)) { cancelRow(row); row.node.remove(); rows.delete(id); }
        }, kept);
        if (update.newTextParagraphs.length) note.textContent = hint;
        if (!following) for (const id of update.newTextParagraphs) unread.add(id);
        controls();
      }
      // New closure events only: enabling proofreading never sends old history.
      for (const id of update.closedParagraphs || []) {
        const row = rows.get(id);
        if (!row || !isEnabled()) continue;
        row.job = { id: prefix + id, text: row.text, context: row.context };
        request(row);
      }
    }
    return {
      updateAsr(results, now, token) {
        render(history.updateAsr(results, now, token));
        render(history.settle(now, token));
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => render(history.settle(performance.now(), token)), 3000);
      },
      settle: (now, token) => render(history.settle(now, token)),
      append(text, start, end) { const update = history.appendCue(text, start, end); render(update); return update.changed; },
      interrupt() { clearTimeout(settleTimer); render(history.interrupt()); },
      resetRecognition() { clearTimeout(settleTimer); render(history.interrupt()); return history.resetRecognition(); },
      tail: n => history.snapshot().map(entry => entry.text).join('').slice(-n),
      focus(on) { bubble.tabIndex = on ? 0 : -1; if (!on) { bubble.blur?.(); follow(); } else if (following) bubble.scrollTop = bubble.scrollHeight; },
      message(text) { if (alive) note.textContent = text; },
      cancelProofreading() { for (const row of rows.values()) cancelRow(row); },
      stop() { alive = false; clearTimeout(settleTimer); for (const row of rows.values()) cancelRow(row); history.interrupt(); el.replaceChildren(); },
    };
  }
  return { create };
});
