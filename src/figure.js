// The home figure: a visual representation of checking vibes and detecting warning signs.
// A radar pulse expands outward. Warning symbols appear as the pulse passes.
// Information nodes are detected and connect together, showing verification.
// Red = alerts/warnings detected. Blue = verified/safe information.

const INK = [42, 102, 184]; // logo blue
const WARN = [179, 38, 30]; // warning red
const GLOW = [66, 180, 255]; // bright blue glow

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Information nodes to check: mix of warnings and verified data
function buildNodes() {
  const R = rng(42);
  const nodes = [];

  // Central scanner point
  nodes.push({
    x: 0.5,
    y: 0.5,
    type: "scanner",
    isWarning: false,
  });

  // Scattered data points: some warnings (red), some verified (blue)
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 + (R() - 0.5) * 0.3;
    const dist = 0.2 + R() * 0.25;
    nodes.push({
      x: 0.5 + Math.cos(angle) * dist,
      y: 0.5 + Math.sin(angle) * dist,
      type: "data",
      isWarning: R() < 0.4, // 40% warnings, 60% verified
      angle,
      dist,
    });
  }

  return nodes;
}

// Edges: connect nearby verified nodes, warnings connect to center
function buildEdges(nodes) {
  const edges = [];

  // Warnings connect to scanner (center)
  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.isWarning) {
      edges.push({
        from: 0,
        to: i,
        isWarning: true,
      });
    }
  }

  // Verified nodes connect to each other nearby
  const verified = nodes.filter((n) => !n.isWarning && n.type === "data");
  for (let i = 0; i < verified.length; i++) {
    for (let j = i + 1; j < verified.length; j++) {
      const dx = verified[i].x - verified[j].x;
      const dy = verified[i].y - verified[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.25) {
        edges.push({
          from: nodes.indexOf(verified[i]),
          to: nodes.indexOf(verified[j]),
          isWarning: false,
        });
      }
    }
  }

  return edges;
}

export function mountFigure(canvas, { seed = 7, duration = 6500 } = {}) {
  if (!canvas || !canvas.getContext) return () => {};
  const ctx = canvas.getContext("2d");
  const nodes = buildNodes();
  const edges = buildEdges(nodes);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let w = 0, h = 0, dpr = 1, start = 0, raf = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    w = r.width;
    h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduce) drawScene(1);
  }

  function drawScene(t) {
    ctx.clearRect(0, 0, w, h);

    // Radar pulse: expanding circle with fading opacity
    const pulseRadius = 0.35 * t;
    const pulseOpacity = Math.max(0, 1 - t);

    ctx.strokeStyle = `rgba(${GLOW},${pulseOpacity * 0.6})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0.5 * w, 0.5 * h, pulseRadius * Math.min(w, h), 0, Math.PI * 2);
    ctx.stroke();

    // Inner radar rings
    ctx.strokeStyle = `rgba(${INK},${pulseOpacity * 0.2})`;
    ctx.lineWidth = 1;
    for (let r = 0.1; r < pulseRadius; r += 0.1) {
      ctx.beginPath();
      ctx.arc(0.5 * w, 0.5 * h, r * Math.min(w, h), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw edges (verified connections and warning links)
    const edgePhase = Math.max(0, Math.min(1, t * 1.5 - 0.2));
    const edgesDrawn = Math.floor(edgePhase * edges.length);

    for (let i = 0; i < edgesDrawn; i++) {
      const edge = edges[i];
      const fromNode = nodes[edge.from];
      const toNode = nodes[edge.to];

      const x1 = fromNode.x * w;
      const y1 = fromNode.y * h;
      const x2 = toNode.x * w;
      const y2 = toNode.y * h;

      ctx.lineWidth = edge.isWarning ? 2 : 1;
      ctx.lineCap = "round";
      ctx.strokeStyle = edge.isWarning
        ? `rgba(${WARN},${0.5 * edgePhase})`
        : `rgba(${GLOW},${0.3 * edgePhase})`;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Draw nodes (data points)
    const nodePhase = Math.max(0, Math.min(1, t * 1.3 - 0.1));
    const nodesDrawn = Math.floor(nodePhase * (nodes.length - 1)) + 1; // +1 for scanner

    for (let i = 0; i < nodesDrawn; i++) {
      const node = nodes[i];
      const px = node.x * w;
      const py = node.y * h;

      if (node.type === "scanner") {
        // Center scanner: blue pulsing circle
        const scannerSize = 4 + Math.sin(t * Math.PI * 4) * 2;
        ctx.fillStyle = `rgba(${GLOW},0.8)`;
        ctx.beginPath();
        ctx.arc(px, py, scannerSize, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(${GLOW},0.5)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, scannerSize + 3, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Data points
        const size = node.isWarning ? 4 : 3;
        const opacity = (i / (nodes.length - 1)) * nodePhase;

        if (node.isWarning) {
          // Warning: red alert symbol
          ctx.fillStyle = `rgba(${WARN},${0.7 + opacity * 0.3})`;
          ctx.beginPath();
          ctx.arc(px, py, size, 0, Math.PI * 2);
          ctx.fill();

          // Triangle inside for warning symbol effect
          ctx.fillStyle = `rgba(255,255,255,0.6)`;
          ctx.font = "bold 8px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("!", px, py);
        } else {
          // Verified: blue checkmark style
          ctx.fillStyle = `rgba(${GLOW},${0.6 + opacity * 0.3})`;
          ctx.beginPath();
          ctx.arc(px, py, size, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = `rgba(${GLOW},${0.4 + opacity * 0.2})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(px, py, size + 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  function frame(now) {
    if (!start) start = now;
    const elapsed = now - start;
    const t = Math.min(1, elapsed / duration);

    drawScene(t);

    if (t < 1) raf = requestAnimationFrame(frame);
  }

  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    start = 0;
    resize();
    if (!reduce) raf = requestAnimationFrame(frame);
  });
  ro.observe(canvas);
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
}
