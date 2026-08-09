// Stress runner: spawn a dedicated server with compressed phase holds, then
// blitz it with the load harness (defaults: 500 players × 2500 questions).
// Mirrors run-mobile-qa.cjs's proven spawn/wait/kill pattern.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const PORT = String(process.env.STRESS_PORT || 8080);
// Stress against a disposable DB so the marathon's 1.25M answer rows never
// pollute the dev/QA database.
const DB_PATH = path.join(__dirname, 'stress-' + Date.now().toString(36) + '.sqlite');

let status = 0;
const args = process.argv.slice(2).join(' ');
const srv = spawn(process.execPath, [path.join(root, 'server', 'src', 'index.js')], {
  env: {
    ...process.env,
    PORT,
    NODE_ENV: 'test',
    STRESS_FAST: '1',
    COUNTDOWN_MS: process.env.STRESS_COUNTDOWN_MS || '1000',
    ANSWER_GRACE_MS: process.env.STRESS_ANSWER_GRACE_MS || '20',
    REVEAL_HOLD_MS: process.env.STRESS_REVEAL_HOLD_MS || '15',
    SCOREBOARD_HOLD_MS: process.env.STRESS_SCOREBOARD_HOLD_MS || '15',
    PODIUM_HOLD_MS: process.env.STRESS_PODIUM_HOLD_MS || '400',
    HOST_LOST_GRACE_MS: process.env.STRESS_HOST_LOST_GRACE_MS || '3000',
    DB_PATH,
    OSCAR_URL: `http://localhost:${PORT}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
srv.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));

function healthz() {
  return new Promise((res) => {
    const r = http.get(`http://localhost:${PORT}/healthz`, { timeout: 2000 }, (q) => {
      let b = '';
      q.on('data', (c) => (b += c));
      q.on('end', () => res({ ok: true, body: b }));
    });
    r.on('error', () => res(null));
    r.on('timeout', () => { r.destroy(); res(null); });
  });
}
async function upz() {
  for (let i = 0; i < 80; i++) {
    const h = await healthz();
    if (h) return h;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

(async () => {
  const started = Date.now();
  const h = await upz();
  if (!h) { console.error('server never came up'); status = 2; return kill(); }
  console.log(`server OK (pid ${srv.pid}) — ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

  const harness = spawn(process.execPath, [path.join(root, 'stress', 'load.js'), ...(args ? args.split(' ') : [])], {
    env: { ...process.env, OSCAR_URL: `http://localhost:${PORT}`, ADMIN_PIN: '000000', STRESS_FAST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  harness.stdout.on('data', (d) => process.stdout.write(d));
  harness.stderr.on('data', (d) => process.stderr.write(d));
  const code = await new Promise((res) => harness.on('exit', res));
  status = code || 0;
  kill();
})();

function kill() {
  try { srv.kill(); } catch {}
  // Drop the disposable stress DB (1.25M+ rows) so it never lingers on disk.
  setTimeout(() => {
    try { require('fs').unlinkSync(DB_PATH); } catch {}
    process.exit(status);
  }, 500);
}
process.on('SIGINT', () => { kill(); });