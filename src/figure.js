// The home figure: an expanding cyber network showing threat propagation.
// Nodes represent attackers, victims, infrastructure. Edges show malicious connections.
// Red nodes = threat actors / botnet command centers. Blue nodes = compromised hosts / victims.
// Network grows and connections reveal the structure of digital exploitation.

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

// Cyber network: C2 servers, botnets, compromised hosts
function buildNetwork() {
  const nodes = [];
  const R = rng(42);

  // Central C2 (Command & Control) servers - red threat actors
  for (let i = 0; i < 3; i++) {
    nodes.push({
      x: 0.3 + i * 0.2,
      y: 0.25,
      isBad: true,
      label: 'C2',
      size: 1.2,
    });
  }

  // Botnet nodes radiating from C2 - red, medium threat
  for (let c2Idx = 0; c2Idx < 3; c2Idx++) {
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 + (c2Idx * Math.PI / 6);
      const dist = 0.15;
      nodes.push({
        x: (0.3 + c2Idx * 0.2) + Math.cos(angle) * dist,
        y: 0.25 + Math.sin(angle) * dist,
        isBad: true,
        label: 'bot',
        size: 0.8,
        parent: c2Idx,
      });
    }
  }

  // Compromised hosts (victims) - blue, spread across lower area
  for (let i = 0; i < 8; i++) {
    nodes.push({
      x: 0.15 + (i % 4) * 0.18 + (R() - 0.5) * 0.06,
      y: 0.60 + Math.floor(i / 4) * 0.18 + (R() - 0.5) * 0.06,
      isBad: false,
      label: 'host',
      size: 0.7,
    });
  }

  // Edges: connections from threat actors to victims (malicious traffic)
  const edges = [];

  // Botnet to compromised hosts
  for (let i = 3; i < nodes.length - 8; i++) {
    // Each botnet node connects to 1-3 victim hosts
    const numConnections = Math.floor(R() * 3) + 1;
    for (let j = 0; j < numConnections; j++) {
      const victimIdx = nodes.length - 8 + Math.floor(R() * 8);
      if (victimIdx !== i) {
        edges.push({
          from: i,
          to: victimIdx,
          isBad: true,
        });
      }
    }
  }

  // Some inter-botnet connections (peer-to-peer propagation)
  for (let i = 3; i < 9; i++) {
    if (R() < 0.5 && i + 2 < nodes.length - 8) {
      edges.push({
        from: i,
        to: i + Math.floor(R() * 3) + 1,
        isBad: true,
      });
    }
  }

  // Remove duplicates
  const edgeSet = new Set(edges.map((e) => JSON.stringify([Math.min(e.from, e.to), Math.max(e.from, e.to)])));
  return {
    nodes,
    edges: Array.from(edgeSet).map((s) => {
      const [from, to] = JSON.parse(s);
      return { from, to, isBad: true };
    }),
  };
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
    w = r.width;
    h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduce) drawNetwork(1, 1);
  }

  function drawNetwork(edgeProgress, nodeProgress) {
    ctx.clearRect(0, 0, w, h);

    // Background: subtle grid
    ctx.strokeStyle = `rgba(${INK},0.03)`;
    ctx.lineWidth = 0.5;
    const gridSpacing = Math.min(w, h) / 6;
    for (let x = 0; x <= w; x += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Draw edges (malicious traffic connections)
    const edgesDrawn = Math.floor(edgeProgress * edges.length);
    for (let i = 0; i < edgesDrawn; i++) {
      const edge = edges[i];
      const fromNode = nodes[edge.from];
      const toNode = nodes[edge.to];

      const x1 = fromNode.x * w;
      const y1 = fromNode.y * h;
      const x2 = toNode.x * w;
      const y2 = toNode.y * h;

      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.strokeStyle = `rgba(${WARN},${0.3 * edgeProgress})`;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Draw nodes
    const nodesDrawn = Math.floor(nodeProgress * nodes.length);
    for (let i = 0; i < nodesDrawn; i++) {
      const node = nodes[i];
      const px = node.x * w;
      const py = node.y * h;

      const size = node.size * (2 + (nodeProgress * 1.5));

      if (node.isBad) {
        // Threat actors: red with emphasis
        ctx.fillStyle = `rgba(${WARN},${0.8 * nodeProgress})`;
      } else {
        // Victims: blue
        ctx.fillStyle = `rgba(${GLOW},${0.7 * nodeProgress})`;
      }

      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();

      // Outline for threat actors
      if (node.isBad) {
        ctx.strokeStyle = `rgba(${WARN},${0.5 * nodeProgress})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px, py, size + 1, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Labels (subtle)
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(${INK},${0.3 * nodeProgress})`;
    for (let i = 0; i < Math.min(nodesDrawn, 3); i++) {
      const node = nodes[i];
      if (node.label === 'C2') {
        const px = node.x * w;
        const py = node.y * h;
        ctx.fillText("C2", px, py - node.size * 3);
      }
    }
  }

  function frame(now) {
    if (!start) start = now;
    const elapsed = now - start;
    const t = Math.min(1, elapsed / duration);

    // Stagger: edges first, nodes follow
    const edgeProgress = Math.min(1, t * 1.4);
    const nodeProgress = Math.max(0, Math.min(1, (t - 0.1) * 1.6));

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
