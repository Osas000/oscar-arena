// QA runner: spawn test server, wait for healthz, run mobile-qa, kill server.
const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const srv = spawn(process.execPath, [path.join(root, 'server', 'src', 'index.js')], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvOut = '';
srv.stdout.on('data', (d) => (srvOut += d));
srv.stderr.on('data', (d) => (srvOut += d));

const http = require('http');
function healthz() {
  return new Promise((res) => {
    const r = http.get('http://localhost:8080/healthz', { timeout: 2000 }, (q) => {
      q.resume();
      res(q.statusCode === 200);
    });
    r.on('error', () => res(false));
    r.on('timeout', () => {
      r.destroy();
      res(false);
    });
  });
}

(async () => {
  let ok = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await upz()) { ok = true; break; }
    if (srv.exitCode !== null) break;
  }
  async function upz() { try { return await healthz(); } catch { return false; } }
  if (!ok) {
    console.error('SERVER FAILED TO START:\n' + srvOut);
    srv.kill();
    process.exit(1);
  }
  console.log('server healthz OK (pid ' + srv.pid + ')');

  const qa = spawn(process.execPath, [path.join(root, 'server', 'test', 'mobile-qa.js')], {
    cwd: root,
    env: { ...process.env, NODE_PATH: 'C:/Users/LENOVO/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules' },
    stdio: 'inherit',
  });
  const code = await new Promise((res) => qa.on('exit', res));
  srv.kill();
  console.log('\nQA_EXIT=' + code);
  process.exit(code);
})();