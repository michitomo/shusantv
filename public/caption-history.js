// Viewing-session captions only: no storage and no speaker inference.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.shusantvCaptionHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createHistory({ gapMs = 3000, maxEntries = 2000 } = {}) {
    const limit = Math.max(1, Math.floor(maxEntries) || 2000);
    let entries = [], nextId = 1, paragraph = 1;
    let slots = new Map(), finalizedThrough = -1, run = 0, active = true;
    let lastChange = null, lastCue = null, cueEnd = null;
    const clean = text => String(text || '').trim();
    const snapshot = () => entries.map(entry => ({ ...entry }));
    const result = (added = 0, changed = false, newTextParagraphs = []) => ({
      entries: snapshot(), added, changed, newTextParagraphs: [...new Set(newTextParagraphs)]
    });
    function trim() {
      if (entries.length <= limit) return;
      entries.splice(0, entries.length - limit);
      const kept = new Set(entries);
      for (const [index, entry] of slots) if (!kept.has(entry)) slots.delete(index);
    }
    function add(text, interim, split) {
      if (split && entries.length) paragraph++;
      const entry = { id: nextId++, paragraph, text, interim };
      entries.push(entry);
      return entry;
    }
    // Results are the complete cumulative Web Speech result list for this run.
    // Capture resetRecognition()'s token in the recognizer's event callbacks.
    function updateAsr(results, now = Date.now(), token = run) {
      if (!active || token !== run) return result();
      let added = 0, changed = false;
      const newTextParagraphs = [];
      for (let index = 0; index < results.length; index++) {
        if (index <= finalizedThrough) continue;
        const value = results[index], text = clean(value.text), final = !!value.final;
        let entry = slots.get(index);
        if (text) {
          if (!entry) {
            entry = add(text, !final, lastChange !== null && now - lastChange >= gapMs);
            slots.set(index, entry);
            added++;
            newTextParagraphs.push(entry.paragraph);
            changed = true;
            lastChange = now;
          } else {
            // Corrections, including equal-length corrections, replace the interim.
            // Finalizing unchanged text is not a new utterance or a timing update.
            if (entry.text !== text) {
              // Punctuation added on finalization is not newly spoken text.
              if (text.startsWith(entry.text) && /[^\s\p{P}]/u.test(text.slice(entry.text.length))) {
                newTextParagraphs.push(entry.paragraph);
                lastChange = now;
              }
              entry.text = text;
              changed = true;
            }
            if (entry.interim === final) { entry.interim = !final; changed = true; }
          }
        } else if (entry && entry.interim) {
          entries = entries.filter(item => item !== entry);
          slots.delete(index);
          changed = true;
        }
        if (final) finalizedThrough = index;
      }
      // An engine may retract trailing interim results without finalizing them.
      for (const [index, entry] of slots) {
        if (index >= results.length && entry.interim) {
          entries = entries.filter(item => item !== entry);
          slots.delete(index);
          changed = true;
        }
      }
      trim();
      return result(added, changed, newTextParagraphs);
    }
    // Cue times are seconds on the media timeline, not HTTP arrival times.
    // The caller supplies newly viewed cues in media order, not a backlog fetch.
    function appendCue(text, start, end, now = Date.now()) {
      text = clean(text);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return result();
      if (lastCue && start < lastCue.start) return result();
      // HLS can repeat the same cue at shifted segment boundaries.
      if (lastCue && text === lastCue.text && start - lastCue.end <= 6) {
        lastCue.end = Math.max(lastCue.end, end);
        if (cueEnd !== null) cueEnd = Math.max(cueEnd, end);
        return result();
      }
      const split = cueEnd !== null && (start - cueEnd) * 1000 >= gapMs;
      const entry = add(text, false, split);
      lastCue = { start, end, text };
      cueEnd = end;
      trim();
      return result(1, true, [entry.paragraph]);
    }
    // Pause/buffering/stop/restart is not evidence of a speech pause. Invalidate
    // late recognizer callbacks, discard unfinished text, and clear both clocks.
    function interrupt() {
      run++;
      active = false;
      const before = entries.length;
      entries = entries.filter(entry => !entry.interim);
      slots.clear();
      finalizedThrough = -1;
      lastChange = null;
      cueEnd = null;
      return result(0, entries.length !== before);
    }
    function resetRecognition() {
      interrupt();
      active = true;
      return run;
    }
    return { updateAsr, appendCue, interrupt, resetRecognition, snapshot };
  }
  return { createHistory };
});
