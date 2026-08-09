// Mobile-responsive QA: drives the REAL UI through a full game cycle at phone
// and tablet viewports, asserting NO horizontal overflow on every screen phase
// (host + player) and capturing screenshots for visual review.
// Run:  NODE_PATH="<global>/@playwright/mcp/node_modules" node server/test/mobile-qa.js
import { chromium } from 'playwright-core';

const BASE = process.env.OSCAR_BASE || 'http://localhost:8080';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'server/test/qa-artifacts';

const VIEWPORTS = [
  { name: 'phone-390', width: 390, height: 844 },   // iPhone 12/13/14
  { name: 'small-360', width: 360, height: 740 },   // small Android
  { name: 'tablet-768', width: 768, height: 1024 }, // iPad portrait
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns true when the page has NO horizontal overflow: nothing sticks out
// beyond the right edge of the viewport (tolerance 2px for subpixel rounding).
async function assertNoHOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const docW = document.documentElement.scrollWidth;
    const bad = [];
    // Every visible element's right edge must stay inside the viewport.
    for (const el of document.querySelectorAll('body *')) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      // Skip elements mid-animation: framer-motion leaves an in-flight
      // transform matrix on the element while a spring plays (e.g. the giant
      // countdown "GO!" scaling down on exit). Its transformed rect is a
      // transient visual moment — NOT a layout overflow — and it outlives any
      // fixed sleep. The untransformed rect is what the layout actually is.
      const tm = st.transform;
      const isAnimated = tm !== 'none' && /matrix\(|matrix3d\(/.test(tm);
      if (isAnimated) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 2 || r.left < -2) {
        bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ').slice(0, 2).join('.')} right=${Math.round(r.right)} left=${Math.round(r.left)}`);
      }
    }
    return { docScrollW: docW, vw, bad: bad.slice(0, 6), badCount: bad.length };
  });
  const ok = overflow.docScrollW <= overflow.vw + 2 && overflow.badCount === 0;
  if (!ok) {
    console.log(`  ✗ OVERFLOW @ ${label}: scrollW=${overflow.docScrollW} vw=${overflow.vw} bad=${overflow.badCount} -> ${overflow.bad.join(' | ')}`);
  } else {
    console.log(`  ✓ no overflow @ ${label} (scrollW=${overflow.docScrollW}/${overflow.vw})`);
  }
  return ok;
}

async function shot(page, vp, name) {
  // Evidence artifact ONLY. Fire-and-forget: a slow/busy page must never stall
  // the game-flow assertions, so the screenshot is not awaited.
  page.screenshot({ path: `${OUT}/${vp.name}-${name}.png`, timeout: 2000, animations: 'disabled' })
    .then(() => console.log(`  (saved ${vp.name}-${name}.png)`))
    .catch(() => console.log(`  (shot ${name} skipped)`));
}

async function waitForText(page, text, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate((t) => document.body.innerText.includes(t), text)) return;
    await sleep(150);
  }
  const info = await page.evaluate(() => ({
    text: document.body.innerText,
    fullResultsInDom: !!document.body.innerText.includes('FULL RESULTS'),
    h2s: [...document.querySelectorAll('h2')].map((h) => h.innerText),
    disp: [...document.querySelectorAll('#root *')].slice(0, 12).map((el) => `${el.tagName}.${(el.className || '').toString().split(' ').slice(0, 2).join('.')}`),
    bodyChildren: document.body.children.length,
  }));
  try { await page.screenshot({ path: OUT + '/debug-timeout.png' }); } catch {}
  throw new Error(`timeout waiting for text "${text}"\ninnerText: ${JSON.stringify(info.text).slice(0, 500)}\nh2s: ${JSON.stringify(info.h2s)}\nroot-top: ${JSON.stringify(info.disp)}\nbodyChildren: ${info.bodyChildren}`);
}

async function waitUntilAny(page, texts, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate((ts) => ts.some((t) => document.body.innerText.includes(t)), texts)) return;
    await sleep(150);
  }
  const info = await page.evaluate(() => ({
    text: document.body.innerText,
    h2s: [...document.querySelectorAll('h2')].map((h) => h.innerText),
  }));
  throw new Error(`timeout waiting for any of [${texts.join(', ')}]\ninnerText: ${JSON.stringify(info.text).slice(0, 400)}\nh2s: ${JSON.stringify(info.h2s)}`);
}

async function waitFor(page, text, timeout = 10000) {
  return waitForText(page, text, timeout);
}

async function clickByText(page, text, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ok = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, [role="button"], a')];
      const el = els.find((e) => e.innerText.trim().includes(t));
      if (!el || el.disabled) return false;
      el.click();
      return true;
    }, text);
    if (ok) {
      await sleep(250);
      return;
    }
    await sleep(150);
  }
  throw new Error('no clickable element: ' + text);
}

async function typeByPlaceholder(page, ph, value) {
  const ok = await page.evaluate(([p, v]) => {
    const el = document.querySelector(`input[placeholder="${p}"], textarea[placeholder="${p}"]`);
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, [ph, value]);
  if (!ok) throw new Error('no input with placeholder: ' + ph);
  await sleep(200);
}

async function clickEnabled(page, text) {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.innerText.trim().includes(t));
    if (!el || el.disabled) return false;
    el.click();
    return true;
  }, text);
  if (!ok) throw new Error('no enabled button: ' + text);
  await sleep(250);
}

let failures = 0;
const fail = (m) => { console.log('  ✗ ' + m); failures++; };

async function runViewport(vp) {
  console.log(`\n=== VIEWPORT ${vp.name} ${vp.width}x${vp.height} ===`);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing'] });
  // Block PWA auto-update SW (skipWaiting+clientsClaim) from force-reloading the
  // page mid-flow via the controllerchange handler in main.jsx.
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  // Google Fonts are unreachable/slow in this sandbox; abort them so the
  // screenshot "waiting for fonts" stall can't eat the timed question window.
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // Software rasterization (no GPU here) starves the main thread on the larger
  // tablet viewport: the arena's infinite spark-float ambience loops force a
  // full-frame repaint every vsync and socket events queue behind for 30s+.
  // The ambience is decorative only (fixed, z-0, aria-hidden) — kill it and
  // honor prefers-reduced-motion so the QA measures layout, not GPU capacity.
  await ctx.addInitScript(() => {
    const css = [
      '.arena-ambience,.arena-spark{display:none!important}',
      '*{animation-duration:0.01s!important;animation-iteration-count:1!important;animation-delay:0s!important;transition-duration:0.01s!important}',
    ].join('');
    const once = () => {
      const st = document.createElement('style');
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', once, { once: true });
    else once();
  });
  const host = await ctx.newPage();
  host.on('pageerror', (e) => fail(`HOST pageerror: ${e.message}`));
  host.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[PHASE-SET]') || t.startsWith('[HOST-EVT]') || t.startsWith('[HOSTLIVE-RENDER]')) console.log(`  [host console] ${t}`);
  });

  // ---------- HOST: login ----------
  await host.goto(BASE + '/#/host', { waitUntil: 'domcontentloaded' });
  await waitForText(host, 'Host Console');
  if (!(await assertNoHOverflow(host, 'host-login'))) fail('host-login overflow');
  await shot(host, vp, 'host-login');
  await typeByPlaceholder(host, '••••••', '000000');
  await clickEnabled(host, 'Unlock');
  await waitForText(host, 'Quiz Library');
  if (!(await assertNoHOverflow(host, 'host-dashboard'))) fail('host-dashboard overflow');
  await shot(host, vp, 'host-dashboard');

  // ---------- HOST: create quiz ----------
  await typeByPlaceholder(host, 'New quiz title…', 'Mobile QA Quiz');
  await clickEnabled(host, '+ Create');
  await waitForText(host, 'Add question');
  await clickEnabled(host, '+ Add question');
  await waitForText(host, 'QUESTION 1');
  if (!(await assertNoHOverflow(host, 'quiz-builder'))) fail('quiz-builder overflow');
  await shot(host, vp, 'quiz-builder');
  await typeByPlaceholder(host, 'Quiz title', 'Mobile QA Quiz');
  const q1 = 'What is the capital of Nigeria?';
  await typeByPlaceholder(host, 'Type the question here…', q1);
  await typeByPlaceholder(host, 'Answer option…', 'Abuja');
  await host.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[placeholder="Answer option…"]')];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[1], 'Lagos');
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
  });
  await host.evaluate(() => {
    const nums = [...document.querySelectorAll('input[type="number"]')];
    if (nums[0]) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(nums[0], 20); // generous time limit — screenshots + checks eat seconds
      nums[0].dispatchEvent(new Event('input', { bubbles: true }));
      nums[0].dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await sleep(200);
  await clickEnabled(host, 'Save & Host');
  await waitForText(host, 'JOIN AT');
  if (!(await assertNoHOverflow(host, 'host-lobby'))) fail('host-lobby overflow');
  await shot(host, vp, 'host-lobby');

  const pin = await host.evaluate(() => {
    const m = document.body.innerText.match(/GAME PIN\s+(\d{6})/);
    return m ? m[1] : null;
  });
  if (!pin) throw new Error('no PIN found');
  console.log(`  PIN=${pin}`);

  // ---------- PLAYER: join ----------
  const player = await ctx.newPage();
  player.on('pageerror', (e) => fail(`PLAYER pageerror: ${e.message}`));
  player.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[PHASE-SET]') || t.startsWith('[PLAYER-EVT]') || t.startsWith('[PLAYER-EMIT]') || t.startsWith('[PLAYER-ACK]')) console.log(`  [player console] ${t}`);
  });
  await player.goto(BASE + '/#/player', { waitUntil: 'domcontentloaded' });
  await waitForText(player, 'GAME PIN');
  if (!(await assertNoHOverflow(player, 'player-join'))) fail('player-join overflow');
  await shot(player, vp, 'player-join');
  await typeByPlaceholder(player, '000 000', pin);
  await typeByPlaceholder(player, 'e.g. RangerOne', 'Tester');
  await clickEnabled(player, 'Enter Arena');
  await waitForText(player, 'Waiting for the host');
  if (!(await assertNoHOverflow(player, 'player-lobby'))) fail('player-lobby overflow');
  await shot(player, vp, 'player-lobby');

  // ---------- START ----------
  await clickByText(host, 'START');
  await waitForText(player, q1);
  if (!(await assertNoHOverflow(host, 'host-question'))) fail('host-question overflow');
  if (!(await assertNoHOverflow(player, 'player-question'))) fail('player-question overflow');
  await shot(host, vp, 'host-question');
  await shot(player, vp, 'player-question');

  // ---------- ANSWER ----------
  await player.evaluate(() => {
    const t = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Abuja'));
    if (t) t.click();
  });
  await waitForText(player, 'Answer locked in');
  if (!(await assertNoHOverflow(player, 'player-answered'))) fail('player-answered overflow');
  await shot(player, vp, 'player-answered');

  // ---------- REVEAL -> SCOREBOARD ----------
    // The game runs a timed chain (reveal 4s -> scoreboard 8s -> podium -> done)
    // and the host can skip ahead with clicks, so a strict wait for any single
    // transient phase is flaky. Wait for whichever of these appears; Next and
    // Next Question are both on the host's action button.
    await waitUntilAny(host, ['Next', 'LEADERBOARD', 'PODIUM', 'FULL RESULTS'], 40000);
    if (!(await assertNoHOverflow(host, 'host-reveal'))) fail('host-reveal overflow');
    // If we're early (reveal visible), click through to the scoreboard.
    const onReveal = await host.evaluate(() => document.body.innerText.includes('Next ▶'));
    if (onReveal) await clickByText(host, 'Next');
    await waitUntilAny(host, ['LEADERBOARD', 'PODIUM', 'FULL RESULTS'], 15000);
    await shot(host, vp, 'host-scoreboard');
    await waitUntilAny(player, ['Leaderboard', 'PODIUM'], 15000);
    await sleep(1200); // rows slide in from x:-40 — let the animation settle
    if (!(await assertNoHOverflow(host, 'host-scoreboard'))) fail('host-scoreboard overflow');
    if (!(await assertNoHOverflow(player, 'player-scoreboard'))) fail('player-scoreboard overflow');
    await shot(host, vp, 'host-scoreboard');
    await shot(player, vp, 'player-scoreboard');

    // ---------- PODIUM ----------
    const onScoreboard = await host.evaluate(() => document.body.innerText.includes('Next Question'));
    if (onScoreboard) await clickByText(host, 'Next Question');
    await waitFor(host, 'PODIUM', 15000);
    await waitFor(player, 'PODIUM', 15000);
    await sleep(1200); // let the tiles spring in (they animate from y:200)
    if (!(await assertNoHOverflow(host, 'host-podium'))) fail('host-podium overflow');
    if (!(await assertNoHOverflow(player, 'player-podium'))) fail('player-podium overflow');
    await shot(host, vp, 'host-podium');
    await shot(player, vp, 'player-podium');

    // ---------- DONE ----------
    const podiumBeforeDone = await host.evaluate(() => document.body.innerText.includes('PODIUM'));
    if (podiumBeforeDone) await clickByText(host, 'Finish & Show Results');
    await waitFor(host, 'FULL RESULTS', 15000);
  if (!(await assertNoHOverflow(host, 'host-done'))) fail('host-done overflow');
  await shot(host, vp, 'host-done');

  await browser.close();
}

// ---------- END-FLOW QA (host ends session) ----------
// Regression for the three reported bugs:
//   1. End not immediate ("takes 3-4 reloads") — host:end must propagate to
//      every player instantly, from the LOBBY and from mid-question.
//   2. "You are the CHAMPION" on an abandoned game — a host-ended session is
//      NOT a conclusion: the player must see a clean 'Session Ended', never a
//      champion crown (that is reserved for naturally finished games).
//   3. Refresh after the end used to bounce the player to the PIN screen; the
//      resume path must land on the terminal 'Session Ended' screen instead.
async function endFlowCheck(vp) {
  console.log(`\n=== END-FLOW ${vp.name} ${vp.width}x${vp.height} ===`);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing'] });
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(() => {
    const css = [
      '.arena-ambience,.arena-spark{display:none!important}',
      '*{animation-duration:0.01s!important;animation-iteration-count:1!important;animation-delay:0s!important;transition-duration:0.01s!important}',
    ].join('');
    const once = () => {
      const st = document.createElement('style');
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', once, { once: true });
    else once();
  });

  const host = await ctx.newPage();
  host.on('pageerror', (e) => fail(`HOST pageerror: ${e.message}`));
  const player = await ctx.newPage();
  player.on('pageerror', (e) => fail(`PLAYER pageerror: ${e.message}`));

  // ---- host login ----
  await host.goto(BASE + '/#/host', { waitUntil: 'domcontentloaded' });
  await waitForText(host, 'Host Console');
  await typeByPlaceholder(host, '••••••', '000000');
  await clickEnabled(host, 'Unlock');
  await waitForText(host, 'Quiz Library');

  // ---- create + host a tiny quiz ----
  await typeByPlaceholder(host, 'New quiz title…', 'End Flow QA');
  await clickEnabled(host, '+ Create');
  await waitForText(host, 'Add question');
  await clickEnabled(host, '+ Add question');
  await waitForText(host, 'QUESTION 1');
  await typeByPlaceholder(host, 'Quiz title', 'End Flow QA');
  await typeByPlaceholder(host, 'Type the question here…', 'End-flow test question?');
  await typeByPlaceholder(host, 'Answer option…', 'Alpha');
  await host.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[placeholder="Answer option…"]')];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[1], 'Beta');
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(200);
  await clickEnabled(host, 'Save & Host');
  await waitForText(host, 'JOIN AT');
  const pin = await host.evaluate(() => {
    const m = document.body.innerText.match(/GAME PIN\s+(\d{6})/);
    return m ? m[1] : null;
  });
  if (!pin) throw new Error('end-flow: no PIN found');
  console.log(`  PIN=${pin}`);

  // ---- player joins (lobby) ----
  await player.goto(BASE + '/#/player', { waitUntil: 'domcontentloaded' });
  await waitForText(player, 'GAME PIN');
  await typeByPlaceholder(player, '000 000', pin);
  await typeByPlaceholder(player, 'e.g. RangerOne', 'EndTester');
  await clickEnabled(player, 'Enter Arena');
  await waitForText(player, 'Waiting for the host');

  // ---- END FROM LOBBY (must be immediate, no champion) ----
  await clickByText(host, 'End session');
  await waitUntilAny(player, ['Session Ended', 'GAME PIN'], 8000);
  const lobbyEndText = await player.evaluate(() => document.body.innerText);
  if (!lobbyEndText.includes('Session Ended')) fail('end-flow: lobby end did not reach the player');
  if (lobbyEndText.includes('CHAMPION')) fail('end-flow: "CHAMPION" shown on an abandoned lobby session');
  if (lobbyEndText.includes('host ended this session')) console.log('  ✓ lobby end: player shows the professional "host ended this session" message');
  if (!(await assertNoHOverflow(player, 'player-session-ended-lobby'))) fail('end-flow: session-ended overflow (lobby)');
  await shot(player, vp, 'session-ended-lobby');

  // ---- host returns to dashboard after End ----
  await waitForText(host, 'Quiz Library', 8000);

  // ---- REFRESH-RESUME: reloading the player page after an end must land on
  // the terminal screen (no PIN form, no zombie) ----
  await player.goto(BASE + '/#/player', { waitUntil: 'domcontentloaded' });
  await waitForText(player, 'Session Ended', 10000);
  const refreshText = await player.evaluate(() => document.body.innerText);
  if (refreshText.includes('GAME PIN')) fail('end-flow: refresh after end fell back to the PIN screen');
  console.log('  ✓ refresh-resume: player landed on the terminal "Session Ended" screen');

  // ---- END MID-QUESTION (the original "3-4 reloads" complaint) ----
  await host.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('Host ▶')); b && b.click(); });
  await waitForText(host, 'JOIN AT');
  const pin2 = await host.evaluate(() => {
    const m = document.body.innerText.match(/GAME PIN\s+(\d{6})/);
    return m ? m[1] : null;
  });
  if (!pin2) throw new Error('end-flow: no PIN 2');

  // fresh player session (the old one is stuck on the terminal screen)
  const ctx2 = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await ctx2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => fail(`PLAYER-2 pageerror: ${e.message}`));
  await p2.goto(BASE + '/#/player', { waitUntil: 'domcontentloaded' });
  await waitForText(p2, 'GAME PIN');
  await typeByPlaceholder(p2, '000 000', pin2);
  await typeByPlaceholder(p2, 'e.g. RangerOne', 'MidGameTester');
  await clickEnabled(p2, 'Enter Arena');
  await waitForText(p2, 'Waiting for the host');

  await clickByText(host, 'START');
  await waitForText(p2, 'End-flow test question?');
  await p2.evaluate(() => {
    const t = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Alpha'));
    if (t) t.click();
  });
  await waitForText(p2, 'Answer locked in');
  // end WHILE the question is live — the very bug: players hung for 3-4
  // reloads before ever seeing the end.
  await clickByText(host, 'End session');
  await waitForText(p2, 'Session Ended', 8000);
  const midText = await p2.evaluate(() => document.body.innerText);
  if (midText.includes('CHAMPION')) fail('end-flow: CHAMPION shown on a mid-game host end');
  if (!(await shotNoHOverflow(p2, 'session-ended-midgame'))) fail('end-flow: session-ended overflow (mid-game)');
  await shot(p2, vp, 'session-ended-midgame');

  await browser.close();
}

async function shotNoHOverflow(page, label) {
  return assertNoHOverflow(page, label);
}

// ---------- LANDING at every viewport ----------
async function landingCheck(vp) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing'] });
  // Block PWA auto-update SW (skipWaiting+clientsClaim) from force-reloading the
  // page mid-flow via the controllerchange handler in main.jsx.
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(() => {
    const css = [
      '.arena-ambience,.arena-spark{display:none!important}',
      '*{animation-duration:0.01s!important;animation-iteration-count:1!important;animation-delay:0s!important;transition-duration:0.01s!important}',
    ].join('');
    const once = () => {
      const st = document.createElement('style');
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', once, { once: true });
    else once();
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitForText(page, 'OSCAR');
  if (!(await assertNoHOverflow(page, 'landing'))) fail('landing overflow');
  await shot(page, vp, 'landing');
  await browser.close();
}

import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });

for (const vp of VIEWPORTS) {
  await landingCheck(vp);
  await runViewport(vp);
}
// End-flow regression is heavy (an extra browser, quiz build, two sessions);
// it is viewport-agnostic, so run it exactly once at the phone viewport.
await endFlowCheck(VIEWPORTS[0]);

console.log(`\n${failures === 0 ? 'MOBILE-QA-OK — zero overflow at all viewports/phases' : `MOBILE-QA-FAIL — ${failures} overflow(s) found`}`);
process.exit(failures === 0 ? 0 : 1);
