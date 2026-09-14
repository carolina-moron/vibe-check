// The home figure: an animated network showing how trafficking networks spread.
// Nodes cluster and connect, revealing the structure of exploitation networks.
// Red nodes = bad actors, blue nodes = vulnerable endpoints.

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

// Trafficking network: clusters of nodes at different risk levels
function buildNetwork() {
  const nodes = [];
  const R = rng(42);

  // Central hub (bad actor cluster)
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const dist = 0.15;
    nodes.push({
      x: 0.5 + Math.cos(angle) * dist,
      y: 0.5 + Math.sin(angle) * dist,
      cluster: 'hub',
      isBad: true,
      depth: 0,
    });
  }

  // Source cluster (left side)
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 2 + (i / 4) * Math.PI;
    const dist = 0.25;
    nodes.push({
      x: 0.2 + Math.cos(angle) * (dist * 0.3) + (R() - 0.5) * 0.06,
      y: 0.5 + Math.sin(angle) * dist + (R() - 0.5) * 0.06,
      cluster: 'source',
      isBad: true,
      depth: 1,
    });
  }

  // Transit cluster (right side)
  for (let i = 0; i < 4; i++) {
    const angle = -Math.PI / 2 + (i / 4) * Math.PI;
    const dist = 0.25;
    nodes.push({
      x: 0.8 + Math.cos(angle) * (dist * 0.3) + (R() - 0.5) * 0.06,
      y: 0.5 + Math.sin(angle) * dist + (R() - 0.5) * 0.06,
      cluster: 'destination',
      isBad: false,
      depth: 1,
    });
  }

  // Secondary hubs (bottom)
  for (let i = 0; i < 3; i++) {
    nodes.push({
      x: 0.3 + i * 0.2 + (R() - 0.5) * 0.08,
      y: 0.78 + (R() - 0.5) * 0.08,
      cluster: 'transit',
      isBad: false,
      depth: 2,
    });
  }

  // Edges: connect nearby nodes, showing traffic flow
  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Connect nearby nodes (within 0.35 units)
      if (dist < 0.35) {
        edges.push({
          from: i,
          to: j,
          dist,
          // Flow: prefer connections from bad actors outward
          isBad: nodes[i].isBad || nodes[j].isBad,
        });
      }
    }
  }

  // Sort edges by distance (closer = stronger = drawn first)
  edges.sort((a, b) => a.dist - b.dist);

  return { nodes, edges };
}

export function mountFigure(canvas, { seed = 7, duration = 6500 } = {}) {
  if (!canvas || !canvas.getContext) return () => {};
  const ctx = canvas.getContext("2d");
  const { nodes, edges } = buildNetwork();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let w = 0, h = 0, dpr = 1, start = 0, raf = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduce) drawNetwork(1, 1);
  }

  function drawNetwork(edgeProgress, nodeProgress) {
    ctx.clearRect(0, 0, w, h);

    // Draw background grid (subtle)
    ctx.strokeStyle = `rgba(${INK},0.04)`;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const x = (i / 4) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      const y = (i / 4) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Draw edges (connections)
    const edgesDrawn = Math.floor(edgeProgress * edges.length);
    for (let i = 0; i < edgesDrawn; i++) {
      const edge = edges[i];
      const fromNode = nodes[edge.from];
      const toNode = nodes[edge.to];

      const x1 = fromNode.x * w;
      const y1 = fromNode.y * h;
      const x2 = toNode.x * w;
      const y2 = toNode.y * h;

      ctx.lineWidth = edge.isBad ? 1.8 : 1.2;
      ctx.lineCap = "round";
      ctx.strokeStyle = edge.isBad
        ? `rgba(${WARN},${0.25 * edgeProgress})`
        : `rgba(${INK},${0.15 * edgeProgress})`;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Draw nodes (dots)
    const nodesDrawn = Math.floor(nodeProgress * nodes.length);
    for (let i = 0; i < nodesDrawn; i++) {
      const node = nodes[i];
      const px = node.x * w;
      const py = node.y * h;

      // Size based on cluster importance
      let size = node.cluster === 'hub' ? 6 : node.cluster === 'source' ? 5 : 3.5;
      size = size * (0.6 + nodeProgress * 0.4);

      if (node.isBad) {
        // Bad actors: red, larger
        ctx.fillStyle = `rgba(${WARN},${0.8 * nodeProgress})`;
      } else {
        // Normal: blue
        ctx.fillStyle = `rgba(${GLOW},${0.6 * nodeProgress})`;
      }

      // Draw node
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();

      // Draw outline on hub nodes
      if (node.cluster === 'hub') {
        ctx.strokeStyle = `rgba(${WARN},${0.4 * nodeProgress})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, size + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function frame(now) {
    if (!start) start = now;
    const elapsed = now - start;
    const t = Math.min(1, elapsed / duration);

    // Stagger: edges appear first (0-0.5), then nodes (0.3-1)
    const edgeProgress = Math.min(1, t * 1.5);
    const nodeProgress = Math.max(0, Math.min(1, (t - 0.2) * 1.8));

    drawNetwork(edgeProgress, nodeProgress);

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
