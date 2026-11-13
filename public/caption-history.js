// Viewing-session caption model: no storage here and no speaker inference.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.shusantvCaptionHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Recognizers rarely punctuate; close a finished result the way it is displayed.
  const punctuate = text => !text || /[。、．，！？!?]$/.test(text) ? text
    : /(です|ます|でした|ました|ません|ございます|であります)(ね|よ)?$/.test(text) ? text + '。' : text + '、';
  const endsSentence = text => /[。．！？!?]$/.test(punctuate(text));
  // The on-device recognizer often returns Japanese as space-separated words
  // ("自衛 隊 を 明記 する"). Join them, keeping spaces only inside Latin text; spaced
  // output also hid watch-list names ("塩 川") from detection.
  const JA = '\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef';
  const SPACED = new RegExp(`\\s+(?=[${JA}])|(?<=[${JA}])\\s+`, 'g');
  const joinWords = text => text.replace(SPACED, '');
  // The recognizer keeps one result open for a long time (hundreds of characters
  // of fast speech), so waiting for it to finalize delays everything downstream.
  // When the engine punctuates its own output (SpeechRecognition.unspokenPunctuation),
  // a sentence is finished inside a still-growing result at its 「。」「？」「！」.
  // Only the engine's punctuation counts: guessing from word endings such as
  // 「ます」 cuts inside words like 「ますます」.
  const SENTENCE_END = /[。．！？!?]+/gu;
  // Returns where the first finished sentence of at least `min` characters ends, or
  // 0. `ahead` characters must follow it, so the recognizer has moved on past it.
  function sentenceCut(text, min, ahead) {
    SENTENCE_END.lastIndex = 0;
    for (let match; (match = SENTENCE_END.exec(text));) {
      const end = match.index + match[0].length;
      if (end > text.length - ahead) return 0;
      if (end >= min) return end;
    }
    return 0;
  }
  const SENTENCE_AHEAD = 4;
  // gapMs: silence that ends a paragraph (and, for ASR, sends it to proofreading).
  // sentenceChars: an ASR paragraph of at least this many characters also ends at a
  // finished sentence, so continuous speech is proofread without waiting for a pause.
  // paragraphChars: the recognizer finalizes fast speech in long runs that stop
  // mid-sentence; past this length a finalized run ends the paragraph anyway, so a
  // five-minute speech is not one unreadable block.
  function createHistory({ gapMs = 1500, maxEntries = 20000, clock = Date.now, sentenceChars = 15, paragraphChars = 200 } = {}) {
    const limit = Math.max(1, Math.floor(maxEntries) || 20000);
    let entries = [], nextId = 1, paragraph = 1;
    let slots = new Map(), finalizedThrough = -1, run = 0, active = true;
    // Per open result: the leading text already split off as finished sentences.
    let taken = new Map();
    let lastChange = null, lastCue = null, cueEnd = null;
    const closed = new Set(), asrParagraphs = new Set();
    const clean = text => String(text || '').trim();
    const snapshot = () => entries.map(entry => ({ ...entry }));
    // Views apply `updated`/`removed` so a day-long log costs O(change) per result.
    let touched = new Set(), removed = [];
    const result = (added = 0, changed = false, newTextParagraphs = [], closedParagraphs = []) => {
      const out = {
        get entries() { return snapshot(); }, added, changed, newTextParagraphs: [...new Set(newTextParagraphs)],
        closedParagraphs, updated: [...touched].map(entry => ({ ...entry })), removed
      };
      touched = new Set(); removed = [];
      return out;
    };
    function drop(entry) {
      touched.delete(entry);
      removed.push(entry.id);
      const index = entries.lastIndexOf(entry);
      if (index >= 0) entries.splice(index, 1);
    }
    function trim() {
      if (entries.length <= limit) return;
      for (const entry of entries.splice(0, entries.length - limit)) { touched.delete(entry); removed.push(entry.id); }
      const kept = new Set(entries);
      for (const [index, entry] of slots) if (!kept.has(entry)) slots.delete(index);
      const paragraphs = new Set(entries.map(entry => entry.paragraph));
      for (const id of closed) if (!paragraphs.has(id)) closed.delete(id);
      for (const id of asrParagraphs) if (!paragraphs.has(id)) asrParagraphs.delete(id);
    }
    function closeParagraph(id) {
      if (closed.has(id) || !asrParagraphs.has(id)) return false;
      let found = false;
      for (let i = entries.length - 1; i >= 0 && entries[i].paragraph >= id; i--) {
        if (entries[i].paragraph !== id) continue;
        if (entries[i].interim) return false;
        found = true;
      }
      if (!found) return false;
      closed.add(id);
      return true;
    }
    function sentenceClosed() {
      const tail = entries[entries.length - 1];
      if (!tail || tail.paragraph !== paragraph || tail.interim) return false;
      let length = 0;
      for (let i = entries.length - 1; i >= 0 && entries[i].paragraph === paragraph && length < paragraphChars; i--) length += entries[i].text.length;
      const enough = endsSentence(tail.text) ? length >= sentenceChars : length >= paragraphChars;
      return enough && closeParagraph(paragraph);
    }
    // A timer may settle final text, but lifecycle interruptions never do.
    function settle(now = Date.now(), token = run) {
      if (!active || token !== run || lastChange === null || now - lastChange < gapMs) return result();
      return result(0, false, [], closeParagraph(paragraph) ? [paragraph] : []);
    }
    // The speaker paused (the caller heard silence) while the recognizer still holds
    // the result open. Once the text has also stopped changing for `stableMs` — the
    // words before the pause have arrived — end the paragraph there; what the
    // recognizer adds to this result afterwards starts a new one.
    function pause(now = Date.now(), token = run, stableMs = 400) {
      if (!active || token !== run || lastChange === null || now - lastChange < stableMs) return result();
      const tail = entries[entries.length - 1];
      if (!tail || !tail.interim || tail.paragraph !== paragraph) return result();
      let slot = null, length = 0;
      for (const [index, entry] of slots) if (entry === tail) slot = index;
      for (let i = entries.length - 1; i >= 0 && entries[i].paragraph === paragraph && length < sentenceChars; i--) length += entries[i].text.length;
      if (slot === null || length < sentenceChars) return result();
      tail.interim = false;
      touched.add(tail);
      taken.set(slot, (taken.get(slot) || '') + tail.text);
      slots.delete(slot);
      return result(0, true, [], closeParagraph(paragraph) ? [paragraph] : []);
    }
    function add(text, interim, split) {
      if (split && entries.length) paragraph++;
      // `at` is the wall-clock viewing time; gap detection uses the caller's clock.
      const entry = { id: nextId++, paragraph, text, interim, at: clock() };
      entries.push(entry);
      touched.add(entry);
      return entry;
    }
    // Results are the complete cumulative Web Speech result list for this run.
    // Capture resetRecognition()'s token in the recognizer's event callbacks.
    function updateAsr(results, now = Date.now(), token = run) {
      if (!active || token !== run) return result();
      let added = 0, changed = false;
      const newTextParagraphs = [], closedParagraphs = [];
      // One piece of a result: create or update the entry currently mapped to its slot.
      function apply(index, text, final) {
        let entry = slots.get(index);
        if (text) {
          if (!entry) {
            entry = add(text, !final, closed.has(paragraph) || (lastChange !== null && now - lastChange >= gapMs));
            asrParagraphs.add(entry.paragraph);
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
              touched.add(entry);
              changed = true;
            }
            if (entry.interim === final) { entry.interim = !final; touched.add(entry); changed = true; }
          }
        } else if (entry && entry.interim) {
          drop(entry);
          slots.delete(index);
          changed = true;
        }
      }
      for (let index = 0; index < results.length; index++) {
        if (index <= finalizedThrough) continue;
        const value = results[index], final = !!value.final;
        let text = joinWords(clean(value.text));
        // Sentences already split off stay as they were shown, even if the recognizer
        // later rewords them; only what follows them is still live.
        const head = taken.get(index);
        if (head) text = text.startsWith(head) ? text.slice(head.length) : text.slice(Math.min(head.length, text.length));
        for (let cut; (cut = sentenceCut(text, sentenceChars, final ? 1 : SENTENCE_AHEAD));) {
          apply(index, text.slice(0, cut), true);
          taken.set(index, (taken.get(index) || '') + text.slice(0, cut));
          slots.delete(index); // the rest of this result continues in a new entry
          text = text.slice(cut);
          if (closeParagraph(paragraph)) closedParagraphs.push(paragraph);
        }
        apply(index, text, final);
        if (final) {
          finalizedThrough = index;
          taken.delete(index);
          // Before the next result is added, so it starts a new paragraph.
          if (text && sentenceClosed()) closedParagraphs.push(paragraph);
        }
      }
      // An engine may retract trailing interim results without finalizing them.
      for (const [index, entry] of slots) {
        if (index >= results.length && entry.interim) {
          drop(entry);
          slots.delete(index);
          changed = true;
        }
      }
      for (const index of taken.keys()) if (index >= results.length) taken.delete(index);
      trim();
      for (const id of asrParagraphs) {
        if (id !== paragraph && closeParagraph(id)) closedParagraphs.push(id);
      }
      return result(added, changed, newTextParagraphs, closedParagraphs);
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
    // late recognizer callbacks and clear both clocks. Text already shown stays:
    // recognizers restart often, and dropping the unfinished tail made captions
    // vanish mid-sentence. It is kept as-is (never re-recognized, so no duplicate).
    function interrupt() {
      run++;
      active = false;
      let changed = false;
      for (const entry of slots.values()) {
        if (!entry.interim) continue;
        entry.interim = false;
        touched.add(entry);
        changed = true;
      }
      slots.clear();
      taken.clear();
      finalizedThrough = -1;
      lastChange = null;
      cueEnd = null;
      return result(0, changed);
    }
    function tail(length) {
      let text = '';
      for (let i = entries.length - 1; i >= 0 && text.length < length; i--) text = entries[i].text + text;
      return text.slice(-length);
    }
    function resetRecognition() {
      interrupt();
      active = true;
      return run;
    }
    return { updateAsr, appendCue, settle, pause, interrupt, resetRecognition, snapshot, tail, gapMs };
  }
  return { createHistory, punctuate, joinWords, sentenceCut };
});
