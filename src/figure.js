// The home figure: a network expanding from a central point, showing connections
// and growth patterns. Nodes branch out, connect, and spread. Some are highlighted
// to show bad actors in a network. Drawn on a 2D canvas with soft lines and fading.
// Original to Vibe Check — replaces the pencil knot.

const INK = [42, 102, 184]; // logo blue
const WARN = [179, 38, 30]; // warning red

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate network nodes and connections
function buildNetwork(nodeCount = 12) {
  const nodes = [];
  const R = rng(42);

  // Central node at origin
  nodes.push({ id: 0, x: 0.5, y: 0.5, depth: 0, isBad: true });

  // Spread nodes outward in waves
  let nodeId = 1;
  for (let depth = 1; depth <= 3; depth++) {
    const nodesAtDepth = Math.floor(depth * 3);
    for (let i = 0; i < nodesAtDepth && nodeId < nodeCount; i++) {
      const angle = (i / nodesAtDepth) * Math.PI * 2 + (R() - 0.5) * 0.3;
      const dist = 0.15 + depth * 0.15 + (R() - 0.5) * 0.08;
      const isBad = R() < 0.2; // 20% of nodes are "bad actors"
      nodes.push({
        id: nodeId,
        x: 0.5 + Math.cos(angle) * dist,
        y: 0.5 + Math.sin(angle) * dist,
        depth,
        isBad,
      });
      nodeId++;
    }
  }

  // Create edges: each node connects to 1-2 closer nodes (outward) or random
  const edges = [];
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i];
    // Connect to parent (closer node at lower depth)
    const closer = nodes.filter((m) => m.depth < n.depth);
    if (closer.length) {
      const parent = closer[Math.floor(R() * closer.length)];
      edges.push([n.id, parent.id]);
    }
  }

  return { nodes, edges };
}

export function mountFigure(canvas, { seed = 7, duration = 6500 } = {}) {
  if (!canvas || !canvas.getContext) return () => {};
  const ctx = canvas.getContext("2d");
  const { nodes, edges } = buildNetwork(12);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let w = 0, h = 0, dpr = 1, start = 0, drawn = 0, raf = 0;

  const toPx = ([x, y]) => [x * w, y * h];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawn = 0;
    if (reduce) drawNetwork(0, nodes.length, 1);
  }

  // Draw edges up to a certain depth
  function drawEdges(maxDepth, progress) {
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const [fromId, toId] of edges) {
      const from = nodes[fromId];
      const to = nodes[toId];

      // Only draw if both nodes are within depth
      if (Math.max(from.depth, to.depth) > maxDepth) continue;

      const [x1, y1] = toPx([from.x, from.y]);
      const [x2, y2] = toPx([to.x, to.y]);

      const isBadEdge = from.isBad || to.isBad;
      ctx.strokeStyle = isBadEdge
        ? `rgba(${WARN},0.4)`
        : `rgba(${INK},0.25)`;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  // Draw nodes
  function drawNodes(maxDepth, progress) {
    for (const node of nodes) {
      if (node.depth > maxDepth) continue;

      const [px, py] = toPx([node.x, node.y]);

      // Size grows slightly with progress
      const baseSize = node.depth === 0 ? 8 : 5;
      const size = baseSize * (0.6 + progress * 0.4);

      // Center node is always emphasized
      if (node.id === 0) {
        ctx.fillStyle = `rgba(${WARN},0.9)`;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();

        // Pulsing ring around center
        ctx.strokeStyle = `rgba(${WARN},${0.3 * progress})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, size + 6 * progress, 0, Math.PI * 2);
        ctx.stroke();
      } else if (node.isBad) {
        // Bad actor nodes in warning color
        ctx.fillStyle = `rgba(${WARN},${0.6 + progress * 0.3})`;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Normal nodes in blue
        ctx.fillStyle = `rgba(${INK},${0.5 + progress * 0.3})`;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawNetwork(nodeProgress, edgeProgress, opacity) {
    ctx.clearRect(0, 0, w, h);

    // Draw background guides (subtle)
    ctx.strokeStyle = `rgba(${INK},0.05)`;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 4; i++) {
      const y = (h / 3) * (i + 1);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.globalAlpha = opacity;

    // Reveal edges first, then nodes
    const maxDepth = Math.floor(nodeProgress * 4);
    drawEdges(maxDepth, edgeProgress);
    drawNodes(maxDepth, edgeProgress);

    ctx.globalAlpha = 1;
  }

  function frame(now) {
    if (!start) start = now;
    const elapsed = now - start;
    const t = Math.min(1, elapsed / duration);

    // Stagger: edges appear first, then nodes fill in
    const nodeProgress = Math.min(1, t * 1.2);
    const fadeIn = Math.max(0, Math.min(1, (t - 0.1) * 2)); // delay start

    drawNetwork(nodeProgress, fadeIn, 1);

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
