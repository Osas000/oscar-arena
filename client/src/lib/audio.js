// Synthesized audio effects via WebAudio — zero asset files, instant on slow
// networks. Models Kahoot's tick/success/scoreboard feel. All muted until the
// user interacts (autoplay policy).
let ctx = null;
let enabled = true;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no-op */ }
}

export function setSoundEnabled(v) { enabled = v; }
export function isSoundEnabled() { return enabled; }

function tone({ freq, start = 0, dur, type = 'sine', vol = 0.22 }) {
  if (!ctx || !enabled) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

// Rising tick each second as the timer winds down.
export function tick() { tone({ freq: 660, start: 0, dur: 0.09, type: 'square', vol: 0.12 }); }

// Correct answer fanfare (major arpeggio).
export function playCorrect() {
  tone({ freq: 523.25, start: 0, dur: 0.18, type: 'triangle' });
  tone({ freq: 659.25, start: 0.12, dur: 0.18, type: 'triangle' });
  tone({ freq: 783.99, start: 0.24, dur: 0.24, type: 'triangle' });
  tone({ freq: 1046.5, start: 0.42, dur: 0.3, type: 'triangle', vol: 0.25 });
}

// Wrong answer (sad trombone-ish two-note descent).
export function playWrong() {
  tone({ freq: 392, start: 0, dur: 0.2, type: 'sawtooth', vol: 0.16 });
  tone({ freq: 311, start: 0.18, dur: 0.28, type: 'sawtooth', vol: 0.16 });
}

// Player's answer registered — short blip.
export function playRegister() {
  tone({ freq: 880, start: 0, dur: 0.08, type: 'sine', vol: 0.14 });
}

// Scoreboard / reveal accents.
export function playReveal() {
  tone({ freq: 440, start: 0, dur: 0.1, type: 'triangle' });
  tone({ freq: 554.37, start: 0.09, dur: 0.1, type: 'triangle' });
  tone({ freq: 659.25, start: 0.18, dur: 0.16, type: 'triangle' });
}

// Podium fanfare.
export function playPodium() {
  tone({ freq: 523.25, start: 0, dur: 0.2, type: 'triangle' });
  tone({ freq: 659.25, start: 0.15, dur: 0.2, type: 'triangle' });
  tone({ freq: 783.99, start: 0.3, dur: 0.2, type: 'triangle' });
  tone({ freq: 1046.5, start: 0.45, dur: 0.4, type: 'triangle', vol: 0.3 });
  tone({ freq: 1318.5, start: 0.6, dur: 0.5, type: 'triangle', vol: 0.25 });
}