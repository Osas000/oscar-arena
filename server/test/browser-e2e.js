// Full-stack browser E2E: drives the REAL UI (host + player) against a live
// server via system Chrome + puppeteer-core. Run with the server up:
//   node test/browser-e2e.js
import puppeteer from 'puppeteer-core';

const BASE = process.env.OSCAR_BASE || 'http://localhost:8080';
const ADMIN_PIN = process.env.ADMIN_PIN || '000000';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('  ✓', ...a);

async function waitForText(page, text, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const has = await page.evaluate((t) => document.body.innerText.includes(t), text);
    if (has) return true;
    await sleep(150);
  }
  const dump = await page.evaluate(() => document.body.innerText.slice(0, 400));
  throw new Error(`timeout waiting for text: "${text}"\npage state: ${JSON.stringify(dump)}`);
}

async function clickByText(page, text) {
  await page.evaluate((t) => {
    const els = [...document.querySelectorAll('button, [role="button"], a')];
    const el = els.find((e) => e.innerText.trim().includes(t));
    if (!el) throw new Error('no element with text: ' + t);
    el.click();
  }, text);
}

async function typeByPlaceholder(page, ph, value) {
  const start = Date.now();
  while (Date.now() - start < 6000) {
    const ok = await page.evaluate(([p, v]) => {
      const el = document.querySelector(`input[placeholder="${p}"], textarea[placeholder="${p}"]`);
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, [ph, value]);
    if (ok) { await sleep(250); return; }
    await sleep(120);
  }
  throw new Error(`timeout typing placeholder: "${ph}"`);
}

async function clickEnabled(page, text) {
  // Wait for a matching, ENABLED button (React may still be committing input).
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const ok = await page.evaluate((t) => {
      const el = [...document.querySelectorAll('button')].find((b) => b.innerText.trim().includes(t));
      return el && !el.disabled;
    }, text);
    if (ok) break;
    await sleep(120);
  }
  await clickByText(page, text);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,900'],
  });

  // ---------------- HOST ----------------
  const host = await browser.newPage();
  host.on('pageerror', (e) => console.log('HOST pageerror:', e.message, '\n', (e.stack || '').split('\n').slice(0, 5).join('\n')));
  host.on('console', (m) => { const t = m.text(); if (t.startsWith('[HOST-EVT]') || t.startsWith('[PHASE-SET]') || t.startsWith('[HOSTLIVE-RENDER]')) console.log(t); });
  await host.setViewport({ width: 1280, height: 900 });
  await host.goto(BASE + '/#/host', { waitUntil: 'networkidle2' });
  await waitForText(host, 'Host Console');
  log('host console rendered');

  // Login
  await typeByPlaceholder(host, '••••••', ADMIN_PIN);
  await clickEnabled(host, 'Unlock');
  await waitForText(host, 'Quiz Library');
  log('admin login OK');

  // Create quiz via UI
  await typeByPlaceholder(host, 'New quiz title…', 'Browser E2E Quiz');
  await clickEnabled(host, '+ Create');
  await waitForText(host, 'Add question');
  await clickEnabled(host, '+ Add question');
  await waitForText(host, 'QUESTION 1');
  log('builder opened');

  // Fill question 1
  await typeByPlaceholder(host, 'Quiz title', 'Browser E2E Quiz');
  const q1 = 'Capital of Nigeria?';
  await typeByPlaceholder(host, 'Type the question here…', q1);
  await typeByPlaceholder(host, 'Answer option…', 'Abuja');
  // second option input — query all inputs with that placeholder
  await host.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[placeholder="Answer option…"]')];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[1], 'Lagos');
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
  });
  // mark first option correct (default already); shorten the timer so the E2E
  // doesn't wait out a 30s question — first number input is Time, second Points.
  await host.evaluate(() => {
    const nums = [...document.querySelectorAll('input[type="number"]')];
    if (nums[0]) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(nums[0], 5);
      nums[0].dispatchEvent(new Event('input', { bubbles: true }));
      nums[0].dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await sleep(250);
  // save & host
  await clickEnabled(host, 'Save & Host');
  await waitForText(host, 'JOIN AT');
  log('quiz hosted — lobby visible');

  // Read the PIN from the host screen
  const pin = await host.evaluate(() => {
    const m = document.body.innerText.match(/GAME PIN\s+(\d{6})/);
    return m ? m[1] : null;
  });
  if (!pin) throw new Error('no PIN on host screen');
  log(`PIN = ${pin}`);

  // ---------------- PLAYER ----------------
  const player = await browser.newPage();
  player.on('pageerror', (e) => console.log('PLAYER pageerror:', e.message));
  await player.setViewport({ width: 420, height: 800 });
  await player.goto(BASE + '/#/player', { waitUntil: 'networkidle2' });
  await waitForText(player, 'GAME PIN');
  log('player join screen rendered');

  await typeByPlaceholder(player, '000 000', pin);
  await typeByPlaceholder(player, 'e.g. RangerOne', 'Tester');
  await clickEnabled(player, 'Enter Arena');
  await waitForText(player, 'Waiting for the host');
  log('player joined lobby');

  // ---------------- START GAME ----------------
  await clickByText(host, 'START');
  await waitForText(player, q1);
  log('question 1 shown to player');

  // Answer: click the correct tile (Abuja — first tile)
  await player.evaluate(() => {
    const tiles = [...document.querySelectorAll('button')].filter((b) => b.innerText.includes('Abuja'));
    if (tiles[0]) tiles[0].click();
  });
  await waitForText(player, 'Answer locked in');
  log('player answered');

  // Host sees the reveal (answer distribution) with the Next button — engine
  // holds reveal ~4s before auto-advancing to the scoreboard.
  await waitForText(host, 'Next');
  log('host sees reveal + Next button');
  await waitForText(host, 'LEADERBOARD');
  log('host on leaderboard');

  // Player should see the scoreboard too
  await waitForText(player, 'Leaderboard');
  log('player sees leaderboard (top-5 broadcast works)');

  // Host: next -> podium (only 1 question)
  await clickByText(host, 'Next Question');
  await waitForText(host, 'PODIUM');
  await waitForText(player, 'PODIUM');
  log('podium reached on both screens');

  // Finish -> results
  await clickByText(host, 'Finish & Show Results');
  await waitForText(host, 'FULL RESULTS');
  log('full results shown to host');

  await browser.close();
  console.log('\nBROWSER-E2E-OK — real UI flow verified end to end');
}

main().catch((e) => { console.error('\nBROWSER-E2E-FAIL:', e.message); process.exit(1); });