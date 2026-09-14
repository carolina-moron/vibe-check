// The home figure: a single blue pencil line drawn across the sheet. It starts as a loose, easy
// thread (an offer), then loops back on itself and tightens into a knot (the trap), and the
// line continues on, taut. Drawn on a 2D canvas with a pencil brush: many faint, jittered
// passes rather than one clean stroke. Original to Digital Safety Check.
// Holds as a finished drawing under prefers-reduced-motion.

const INK = [31, 59, 99];

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Path in unit space (x 0..1, y around 0): drift, easy wave, a widening loop, three tightening
// coils, then a straight taut line to the edge.
function pathPoints(n = 1400) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let x, y;
    if (t < 0.38) {
      const u = t / 0.38;
      x = 0.04 + u * 0.4;
      y = Math.sin(u * Math.PI * 2) * 0.07 * (1 - u * 0.4) + Math.sin(u * Math.PI * 4) * 0.006;
    } else if (t < 0.78) {
      const u = (t - 0.38) / 0.4;
      const turns = 3.2 * Math.PI * 2;
      const r = 0.11 * Math.pow(1 - u, 1.6) + 0.012;
      const a = u * turns - Math.PI / 2;
      // starts at the bottom of its first turn, exactly where the wave left off (y = 0)
      x = 0.44 + u * 0.12 + Math.cos(a) * r * 0.85;
      y = (Math.sin(a) + 1) * r - 0.024 * u;
    } else {
      // taut line, leaving from exactly where the last coil ends
      const u = (t - 0.78) / 0.22;
      const aEnd = 3.2 * Math.PI * 2 - Math.PI / 2;
      const xEnd = 0.56 + Math.cos(aEnd) * 0.012 * 0.85, yEnd = (Math.sin(aEnd) + 1) * 0.012 - 0.024;
      x = xEnd + u * (0.96 - xEnd);
      y = yEnd * (1 - Math.min(1, u * 6));
    }
    pts.push([x, y]);
  }
  return pts;
}

export function mountFigure(canvas, { seed = 7, duration = 6500 } = {}) {
  if (!canvas || !canvas.getContext) return () => {};
  const ctx = canvas.getContext("2d");
  const pts = pathPoints();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, h = 0, dpr = 1, start = 0, drawn = 0, raf = 0;

  const toPx = ([x, y]) => [x * w, h * 0.52 + y * Math.min(w, h * 2.2)];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawn = 0;
    construction();
    if (reduce) pencil(0, pts.length - 1);
  }

  // Faint construction marks: the axis the thread travels along, and a guide circle at the knot.
  function construction() {
    const R = rng(seed + 99);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = `rgba(${INK},0.18)`;
    const y = h * 0.52;
    for (let p = 0; p < 2; p++) {
      ctx.beginPath();
      ctx.moveTo(w * 0.03, y + (R() - 0.5));
      ctx.lineTo(w * 0.97, y + (R() - 0.5));
      ctx.setLineDash([22, 5, 3, 5]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const [cx, cy] = toPx([0.5, 0.03]);
    const rad = 0.13 * Math.min(w, h * 2.2);
    for (let p = 0; p < 3; p++) {
      ctx.beginPath();
      ctx.ellipse(cx + (R() - 0.5) * 3, cy + (R() - 0.5) * 3, rad * (0.97 + R() * 0.06), rad * (0.9 + R() * 0.06), R() * 0.2, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${INK},${0.06 + R() * 0.05})`;
      ctx.stroke();
    }
  }

  // A pencil pass between two point indices: several jittered, translucent strokes.
  function pencil(from, to) {
    const R = rng(seed + from);
    for (let pass = 0; pass < 4; pass++) {
      ctx.beginPath();
      const j = pass === 0 ? 0.25 : 0.9;
      for (let i = from; i <= to; i++) {
        const [x, y] = toPx(pts[i]);
        const px = x + (R() - 0.5) * j, py = y + (R() - 0.5) * j;
        i === from ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.lineWidth = pass === 0 ? 1.5 : 0.7;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = `rgba(${INK},${pass === 0 ? 0.78 : 0.16 + R() * 0.12})`;
      ctx.stroke();
    }
  }

  function frame(now) {
    if (!start) start = now;
    const target = Math.min(pts.length - 1, Math.floor(((now - start) / duration) * (pts.length - 1)));
    if (target > drawn) { pencil(Math.max(0, drawn - 1), target); drawn = target; }
    if (drawn < pts.length - 1) raf = requestAnimationFrame(frame);
  }

  const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); start = 0; resize(); if (!reduce) raf = requestAnimationFrame(frame); });
  ro.observe(canvas);
  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}
