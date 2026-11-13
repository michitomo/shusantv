// DOM mode mocks layout/media; browser mode runs the same listing scenarios in Chromium.
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { createFixture, HlsMock, publicFile } from './ui-fixture.mjs';
const require = createRequire(import.meta.url);
export async function createHarness(browserMode = false, { captionMedia = true, asr = false, storage = {}, fetch: request } = {}) {
  const fixture = createFixture(), { state } = fixture, errors = [];
  const browser = browserMode ? await require('playwright').chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }) : null;
  async function open(file, search = '') {
    if (browser) {
      const page = await browser.newPage();
      page.on('pageerror', error => errors.push(String(error)));
      await page.route('**/*', async route => {
        const response = await fixture.fetch(route.request().url());
        await route.fulfill({ status: response.status, body: await response.text(), headers: { ...Object.fromEntries(response.headers), 'Access-Control-Allow-Origin': '*' } });
      });
      await page.clock.install({ time: new Date(state.now) });
      await page.goto(`https://test.local/${file}${search}`);
      return { eval: code => page.evaluate(code), tick: () => page.clock.setFixedTime(new Date(state.now)), close: () => page.close(), errors };
    }
    const { parseHTML } = require(process.env.LINKEDOM_PATH || 'linkedom');
    const html = await publicFile(file), { document, window: dom } = parseHTML(html);
    const select = document.getElementById('meeting');
    if (select) Object.defineProperty(select, 'value', {
      get() { return this.querySelector('option[selected]')?.getAttribute('value') || ''; },
      set(value) { for (const option of this.querySelectorAll('option')) option.toggleAttribute('selected', option.getAttribute('value') === value); },
    });
    Object.defineProperty(document, 'hidden', { value: false, writable: true });
    const timers = new Set(), store = new Map(Object.entries(storage));
    const events = document.createElement("span");
    const timeout = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
    class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [state.now])); } static now() { return state.now; } }
    const location = new URL(`https://test.local/${file}${search}`);
    const sandbox = {
      document, console, Date: ClockDate, Intl, URL, URLSearchParams, AbortController, AbortSignal, Response, Blob,
      TextEncoder, TextDecoder, performance, Map, Set, Promise, Uint8Array, crypto: webcrypto, Hls: HlsMock, Event: dom.Event,
      fetch: (url, options) => request ? request(url, options, fixture.fetch) : fixture.fetch(url, options), location, history: { replaceState(_, __, url) { location.href = String(url); } }, navigator: {},
      localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
      innerHeight: 768, innerWidth: 1024, scrollY: 0, scrollX: 0,
      scrollTo(x, y) { sandbox.scrollY = typeof x === 'object' ? x.top : y; }, scrollBy(x, y) { sandbox.scrollY += y; },
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events), setTimeout: timeout, clearTimeout,
      setInterval: (fn, ms) => { const id = setInterval(fn, ms); timers.add(id); return id; }, clearInterval,
      requestAnimationFrame: fn => timeout(() => fn(performance.now()), 0), cancelAnimationFrame: clearTimeout,
    };
    dom.HTMLElement.prototype.getBoundingClientRect = function () {
      const index = Math.max(0, [...document.querySelectorAll('.cue')].indexOf(this));
      return { top: index * 34 - sandbox.scrollY, bottom: (index + 1) * 34 - sandbox.scrollY, height: 34, width: 800 };
    };
    Object.defineProperty(document.body, 'scrollHeight', { get: () => document.querySelectorAll('.cue').length * 34 + 200 });
    // DOM media/caption mocks: no real playback, layout, or recognition.
    if (captionMedia) {
      const media = new WeakMap();
      const mediaState = video => {
        if (!media.has(video)) {
          const target = document.createElement('span'), tracks = [];
          tracks.addEventListener = target.addEventListener.bind(target);
          tracks.removeEventListener = target.removeEventListener.bind(target);
          tracks.dispatchEvent = target.dispatchEvent.bind(target);
          media.set(video, { paused: false, tracks });
        }
        return media.get(video);
      };
      Object.defineProperties(dom.HTMLElement.prototype, {
        paused: { configurable: true, get() { return mediaState(this).paused; } },
        textTracks: { configurable: true, get() { return mediaState(this).tracks; } },
      });
      dom.HTMLElement.prototype.play = function () { mediaState(this).paused = false; this.dispatchEvent(new dom.Event('playing')); return Promise.resolve(); };
      dom.HTMLElement.prototype.pause = function () { mediaState(this).paused = true; this.dispatchEvent(new dom.Event('pause')); };
      sandbox.performance = { now: () => state.now };
      sandbox.makeCaptionTrack = () => {
        const track = document.createElement('span');
        track.kind = 'subtitles'; track.activeCues = [];
        track.emit = cues => { track.activeCues = cues; track.dispatchEvent(new dom.Event('cuechange')); };
        return track;
      };
      if (asr) {
        sandbox.SpeechRecognition = class {
          static instances = [];
          static async available() { return 'available'; }
          constructor() { this.constructor.instances.push(this); }
          start(track) { this.track = track; }
          abort() { this.aborted = true; this.onend?.(); }
          stop() { this.stopped = true; }
          emit(results) { this.onresult?.({ results: results.map(([text, final = false]) => Object.assign([{ transcript: text }], { isFinal: final })) }); }
        };
        const node = () => ({ gain: { value: 0 }, connect(target) { return target; }, disconnect() { this.disconnected = true; } });
        sandbox.AudioContext = class {
          destination = node();
          createMediaElementSource() { return node(); }
          createGain() { return node(); }
          createMediaStreamDestination() { const track = { kind: 'audio', stop() { this.stopped = true; } }; return { ...node(), stream: { getAudioTracks: () => [track] } }; }
        };
      }
    }
    sandbox.window = sandbox;
    const context = vm.createContext(sandbox);
    for (const [, attributes, inline] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      const src = attributes.match(/src="([^"]+)"/)?.[1];
      if (attributes.includes('type="module"') || src?.startsWith('http')) continue;
      vm.runInContext(src ? await publicFile(src) : inline, context, { filename: src || file });
    }
    return { eval: code => vm.runInContext(code, context), tick() {}, close: () => { for (const id of timers) clearTimeout(id); }, errors: [] };
  }
  return { state, open, errors, close: () => browser?.close() };
}
