#!/usr/bin/env node
/**
 * LIVE HOLD PROBE — Render free-tier reality check.
 *
 * Opens N real Socket.IO connections to the LIVE site (the exact transport
 * player phones use), holds them, and measures what actually matters at a
 * venue:
 *   - connect storm: % that connected, latency med/p95/p99, drops
 *   - server responsiveness under load: acks to a real socket event
 *     (player:join_pin with a bogus PIN — public, no admin needed)
 *   - server memory ceiling: heap/RSS sampled live from /healthz while the
 *     connections pile on (Render free = 512MB RAM)
 *
 * Usage: node qa/live-hold-probe.mjs --url https://oscar-arena.onrender.com --sockets 1000 --hold 30
 */
import { io } from 'socket.io-client';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] && !String(args[i + 1]).startsWith('--') ? args[i + 1] : d;
};
const URL = flag('url', 'https://oscar-arena.onrender.com');
const N = parseInt(flag('sockets', '500'), 10) || 500;
const HOLD = parseInt(flag('hold', '30'), 10) || 30;
const BATCH = 100;

const lat = [];
let connected = 0;
let failed = 0;
const sockets = [];
let peak = { heap: 0, rss: 0 };
let sampleCount = 0;

const mem = setInterval(() => {
  fetch(URL + '/healthz').then((r) => r.json()).then((h) => {
    if (typeof h.heap === 'number') {
      sampleCount++;
      peak.heap = Math.max(peak.heap, h.heap);
      peak.rss = Math.max(peak.rss, h.rss || 0);
    }
  }).catch(() => {});
}, 2000);

const pct = (a, q) => {
  if (!a.length) return '-';
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))] + 'ms';
};

const openOne = (i) => new Promise((res) => {
  const t0 = Date.now();
  const s = io(URL, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    timeout: 20000,
  });
  const guard = setTimeout(() => { failed++; try { s.close(); } catch {} res(); }, 25000);
  s.on('connect', () => {
    clearTimeout(guard);
    connected++;
    lat.push(Date.now() - t0);
    sockets.push(s);
    res();
  });
  s.on('connect_error', () => { clearTimeout(guard); failed++; res(); });
});

console.log(`LIVE HOLD PROBE — ${URL} · ${N} sockets · hold ${HOLD}s · batch ${BATCH}`);
console.log(`(real internet leg: this PC → Render; mirrors venue phones over 4G)\n`);

const t0 = Date.now();
for (let w = 0; w < N; w += BATCH) {
  const jobs = [];
  for (let i = w; i < Math.min(w + BATCH, N); i++) jobs.push(openOne(i));
  await Promise.allSettled(jobs);
  const done = Math.min(w + BATCH, N);
  if (done % 200 === 0 || done === N) console.log(`  ${done}/${N} initiated (${connected} connected, ${failed} failed)`);
}
const connectWall = (Date.now() - t0) / 1000;
console.log(`\n  connected ${connected}/${N} in ${connectWall.toFixed(1)}s (${failed} failed)`);
console.log(`  connect latency: med ${pct(lat, 0.5)} · p95 ${pct(lat, 0.95)} · p99 ${pct(lat, 0.99)}`);

// ---- responsiveness under load: real event round-trips ----
const rt = [];
const doPing = (s) => new Promise((res) => {
  const t1 = Date.now();
  s.emit('player:join_pin', { pin: '000000', nickname: 'Probe' }, () => res(Date.now() - t1));
  setTimeout(() => res(-1), 10000);
});
const sample = sockets.filter((_, i) => i % 5 === 0);
for (const s of sample) rt.push(await doPing(s));
const real = rt.filter((x) => x >= 0);
console.log(`  server round-trip (ack, ${real.length} sampled): med ${pct(real, 0.5)} · p95 ${pct(real, 0.95)} · p99 ${pct(real, 0.99)}${real.length < rt.length ? ` (${rt.length - real.length} timed out)` : ''}`);

// ---- hold + drops ----
console.log(`  holding ${sockets.length} live connections ${HOLD}s…`);
let dropped = 0;
sockets.forEach((s) => s.on('disconnect', () => dropped++));
let dead = 0;
const check = setInterval(() => { dead = sockets.filter((s) => !s.connected).length; }, 2000);
await new Promise((r) => setTimeout(r, HOLD * 1000));
clearInterval(check);
console.log(`  dropped during hold: ${dropped} (${dead} disconnected at end)`);

// ---- memory at peak (the Render free 512MB question) ----
console.log(`\n──────────── LIVE HOLD RESULT ────────────`);
console.log(`connected      : ${connected}/${N}${failed ? ' (' + failed + ' failed)' : ''}`);
console.log(`connect lat    : med ${pct(lat, 0.5)} · p95 ${pct(lat, 0.95)} · p99 ${pct(lat, 0.99)}`);
console.log(`server RTT     : med ${pct(real, 0.5)} · p95 ${pct(real, 0.95)} · p99 ${pct(real, 0.99)}`);
console.log(`dropped in hold: ${dropped} / ${sockets.length}`);
console.log(`server heap    : ${(peak.heap / 1048576).toFixed(0)} MB (peak, ${sampleCount} samples)`);
console.log(`server RSS     : ${(peak.rss / 1048576).toFixed(0)} MB (Render free cap = 512)`);
console.log(`──────────────────────────────────────────`);

const ok = connected >= N * 0.9 && dropped < N * 0.1 && peak.rss < 512 * 1048576;
console.log(ok
  ? `\nLIVE-HOLD-OK — ${connected} concurrent connections held on the live Render instance, healthy memory.`
  : `\nLIVE-HOLD-LIMIT — see numbers above (Render free tier constraint found).`);
process.exit(ok ? 0 : 2);