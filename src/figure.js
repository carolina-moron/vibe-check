// The home figure: an animated globe with dots and connections showing network growth.
// Nodes appear at key trafficking corridors, connecting progressively to show how networks expand.
// The globe rotates slowly. Styled like the NASA night lights satellite view.

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

// Key trafficking corridor endpoints (lat, lon)
const NODE_LOCATIONS = [
  { name: "Albania", lat: 41, lon: 20, isBad: true },      // European source
  { name: "Philippines", lat: 12, lon: 122, isBad: true }, // SE Asia source
  { name: "Thailand", lat: 15, lon: 101, isBad: true },    // Hub
  { name: "Myanmar", lat: 22, lon: 98, isBad: true },      // Source
  { name: "Cambodia", lat: 13, lon: 105, isBad: false },   // Transit
  { name: "Vietnam", lat: 16, lon: 107, isBad: false },    // Transit
  { name: "Hong Kong", lat: 22.3, lon: 114.2, isBad: false }, // Hub
  { name: "Japan", lat: 36, lon: 138, isBad: false },      // Destination
  { name: "South Korea", lat: 37, lon: 127, isBad: false }, // Destination
  { name: "Taiwan", lat: 23.7, lon: 120.9, isBad: false }, // Transit
  { name: "Mexico", lat: 23, lon: -102, isBad: true },     // N. America source
  { name: "USA", lat: 37, lon: -95, isBad: false },        // Destination
  { name: "Guatemala", lat: 15.5, lon: -90.25, isBad: true }, // C. America source
  { name: "Nigeria", lat: 9.08, lon: 8.68, isBad: true },  // African source
  { name: "Kenya", lat: -0.02, lon: 37.9, isBad: false },  // African transit
  { name: "Germany", lat: 51.17, lon: 10.45, isBad: false }, // Europe destination
  { name: "UK", lat: 55.38, lon: -3.44, isBad: false },    // Destination
  { name: "UAE", lat: 23.42, lon: 53.85, isBad: false },   // Gulf hub
  { name: "India", lat: 20.59, lon: 78.96, isBad: false }, // South Asia source
  { name: "Brazil", lat: -14.24, lon: -51.93, isBad: false }, // South America
];

// Connect nearby nodes to show corridors
function buildEdges(nodes) {
  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].lon - nodes[j].lon;
      const dy = nodes[i].lat - nodes[j].lat;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Connect nodes within ~40 degrees (established corridors)
      if (dist < 45) {
        edges.push([i, j, dist]);
      }
    }
  }

  // Sort by distance (closer = stronger corridors = drawn first)
  return edges.sort((a, b) => a[2] - b[2]);
}

export function mountFigure(canvas, { seed = 7, duration = 6500 } = {}) {
  if (!canvas || !canvas.getContext) return () => {};
  const ctx = canvas.getContext("2d");
  const nodes = NODE_LOCATIONS;
  const edges = buildEdges(nodes);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let w = 0, h = 0, dpr = 1, start = 0, drawn = 0, raf = 0;

  // Project lat/lon to canvas, accounting for globe rotation
  const project = ([lat, lon], rotation) => {
    const rotLon = lon + rotation;
    const phi = lat * Math.PI / 180;
    const theta = rotLon * Math.PI / 180;

    // Simple cylindrical projection
    const x = (theta / Math.PI + 1) * 0.5 * w;
    const y = (0.5 - phi / Math.PI) * h;
    return [x, y];
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawn = 0;
    if (reduce) drawGlobe(0, nodes.length, 1, 0);
  }

  function drawGlobe(edgesDrawn, nodesDrawn, progress, rotation) {
    ctx.clearRect(0, 0, w, h);

    // Draw edges (connections between nodes)
    const edgesToDraw = Math.floor(edgesDrawn * edges.length);
    for (let i = 0; i < edgesToDraw; i++) {
      const [fromIdx, toIdx] = edges[i];
      const from = nodes[fromIdx];
      const to = nodes[toIdx];
      const isBadEdge = from.isBad || to.isBad;

      const [x1, y1] = project([from.lat, from.lon], rotation);
      const [x2, y2] = project([to.lat, to.lon], rotation);

      ctx.lineWidth = 1.2;
      ctx.lineCap = "round";
      ctx.strokeStyle = isBadEdge
        ? `rgba(${WARN},${0.3 * progress})`
        : `rgba(${INK},${0.2 * progress})`;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Draw nodes (dots at locations)
    const nodesToDraw = Math.floor(nodesDrawn * nodes.length);
    for (let i = 0; i < nodesToDraw; i++) {
      const node = nodes[i];
      const [px, py] = project([node.lat, node.lon], rotation);

      // Only draw if on visible hemisphere
      if (px < -20 || px > w + 20) continue;

      const size = node.isBad ? 4.5 : 3;
      const opacity = node.isBad ? (0.6 + progress * 0.4) : (0.5 + progress * 0.3);

      if (node.isBad) {
        // Bad actor nodes: red
        ctx.fillStyle = `rgba(${WARN},${opacity})`;
      } else {
        // Normal nodes: blue with glow
        ctx.fillStyle = `rgba(${GLOW},${opacity})`;
      }

      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(now) {
    if (!start) start = now;
    const elapsed = now - start;
    const t = Math.min(1, elapsed / duration);

    // Rotate globe continuously
    const rotation = t * 360;

    // Stagger: edges appear first, nodes fill in
    const edgeProgress = Math.min(1, t * 1.3);
    const nodeProgress = Math.max(0, Math.min(1, (t - 0.15) * 1.5));

    drawGlobe(edgeProgress, nodeProgress, nodeProgress, rotation);

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
