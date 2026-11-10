(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.shusantvTranscript = api;
})(globalThis, function () {
  // Separate capacity guarantees that slow history never occupies the live lane.
  function createLoader({ fetchText, onText, onProgress = () => {}, concurrency = 8,
    recentCount = 24, retryDelay = 3000, setTimer = setTimeout, clearTimer = clearTimeout }) {
    const jobs = new Map(), queues = { recent: [], history: [] };
    const active = { recent: 0, history: 0 };
    const limits = { recent: Math.max(1, Math.ceil(concurrency / 2)), history: Math.max(1, Math.floor(concurrency / 2)) };
    let stopped = false, historyReady = false;
    function pump(lane) {
      if (lane === 'history' && !historyReady) return;
      while (!stopped && active[lane] < limits[lane] && queues[lane].length) {
        const job = queues[lane].shift();
        if (job.state !== 'queued' || job.lane !== lane) continue;
        active[lane]++; job.state = 'loading'; job.attempts++;
        Promise.resolve().then(() => fetchText(job.url)).then(text => {
          if (stopped) return;
          onText(text, job.url);
          job.state = 'done';
          if (lane === 'recent') { historyReady = true; pump('history'); }
        }).catch(() => {
          if (stopped) return;
          job.state = 'failed';
          if (job.attempts < 3) job.timer = setTimer(() => {
            job.timer = null;
            if (stopped) return;
            job.state = 'queued'; queues[job.lane].push(job); pump(job.lane);
          }, retryDelay * job.attempts);
        }).finally(() => {
          active[lane]--;
          job.resolve(); // First attempt releases initial loading; retries continue independently.
          if (stopped) return;
          onProgress([...jobs.values()].filter(j => j.state === 'done').length, jobs.size);
          pump(lane);
        });
      }
    }
    return {
      enqueue(urls) {
        if (stopped) return Promise.resolve();
        const latest = new Set(urls.slice(-recentCount));
        for (const url of [...urls].reverse()) {
          let job = jobs.get(url);
          if (!job) {
            let resolve;
            const promise = new Promise(r => { resolve = r; });
            job = { url, state: 'queued', attempts: 0, lane: latest.has(url) ? 'recent' : 'history', promise, resolve };
            jobs.set(url, job); queues[job.lane].push(job);
          } else if (job.state === 'failed' && !job.timer) {
            job.attempts = 0; job.state = 'queued'; queues[job.lane].push(job);
          } else if (latest.has(url) && job.lane === 'history' && job.state === 'queued') {
            job.lane = 'recent'; queues.recent.push(job);
          }
        }
        // New playlist additions take precedence over still queued recent entries.
        const rank = new Map(urls.map((url, i) => [url, i]));
        queues.recent.sort((a, b) => (rank.get(b.url) ?? -1) - (rank.get(a.url) ?? -1));
        pump('recent'); pump('history');
        return Promise.all([...latest].map(url => jobs.get(url).promise)).then(() => {
          historyReady = true; pump('history');
        });
      },
      stats() {
        const all = [...jobs.values()];
        const done = all.filter(j => j.state === 'done').length;
        const failed = all.filter(j => j.state === 'failed' && j.attempts >= 3).length;
        return { total: all.length, done, failed, pending: all.length - done - failed };
      },
      stop() {
        stopped = true;
        for (const job of jobs.values()) { if (job.timer) clearTimer(job.timer); job.resolve(); }
        queues.recent.length = queues.history.length = 0;
      }
    };
  }
  function mergeCues(existing, fresh) {
    const result = [];
    for (const cue of [...existing, ...fresh].sort((a, b) => a.t - b.t)) {
      const last = result[result.length - 1];
      if (last && last.text === cue.text && cue.t - last.end <= 6) {
        last.end = Math.max(last.end, cue.end);
        // Keep an existing DOM node/annotation when its earlier neighbor arrives.
        if (!last.row && cue.row) last.row = cue.row;
      } else result.push(cue);
    }
    return result;
  }
  return { createLoader, mergeCues };
});
