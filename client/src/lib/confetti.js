// Lightweight canvas confetti — no dependency, used on podium + correct answers.
export function confettiBurst(container, { count = 140, duration = 2600 } = {}) {
  if (typeof document === 'undefined') return;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;';
  document.body.appendChild(canvas);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);

  const colors = ['#FFB81C', '#E53935', '#1E6BE5', '#43A047', '#FBC02D', '#FFFFFF', '#0B1B3B'];
  const parts = Array.from({ length: count }, () => ({
    x: window.innerWidth / 2 + (Math.random() - 0.5) * 120,
    y: window.innerHeight / 2 - 40,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 16 - 4,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    w: 6 + Math.random() * 7,
    h: 8 + Math.random() * 10,
    color: colors[(Math.random() * colors.length) | 0],
    gravity: 0.22 + Math.random() * 0.1,
  }));

  const start = performance.now();
  const frame = (now) => {
    const t = now - start;
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.color;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else { canvas.remove(); }
  };
  requestAnimationFrame(frame);
}