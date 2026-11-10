// Shared offline fixtures for DOM and Chromium tests. Unexpected requests fail closed.
import { readFile } from 'node:fs/promises';
export const publicFile = file => readFile(new URL(`../public/${file}`, import.meta.url), 'utf8');
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export class HlsMock {
  static Events = { MANIFEST_PARSED: 'manifest', LEVEL_SWITCHED: 'level', ERROR: 'error', SUBTITLE_TRACKS_UPDATED: 'subs' };
  constructor() { this.sources = []; this.events = {}; this.levels = [{ bitrate: 300000 }]; this.subtitleTracks = []; this.subtitleTrack = -1; }
  on(event, callback) { this.events[event] = callback; }
  loadSource(url) { this.sources.push(url); }
  attachMedia() {}
  destroy() { this.destroyed = true; }
}
export function createFixture() {
  const hash = 'cpl6pa5632pig7l1fg4g';
  const state = { now: Date.parse('2026-11-10T04:30:00Z'), listed: false, listingFails: true, active: true, uid: 'browserfixtureprogram001', vod: false };
  const stamp = (time = state.now) => new Date(time).toISOString();
  const entry = () => {
    const base = `https://sangiin-live.live.ipcasting.jp/live/${hash}.h/${state.uid}`;
    return { house: 'sangiin', id: 'sid9456', name: '総務委員会', time: '13:00', m3u8: `${base}/index.m3u8`, channelInfo: `${base}/channel-info.json` };
  };
  async function fetch(value) {
    const url = new URL(value, 'https://test.local/');
    if (url.hostname === 'test.local') {
      if (url.pathname === '/streams.json') return state.listingFails ? new Response('fail', { status: 503 }) : Response.json({
        updatedAt: stamp(), sessionDate: '2026-11-10', streams: state.listed && !state.vod ? [entry()] : [],
        vod: state.vod ? [{ house: 'sangiin', id: 'sid9456', name: '総務委員会', hash: 'vodfixture' }] : [],
      });
      return new Response(await publicFile(url.pathname.slice(1) || 'index.html'), { headers: { 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html' } });
    }
    if (url.hostname === 'cdn.jsdelivr.net') return new Response(url.pathname.includes('hls.js')
      ? `window.Hls = ${HlsMock};` : 'export const loadDefaultJapaneseParser=()=>({parse:s=>[s]});', { headers: { 'Content-Type': 'text/javascript' } });
    if (url.hostname === 'hlslive.shugiintv.go.jp') return new Response('', { status: 404 });
    if (url.hostname === 'sangiin-live.live.ipcasting.jp') {
      if (url.pathname.endsWith('channel-info.json')) return Response.json({ config: { published: 'public' }, status: {
        output: state.active ? 'active' : 'inactive', program_id: url.pathname.includes(hash) ? 9456 : 65535, program_uid: state.uid,
        program_start: stamp(state.now - 1800000), date: stamp(), latest_pts: stamp(), subtitle: 'active',
      }, schedules: [] });
      if (url.pathname.endsWith('index.m3u8')) return new Response('#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subtitles.m3u8"\n');
      if (url.pathname.endsWith('subtitles.m3u8')) return new Response('#EXTM3U\n#EXTINF:4,\none.vtt\n#EXT-X-ENDLIST\n');
      if (url.pathname.endsWith('one.vtt')) return new Response('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n最新の発言です\n');
    }
    throw new Error(`Unexpected request ${url}`);
  }
  return { state, fetch };
}
