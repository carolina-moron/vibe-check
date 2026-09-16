import {
  assess, considerations, parsePostingUrl, fetchPosting, caseEvidence, caseJurisdictions, coverage, linkFor, allNames, buildReport, dHash, flsriCountry, flsriRoute,
} from "./engine.js?v=";
import { mountFigure } from "./figure.js?v=";
import { REPORT_ENDPOINT } from "./config.js?v=";

const [signals, registers, { cases }, flsri] = await Promise.all(
  ["data/signals.json", "data/registers.json", "data/cases/index.json", "data/flsri.json"].map((p) => fetch(p).then((r) => r.json())),
);
let newsData = null;
let ctdcData;
const loadCtdc = async () => (ctdcData !== undefined ? ctdcData : (ctdcData = await fetch("data/ctdc.json").then((r) => (r.ok ? r.json() : null)).catch(() => null)));
let helpData = null;
const loadPartners = async () => fetch("data/partners.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
const loadHelp = async () => (helpData ||= await fetch("data/help.json").then((r) => (r.ok ? r.json() : null)).catch(() => null));
const loadNews = async () => (newsData ||= await fetch("data/news.json").then((r) => r.json()));
let siteConfig = null;
const loadConfig = async () => (siteConfig ||= await fetch("data/config.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
// One anonymous event per check when a live agent endpoint is configured: kind, tier and a count. Never the text.
async function reportCheck(kind, r) {
  const { agentUrl } = await loadConfig();
  if (!agentUrl) return;
  fetch(`${agentUrl.replace(/\/$/, "")}/event`, { method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
    body: JSON.stringify({ kind: kind || "other", tier: r.tier?.id, flags: r.flags?.length || 0 }) }).catch(() => {});
}

// ---- helpers ---------------------------------------------------------------------------

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const href = (u) => (/^(https:\/\/|#\/)/.test(u || "") ? esc(u) : "#");
const ext = (u, label) => `<a href="${href(u)}" target="_blank" rel="noopener">${esc(label)}</a>`;
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const country = (iso) => { try { return countryNames.of(iso); } catch { return iso; } };
const signalById = Object.fromEntries(signals.signals.map((s) => [s.id, s]));
const main = $("#main");

const TYPOLOGY = {
  "scam-compound": { label: "Scam compound", color: "#14264A" },
  "labor-trafficking": { label: "Labour trafficking", color: "#2A66B8" },
  "forced-labor-industrial": { label: "Industrial forced labour", color: "#6B7A8F" },
  "laundering": { label: "Laundering network", color: "#2B6A76" },
  "money-mule": { label: "Money mules", color: "#2B6A76" },
  "job-scam": { label: "Job scam", color: "#9A6A00" },
  "sex-trafficking": { label: "Sex trafficking", color: "#B3261E" },
  "deepfake-fraud": { label: "Deepfakes and voice clones", color: "#8A4F9E" },
};
const STATUS = {
  enforcement_action: "Enforcement action", sanctioned: "Sanctioned", convicted: "Convicted",
  civil_judgment: "Civil judgment", settled: "Settled", charges_dismissed: "Criminal charges dismissed", reported: "Reported",
};
const STAGE = {
  advertised: "Advertised", recruited: "Recruited", transit: "Transit", exploited: "Exploited",
  laundered: "Money laundered", escaped: "Escaped / rescued", prosecuted: "Prosecuted",
};
const VERDICT = {
  hit: { label: "Evidence found", cls: "v-hit" },
  "no-evidence-found": { label: "No evidence found", cls: "v-none" },
  "not-searched": { label: "Not searched", cls: "v-skip" },
  error: { label: "Could not search", cls: "v-err" },
};
const ACCESS = {
  queried: { label: "queried live", cls: "a-live" },
  referral: { label: "referral", cls: "a-ref" },
  planned: { label: "planned", cls: "a-plan" },
};

// On a case, the score counts the warning signs its sources document, so the tiers read differently from a live check.
const CASE_TIER = { high: "Many warning signs documented", caution: "Some warning signs documented", low: "Few warning signs documented" };
const caseTierLabel = (s) => CASE_TIER[s.tier.id] || s.tier.label;
const scoreBadge = (s, cov) => `
  <div class="scorebox t-${esc(s.tier.id)}">
    <div class="num">${s.points}<small>/100</small></div>
    <div><div class="tierlabel">${esc(caseTierLabel(s))}</div><div class="cov c-${esc(cov.class)}" title="${esc(cov.explain)}">${esc(cov.label)}</div></div>
  </div>`;
const scoreGuide = `<details class="scoreguide">
    <summary>What do the score and “public records” mean?</summary>
    <div class="scoreguide-body">
      <div><h3>Warning-sign score (0–100)</h3>
        <p>Each warning sign the sources document adds points: lures such as upfront fees or confiscated passports, official actions, and name changes. More documented signs mean a higher score, capped at 100. It measures how much evidence exists, not how bad a case was.</p>
        <p class="concern-legend"><span class="scorechip t-high">45–100 · Many warning signs</span><span class="scorechip t-caution">20–44 · Some warning signs</span><span class="scorechip t-low">0–19 · Few warning signs</span></p></div>
      <div><h3>Public records</h3>
        <p>A separate question: could official registers (company, court and enforcement records) in the countries involved have recorded this? <strong>Many</strong> means three or more registers apply, <strong>some</strong> means one or two, and <strong>none</strong> means only global watchlists apply. Where there are no public records, a low score doesn't mean a case or company is safe.</p></div>
    </div>
  </details>`;

const CONCERN = (w) => w >= 20 ? { cls: "c-high", label: "High concern" } : w >= 10 ? { cls: "c-med", label: "Medium concern" } : { cls: "c-low", label: "Low concern" };
const concernLegend = `<p class="concern-legend"><span class="clevel c-high">High concern</span><span class="clevel c-med">Medium concern</span><span class="clevel c-low">Low concern</span></p>`;
const flagList = (flags) => flags.length ? `${concernLegend}<ul class="flags">${flags.map((f) => { const c = CONCERN(f.weight); return `
  <li class="${f.weight >= 20 ? "w-hi" : f.weight >= 10 ? "w-md" : "w-lo"} ${c.cls}">
    <div class="row"><strong>${esc(f.label)}</strong><span class="clevel ${c.cls}">${c.label}</span></div>
    <div class="meta">${esc(signals.categories[f.category])}${f.evidence ? ` · <q>${esc(f.evidence)}</q>` : ""}</div>
    <div class="why">${esc(f.why)}</div>
  </li>`; }).join("")}</ul>` : `<p class="muted">No indicators recorded.</p>`;

// ---- FLSRI structural risk -------------------------------------------------------------

const FL_TIER = {
  higher: { label: "Higher", color: "#14264A" },
  middle: { label: "Middle", color: "#5F8FCB" },
  lower: { label: "Lower", color: "#D3DFEE" },
};
const flSrc = flsri.source;
const flLink = (label = "FLSRI") => ext(flSrc.site, label);
const bar = (v, color = "var(--ink)") => v == null ? `<span class="muted">—</span>` : `<span class="meter"><i style="width:${Math.round(v * 100)}%;background:${color}"></i></span><span class="mono">${v.toFixed(2)}</span>`;
const tierChip = (t) => `<span class="fltier" style="--c:${FL_TIER[t].color}">${FL_TIER[t].label}</span>`;

let worldGeo = null;
async function loadWorld() {
  if (worldGeo) return worldGeo;
  if (!window.topojson) throw new Error("topojson-client not loaded");
  const topo = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json").then((r) => r.json());
  const geo = topojson.feature(topo, topo.objects.countries);
  // Rings that cross the antimeridian (Russia, Fiji) would streak across the map:
  // shift their western longitudes east so each ring stays contiguous.
  const fixRing = (ring) => {
    const xs = ring.map((p) => p[0]);
    return Math.max(...xs) - Math.min(...xs) > 180 ? ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]) : ring;
  };
  for (const f of geo.features) {
    const g = f.geometry; if (!g) continue;
    if (g.type === "Polygon") g.coordinates = g.coordinates.map(fixRing);
    if (g.type === "MultiPolygon") g.coordinates = g.coordinates.map((poly) => poly.map(fixRing));
  }
  worldGeo = geo;
  return geo;
}

let ctdcPts = null;
async function ctdcPoints() {
  if (ctdcPts) return ctdcPts;
  const geo = await loadWorld();
  ctdcPts = {};
  for (const f of geo.features) {
    const iso2 = flsri.numericToIso2[f.id];
    if (!iso2 || !f.geometry) continue;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best = null;
    for (const poly of polys) {
      const ring = poly[0]; let a = 0, cx = 0, cy = 0;
      for (let i = 0; i < ring.length - 1; i++) { const [x0, y0] = ring[i], [x1, y1] = ring[i + 1]; const k = x0 * y1 - x1 * y0; a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k; }
      if (a && (!best || Math.abs(a) > best.a)) best = { a: Math.abs(a), lat: cy / (3 * a), lon: cx / (3 * a) };
    }
    if (best) ctdcPts[iso2] = [best.lat, best.lon];
  }
  Object.assign(ctdcPts, { US: [39.8, -98.6], RU: [61.5, 96], CA: [56, -106] });
  return ctdcPts;
}

function flsriLayer(geo) {
  return L.geoJSON(geo, {
    style: (f) => {
      const c = flsri.countries[flsri.numericToIso2[f.id]];
      return { stroke: true, weight: 0.5, color: "#FFFFFF", fillOpacity: c?.scored ? 0.75 : 0.25, fillColor: c?.scored ? FL_TIER[c.tier].color : "#CFC6B8" };
    },
    onEachFeature: (f, layer) => {
      const iso2 = flsri.numericToIso2[f.id];
      const c = flsriCountry(iso2, flsri);
      layer.bindTooltip(c.available
        ? `<strong>${esc(c.name)}</strong><br>FLSRI ${c.composite.toFixed(2)} · ${FL_TIER[c.tier].label} tier<br>Rank ${c.rank} (90% band ${c.band[0]}–${c.band[1]})${c.lowConfidence ? "<br><em>Lower confidence</em>" : ""}`
        : `<strong>${esc(f.properties.name)}</strong><br>${esc(c.reason)}`, { sticky: true });
    },
  });
}

let figureCleanup = () => {};
let maps = [];
function resetMaps() { maps.forEach((m) => m.remove()); maps = []; }

function baseMap(el, opts = {}) {
  if (!window.L) { el.innerHTML = `<p class="muted pad">Map library failed to load.</p>`; return null; }
  const map = L.map(el, { worldCopyJump: true, scrollWheelZoom: false, ...opts });
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors", maxZoom: 16,
  }).addTo(map);
  maps.push(map);
  return map;
}

// A gentle arc between two points that takes the short way round, so Thailand to Hawaii
// crosses the Pacific instead of the whole map. Legs that cross the date line are drawn
// twice, shifted a world apart, so both ends of the line meet their pins.
function arc(a, b, n = 24) {
  const [lat1, lon1] = a;
  let [lat2, lon2] = b;
  if (lon2 - lon1 > 180) lon2 -= 360;
  else if (lon1 - lon2 > 180) lon2 += 360;
  const dx = lon2 - lon1, dy = lat2 - lat1, bend = 0.18;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([lat1 + dy * t + -dx * bend * t * (1 - t), lon1 + dx * t + dy * bend * t * (1 - t)]);
  }
  if (lon2 === b[1]) return [pts];
  const shift = lon2 > b[1] ? -360 : 360;
  return [pts, pts.map(([la, lo]) => [la, lo + shift])];
}

function drawJourney(map, c, { numbered = true, weight = 3, link = false } = {}) {
  const color = TYPOLOGY[c.typology]?.color || "#444";
  const pts = c.journey.map((j) => [j.lat, j.lon]);
  const layers = [];
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i][0] === pts[i + 1][0] && pts[i][1] === pts[i + 1][1]) continue;
    layers.push(L.polyline(arc(pts[i], pts[i + 1]), { color, weight, opacity: 0.85, dashArray: c.journey[i + 1].stage === "prosecuted" ? "4 6" : null }));
  }
  c.journey.forEach((j, i) => {
    const icon = L.divIcon({ className: "pin", html: `<span style="--c:${color}">${numbered ? i + 1 : ""}</span>`, iconSize: numbered ? [24, 24] : [12, 12] });
    layers.push(L.marker([j.lat, j.lon], { icon, title: `${STAGE[j.stage]}: ${j.place}` })
      .bindPopup(`<strong>${esc(STAGE[j.stage])}</strong><br>${esc(j.place)}, ${esc(country(j.country))}<br><span class="muted">${esc(j.note)}</span>${link ? `<br><a href="#/case/${esc(c.id)}">${esc(c.title)} →</a>` : ""}`));
  });
  const group = L.featureGroup(layers).addTo(map);
  return group;
}

// ---- CTDC corridor summaries -----------------------------------------------------------

const ctdcShares = (obj) => obj ? Object.entries(obj.pct).map(([k, v]) => `<li><span>${esc(k)}</span><span class="hb"><i style="width:${v}%"></i></span><span class="mono">${v}%</span></li>`).join("") : "";
function ctdcCorridorHtml(c, src) {
  const title = c.domestic ? `Within ${esc(country(c.from))}` : `${esc(country(c.from))} → ${esc(country(c.to))}`;
  const block = (label, g) => g ? `<h4>${label} <span class="fine">(of ${g.answered.toLocaleString("en-US")} records with this information)</span></h4><ul class="hbars">${ctdcShares(g)}</ul>` : "";
  return `<div class="ctdc-corridor">
    <div class="row"><h3>${title}</h3><span class="mono">${c.n.toLocaleString("en-US")} records${c.years ? ` · ${c.years[0]}–${c.years[1]}` : ""}</span></div>
    <p class="fine">${c.gender ? Object.entries(c.gender).map(([k, v]) => `${esc(k)} ${v}%`).join(" · ") : ""}${c.minors_pct != null ? ` · Under 18: ${c.minors_pct}%` : ""}</p>
    ${block("Type of exploitation", c.exploitation)}
    ${block("Means of control", c.control)}
    ${block("Type of labour", c.labour)}
    ${block("Recruiter was a…", c.recruiter)}
    <p class="fine credit">${esc(src.credit)}</p>
  </div>`;
}
const ctdcCredit = (src) => `<p class="fine credit">${esc(src.credit)} Derived summaries; corridors with fewer than ${src.min_count} records are withheld. ${ext(src.terms, "CTDC terms of use")}.</p>`;

const globeSection = () => `
    <div class="globecard">
      <div class="maphead"><div><h2>Where the signals are</h2><p class="fine">A rotating view of every country in the researched cases (blue and red pulses: recruitment and exploitation) and in recent news reports (grey pulses). Drag to turn, scroll to zoom.</p></div>
        <label class="check toggle"><input type="checkbox" id="globe-spin" checked> Rotate</label></div>
      <div class="globe-wrap">
        <div id="globe" class="globe" role="img" aria-label="Rotating globe with pulses on countries in cases and news"></div>
        <aside class="globe-key" aria-label="What the colours mean">
          <h3>What the colours mean</h3>
          <ul>
            <li><i style="background:#2A66B8"></i><span><strong>Blue pulse</strong> Where people were advertised to, recruited or moved through, in a researched case.</span></li>
            <li><i style="background:#B3261E"></i><span><strong>Red pulse</strong> Where people were exploited, or where the money was laundered.</span></li>
            <li><i style="background:#14264A;border:1px solid #fff"></i><span><strong>Navy dot</strong> Where a case was prosecuted or sanctioned.</span></li>
            <li><i style="background:#8C97A6"></i><span><strong>Grey pulse</strong> A country named in recent news reports. Bigger means more reports. Not checked cases.</span></li>
          </ul>
          <h3>Arcs connecting the dots</h3>
          <p class="fine">Each arc is one case's journey, stage to stage. Its colour is the type of case:</p>
          <ul class="key-types">${Object.entries(TYPOLOGY).filter(([t]) => cases.some((c) => c.typology === t)).map(([t, x]) => `<li><i class="key-arc" style="background:${x.color}"></i><span>${esc(x.label)}</span></li>`).join("")}</ul>
          <p class="fine">Hover a dot for its case or country. No country is ruled out: this shows what was documented or reported, not where the problem is.</p>
        </aside>
      </div>
    </div>
`;

// ---- 3D globe: pulse rings on case and news countries (globe.gl, loaded on demand) ----------

let globeLib = null;
const loadGlobe = () => globeLib ||= new Promise((res, rej) => {
  if (window.Globe) return res(window.Globe);
  const sc = document.createElement("script");
  sc.src = "https://cdn.jsdelivr.net/npm/globe.gl@2.33.2/dist/globe.gl.min.js";
  sc.onload = () => res(window.Globe); sc.onerror = rej; document.head.appendChild(sc);
});

async function mountGlobe(el) {
  if (!el) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.innerHTML = `<p class="muted pad">Globe animation off (reduced motion).</p>`; return; }
  let Globe;
  try { Globe = await loadGlobe(); } catch { el.innerHTML = `<p class="muted pad">Globe could not load.</p>`; return; }
  if (!document.body.contains(el)) return;
  const pts = new Map();
  const add = (lat, lng, kind, label) => { const k = `${lat.toFixed(1)},${lng.toFixed(1)}`; if (!pts.has(k)) pts.set(k, { lat, lng, kind, label, n: 0 }); pts.get(k).n++; };
  for (const c of cases) for (const j of c.journey) add(j.lat, j.lon, ["exploited", "laundered"].includes(j.stage) ? "exploited" : j.stage === "prosecuted" ? "prosecuted" : "recruited", c.title);
  try {
    const n = await loadNews();
    for (const [k, v] of Object.entries(n.aggregates.byCountry)) { const p = n.points[k]; if (p) add(p[0], p[1], "news", `${country(k)}: ${v.mentions} news reports`); }
  } catch {}
  const COLOR = { recruited: "#2A66B8", exploited: "#B3261E", prosecuted: "#14264A", news: "#8C97A6" };
  const rings = [...pts.values()].filter((p) => p.kind !== "prosecuted");
  const arcs = cases.flatMap((c) => c.journey.slice(0, -1).map((j, i) => ({ startLat: j.lat, startLng: j.lon, endLat: c.journey[i + 1].lat, endLng: c.journey[i + 1].lon, color: TYPOLOGY[c.typology]?.color || "#2A66B8" })));
  const g = Globe({ animateIn: true })(el)
    .width(el.clientWidth).height(el.clientHeight)
    .backgroundColor("rgba(0,0,0,0)")
    .globeImageUrl("https://cdn.jsdelivr.net/npm/three-globe@2.31.0/example/img/earth-blue-marble.jpg")
    .showAtmosphere(true).atmosphereColor("#2A66B8").atmosphereAltitude(0.18)
    .ringsData(rings).ringColor((d) => (t) => `rgba(${d.kind === "exploited" ? "179,38,30" : d.kind === "news" ? "140,151,166" : "42,102,184"},${1 - t})`)
    .ringMaxRadius((d) => (d.kind === "news" ? 2 + Math.min(4, d.n) : 5)).ringPropagationSpeed((d) => (d.kind === "news" ? 1.2 : 2)).ringRepeatPeriod((d) => (d.kind === "news" ? 1600 : 900))
    .pointsData([...pts.values()]).pointColor((d) => COLOR[d.kind]).pointAltitude(0.01).pointRadius((d) => (d.kind === "news" ? 0.25 : 0.4)).pointLabel((d) => d.label)
    .arcsData(arcs).arcColor("color").arcAltitude(0.18).arcStroke(0.5).arcDashLength(0.5).arcDashGap(0.2).arcDashAnimateTime(2500);
  g.pointOfView({ lat: 15, lng: 30, altitude: 1.6 }, 0);
  const ctl = g.controls(); ctl.autoRotate = true; ctl.autoRotateSpeed = 0.6; ctl.enableZoom = true;
  $("#globe-spin")?.addEventListener("change", (e) => { ctl.autoRotate = e.target.checked; });
  const ro = new ResizeObserver(() => g.width(el.clientWidth).height(el.clientHeight)); ro.observe(el);
  globeCleanup = () => { ro.disconnect(); g._destructor?.(); };
}
let globeCleanup = () => {};

// ---- views: catalog + world map --------------------------------------------------------

function viewCases() {
  const counts = {};
  cases.forEach((c) => { counts[c.typology] = (counts[c.typology] || 0) + 1; });
  const origins = new Set(cases.flatMap((c) => c.victim_origins || []));
  const actions = cases.flatMap((c) => c.entities.flatMap((e) => e.actions || [])).length;
  const names = cases.flatMap((c) => c.entities.flatMap((e) => e.names || [])).length;

  main.innerHTML = `
    <section class="hero">
      <div class="eyebrow mono">Documented cases · ${cases.length} traced</div>
      <h1>Where fake offers lead</h1>
      <p class="lede">Each case follows a journey from the first contact (a job ad, a message, a deepfake video or call) to the place people were exploited, and the entities behind it through their former names, aliases and enforcement record. Every fact links to the source it came from.</p>
      <div class="stats">
        <div><b>${cases.length}</b><span>cases</span></div>
        <div><b>${actions}</b><span>official actions</span></div>
        <div><b>${names}</b><span>former names &amp; aliases</span></div>
        <div><b>${origins.size}</b><span>victim origin countries</span></div>
      </div>
    </section>
    ${globeSection()}
    <section class="mapcard">
      <div class="maphead">
        <div><h2>Global map of case journeys</h2>
          <label class="check toggle"><input type="checkbox" id="fl-toggle"> Shade countries by structural forced-labour risk (${flLink()})</label>
          <label class="check toggle"><input type="checkbox" id="ctdc-toggle"> Show victim corridors from the Counter-Trafficking Data Collaborative (CTDC)</label>
          <label class="check toggle"><input type="checkbox" id="news-toggle" checked> Show recent news reports (not checked) <span class="fine" id="news-count"></span></label></div>
        <div class="legend" id="legend">${Object.entries(counts).map(([t, n]) => `
          <button type="button" class="lg on" data-typ="${esc(t)}" aria-pressed="true"><i style="background:${TYPOLOGY[t].color}"></i>${esc(TYPOLOGY[t].label)} <span class="mono">${n}</span></button>`).join("")}
        </div>
      </div>
      <div id="worldmap" class="map world" role="img" aria-label="World map of case journeys"></div>
      <div id="fl-legend" class="fllegend pad" hidden>
        <span class="fine">FLSRI tier:</span>${Object.values(FL_TIER).map((t) => `<span><i style="background:${t.color}"></i>${t.label}</span>`).join("")}<span><i style="background:#CFC6B8"></i>Not scored</span>
        <span class="fine">Structural conditions, not prevalence. Build ${esc(flSrc.build_date)}. Under-reads destination and sponsorship systems such as the Gulf.</span>
      </div>
      <p class="fine pad">For victim-level trafficking patterns between countries, see the <a href="https://www.ctdatacollaborative.org/map" target="_blank" rel="noopener">Counter-Trafficking Data Collaborative (CTDC) map</a>, run by IOM. Source: Counter-Trafficking Data Collaborative (CTDC), September 2026.</p>
      <p class="fine pad">Pins are approximate, city or country level. Lines join the stages of each journey in order; dashed segments lead to where the case was prosecuted or sanctioned. Click a pin for the stage, or a card below for the full case. Faint grey circles are countries named in recent news reports: collected automatically and not checked, so they are shown apart from the ${cases.length} researched cases (see <a href="#/methodology">Methodology</a>, Limits).</p>
    </section>
    <section class="panel ctdc-panel" id="ctdc-panel" hidden>
      <h2>Victim corridors (CTDC)</h2>
      <div id="ctdc-body"></div>
    </section>
    <section>
      <div class="gridhead"><h2>Cases</h2><input id="filter" type="search" placeholder="Filter by name, alias, country…" aria-label="Filter cases"></div>
      ${scoreGuide}
      <div class="cards" id="cards"></div>
    </section>`;

  mountGlobe($("#globe"));
  const map = baseMap($("#worldmap"), { center: [22, 40], zoom: 2, minZoom: 2 });
  const groups = {};
  if (map) {
    cases.forEach((c) => {
      const g = drawJourney(map, c, { numbered: false, weight: 2.5, link: true });
      (groups[c.typology] ||= []).push(g);
    });
  }
  // News reports layer: countries named in recent articles, kept visually apart from the checked cases.
  let newsLayer = null;
  const showNews = async (on) => {
    if (!map) return;
    if (!on) { newsLayer?.remove(); return; }
    if (!newsLayer) {
      const n = await loadNews();
      $("#news-count").textContent = `(${n.n_articles} articles)`;
      const byCountry = {};
      n.articles.forEach((x, i) => x.places.forEach((pl) => (byCountry[pl.iso2] ||= []).push(i)));
      const top = Math.max(...Object.values(byCountry).map((v) => v.length));
      newsLayer = L.layerGroup(Object.entries(byCountry).filter(([k]) => n.points[k]).map(([k, idx]) =>
        L.circleMarker(n.points[k], { radius: 3 + Math.sqrt(idx.length / top) * 14, color: "#8C97A6", weight: 1, dashArray: "2 3", fillColor: "#8C97A6", fillOpacity: 0.18 })
          .bindPopup(`<strong>${esc(country(k))}</strong>: ${idx.length} news report${idx.length > 1 ? "s" : ""} (not checked)<ul class="newspop">${idx.slice(0, 5).map((i) => `<li>${ext(n.articles[i].url, n.articles[i].title)}</li>`).join("")}</ul>${idx.length > 5 ? `<a href="#/news/country/${esc(k)}">All ${idx.length} reports →</a>` : ""}`)));
    }
    newsLayer.addTo(map);
    newsLayer.eachLayer((l) => l.bringToBack());
  };
  $("#news-toggle").addEventListener("change", (e) => showNews(e.target.checked));
  showNews(true);
  let ctdcLayer = null;
  $("#ctdc-toggle").addEventListener("change", async (e) => {
    const panel = $("#ctdc-panel");
    panel.hidden = !e.target.checked;
    if (!e.target.checked) { ctdcLayer?.remove(); return; }
    const d = await loadCtdc();
    if (!d) {
      $("#ctdc-body").innerHTML = `<p class="callout">CTDC corridor summaries haven't been imported yet. CTDC's terms don't allow automated downloads, so the dataset is added by hand from ${ext("https://www.ctdatacollaborative.org/page/global-synthetic-dataset", "the CTDC Global Synthetic Dataset page")}. Meanwhile, see ${ext("https://www.ctdatacollaborative.org/map", "the CTDC map")}.</p>`;
      return;
    }
    const top = d.corridors.filter((c) => !c.domestic).slice(0, 60);
    const max = top[0]?.n || 1;
    if (map && !ctdcLayer) {
      const pts = await ctdcPoints();
      ctdcLayer = L.layerGroup(top.filter((c) => pts[c.from] && pts[c.to]).map((c) =>
        L.polyline(arc(pts[c.from], pts[c.to]), { color: "#2A66B8", weight: 1 + 7 * Math.sqrt(c.n / max), opacity: 0.55 })
          .bindTooltip(`${esc(country(c.from))} → ${esc(country(c.to))}: ${c.n.toLocaleString("en-US")} records`, { sticky: true })
          .on("click", () => showCorridor(c))));
    }
    ctdcLayer?.addTo(map);
    const showCorridor = (c) => { $("#ctdc-detail").innerHTML = ctdcCorridorHtml(c, d.source); $("#ctdc-detail").scrollIntoView({ behavior: "smooth", block: "nearest" }); };
    $("#ctdc-body").innerHTML = `
      <p class="fine">${esc(d.source.note)} Line width shows the number of records. Click a line or a row for its summary.</p>
      <div class="ctdc-grid">
        <ol class="corrlist" id="ctdc-list">${top.slice(0, 20).map((c, i) => `<li><button type="button" class="linklike" data-i="${i}">${esc(country(c.from))} → ${esc(country(c.to))}</button> <span class="mono">${c.n.toLocaleString("en-US")}</span></li>`).join("")}</ol>
        <div id="ctdc-detail">${top[0] ? ctdcCorridorHtml(top[0], d.source) : ""}</div>
      </div>
      ${ctdcCredit(d.source)}`;
    $("#ctdc-list").addEventListener("click", (ev) => { const b = ev.target.closest("[data-i]"); if (b) showCorridor(top[Number(b.dataset.i)]); });
  });
  let flLayer = null;
  $("#fl-toggle").addEventListener("change", async (e) => {
    if (!map) return;
    $("#fl-legend").hidden = !e.target.checked;
    if (!e.target.checked) { flLayer?.remove(); return; }
    try {
      flLayer ||= flsriLayer(await loadWorld());
      flLayer.addTo(map).bringToBack();
    } catch {
      $("#fl-legend").innerHTML = `<span class="fine">Country shapes could not be loaded.</span>`;
    }
  });
  $("#legend").addEventListener("click", (e) => {
    const b = e.target.closest("[data-typ]"); if (!b || !map) return;
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on)); b.classList.toggle("on", on);
    groups[b.dataset.typ].forEach((g) => (on ? g.addTo(map) : g.remove()));
  });

  const render = (q = "") => {
    const needle = q.trim().toLowerCase();
    const list = cases.filter((c) => !needle || JSON.stringify([c.title, c.summary, c.entities.map((e) => allNames(e).map((n) => n.name)), c.journey.map((j) => [j.place, country(j.country)])]).toLowerCase().includes(needle));
    $("#cards").innerHTML = list.map((c) => {
      const s = caseEvidence(c, signals);
      const cov = coverage(caseJurisdictions(c), registers);
      const route = [...new Set(c.journey.filter((j) => j.stage !== "prosecuted").map((j) => country(j.country)))].join(" → ");
      return `<a class="card" href="#/case/${esc(c.id)}">
        <div class="cardtop"><span class="typ" style="--c:${TYPOLOGY[c.typology]?.color}">${esc(TYPOLOGY[c.typology]?.label)}</span><span class="mono muted">${esc(c.period)}</span></div>
        <h3>${esc(c.title)}</h3>
        <p class="route">${esc(route)}</p>
        <div class="cardfoot"><span class="status">${esc(STATUS[c.status])}</span><span class="mini t-${esc(s.tier.id)}" title="${esc(caseTierLabel(s))}: ${s.points} out of 100">${s.points}<small>/100</small><span class="sr"> warning-sign score, ${esc(caseTierLabel(s))}</span></span><span class="cov c-${esc(cov.class)}" title="${esc(cov.explain)}">${esc(cov.label)}</span></div>
      </a>`;
    }).join("") || `<p class="muted">No cases match.</p>`;
  };
  render();
  $("#filter").addEventListener("input", (e) => render(e.target.value));
}

// ---- views: one case -------------------------------------------------------------------

function viewCase(id) {
  const c = cases.find((x) => x.id === id);
  if (!c) { main.innerHTML = `<section><h1>Case not found</h1><p><a href="#/cases">Back to cases</a></p></section>`; return; }
  const s = caseEvidence(c, signals);
  const cov = coverage(caseJurisdictions(c), registers);
  const typ = TYPOLOGY[c.typology] || {};

  main.innerHTML = `
    <p class="crumb"><a href="#/cases">← All cases</a></p>
    <section class="casehead">
      <div>
        <div class="eyebrow mono"><span class="typ" style="--c:${typ.color}">${esc(typ.label)}</span> ${esc(c.period)} · ${esc(STATUS[c.status])}</div>
        <h1>${esc(c.title)}</h1>
        <p class="lede">${esc(c.summary)}</p>
      </div>
      ${scoreBadge(s, cov)}
    </section>

    <div class="dash">
      <section class="panel span2">
        <h2>Recruitment journey</h2>
        <div id="casemap" class="map" role="img" aria-label="Map of this case's journey"></div>
        <ol class="journey">${c.journey.map((j) => `
          <li><span class="stage mono">${esc(STAGE[j.stage])}</span><div><strong>${esc(j.place)}, ${esc(country(j.country))}</strong><p>${esc(j.note)}</p>${j.source ? `<span class="fine">${ext(j.source, "source")}</span>` : ""}</div></li>`).join("")}
        </ol>
      </section>

      <section class="panel">
        <h2>Warning-sign score</h2>
        <p class="fine"><strong>${s.points}/100 · ${esc(caseTierLabel(s))}.</strong> Each warning sign the sources document adds points (lures, official actions, name changes), capped at 100. It measures how much evidence exists, not how serious the harm was.</p>
        <p class="fine"><strong>${esc(cov.label)}.</strong> ${esc(cov.explain)}</p>
        ${flagList(s.flags)}
      </section>

      <section class="panel">
        <h2>Entities and name lineage</h2>
        ${c.entities.map((e) => `
          <div class="entity">
            <div class="row"><strong>${esc(e.name)}</strong><span class="mono muted">${esc(e.kind || "")}${e.jurisdiction ? ` · ${esc(e.jurisdiction)}` : ""}</span></div>
            ${(e.names || []).length ? `<ol class="lineage">${e.names.map((n) => `<li><span class="mono">${esc(n.type)}</span> ${esc(n.name)}${n.from || n.to ? ` <span class="muted">(${esc(n.from || "?")}–${esc(n.to || "")})</span>` : ""}${n.source ? ` · ${ext(n.source, "source")}` : ""}</li>`).join("")}</ol>` : ""}
            ${(e.actions || []).length ? `<ul class="actions">${e.actions.map((a) => `<li><span class="mono">${esc(a.date || "")}</span> ${esc(a.body)}: ${ext(a.url, a.action)}</li>`).join("")}</ul>` : ""}
          </div>`).join("")}
      </section>

      <section class="panel">
        <h2>How people were recruited</h2>
        ${(c.lures || []).length ? `<ul class="lures">${c.lures.map((l) => `<li><span class="tag">${esc(signalById[l.signal]?.label || l.signal)}</span><p>${esc(l.quote_or_description)}</p>${l.source ? `<span class="fine">${ext(l.source, "source")}</span>` : ""}</li>`).join("")}</ul>` : `<p class="muted">No lure details in the sources.</p>`}
        ${(c.victim_origins || []).length ? `<p class="fine">Victims recorded from: ${c.victim_origins.map(country).map(esc).join(", ")}</p>` : ""}
      </section>

      <section class="panel">
        <h2>Registers that could have seen it</h2>
        <p class="fine">Coverage is judged on the jurisdictions where the entities are based and people were exploited: ${caseJurisdictions(c).map(country).map(esc).join(", ")}.</p>
        ${cov.applicable.length ? `<ul class="reglist">${cov.applicable.map((r) => `<li><span class="acc ${ACCESS[r.access].cls}">${ACCESS[r.access].label}</span> ${ext(linkFor(r, { name: c.entities[0]?.name }), r.name)}</li>`).join("")}</ul>` : `<p class="callout">No open national register covers these jurisdictions. Only global watchlists (sanctions, Interpol) could name these entities, which is why so many compound operators surface only once sanctioned.</p>`}
      </section>

      ${flsriPanel(c)}
      <section class="panel span2" id="case-ctdc" hidden></section>

      <section class="panel span2">
        <h2>Sources</h2>
        <ul class="sources">${c.sources.map((src) => `<li><span class="acc">${esc(src.tier)}</span> ${ext(src.url, src.title)} <span class="muted">· ${esc(src.publisher)}${src.date ? `, ${esc(src.date)}` : ""}</span></li>`).join("")}</ul>
      </section>
    </div>`;

  loadCtdc().then((d) => {
    if (!d || !$("#case-ctdc")) return;
    const origins = [...new Set([...c.journey.filter((j) => ["advertised", "recruited", "transit"].includes(j.stage)).map((j) => j.country), ...(c.victim_origins || [])])];
    const dests = [...new Set(c.journey.filter((j) => ["exploited"].includes(j.stage)).map((j) => j.country))];
    const hits = d.corridors.filter((k) => origins.includes(k.from) && dests.includes(k.to) && k.from !== k.to);
    const el = $("#case-ctdc");
    el.hidden = false;
    el.innerHTML = `<h2>What wider data shows on these routes</h2>
      <p class="fine">Summaries of identified victims from the Counter-Trafficking Data Collaborative for the origin and destination countries in this case. They describe the corridor as a whole, not this case.</p>
      ${hits.length ? `<div class="ctdc-cols">${hits.slice(0, 4).map((k) => ctdcCorridorHtml(k, d.source)).join("")}</div>` : `<p class="fine">CTDC publishes no corridor with ${d.source.min_count} or more records for these countries (${origins.map(country).map(esc).join(", ") || "—"} → ${dests.map(country).map(esc).join(", ") || "—"}). Absence here reflects where contributing organisations identify victims, not an absence of trafficking.</p>`}
      ${ctdcCredit(d.source)}`;
  });

  const map = baseMap($("#casemap"));
  if (map) {
    const g = drawJourney(map, c);
    map.fitBounds(g.getBounds().pad(0.25), { maxZoom: 6 });
  }
}

function flsriPanel(c) {
  const { rows, destinationUnderRead } = flsriRoute(c, flsri);
  if (!rows.length) return "";
  const phaseFor = (r) => r.roles.includes("destination") && !r.roles.includes("origin") ? "E" : r.roles.includes("destination") ? "RE" : "R";
  return `
    <section class="panel span2">
      <h2>Structural conditions along the route</h2>
      <p class="fine">From the ETC ${flLink("Forced Labor Structural Risk Index")}. For countries where people were recruited, the Recruitment phase is the one to read; where they were exploited, the Exploitation phase. These are country conditions that make forced labour more likely. They are not evidence about anyone in this case and are not part of its score.</p>
      <div class="tblwrap"><table class="fltable">
        <thead><tr><th>Country</th><th>Role on route</th><th>Recruitment phase</th><th>Exploitation phase</th><th>Composite</th><th>Rank (90% band)</th></tr></thead>
        <tbody>${rows.map((r) => r.available ? `
          <tr><td><strong>${esc(country(r.iso2))}</strong>${r.lowConfidence ? ` <span class="acc a-plan" title="Score rests on a reduced evidence base">lower confidence</span>` : ""}</td>
            <td>${esc(r.roles.join(", "))}</td>
            <td class="${phaseFor(r).includes("R") ? "focus" : ""}">${bar(r.R)}</td>
            <td class="${phaseFor(r).includes("E") ? "focus" : ""}">${bar(r.E)}</td>
            <td>${tierChip(r.tier)} <span class="mono">${r.composite.toFixed(2)}</span></td>
            <td class="mono">${r.rank} <span class="muted">(${r.band[0]}–${r.band[1]})</span> <span class="muted">of ${flSrc.n_scored}</span></td></tr>`
          : `<tr><td><strong>${esc(country(r.iso2))}</strong></td><td>${esc(r.roles.join(", "))}</td><td colspan="4" class="muted">${esc(r.reason)}</td></tr>`).join("")}
        </tbody></table></div>
      ${destinationUnderRead ? `<p class="callout">Where people were recruited from scores higher than, or as high as, where they were exploited. That is expected: FLSRI measures origin-side conditions well and <strong>under-reads destination and sponsorship systems</strong> (tied visas, recruitment debt, brokerage, and closed zones such as compounds). A lower score for a destination is not a clean bill of health.</p>` : ""}
      ${rows.filter((r) => r.available && r.corridors?.length && r.roles.some((x) => x !== "destination")).map((r) => `
        <h3>Highest-risk sub-national corridors in ${esc(country(r.iso2))}</h3>
        <p class="fine">Admin-1 regions from FLSRI's census-based sub-national layer (weights illustrative, not locked).</p>
        <ul class="corridors">${r.corridors.slice(0, 6).map((k) => `<li><span>${esc(k.region)}</span><span>${bar(k.risk)}</span></li>`).join("")}</ul>`).join("")}
      <p class="fine">FLSRI build ${esc(flSrc.build_date)}, imported ${esc(flSrc.imported)}. ${esc(flSrc.rank_band)}. ${esc(flSrc.citation)}</p>
    </section>`;
}

// ---- top concerns (home) and concern pages ---------------------------------------------

async function concernData() {
  const news = await loadNews();
  const signalsSeen = {};
  const bump = (id, key, n = 1) => { (signalsSeen[id] ||= { cases: 0, news: 0 })[key] += n; };
  for (const c of cases) for (const id of new Set((c.lures || []).map((l) => l.signal))) bump(id, "cases");
  for (const [id, n] of Object.entries(news.aggregates.signals)) bump(id, "news", n);
  const topSignals = Object.entries(signalsSeen)
    .map(([id, v]) => ({ id, ...v, score: v.cases * 3 + v.news }))
    .sort((a, b) => b.score - a.score).slice(0, 6);
  const topTyp = Object.entries(news.aggregates.typologies).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topRoutes = news.aggregates.corridors.slice(0, 5);
  return { news, topSignals, topTyp, topRoutes };
}

async function renderSeeing() {
  const el = $("#seeing"); if (!el) return;
  let d;
  try { d = await concernData(); } catch { el.hidden = true; return; }
  const updated = new Date(d.news.generated).toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="seeing-head">
      <h2>What we're seeing</h2>
      <p class="sub">Among other things, these are the top concerns and warning signs in the data we've collected: ${cases.length} documented cases and ${d.news.n_articles} recent news reports (updated ${esc(updated)}). Click through to see where each one comes from.</p>
    </div>
    <div class="seeing-grid">
      <div class="seeing-col">
        <h3>Top warning signs</h3>
        <ol class="seeing-list">${d.topSignals.map((x, i) => `
          <li><a href="#/concern/${esc(x.id)}"><span class="rank">${String(i + 1).padStart(2, "0")}</span><span class="what">${esc(signalById[x.id]?.label || x.id)}</span><span class="fine">${x.cases ? `${x.cases} case${x.cases > 1 ? "s" : ""}` : ""}${x.cases && x.news ? " · " : ""}${x.news ? `${x.news} news report${x.news > 1 ? "s" : ""}` : ""}</span></a></li>`).join("")}
        </ol>
      </div>
      <div class="seeing-col">
        <h3>Top threats in the news</h3>
        <ol class="seeing-list">${d.topTyp.map(([t, n], i) => `
          <li><a href="#/news/typ/${esc(t)}"><span class="rank">${String(i + 1).padStart(2, "0")}</span><span class="what">${esc(NEWS_TYP[t] || t)}</span><span class="fine">${n} report${n > 1 ? "s" : ""}</span></a></li>`).join("")}
        </ol>
      </div>
      <div class="seeing-col">
        <h3>Routes in the news</h3>
        <ol class="seeing-list">${d.topRoutes.map((c, i) => `
          <li><a href="#/news/country/${esc(c.from)}"><span class="rank">${String(i + 1).padStart(2, "0")}</span><span class="what">${esc(country(c.from))} → ${esc(country(c.to))}</span><span class="fine">${c.count} report${c.count > 1 ? "s" : ""}</span></a></li>`).join("")}
        </ol>
      </div>
    </div>
    <p class="fine">Cases are researched from official and press sources; news patterns are read automatically from headlines and can be wrong. Anonymous reports submitted here will be added once collection is switched on. <a href="#/methodology">How this is built</a>.</p>`;
}

async function viewConcern(id) {
  const sig = signalById[id];
  if (!sig) { main.innerHTML = `<section class="hero small"><div class="eyebrow">Concern</div><h1>Not found</h1><p class="lede"><a href="#/check">Back to the check</a></p></section>`; return; }
  const news = await loadNews();
  const caseHits = cases.flatMap((c) => (c.lures || []).filter((l) => l.signal === id).map((l) => ({ c, l })));
  const newsHits = news.articles.filter((a) => a.signals.includes(id));
  const kinds = KIND_ORDER.map((k) => [k, KINDS[k]]).filter(([, k]) => k.questions.includes(id));
  main.innerHTML = `
    <p class="crumb"><a href="#/check">← What we're seeing</a></p>
    <section class="hero small">
      <div class="eyebrow">Warning sign · ${esc(signals.categories[sig.category])}</div>
      <h1>${esc(sig.label)}</h1>
      <p class="lede">${esc(sig.why)}</p>
    </section>
    <div class="dash">
      <section class="panel">
        <h2>In documented cases</h2>
        ${caseHits.length ? `<ul class="lures">${caseHits.map(({ c, l }) => `<li><a href="#/case/${esc(c.id)}"><strong>${esc(c.title)}</strong></a><p>${esc(l.quote_or_description)}</p>${l.source ? `<span class="fine">${ext(l.source, "source")}</span>` : ""}</li>`).join("")}</ul>` : `<p class="fine">Not recorded in the documented cases.</p>`}
      </section>
      <section class="panel">
        <h2>In recent news</h2>
        ${newsHits.length ? `<ul class="articles">${newsHits.slice(0, 12).map((a) => `<li><span class="mono fine">${esc(a.date || "")} · ${esc(a.source)}</span><h3>${ext(a.url, a.title)}</h3></li>`).join("")}</ul>${newsHits.length > 12 ? `<p class="fine">${newsHits.length - 12} more on <a href="#/news">News patterns</a>.</p>` : ""}` : `<p class="fine">Not found in the last ${news.window_days} days of coverage. Short news snippets undercount warning signs.</p>`}
      </section>
      <section class="panel span2">
        <h2>Check your own situation</h2>
        <p class="fine">These checks look for this warning sign:</p>
        <nav class="kinds compact" aria-label="Checks that look for this">${(kinds.length ? kinds : KIND_ORDER.map((k) => [k, KINDS[k]])).map(([k, x]) => `<a class="kind" href="#/check/${k}"><span class="ki" aria-hidden="true">${KIND_ICON[k]}</span><strong>${esc(x.label)}</strong></a>`).join("")}</nav>
        <p class="fine">If this is happening to you now, <a href="#/help">get help</a>.</p>
      </section>
    </div>`;
}

// ---- views: help -----------------------------------------------------------------------

const telHref = (v) => `tel:${String(v).replace(/[^\d+]/g, "")}`;
const contactHtml = (c) => {
  const v = esc(c.value);
  const link = c.type === "phone" ? `<a class="dial" href="${telHref(c.value)}">${v}</a>`
    : c.type === "sms" ? `<span class="mono">${v}</span>`
    : c.type === "whatsapp" ? `<span class="mono">${v}</span>`
    : c.type === "email" ? `<a href="mailto:${v}">${v}</a>`
    : ext(c.value, c.value.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""));
  return `<li><span class="ctype">${esc({ phone: "Call", sms: "Text", whatsapp: "WhatsApp", web: "Online", email: "Email" }[c.type] || c.type)}</span> ${link}${c.note ? ` <span class="muted">${esc(c.note)}</span>` : ""}</li>`;
};
const FOR_LABEL = { trafficking: "Human trafficking", "forced-labour": "Forced labour", "job-scam": "Job scams and fraud", "migrant-workers": "Migrant workers", children: "Children" };

const SITUATIONS = [
  { id: "danger", title: "I'm being held, threatened or can't leave", urgent: true, steps: [
    "If you can, call the emergency number or a trafficking hotline for the country you're in (choose it above). If you can't speak, many hotlines accept texts.",
    "If you're abroad, contact your own country's embassy or consulate, or IOM. They help people stranded or exploited abroad, including without a passport. <a href=\"#partners\" data-jump>Organisations that take requests for help</a> are listed below.",
    "Don't confront the people holding you. Keep your phone hidden and charged if you can, and delete this page from your history if your phone is checked.",
    "Try to note where you are (building names, landmarks, a map pin) and share it with someone you trust.",
  ] },
  { id: "someone", title: "Someone I know went for a job and I've lost contact", urgent: true, steps: [
    "Call a trafficking hotline in the country where they went, or in yours. You don't need proof to call.",
    "Contact your country's foreign ministry or embassy in the destination country and report a citizen at risk.",
    "Collect what you have: the job ad, recruiter names and numbers, chat screenshots, travel dates, their last known location. Hotlines and police will ask for these.",
    "Be careful about posting publicly. It can put the person at risk if the recruiters see it.",
  ] },
  { id: "paid", title: "I paid a fee or sent my passport, ID or bank details", steps: [
    "Stop paying. Recruiters who ask for more money \"to release\" a job, visa or refund are usually running the same scam.",
    "Call your bank or payment app now to try to stop or reverse the payment. For crypto or gift cards, report to the platform straight away.",
    "If you sent ID documents, report them lost or stolen to the issuing authority and watch for accounts opened in your name.",
    "Report it (job-scam channels are listed by country above), and keep screenshots and receipts.",
  ] },
  { id: "unsure", title: "I'm not sure whether a job offer is real", steps: [
    "Run it through <a href=\"#/check\">Check an offer</a>, which looks for the warning signs seen in real cases.",
    "Contact the company yourself using the phone number or email on its official website, not the details the recruiter gave you.",
    "Real employers don't charge you for a job, don't need your passport before an interview, and don't interview only over Telegram or WhatsApp.",
    "Be most careful about jobs abroad with free flights and housing, very high pay for easy work, or a workplace address you'll only get \"on arrival\".",
  ] },
  { id: "report", title: "I want to report a recruiter or employer", steps: [
    "If anyone is in danger, call a hotline first.",
    "Report job scams to the official channel for your country (listed above).",
    "You can also <a href=\"#/report\">report it here anonymously</a>. We don't ask who you are, and your details are removed before anything is sent. It helps warn other job seekers.",
  ] },
];

async function viewHelp() {
  const [help, partners] = await Promise.all([loadHelp(), loadPartners()]);
  const regionGuess = (navigator.languages || [navigator.language]).map((l) => (l.split("-")[1] || "").toUpperCase()).find(Boolean);
  let saved = null; try { saved = localStorage.getItem("jrt-help-country"); } catch {}
  const countries = help?.countries || [];
  const initial = [saved, regionGuess].find((c) => c && countries.some((x) => x.iso2 === c)) || countries[0]?.iso2 || "";

  main.innerHTML = `
    <section class="hero small help-hero">
      <div class="eyebrow mono">Get help</div>
      <h1>Help is available</h1>
      <p class="lede">Whether you're in danger now, worried about someone, or unsure about a job offer, you don't need proof to ask for help. Choose your country for hotlines, then find your situation below.</p>
    </section>

    <section class="panel emergency">
      <div class="emerg-head">
        <div><h2>In immediate danger?</h2><p>Call the emergency number for the country you're in.</p></div>
        <label class="short">Country you're in
          <select id="help-country">${[...countries].sort((x, y) => country(x.iso2).localeCompare(country(y.iso2))).map((c) => `<option value="${esc(c.iso2)}"${c.iso2 === initial ? " selected" : ""}>${esc(country(c.iso2))}</option>`).join("")}</select>
        </label>
      </div>
      <div id="help-lines" aria-live="polite">${help ? "" : `<p>Hotline list is loading or unavailable. In the US call <a class="dial" href="tel:18883737888">1-888-373-7888</a>; in the UK <a class="dial" href="tel:08000121700">08000 121 700</a>; anywhere else, local emergency services.</p>`}</div>
    </section>

    <section>
      <h2 class="sec">What's happening?</h2>
      <div class="situations">${SITUATIONS.map((s, i) => `
        <details class="situation${s.urgent ? " urgent" : ""}" ${i === 0 ? "open" : ""} id="h-${s.id}">
          <summary>${esc(s.title)}</summary>
          <ol>${s.steps.map((t) => `<li>${t}</li>`).join("")}</ol>
        </details>`).join("")}
      </div>
    </section>

    ${help?.global?.length ? `<section class="panel"><h2>Anywhere in the world</h2>
      <div class="global">${help.global.map((g) => `<div><h3>${esc(g.name)}</h3><p class="fine">${esc(g.what)}</p><ul class="contacts">${g.contacts.map(contactHtml).join("")}</ul></div>`).join("")}</div></section>` : ""}

    ${partners?.partners?.length ? `<section class="panel" id="partners">
      <h2>Organisations working against trafficking</h2>
      <p class="fine">Groups that support survivors, migrant workers and families, or that research and campaign on trafficking and scam compounds. Some take requests for help directly; others refer people on or work through partners. ${esc(partners.note)} Details checked on each organisation's own website on ${esc(partners.verified)}.</p>
      <div class="pfilter">
        <label class="check"><input type="checkbox" id="p-direct"> Only organisations that take requests for help</label>
        <label>Region <select id="p-region"><option value="">All regions</option>${[...new Set(partners.partners.flatMap((x) => x.regions))].sort().map((r) => `<option>${esc(r)}</option>`).join("")}</select></label>
      </div>
      <div class="partners" id="p-list"></div>
    </section>` : ""}

    <section class="panel">
      <h2>Staying safe while you look for help</h2>
      <ul>
        <li>The red <strong>Quick exit</strong> button (or the Esc key on the report page) leaves this site at once and replaces it in your browser's back button.</li>
        <li>If someone checks your phone, use a private or incognito window, or clear your browsing history afterwards.</li>
        <li>This site doesn't use cookies or tracking. The only thing it remembers on your device is the country you chose on this page.</li>
      </ul>
    </section>
    ${help ? `<p class="fine">Contacts checked against official sources on ${esc(help.verified)}. Numbers change: if one doesn't work, try the emergency number or IOM. <a href="#/report">Tell us</a> about a number that is wrong.</p>` : ""}`;

  const render = (iso2) => {
    const c = countries.find((x) => x.iso2 === iso2);
    if (!c) return;
    $("#help-lines").innerHTML = `
      <div class="emerg-num"><span>Emergency in ${esc(country(c.iso2))}</span><a class="dial big" href="${telHref(c.emergency)}">${esc(c.emergency)}</a></div>
      ${c.lines.length ? "" : `<p class="callout">We haven't been able to verify a national trafficking hotline for ${esc(country(c.iso2))} from an official source yet. If you're from another country, contact your embassy. ${help.global[0] ? `You can also reach <strong>${esc(help.global[0].name)}</strong> (below), which helps people who are stranded or exploited abroad.` : ""}</p>`}
      <div class="lines">${c.lines.map((l) => `
        <div class="line"><div class="fine for">${esc(FOR_LABEL[l.for] || l.for)}</div><h3>${esc(l.name)}</h3>
          <ul class="contacts">${l.contacts.map(contactHtml).join("")}</ul>
          <div class="fine">${ext(l.source, "Source")}</div></div>`).join("")}</div>`;
    try { localStorage.setItem("jrt-help-country", iso2); } catch {}
  };
  if (partners?.partners?.length) {
    const renderPartners = () => {
      const direct = $("#p-direct").checked, region = $("#p-region").value;
      const list = partners.partners.filter((x) => (!direct || x.direct_help) && (!region || x.regions.includes(region) || x.regions.includes("Global")))
        .sort((a, b) => (b.direct_help - a.direct_help) || a.name.localeCompare(b.name));
      $("#p-list").innerHTML = list.map((x) => `
        <div class="partner">
          <div class="for">${x.direct_help ? "Takes requests for help" : "Referral, research or advocacy"} · ${esc(x.regions.join(", "))}</div>
          <h3>${esc(x.name)}</h3>
          <p class="fine">${esc(x.what)}</p>
          <ul class="contacts">
            ${x.contact.web ? `<li><span class="ctype">Online</span> ${ext(x.contact.web, x.contact.web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</li>` : ""}
            ${x.contact.phone ? `<li><span class="ctype">Call</span> <a class="dial" href="${telHref(x.contact.phone)}">${esc(x.contact.phone)}</a></li>` : ""}
            ${x.contact.email ? `<li><span class="ctype">Email</span> <a href="mailto:${esc(x.contact.email)}">${esc(x.contact.email)}</a></li>` : ""}
          </ul>
          <div class="fine">${ext(x.source, "Source")}</div>
        </div>`).join("") || `<p class="fine pad">No organisations match.</p>`;
    };
    $("#p-direct").addEventListener("change", renderPartners);
    $("#p-region").addEventListener("change", renderPartners);
    renderPartners();
  }
  if (help) { render(initial); $("#help-country").addEventListener("change", (e) => render(e.target.value)); }
  main.querySelectorAll("[data-jump]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); $("#partners")?.scrollIntoView({ behavior: "smooth" }); }));
}

// ---- views: news patterns --------------------------------------------------------------

const NEWS_TYP = {
  "deepfake-fraud": "Deepfakes and voice clones",
  "scam-compound": "Scam compounds", "labor-trafficking": "Labour trafficking", "military-recruitment": "Recruited to fight",
  "money-mule": "Money mules", "sex-trafficking": "Sex trafficking", "organ-trafficking": "Organ trafficking", "cartel-recruitment": "Cartel recruitment",
  "online-scam": "Online scams", "human-trafficking": "Human trafficking (general)",
};
// Every article gets at least one type tag. The general labels only show when nothing more specific matched.
const articleTags = (x) => {
  const specific = x.typologies.filter((t) => t !== "online-scam" && t !== "human-trafficking");
  const typ = specific.length ? specific : x.typologies.slice(0, 1);
  const tags = typ.map((t) => NEWS_TYP[t] || t);
  if (x.fake_job) tags.push("Fake job offer");
  return tags.length ? tags : ["General coverage"];
};
const NEWS_EVENT = { arrest: "Arrests & raids", warning: "Warnings & advisories", rescue: "Rescues & repatriation", sanction: "Sanctions", conviction: "Convictions" };
// Corridors backed by several articles get their own row. Corridors that come from a single
// article are merged per article, so one story naming four countries doesn't fill the list.
function corridorRows(corridors) {
  const rows = corridors.filter((c) => c.count > 1).map((c) => ({ from: [c.from], to: [c.to], count: c.count, article: c.articles[0] }));
  const byArticle = new Map();
  for (const c of corridors.filter((x) => x.count === 1)) {
    const r = byArticle.get(c.articles[0]) || { from: [], to: [], count: 1, article: c.articles[0] };
    if (!r.from.includes(c.from)) r.from.push(c.from);
    if (!r.to.includes(c.to)) r.to.push(c.to);
    byArticle.set(c.articles[0], r);
  }
  return [...rows, ...byArticle.values()];
}

const countryRole = (v) => (v.origin > v.destination ? "origin" : v.destination > v.origin ? "destination" : v.origin ? "origin" : "mentioned");
const ROLE_COLOR = { origin: "#2A66B8", destination: "#14264A", mentioned: "#8C97A6" };

// Catalog entities named in an article (names of 6+ characters, whole words).
const entityIndex = cases.flatMap((c) => c.entities.filter((e) => !/^unnamed\b/i.test(e.name)).flatMap((e) => allNames(e).map((n) => n.name)
  .filter((n) => n.length >= 6)
  .map((n) => ({ caseId: c.id, title: c.title, re: new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "iu") }))));
const relatedCases = (a) => [...new Map(entityIndex.filter((x) => x.re.test(`${a.title} ${a.snippet}`)).map((x) => [x.caseId, x])).values()];

const hbars = (obj, labels, max = null) => {
  const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const top = max ?? Math.max(1, ...rows.map(([, n]) => n));
  return rows.length ? `<ul class="hbars">${rows.map(([k, n]) => `<li><span>${esc(labels[k] || k)}</span><span class="hb"><i style="width:${Math.round((n / top) * 100)}%"></i></span><span class="mono">${n}</span></li>`).join("")}</ul>` : `<p class="muted">None detected.</p>`;
};

const SCAM_TYPES = [
  { name: "Fake jobs abroad that end in scam compounds", typ: "scam-compound",
    how: "Online ads offer customer-service, typing or IT jobs abroad with flights and housing paid. People are taken to compounds and forced to run online scams.",
    tells: ["high pay for easy work abroad", "flights and housing arranged by the employer", "workplace address only on arrival", "passport requested early"],
    signals: ["employer_housing_travel", "vague_location", "high_risk_region"], source: ["UNODC, Trapped in scam crime", "https://www.unodc.org/roseap/en/TrappedInScamCrime/index.html"] },
  { name: "Work-from-home and pay-to-work jobs", typ: null,
    how: "Promises of a lot of money for little time or effort, then fees for starter kits, training or certifications.",
    tells: ["you pay before you earn", "“thousands a month” with little work", "placement firms charging up front"],
    signals: ["upfront_fee", "pay_too_high"], source: ["FTC, Job scams", "https://consumer.ftc.gov/articles/job-scams"] },
  { name: "Reshipping jobs", typ: "money-mule",
    how: "You receive packages at home, remove the original packaging and receipts, and reship them. The promised pay never arrives and the company disappears.",
    tells: ["repackaging goods for strangers", "“quality control” or “logistics” job from home", "no contract, no address"],
    signals: ["payment_handling"], source: ["FTC, Job scams", "https://consumer.ftc.gov/articles/job-scams"] },
  { name: "Fake check and overpayment", typ: null,
    how: "An “employer” sends a check and asks you to send part of it back or on to someone else. The check bounces and you owe the full amount.",
    tells: ["check arrives before any work", "asked to send money back or buy equipment from “their vendor”"],
    signals: ["payment_handling", "gift_card_crypto"], source: ["FTC, Job scams", "https://consumer.ftc.gov/articles/job-scams"] },
  { name: "Deepfakes and cloned voices", typ: "deepfake-fraud",
    how: "AI copies a real face or voice: a celebrity selling an investment in an ad, a relative calling in a panic, or a boss on a video call asking for a confidential transfer.",
    tells: ["a famous person promoting crypto or a giveaway", "a loved one's voice asking for money right now", "a video call that ends in an urgent, secret payment", "you're told not to hang up or check"],
    signals: ["celebrity_endorsement", "voice_clone_emergency", "deepfake_video_call"], source: ["FBI IC3, Criminals use generative AI to facilitate financial fraud", "https://www.ic3.gov/PSA/2024/PSA241203"] },
  { name: "Romance and investment scams", typ: null,
    how: "Someone you've met online builds a relationship, avoids meeting, then needs money for medical bills, a ticket, a visa or fees, or offers to get you started in crypto investing.",
    tells: ["always abroad, on a rig, in the military", "gift cards, wire transfers or crypto", "an investment platform with guaranteed profits"],
    signals: ["romance_money", "investment_pitch", "refuses_video", "gift_card_crypto"], source: ["FTC, What to know about romance scams", "https://consumer.ftc.gov/articles/what-know-about-romance-scams"] },
  { name: "Rental listing scams", typ: null,
    how: "A listing well below local rents, an owner who is out of the country and can't show the place, and pressure to pay quickly.",
    tells: ["payment only by wire, gift cards or crypto", "same address listed by a different owner", "home actually listed for sale"],
    signals: ["housing_unseen_deposit", "owner_unavailable", "urgency"], source: ["FTC, Rental listing scams", "https://consumer.ftc.gov/articles/rental-listing-scams"] },
];
const LAUNDERING_TELLS = {
  intro: "Money mules move money for criminals, often without realising it at first. People are recruited through employment scams promising easy money, romance and confidence scams, lottery scams, and unsolicited requests to open a bank account, crypto wallet or business in their name.",
  tells: [
    "A job, partner or stranger asks you to receive money and send it on",
    "You're asked to open accounts, crypto wallets or a company in your name",
    "Funds move through crypto, cash, wires, money-transfer services or prepaid cards",
    "Your bank warns you about activity, and you're told to ignore it",
    "“Payment processing agent”, “financial assistant” or “transaction manager” roles",
  ],
  source: ["FBI IC3, Money mules public service announcement", "https://www.ic3.gov/PSA/2021/PSA211203"],
};

function scamTypesSection(a) {
  return `<section class="scamtypes">
    <div class="scamtypes-head"><h2>Common types of scams</h2><p class="fine">How they work and the tells to look for, from consumer-protection and law-enforcement guidance. Where the news in this window covers a type, you can jump to those articles.</p></div>
    <div class="scamgrid">${SCAM_TYPES.map((t) => `
      <article class="scamcard">
        <h3>${esc(t.name)}</h3>
        <p>${esc(t.how)}</p>
        <ul class="tells">${t.tells.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <div class="scamfoot">
          ${t.typ && a.typologies[t.typ] ? `<a href="#/news/typ/${esc(t.typ)}">${a.typologies[t.typ]} news report${a.typologies[t.typ] > 1 ? "s" : ""} →</a>` : ""}
          ${t.signals.map((sid) => `<a class="acc" href="#/concern/${esc(sid)}">${esc(signalById[sid]?.label.split(" (")[0] || sid)}</a>`).join("")}
        </div>
        <p class="fine">Source: ${ext(t.source[1], t.source[0])}</p>
      </article>`).join("")}
      <article class="scamcard">
        <h3>Money laundering and money mules</h3>
        <p>${esc(LAUNDERING_TELLS.intro)}</p>
        <ul class="tells">${LAUNDERING_TELLS.tells.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <div class="scamfoot">${a.typologies["money-mule"] ? `<a href="#/news/typ/money-mule">${a.typologies["money-mule"]} news report${a.typologies["money-mule"] > 1 ? "s" : ""} →</a>` : ""}<a class="acc" href="#/concern/payment_handling">Receiving or forwarding money</a></div>
        <p class="fine">Source: ${ext(LAUNDERING_TELLS.source[1], LAUNDERING_TELLS.source[0])}. If you've already moved money for someone, stop, keep records, and contact your bank.</p>
      </article>
    </div>
  </section>`;
}

async function viewNews(arg = "") {
  main.innerHTML = `<section class="hero small"><div class="eyebrow mono">News patterns</div><h1>What the news is reporting</h1><p class="muted">Loading…</p></section>`;
  const n = await loadNews();
  const a = n.aggregates;
  const [fk, fv] = String(arg).split("/");
  const state = { country: fk === "country" ? fv : null, typology: fk === "typ" ? fv : null, limit: 20 };
  const gen = new Date(n.generated);

  main.innerHTML = `
    <section class="hero small">
      <div class="eyebrow mono">News patterns · last ${n.window_days} days · updated ${esc(gen.toISOString().slice(0, 10))}</div>
      <h1>What the news is reporting</h1>
      <p class="lede">${n.n_articles} recent news reports on trafficking, forced labour, fake-job recruitment, online scams and deepfakes, gathered with ${esc(n.provider)} and read by rules for countries, direction of movement, typology and lure indicators. The map shows where reporting points, not where most cases are.</p>
    </section>
    <div class="callout">This is <strong>media attention, not case counts</strong>. Coverage follows English-language outlets, government press releases and whatever is in the news cycle. Country roles and corridors are extracted automatically from headlines and snippets and can be wrong; each corridor lists the words it came from. Nothing here feeds a score.</div>

    ${scamTypesSection(a)}

    <section class="mapcard">
      <div class="maphead">
        <div><h2>Countries and corridors in the news</h2>
          <label class="check toggle"><input type="checkbox" id="news-fl"> Shade countries by structural forced-labour risk (${flLink()})</label></div>
        <div class="legend" id="role-legend" role="group" aria-label="Show countries by role">${[["origin", "Mostly origin"], ["destination", "Mostly destination"], ["mentioned", "Mentioned"]].map(([r, label]) => `
          <button type="button" class="lg on" data-role="${r}" aria-pressed="true"><i style="background:${ROLE_COLOR[r]}"></i>${label} <span class="mono">${Object.values(a.byCountry).filter((v) => countryRole(v) === r).length}</span></button>`).join("")}
        </div>
      </div>
      <div id="newsmap" class="map world" role="img" aria-label="Map of countries and corridors in recent news"></div>
      <div class="mapnotes">
        <p class="callout map-caveat"><strong>No country is ruled out.</strong> A country that isn't marked as an origin or destination here, or doesn't appear at all, can still have trafficking, forced labour, scams and other harms. This map only shows what recent English-language news happened to report. Online scams, deepfakes and money-mule recruitment also don't follow routes: they reach people in any country with an internet connection, so "origin" and "destination" mostly describe trafficking stories, not where scams happen.</p>
      <p class="fine">Circle size = number of articles naming the country. Use the buttons above to show or hide origin, destination and mentioned countries. Arrows run from origin to destination; solid lines have two or more articles behind them, dashed lines one. Click a country to filter the articles.</p>
      </div>
    </section>

    <div class="dash">
      <section class="panel">
        <h2>Corridors</h2>
        <p class="fine">Origin to destination, as extracted from the text.</p>
        <ol class="corrlist">${corridorRows(a.corridors).slice(0, 20).map((r, i) => {
          const art = n.articles[r.article];
          const iso = new Set([...r.from, ...r.to]);
          const why = art.places.filter((p) => iso.has(p.iso2)).map((p) => `${p.terms.join(" / ")} → ${p.roles.join("/")}`).join("; ");
          const names = (xs) => xs.map((x) => esc(country(x))).join(", ");
          return `<li${i >= 8 ? " class=\"extra\" hidden" : ""}><div class="row"><strong>${names(r.from)} → ${names(r.to)}</strong><span class="mono">${r.count} article${r.count > 1 ? "s" : ""}</span></div>
            <div class="fine">${ext(art.url, art.title)} · <span title="Words the extractor used">${esc(why)}</span></div></li>`;
        }).join("") || `<li class="muted">No directed corridors detected.</li>`}</ol>
        ${corridorRows(a.corridors).length > 8 ? `<div class="btns"><button type="button" class="ghost" id="corr-more">Show more corridors</button></div>` : ""}
      </section>
      <section class="panel">
        <h2>Most-named countries</h2>
        <ul class="hbars">${Object.entries(a.byCountry).sort((x, y) => y[1].mentions - x[1].mentions).slice(0, 12).map(([k, v]) => {
          const top = Math.max(...Object.values(a.byCountry).map((x) => x.mentions));
          return `<li><button type="button" class="linklike" data-country="${esc(k)}">${esc(country(k))}</button><span class="hb split"><i style="width:${(v.origin / top) * 100}%;background:${ROLE_COLOR.origin}"></i><i style="width:${(v.destination / top) * 100}%;background:${ROLE_COLOR.destination}"></i><i style="width:${((v.mentions - v.origin - v.destination) / top) * 100}%;background:${ROLE_COLOR.mentioned}"></i></span><span class="mono">${v.mentions}</span></li>`;
        }).join("")}</ul>
        <p class="fine">Blue = named as an origin, navy = as a destination, grey = mentioned without a clear role.</p>
        <hr class="split">
        <h2>Typologies</h2>${hbars(Object.fromEntries(Object.entries(a.typologies).filter(([t]) => t !== "online-scam" && t !== "human-trafficking")), NEWS_TYP)}
        <p class="fine">Plus ${a.typologies["online-scam"] || 0} articles about scams in general and ${a.typologies["human-trafficking"] || 0} about trafficking in general.</p>
      </section>
      <section class="panel">
        <h2>Lure indicators in coverage</h2>
        <p class="fine">The same offer-text rules as the live check, run on headlines and snippets. Snippets are short, so these undercount.</p>
        ${hbars(a.signals, Object.fromEntries(signals.signals.map((s) => [s.id, s.label])))}
      </section>
      <section class="panel">
        <h2>What happened</h2>${hbars(a.events, NEWS_EVENT)}
        <h3>Articles per week</h3>
        <div class="weeks">${a.weeks.map((w) => `<div title="${esc(w.week)}: ${w.n}"><i style="height:${Math.round((w.n / Math.max(...a.weeks.map((x) => x.n))) * 100)}%"></i><span class="mono">${esc(w.week.slice(-3))}</span></div>`).join("")}</div>
        <p class="fine">The latest week is partial.</p>
      </section>
      <section class="panel span2">
        <div class="gridhead"><h2>Articles</h2>
          <div class="filters">
            <select id="nf-typ" aria-label="Filter by typology"><option value="">All typologies</option>${Object.keys(a.typologies).map((t) => `<option value="${esc(t)}">${esc(NEWS_TYP[t] || t)}</option>`).join("")}</select>
            <span id="nf-country"></span>
          </div>
        </div>
        <ul class="articles" id="articles"></ul>
        <div class="btns"><button type="button" class="ghost" id="more" hidden>Show more</button></div>
      </section>
      <section class="panel span2">
        <h2>How this page is built</h2>
        <div class="twocol">
          <p class="fine">News is gathered through Tavily's news search: ${n.queries.length} queries returned ${n.n_results} results, and ${n.n_articles} were kept after relevance filtering and de-duplication. Countries are matched from names, nationality words and known compound hubs. A nationality counts as an origin only in a sentence about victims; capital cities count as plain mentions because they are usually datelines. See <a href="#/methodology">Methodology</a>.</p>
          <div><h3>Search queries</h3><ul class="querylist">${n.queries.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></div>
        </div>
      </section>
    </div>`;

  $("#corr-more")?.addEventListener("click", (e) => {
    const open = e.target.dataset.open !== "1";
    document.querySelectorAll(".corrlist .extra").forEach((li) => (li.hidden = !open));
    e.target.dataset.open = open ? "1" : "";
    e.target.textContent = open ? "Show fewer corridors" : "Show more corridors";
  });
  // map
  const map = baseMap($("#newsmap"), { center: [20, 40], zoom: 2, minZoom: 2 });
  if (map) {
    const top = Math.max(...Object.values(a.byCountry).map((v) => v.mentions));
    const roleLayers = { origin: L.layerGroup().addTo(map), destination: L.layerGroup().addTo(map), mentioned: L.layerGroup().addTo(map) };
    const corridorLayer = L.layerGroup().addTo(map);
    for (const c of a.corridors) {
      const p1 = n.points[c.from], p2 = n.points[c.to];
      if (!p1 || !p2) continue;
      const line = L.polyline(arc(p1, p2), { color: "#2A66B8", weight: 1 + c.count * 1.2, opacity: 0.7, dashArray: c.count > 1 ? null : "5 6" }).addTo(corridorLayer);
      line.bindTooltip(`${esc(country(c.from))} → ${esc(country(c.to))}: ${c.count} article${c.count > 1 ? "s" : ""}`, { sticky: true });
      for (const tip of arc(p1, p2)) {
        const [ya, xa] = tip[tip.length - 3], [yb, xb] = tip[tip.length - 1];
        const ang = Math.atan2(yb - ya, xb - xa) * 180 / Math.PI;
        L.marker([yb, xb], { icon: L.divIcon({ className: "arrow", html: `<span style="transform:rotate(${-ang}deg)">➤</span>`, iconSize: [14, 14] }), interactive: false }).addTo(corridorLayer);
      }
    }
    for (const [k, v] of Object.entries(a.byCountry)) {
      const pt = n.points[k]; if (!pt) continue;
      const dom = countryRole(v);
      L.circleMarker(pt, { radius: 4 + Math.sqrt(v.mentions / top) * 18, color: "#FFFFFF", weight: 1, fillColor: ROLE_COLOR[dom], fillOpacity: 0.75 })
        .addTo(roleLayers[dom])
        .bindTooltip(`<strong>${esc(country(k))}</strong><br>${v.mentions} article(s): ${v.origin} as origin, ${v.destination} as destination`)
        .on("click", () => setCountry(k));
    }
    // Role filters: countries show by their main role; corridor arrows stay while origins or destinations are shown.
    $("#role-legend").addEventListener("click", (e) => {
      const b = e.target.closest("[data-role]"); if (!b) return;
      const on = !b.classList.contains("on");
      b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
      on ? roleLayers[b.dataset.role].addTo(map) : roleLayers[b.dataset.role].remove();
      const showLines = ["origin", "destination"].some((r) => $(`#role-legend [data-role="${r}"]`).classList.contains("on"));
      showLines ? corridorLayer.addTo(map) : corridorLayer.remove();
    });
    let fl = null;
    $("#news-fl").addEventListener("change", async (e) => {
      if (!e.target.checked) { fl?.remove(); return; }
      try { fl ||= flsriLayer(await loadWorld()); fl.addTo(map).bringToBack(); } catch {}
    });
  }

  const renderArticles = () => {
    const list = n.articles.filter((x) => (!state.country || x.places.some((p) => p.iso2 === state.country)) && (!state.typology || x.typologies.includes(state.typology)));
    $("#nf-country").innerHTML = state.country ? `<button type="button" class="chip-btn" id="nf-clear">${esc(country(state.country))} ✕</button>` : "";
    $("#nf-clear")?.addEventListener("click", () => setCountry(null));
    $("#more").hidden = list.length <= state.limit;
    $("#more").textContent = `Show more (${list.length - state.limit} left)`;
    $("#articles").innerHTML = list.slice(0, state.limit).map((x) => {
      const rel = relatedCases(x);
      return `<li>
        <div class="row"><span class="mono muted">${esc(x.date || "")} · ${esc(x.source)}</span><span class="tags">${articleTags(x).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</span></div>
        <h3>${ext(x.url, x.title)}</h3>
        <p>${esc(x.snippet)}…</p>
        <div class="chips">
          ${x.places.map((p) => `<span class="pchip" style="--c:${ROLE_COLOR[p.roles.includes("origin") ? "origin" : p.roles.includes("destination") ? "destination" : "mentioned"]}" title="${esc(p.terms.join(", "))}">${esc(country(p.iso2))} · ${esc(p.roles.join("/"))}</span>`).join("")}
          ${x.signals.map((sid) => `<span class="acc a-plan">${esc(signalById[sid]?.label || sid)}</span>`).join("")}
          ${rel.map((r) => `<a class="acc a-live" href="#/case/${esc(r.caseId)}">case: ${esc(r.title)}</a>`).join("")}
        </div></li>`;
    }).join("") || `<li class="muted">No articles match.</li>`;
  };
  $("#more").addEventListener("click", () => { state.limit += 20; renderArticles(); });
  if (state.typology) $("#nf-typ").value = state.typology;
  const setCountry = (k) => { state.country = k; state.limit = 20; renderArticles(); if (k) $("#articles").scrollIntoView({ behavior: "smooth", block: "start" }); };
  $("#nf-typ").addEventListener("change", (e) => { state.typology = e.target.value || null; state.limit = 20; renderArticles(); });
  main.querySelectorAll("[data-country]").forEach((b) => b.addEventListener("click", () => setCountry(b.dataset.country)));
  renderArticles();
  if (state.country || state.typology) $("#articles").closest("section").scrollIntoView();
}

// ---- views: live check -----------------------------------------------------------------

const KINDS = {
  conversation: { label: "Conversation or DM", hint: "A chat, DM, text or email thread", fields: ["profileUrl"], text: "The messages", screenshotFirst: true, questions: ["secrecy", "isolation", "urgency", "threats_coercion", "chat_only_contact", "refuses_video", "romance_money", "verification_code", "deepfake_video_call", "voice_clone_emergency"] },
  profile: { label: "Social profile", hint: "An account that contacted you or that you met on an app", fields: ["profileUrl", "photo"], text: "Bio, posts or messages from this account", questions: ["profile_new", "images_ai", "followers_fake", "profile_mismatch", "refuses_video", "chat_only_contact", "romance_money", "investment_pitch", "celebrity_endorsement", "public_complaints"] },
  travel: { label: "Invitation to travel or meet", hint: "Someone offering to bring you somewhere, or to meet in person", fields: ["destination", "profileUrl"], text: "The invitation or messages about the trip or meeting", questions: ["sponsor_travel_stranger", "meet_private", "carry_package", "vague_location", "document_retention", "secrecy", "visa_fraud"] },
  job: { label: "Job opportunity", hint: "A job ad, offer, or a recruiter who reached out", fields: ["postingUrl", "company", "website", "email", "jurisdiction", "workCountry"], text: "The job ad, offer or recruiter's message", questions: ["upfront_fee", "id_before_interview", "chat_only_contact", "employer_housing_travel", "vague_location", "document_retention", "debt_bondage", "payment_handling", "fast_promotion", "images_ai", "followers_fake", "website_mismatch", "public_complaints"] },
  housing: { label: "Housing offer", hint: "A room, flat or accommodation offered to you", fields: ["website", "email", "destination"], text: "The listing or messages from the landlord or host", questions: ["housing_unseen_deposit", "owner_unavailable", "housing_tied_to_job", "gift_card_crypto", "urgency", "images_ai", "public_complaints"] },
  money: { label: "Request for money", hint: "Someone asking you to pay, lend, invest or send codes", fields: ["profileUrl", "website"], text: "What they asked for and why", questions: ["romance_money", "new_number_impersonation", "voice_clone_emergency", "deepfake_video_call", "celebrity_endorsement", "investment_pitch", "gift_card_crypto", "verification_code", "urgency", "threats_coercion", "secrecy", "public_complaints"] },
  link: { label: "Link", hint: "A website or link someone sent you", fields: ["website", "email"], text: "The message the link came with", questions: ["link_shortener", "urgency", "verification_code", "upfront_fee", "website_mismatch", "images_ai", "public_complaints"] },
  other: { label: "Describe what's happening", hint: "Anything else that doesn't feel right", fields: ["profileUrl", "website", "email"], text: "Tell us what's happening, in your own words", questions: ["secrecy", "isolation", "threats_coercion", "meet_private", "gift_card_crypto", "urgency", "public_complaints"] },
};
// Old links keep working.
KINDS.screenshot = KINDS.conversation; KINDS.recruiter = KINDS.job;
const FIELD = {
  postingUrl: () => `<div class="posting span-all"><label>Link to the job posting <span class="muted">(optional)</span>
      <span class="inline"><input name="postingUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://…"><button type="button" class="ghost" id="read-posting">Read posting</button></span>
      <span class="fine">Postings on Greenhouse, Lever and Ashby are read directly. For other sites we check the website, and you can paste the text below.</span></label><p class="fine" id="posting-status" aria-live="polite"></p></div>`,
  company: () => `<label>Company or agency name <input name="company" autocomplete="off" placeholder="As they wrote it"></label>`,
  website: () => `<label>Website <input name="website" autocomplete="off" placeholder="example.com"></label>`,
  email: () => `<label>Their email address <input name="email" autocomplete="off" placeholder="name@…"></label>`,
  profileUrl: () => `<label>Profile link or username <input name="profileUrl" autocomplete="off" placeholder="instagram.com/… or @username"></label>`,
  jurisdiction: () => `<label>Where they say they're based <select name="jurisdiction"><option value="">Not stated</option>${["US", "GB", "BR", "CA", "AE", "TH", "KH", "MM", "LA", "MY", "PH", "RU", "IN", "NG", "KE"].map((c) => `<option value="${c}">${esc(country(c))}</option>`).join("")}</select></label>`,
  workCountry: () => `<label>Country where the job is <select name="workCountry"><option value="">Not stated</option>${flCountryOptions()}</select></label>`,
  destination: () => `<label>Country you'd be going to <select name="workCountry"><option value="">Not stated</option>${flCountryOptions()}</select></label>`,
  photo: () => `<label>Their profile photo <span class="muted">(optional)</span><input type="file" name="photo" accept="image/*"><span class="fine">Turned into a fingerprint on your device so the same face can be spotted under other names. Never uploaded.</span></label><p class="mono fine" id="photo-hash"></p>`,
};
const flCountryOptions = () => Object.entries(flsri.countries).filter(([, c]) => c.scored).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([k]) => `<option value="${k}">${esc(country(k))}</option>`).join("");
const KIND_ICON = { conversation: "❝", screenshot: "❝", profile: "◉", travel: "✈", job: "▤", recruiter: "▤", housing: "⌂", money: "¤", link: "↗", other: "✎" };
const KIND_ORDER = ["conversation", "profile", "travel", "job", "housing", "money", "link", "other"];

let ocrLib = null;
async function readScreenshot(file, onProgress) {
  if (!ocrLib) {
    await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
    ocrLib = window.Tesseract;
  }
  const { data } = await ocrLib.recognize(file, "eng", { logger: (m) => m.status === "recognizing text" && onProgress(Math.round(m.progress * 100)) });
  return data.text;
}

function viewCheck(kind = "") {
  const k = KINDS[kind];
  const kindsNav = `<nav class="kinds" aria-label="What do you want to check?">${KIND_ORDER.map((id) => [id, KINDS[id]]).map(([id, x]) => `
      <a class="kind${id === kind || KINDS[kind] === x ? " on" : ""}" href="#/check/${id}"${id === kind ? ' aria-current="true"' : ""}><span class="ki" aria-hidden="true">${KIND_ICON[id]}</span><strong>${esc(x.label)}</strong><span class="fine">${esc(x.hint)}</span></a>`).join("")}
    </nav>`;
  main.innerHTML = (k ? `
    <section class="hero small check-hero">
      <div class="eyebrow mono">VibeCheck</div>
      <h1>Something feels off? Check the vibe.</h1>
      <p class="lede">We look for the warning signs seen in real scam and trafficking cases, and tell you whether it's unverified, a reason for caution, or a serious warning sign. <strong>Nothing you enter is stored unless you choose to submit it, and if you do, it will be anonymous.</strong></p>
    </section>
    ${kindsNav}` : `
    <div class="home">
      <section class="story hero-full">
        <div>
          <div class="hero-logo">
            <img src="assets/logo-mark.svg" alt="VibeCheck" width="48" height="48">
            <div class="eyebrow mono">VibeCheck</div>
          </div>
          <h1 class="hero-text">Something feels off? <span class="check-blue">Check</span> the vibe.</h1>
          <p class="sub"><strong>Before you trust someone online, check the situation.</strong> A second opinion for conversations, profiles, invitations and offers. It looks for warning signs of scams, grooming, coercion and exploitation, then suggests what to consider and where to get confidential help. <strong>Nothing you enter is stored unless you choose to submit it, and if you do, it will be anonymous.</strong></p>
        </div>
      </section>
      <div class="figure-wrapper">
        <figure class="figure-band" aria-label="Animation: a blue line that starts loose, tightens into a knot, then continues taut. A visual metaphor for how offers seem safe at first, then trap you, then become impossible to escape.">
          <canvas id="figure" aria-hidden="true"></canvas>
          <figcaption class="figure-caption">Fig. 1 — an offer, a loop, a knot</figcaption>
        </figure>
        <div class="figure-balloon">
          <p><strong>The animation and symbology:</strong> This is how trafficking and scams work. A single blue line drawn by hand. It starts loose (the offer looks easy), loops and tightens (but then you realize you're trapped), then continues taut to the edge (the only way out).</p>
        </div>
      </div>
      <div class="kinds-head">
        <h1>VibeChecker</h1>
        <a class="ghostlink" href="#/report">Report wrong vibes</a>
      </div>
      ${kindsNav}
      <section class="seeing" id="seeing" aria-live="polite"></section>
    </div>`) + `
    ${k ? `
    <form id="check" class="panel">
      <h2>${esc(k.label)}</h2>
      <input type="hidden" name="kind" value="${esc(kind)}">
      <div class="drop">
        <label>Screenshots <span class="muted">(optional${k.screenshotFirst ? ", recommended" : ""})</span>
          <input type="file" id="shots" accept="image/*" multiple>
          <span class="fine">The text is read from the image on your device, and the image isn't uploaded. Check and correct the text below.</span></label>
        <p class="fine mono" id="ocr-status" aria-live="polite"></p>
      </div>
      <label>${esc(k.text)} <textarea name="posting" rows="6" placeholder="Paste or type it here"></textarea></label>
      <div class="grid3">${k.fields.map((f) => FIELD[f]()).join("")}</div>
      <fieldset class="checkset"><legend><strong>Has any of this happened?</strong> <span class="fine">Tick what applies.</span></legend>
        ${k.questions.map((id) => `<label class="check"><input type="checkbox" name="answers" value="${id}"> ${esc(signalById[id].label)}</label>`).join("")}
      </fieldset>
      <div class="btns"><button class="primary" type="submit">Check it</button><button class="ghost" type="button" id="example">Show an example</button></div>
      <p class="fine" id="example-title" aria-live="polite"></p>
      <p class="fine">We check organisations, websites and email domains, never a private person's criminal record (see <a href="#/methodology">Methodology</a>). If you feel unsafe, <a href="#/help">get help now</a>.</p>
    </form>
    <div id="out" aria-live="polite"></div>` : ""}${impactSections()}`;
  mountImpact();
  mountGlobe($("#globe"));
  if (!k) { figureCleanup = mountFigure($("#figure")); renderSeeing(); return; }

  const form = $("#check");
  let photoHash = null;
  $("#read-posting")?.addEventListener("click", async () => {
    const status = $("#posting-status");
    const parsed = parsePostingUrl(form.postingUrl.value);
    if (!parsed) { status.textContent = "That doesn't look like a web address."; return; }
    if (!parsed.ats) { status.textContent = `We can't read postings from ${parsed.host} directly. We'll still check the website when you run the check; paste the ad text below.`; return; }
    status.textContent = "Reading the posting…";
    try {
      const p = await fetchPosting(parsed);
      form.posting.value = [`${p.title}${p.location ? ` (${p.location})` : ""}`, p.text].filter(Boolean).join("\n\n");
      if (form.company && !form.company.value) form.company.value = p.company;
      status.textContent = `Read "${p.title}" from ${parsed.ats[0].toUpperCase() + parsed.ats.slice(1)}. A posting on a real hiring system is a good sign, but scammers can use them too, so still check the details.`;
    } catch {
      status.textContent = "Couldn't read that posting (it may have closed). Paste the text below instead.";
    }
  });
  form.photo?.addEventListener("change", async (e) => {
    photoHash = e.target.files[0] ? await hashImage(e.target.files[0]) : null;
    $("#photo-hash").textContent = photoHash ? `Photo fingerprint: ${photoHash}` : "";
  });
  $("#shots").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const status = $("#ocr-status");
    const texts = [];
    try {
      for (const [i, f] of files.entries()) {
        texts.push(await readScreenshot(f, (pct) => { status.textContent = `Reading screenshot ${i + 1} of ${files.length}… ${pct}%`; }));
      }
      form.posting.value = [form.posting.value.trim(), ...texts.map((t) => t.trim())].filter(Boolean).join("\n\n");
      status.textContent = `Read ${files.length} screenshot${files.length > 1 ? "s" : ""}. Check the text for mistakes before you continue.`;
    } catch {
      status.textContent = "Couldn't read the screenshot here. You can type the messages instead.";
    }
  });

  // Several examples per type, cycling on each click. They are invented for illustration and use
  // reserved .example domains; mixes of obvious, subtle and unverifiable situations.
  const EXAMPLES = {
    conversation: [
      { title: "Grooming and blackmail", posting: "I feel like only I really understand you. Your family won't understand us, so don't tell your parents yet. If you don't send the money I'll share your photos. Send the verification code you just got." },
      { title: "Slow trust, then a move off-platform", posting: "It's been so nice talking every day. My camera is broken so no video for now. Let's move to Telegram, it's more private. I'm travelling for work but I'd love to meet you soon." },
      { title: "Looks friendly, nothing verifiable", posting: "Hey! We met at the conference last week, I'm the one from the design booth. Want to grab coffee next Tuesday near the office?" },
    ],
    profile: [
      { title: "Romance and crypto", posting: "Hi dear, I saw your profile and felt a connection. I'm an engineer working offshore so my camera is broken for video calls. My uncle taught me a crypto trading platform with daily profits, I can show you. Let's continue on Telegram.", answers: ["profile_new", "images_ai"] },
      { title: "Model scout with bought followers", profileUrl: "instagram.com/elitefaces.scouting.example", posting: "We scout new faces for international campaigns. Paid trips to Dubai. DM us your photos and passport details to be considered.", answers: ["followers_fake", "images_ai"] },
      { title: "Ordinary-looking account", profileUrl: "instagram.com/maria.bakes", posting: "Home baker in Lisbon, sharing recipes and weekend market stalls." },
    ],
    travel: [
      { title: "Paid ticket, package, secrecy", posting: "I'll pay for your flight to Bangkok, the ticket is already booked. My driver will pick you up at the airport. Could you bring a small package for my friend? Keep it between us for now, the workplace location will be shared on arrival." },
      { title: "Study-abroad offer", posting: "Our partner college in Kazan offers a free work-and-study programme. We cover flights and housing; you'll work in hospitality while studying. Send your passport copy to reserve a place. Tourist visa is fine to start.", workCountry: "RU" },
      { title: "Meeting someone from an app", posting: "Can't wait to finally meet! Come alone to my place on Saturday, I'll send an Uber to pick you up." },
    ],
    job: [
      { title: "Overseas customer-service job", company: "Huione Guarantee", email: "hr.bangkokjobs@gmail.com", posting: "URGENT: customer service representatives for an online company. No experience needed, earn $3,000 per week! Free flight and accommodation provided. Exact workplace location will be disclosed on arrival. Send your passport scan and pay the visa processing fee within 48 hours.", workCountry: "KH" },
      { title: "Marketing firm with fast promotion", company: "Brightvane Promotions", website: "brightvane-promotions.example", email: "careers@brightvane-promotions.example", posting: "Entry-level marketing representative, no experience needed, weekly pay and fast promotion to management within 6 months. Commission-only while training.", answers: ["website_mismatch", "images_ai"] },
      { title: "Remote job with payment handling", company: "Talentlinq Remote Staffing", email: "talentlinq.hiring@outlook.com", posting: "Hello! We found your CV. Remote data entry, $200 per hour, start tomorrow. Interview on WhatsApp only. You will receive payments and forward them to our clients. A small training fee is required." },
      { title: "Plausible office job, unverified", company: "Quillmere Freight", website: "quillmere-freight.example", email: "jobs@quillmere-freight.example", posting: "Operations coordinator, full time, hybrid. Salary $58,000–$64,000. Two interview rounds with the team." },
    ],
    housing: [
      { title: "Landlord abroad, deposit first", posting: "The flat is available now. I'm currently abroad so I can't show it, but the keys will be sent to you by courier. Please pay the first month and deposit before viewing to reserve it. Western Union preferred." },
      { title: "Room that comes with a job", posting: "Free room in a shared house for workers. Accommodation provided by the employer, rent deducted from wages. You must live on site. Start this week." },
      { title: "Normal-looking listing", website: "cityrentals.example", posting: "Two-bedroom apartment, viewings Saturday 10–12. Lease signed at our office before any deposit." },
    ],
    money: [
      { title: "Customs fee in gift cards", posting: "My love, I need help paying the customs fee for my package, just $900 in Steam gift cards. Keep it between us. Also my uncle has a crypto trading platform with daily profits if you want to invest." },
      { title: "Investment with guaranteed profits", posting: "Join our USDT liquidity mining pool. Guaranteed returns of 3% daily. Deposit today, limited slots, withdraw anytime." },
      { title: "A friend asks for a loan", posting: "Hey it's Sam, new number. Could you lend me $300 until Friday? I'll explain later, bit of an emergency." },
    ],
    link: [
      { title: "Account-locked phishing", website: "secure-bank-verify.example", posting: "Your account is locked. Verify within 24 hours: bit.ly/3kQx9z and share the one-time password." },
      { title: "Job application form on a free site", website: "hiring-now.wixsite.com", posting: "Apply here for the warehouse role, fill in your ID number and bank details to get paid faster.", answers: ["website_mismatch"] },
      { title: "Delivery notice", website: "parcel-redelivery.example", posting: "We missed you. Reschedule delivery now: tinyurl.com/redeliv-2291" },
    ],
    other: [
      { title: "Online relationship and a trip", posting: "We met online last month. He says his family won't approve so I shouldn't tell mine. He wants me to come alone to his city, and his friend will pick me up." },
      { title: "Bank security call", posting: "Someone from my bank's security team called. They asked me to share the one-time password I just received so they could stop fraud on my account, and not to tell anyone at the branch." },
      { title: "Something just feels off", posting: "A recruiter keeps messaging me at 2am, won't say the company name, and says I owe them for 'processing' if I stop replying." },
    ],
  };
  const exampleSet = EXAMPLES[kind] || EXAMPLES[Object.keys(KINDS).find((k) => KINDS[k] === KINDS[kind] && EXAMPLES[k])] || [];
  let exampleIndex = -1;
  const exBtn = $("#example");
  exBtn.textContent = `Show an example (${exampleSet.length})`;
  exBtn.addEventListener("click", () => {
    if (!exampleSet.length) return;
    exampleIndex = (exampleIndex + 1) % exampleSet.length;
    const ex = exampleSet[exampleIndex];
    form.querySelectorAll("input:not([type=checkbox]):not([type=hidden]):not([type=file]), textarea").forEach((el) => { el.value = ""; });
    form.querySelectorAll("select").forEach((el) => { el.selectedIndex = 0; });
    for (const [f, v] of Object.entries(ex)) if (!["answers", "title"].includes(f) && form[f]) form[f].value = v;
    form.querySelectorAll("[name=answers]").forEach((c) => { c.checked = (ex.answers || []).includes(c.value); });
    exBtn.textContent = `Next example (${exampleIndex + 1} of ${exampleSet.length})`;
    $("#example-title").textContent = `Example ${exampleIndex + 1}: ${ex.title}. Invented for illustration.`;
    $("#out").innerHTML = "";
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const input = Object.fromEntries(fd);
    input.answers = fd.getAll("answers");
    if (!input.email && input.profileUrl && !normalizeDomainClient(input.profileUrl)) input.profileUrl = input.profileUrl.trim();
    if (![input.company, input.website, input.email, input.posting, input.profileUrl].some((v) => v && v.trim()) && !input.answers.length) {
      $("#out").innerHTML = `<p class="callout">Add some text, a screenshot, a link, or tick what happened, then check again.</p>`; return;
    }
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Checking…";
    $("#out").innerHTML = `<p class="muted pad">Checking…</p>`;
    try { const r = await assess(input, { signals, registers, cases }); renderCheck(r, { ...input, photoHash }); reportCheck(input.kind, r); }
    finally { btn.disabled = false; btn.textContent = "Check it"; }
  });
}
const normalizeDomainClient = (v) => /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(String(v).replace(/^https?:\/\//, ""));

function contextPanel(input) {
  const rows = [
    input.jurisdiction && { iso2: input.jurisdiction, role: "Employer says it is based in", phase: "R" },
    input.workCountry && { iso2: input.workCountry, role: "Job is in", phase: "E" },
  ].filter(Boolean).map((x) => ({ ...x, ...flsriCountry(x.iso2, flsri) }));
  if (!rows.length) return "";
  return `<section class="panel span2"><h2>Country context</h2>
    <p class="fine">Structural forced-labour conditions from the ETC ${flLink("Forced Labor Structural Risk Index")}. This is context for weighing the indicators above. It says nothing about this employer and does not change the score.</p>
    <ul class="context">${rows.map((r) => `<li><span class="muted">${esc(r.role)}</span> <strong>${esc(country(r.iso2))}</strong>
      ${r.available ? `${tierChip(r.tier)} <span class="mono">composite ${r.composite.toFixed(2)}, rank ${r.rank} (${r.band[0]}–${r.band[1]})</span>
        <div class="fine">${r.phase === "R" ? "Recruitment" : "Exploitation"} phase ${bar(r.phase === "R" ? r.R : r.E)}${r.lowConfidence ? " · lower confidence" : ""}${r.phase === "E" && r.tier !== "higher" ? " · FLSRI under-reads destination and sponsorship systems, so a lower score here is not reassurance." : ""}</div>` : `<div class="fine">${esc(r.reason)}</div>`}</li>`).join("")}</ul></section>`;
}

const HEADLINE = { high: "This situation has concerning signals", caution: "This situation has some concerning signals", unverified: "Unverified: we couldn't confirm this is safe", low: "This organisation checks out on what we can verify" };

function verificationList(r) {
  if (!r.verification) return "";
  return `<div class="verify"><h3>What we could verify</h3><ul>${r.verification.items.map((i) => `<li class="${i.passed ? "ok" : "no"}"><span class="mark" aria-hidden="true">${i.passed ? "✓" : "?"}</span><span><strong>${esc(i.label)}</strong>${i.passed ? "" : " <span class=\"state\">not confirmed</span>"}<br><span class="fine">${esc(i.detail)}</span></span></li>`).join("")}</ul>
    <p class="fine">We treat everything as unverified unless all of these are confirmed. Finding no warning signs is not the same as being safe.</p></div>`;
}

function considerPanel(r) {
  const groups = considerations(r.flags, signals);
  if (!groups.length) return `<section class="consider t-${esc(r.tier.id)}"><h2>${esc(HEADLINE[r.tier.id] || HEADLINE.unverified)}</h2>
    <p>${esc(r.tier.advice)}</p>
    ${verificationList(r)}
    <p class="nextstep"><strong>Recommended next step:</strong> ${esc(signals.dimensions.identity.step)} Don't share documents, send money or travel until you have.</p>
    <p class="helpline">If you feel unsafe or pressured, <a href="#/help">here's where you can get confidential help</a>.</p></section>`;
  const top = groups[0];
  return `<section class="consider t-${esc(r.tier.id)}">
    <h2>${esc(HEADLINE[r.tier.id])}</h2>
    <p class="count">${groups.length} thing${groups.length > 1 ? "s" : ""} to consider before proceeding</p>
    <ol class="considerations">${groups.map((g) => `
      <li><strong>${esc(g.label)}:</strong> ${esc(g.consider)} <span class="fine">(${g.flags.map((f) => esc(f.label.toLowerCase())).slice(0, 3).join("; ")}${g.flags.length > 3 ? "; …" : ""})</span></li>`).join("")}
    </ol>
    <p class="nextstep"><strong>Recommended next step:</strong> ${esc(top.step)}${groups.some((g) => g.id !== top.id && g.id === "money") ? ` ${esc(signals.dimensions.money.step)}` : ""}</p>
    <p class="helpline">If you feel unsafe or pressured, <a href="#/help">here's where you can get confidential help</a>.</p>
    ${verificationList(r)}
    <p class="fine">These are warning signs, not a judgement about a person. No check here can say someone is a trafficker or a scammer.</p>
  </section>`;
}

function verdictBox(r, orgChecked) {
  return `<div class="scorebox t-${esc(r.tier.id)}">
    <div class="num">${r.points}<small>/100</small></div>
    <div><div class="tierlabel">${esc(r.tier.label)}</div>${orgChecked && r.input.jurisdiction ? `<div class="cov c-${esc(r.coverage.class)}" title="${esc(r.coverage.explain)}">${esc(r.coverage.label)}</div>` : `<div class="fine">${r.tier.id === "unverified" ? "Not confirmed safe" : `${r.flags.length} warning sign${r.flags.length === 1 ? "" : "s"}`}</div>`}</div>
  </div>`;
}

function complaintSearches(r) {
  const q = r.input.name || r.input.domain;
  const ids = ["reddit", "bbb", "glassdoor", "websearch"];
  const regs = registers.registers.filter((x) => ids.includes(x.id));
  return `<section class="panel span2 complaints">
    <h2>Look for complaints</h2>
    <p class="fine">Other people's experiences are often the fastest warning. Search for “${esc(q)}” with the word scam, then read what you find: make sure it's the same company, not a similar name. If you find complaints, tick “You found complaints calling them a scam” above and check again.</p>
    <div class="btns">${regs.map((x) => `<a class="ghostlink" href="${esc(linkFor(x, { name: q, domain: r.input.domain }))}" target="_blank" rel="noopener">${esc(x.name.replace(/:.*/, ""))} ↗</a>`).join("")}</div>
  </section>`;
}

function nextSteps(r, input) {
  const serious = r.tier.id === "high";
  return `<section class="panel span2 next">
    <h2>What to do next</h2>
    <ul>
      ${serious ? `<li><strong>Stop before you pay, share documents or travel.</strong> If you feel pressured, threatened or unsafe, <a href="#/help">get help now</a>.</li>` : ""}
      <li>Verify through an official channel: the company's own website or phone number, not the details they gave you.</li>
      <li>Talk it through with someone you trust before deciding.</li>
    </ul>
    <div class="btns"><button type="button" class="ghost" id="download-report">Download this report</button></div>
    <div class="submitbox">
      <h3>Submit this check anonymously</h3>
      <p class="fine">Help warn others. We send only the type of check, the warning signs, the website and email domains, and your text with personal details removed. No name, contact details or IP address, and never the screenshots. You'll see exactly what will be sent first.</p>
      <label class="check consent"><input type="checkbox" id="sub-consent"> I agree this anonymous record can be stored and used, in aggregate, to warn others and for research.</label>
      <div class="btns"><button type="button" class="ghost" id="sub-preview">Preview what will be sent</button></div>
      <div id="sub-out"></div>
    </div>
  </section>`;
}

function downloadReport(r, input) {
  const filename = `vibe-check-${(input.name || input.domain || "result").replace(/[^a-z0-9]/gi, "-").slice(0, 30)}-${new Date().toISOString().split("T")[0]}.txt`;
  const timestamp = new Date().toISOString();
  const report = `VibeCheck Report
Generated: ${timestamp}
Result: ${r.tier.label}
Score: ${r.points}/100

${input.name ? `Name/Company: ${input.name}` : ""}
${input.domain ? `Website: ${input.domain}` : ""}
${input.email ? `Email: ${input.email}` : ""}
${input.profileUrl ? `Profile: ${input.profileUrl}` : ""}

--- CHECK DETAILS ---
${input.posting ? `Text submitted:\n${input.posting}\n` : ""}

--- FINDINGS ---
Warning Signs Found: ${r.flags.length}
${r.flags.map((f) => `· ${f.label} (${signals.categories[f.category]})`).join("\n")}

Recommendation: ${r.tier.advice}

--- NEXT STEPS ---
1. Verify through official channels
2. Talk it through with someone you trust
3. Do not pay, send documents, or travel without independent verification
${r.tier.id === "high" ? "4. If you feel unsafe or pressured, get confidential help: https://example.com/vibecheck#/help" : ""}

Report generated by VibeCheck
Source: https://carolina-moron.github.io/vibe-check
`;
  const blob = new Blob([report], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function wireSubmit(r, input) {
  const dlBtn = $("#download-report");
  if (dlBtn) dlBtn.addEventListener("click", () => downloadReport(r, input));

  const btn = $("#sub-preview"); if (!btn) return;
  btn.addEventListener("click", () => {
    if (!$("#sub-consent").checked) { $("#sub-out").innerHTML = `<p class="fine">Tick the box above to continue.</p>`; return; }
    const record = buildReport({
      kind: input.kind, company: input.company, website: input.website, recruiterEmail: input.email, profileUrl: input.profileUrl,
      destinationCountry: input.workCountry || null, signals: r.flags.map((f) => f.id), narrative: input.posting, photoHash: input.photoHash, consent: true,
    });
    record.result_tier = r.tier.id;
    $("#sub-out").innerHTML = `<pre class="json">${esc(JSON.stringify(record, null, 2))}</pre><div class="btns"><button class="primary" id="send" type="button">Send anonymously</button></div><p id="sent" class="fine" aria-live="polite"></p>`;
    $("#send").addEventListener("click", () => sendReport(record));
  });
}

function renderCheck(r, input = {}) {
  const layers = ["identity", "enforcement", "domain", "priors"];
  const grouped = Object.fromEntries(layers.map((l) => [l, r.checks.filter((c) => c.meta?.layer === l)]));
  const counts = { searched: r.checks.filter((c) => c.verdict === "hit" || c.verdict === "no-evidence-found").length, failed: r.checks.filter((c) => c.verdict === "error").length };

  const orgChecked = !!(r.input.name || r.input.domain || r.input.emailDomain);
  const kindLabel = KINDS[input.kind]?.label || "Your check";
  $("#out").innerHTML = `
    <section class="casehead">
      <div><div class="eyebrow mono">${esc(kindLabel)}</div><h2>${esc(r.input.name || r.input.domain || "Result")}</h2>
        <p class="fine">${orgChecked ? `${counts.searched} register(s) searched, ${counts.failed} unreachable. ` : ""}${esc(r.tier.advice)}</p></div>
      ${verdictBox(r, orgChecked)}
    </section>
    ${considerPanel(r)}
    ${r.catalogMatches.length ? `<div class="callout red">Matches a documented case: ${r.catalogMatches.map((m) => `<a href="#/case/${esc(m.caseId)}">${esc(m.entity)}</a> via ${esc(m.via.type)} name “${esc(m.via.name)}”`).join("; ")}</div>` : ""}
    <div class="dash">
      <section class="panel${orgChecked ? "" : " span2"}"><h2>All warning signs found</h2>${flagList(r.flags)}</section>
      ${orgChecked ? `<section class="panel"><h2>What each register returned</h2>
        ${layers.filter((l) => grouped[l].length).map((l) => `<h3>${esc(registers.layers[l])}</h3><ul class="checks">${grouped[l].map((c) => `
          <li><div class="row"><span>${esc(c.meta?.name || c.register)} <span class="acc ${ACCESS[c.meta?.access]?.cls || ""}">${esc(ACCESS[c.meta?.access]?.label || "")}</span></span><span class="verdict ${VERDICT[c.verdict].cls}">${VERDICT[c.verdict].label}</span></div>
            <div class="meta">${esc(c.detail)}</div>
            ${c.register === "courtlistener" && c.records.length ? `<ul class="records">${c.records.map((d) => `<li>${d.url ? ext(d.url, d.name) : esc(d.name)} <span class="muted">${esc(d.court)} · ${esc(d.date)}</span></li>`).join("")}</ul>` : ""}
            ${c.register === "pullpush" && c.records.length ? `<ul class="records">${c.records.map((d) => `<li>${d.url ? ext(d.url, d.name) : esc(d.name)} <span class="muted">r/${esc(d.subreddit)} · ${esc(d.date)}</span></li>`).join("")}</ul>` : ""}
            ${c.register === "gleif" && c.records.length ? `<ul class="records">${c.records.map((d) => `<li>${ext(d.url, d.name)} <span class="muted">${esc(d.status)} · ${esc(d.jurisdiction)}${d.otherNames.length ? ` · also: ${esc(d.otherNames.map((o) => o.name).join(", "))}` : ""}</span></li>`).join("")}</ul>` : ""}
            <div class="fine">${esc(c.meta?.caveat || "")}</div></li>`).join("")}</ul>`).join("")}
      </section>` : ""}
      ${contextPanel(input)}
      ${nextSteps(r, input)}
      ${orgChecked ? complaintSearches(r) : ""}
      ${orgChecked ? `<section class="panel span2"><h2>Search these by hand</h2>
        <p class="fine">These registers are public but can't be queried from a browser (they need a key, a declared client, or have no API). ${esc(r.coverage.explain)}</p>
        <ul class="reglist cols">${r.referrals.map((reg) => `<li><span class="acc ${ACCESS[reg.access].cls}">${ACCESS[reg.access].label}</span> ${ext(linkFor(reg, { name: r.input.name, domain: r.input.domain }), reg.name)}<div class="fine">${esc(reg.holds)}</div></li>`).join("")}</ul>
      </section>` : ""}
    </div>`;
  wireSubmit(r, input);
}

// ---- views: report ---------------------------------------------------------------------

const REPORT_SIGNALS = ["upfront_fee", "id_before_interview", "document_retention", "debt_bondage", "chat_only_contact", "employer_housing_travel", "vague_location", "visa_fraud", "payment_handling", "pay_too_high", "urgency"];

function viewReport() {
  main.innerHTML = `
    <section class="hero small">
      <div class="eyebrow mono">Anonymous report</div>
      <h1>Report wrong vibes</h1>
      <p class="lede">Something felt off? Tell us about anything suspicious — a person, account, message, company, job offer, investment, romance, housing or scam. Reports are anonymous: we never ask who you are, your details are removed in this browser before anything is sent, and you see exactly what will be sent first.</p>
    </section>
    <div class="callout red"><strong>If you are in danger or can't leave, call for help first.</strong> <a href="#/help">Find the hotline for your country</a>, or call local emergency services. Use a device and connection you feel safe on. The <em>Quick exit</em> button at the top leaves this site immediately.</div>
    <form id="report" class="panel">
      <h2>What type of wrong vibe?</h2>
      <div class="grid3">
        <label>Type of report <select name="type" required><option value="">Choose…</option><option value="job">Job or work opportunity</option><option value="romance">Online relationship or dating</option><option value="investment">Investment or money scheme</option><option value="housing">Housing or rental</option><option value="scam">Scam or fraud</option><option value="grooming">Online grooming</option><option value="company">Suspicious company</option><option value="other">Something else</option></select></label>
        <label>Person's name or company name <input name="company" autocomplete="off"></label>
        <label>Their website or profile <input name="website" autocomplete="off"></label>
      </div>
      <div class="grid3">
        <label>Where did you meet them or find it
          <select name="platform"><option value="">Choose…</option>${["Facebook", "Instagram", "TikTok", "Telegram", "WhatsApp", "Discord", "LinkedIn", "Dating app", "Handshake", "Indeed", "Job board (other)", "Website", "Phone call", "SMS", "Email", "Friend", "Other"].map((p) => `<option>${p}</option>`).join("")}</select></label>
        <label>Their country or location <input name="recruiterCountry" list="countries" autocomplete="off"></label>
        <label>Location they mentioned <input name="destinationCountry" list="countries" autocomplete="off"></label>
      </div>
      <datalist id="countries">${["US", "GB", "TH", "KH", "MM", "LA", "MY", "PH", "AE", "SA", "QA", "RU", "IN", "NG", "KE", "UG", "ET", "GH", "MX", "GT", "HN", "BR", "PL", "SK", "RO", "VN", "CN", "ID", "LK", "NP", "PK", "BD"].map((c) => `<option value="${esc(country(c))}">`).join("")}</datalist>
      <label class="short">Month it happened <input name="incidentMonth" type="month"></label>

      <h2>What happened</h2>
      <fieldset class="checkset"><legend class="fine">Tick everything that applies</legend>
        ${REPORT_SIGNALS.map((id) => `<label class="check"><input type="checkbox" name="signals" value="${id}"> ${esc(signalById[id].label)}</label>`).join("")}
      </fieldset>
      <label>Outcome
        <select name="outcome"><option value="">Choose…</option><option value="spotted">I spotted it and didn't engage</option><option value="paid">I lost money</option><option value="documents">I gave documents or personal data</option><option value="travelled">I travelled for the job</option><option value="held">I was held, threatened or forced to work</option><option value="other">Other</option></select>
      </label>
      <label>In your own words <textarea name="narrative" rows="6" placeholder="What did they promise, and what actually happened? Leave out your name and contact details."></textarea></label>

      <h2>Recruiter profile photo <span class="muted">(optional)</span></h2>
      <p class="fine">Fake recruiters often reuse the same headshot across different “companies”. Choose the photo and this page turns it into a short fingerprint (a perceptual hash) on your device. <strong>The image itself is never uploaded.</strong></p>
      <label class="short"><input type="file" name="photo" accept="image/*"></label>
      <p id="hash" class="mono fine"></p>

      <label class="check consent"><input type="checkbox" name="consent" required> I agree that this anonymous report can be stored and used, in aggregate, to warn others and for research. It won't be published word for word.</label>
      <div class="btns"><button class="primary" type="submit">Preview what will be sent</button></div>
    </form>
    <div id="preview" aria-live="polite"></div>`;

  let photoHash = null;
  $("#report").photo.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    photoHash = file ? await hashImage(file) : null;
    $("#hash").textContent = photoHash ? `Photo fingerprint: ${photoHash} (image not stored)` : "";
  });

  $("#report").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const form = Object.fromEntries(fd);
    form.signals = fd.getAll("signals");
    form.consent = ev.target.consent.checked;
    form.photoHash = photoHash;
    const record = buildReport(form);
    const removed = Object.entries(record.redactions).map(([k, n]) => `${n} ${k}`).join(", ");
    $("#preview").innerHTML = `
      <section class="panel">
        <h2>This is everything that will be sent</h2>
        <p class="fine">${removed ? `Removed from your text: ${esc(removed)}.` : "Nothing needed removing from your text."} No name, contact details, IP address or device information is included. Edit the form and preview again if anything here identifies you.</p>
        <pre class="json">${esc(JSON.stringify(record, null, 2))}</pre>
        <div class="btns"><button class="primary" id="send" type="button">Send anonymously</button></div>
        <p id="sent" class="fine" aria-live="polite"></p>
      </section>`;
    $("#preview").scrollIntoView({ behavior: "smooth" });
    $("#send").addEventListener("click", () => sendReport(record));
  });
}

async function sendReport(record) {
  const out = $("#sent");
  if (!REPORT_ENDPOINT) {
    out.innerHTML = `<strong>Report collection isn't switched on yet, so nothing was sent.</strong> Please report to the hotline or the <a href="https://reportfraud.ftc.gov/" target="_blank" rel="noopener">FTC</a> in the meantime.`;
    return;
  }
  try {
    const res = await fetch(REPORT_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record), credentials: "omit", referrerPolicy: "no-referrer" });
    out.textContent = res.ok ? "Thank you. Your anonymous report was received." : "The report could not be sent. Please try again later.";
    if (res.ok) $("#send").disabled = true;
  } catch {
    out.textContent = "The report could not be sent. Please try again later.";
  }
}

async function hashImage(file) {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = 9; canvas.height = 8;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, 9, 8);
  const { data } = ctx.getImageData(0, 0, 9, 8);
  const grey = [];
  for (let i = 0; i < data.length; i += 4) grey.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  return dHash(grey);
}

// ---- views: methodology ----------------------------------------------------------------

let landscapeData;
const loadLandscape = async () => (landscapeData !== undefined ? landscapeData : (landscapeData = await fetch("data/landscape.json").then((r) => (r.ok ? r.json() : null)).catch(() => null)));

function viewMethodology() {
  const byLayer = (l) => registers.registers.filter((r) => r.layer === l && r.id !== "catalog");
  const cats = Object.entries(signals.categories);
  main.innerHTML = `
    <article class="doc">
      <div class="eyebrow mono">Methodology</div>
      <h1>How VibeCheck works, and what it won't do</h1>
      <p class="lede">VibeCheck is built on the same rules as the Digital Provenance Passport: no claim without a source, no check that can return “clear”, and a score that is always shown with how much could have been found.</p>

      <nav class="toc" aria-label="On this page">
        <a href="#m-principles">Principles</a><a href="#m-check">What you can check</a><a href="#m-people">People are out of scope</a><a href="#m-score">Score and coverage</a>
        <a href="#m-signals">Risk signals</a><a href="#m-registers">Registers</a><a href="#m-cases">Case catalog</a>
        <a href="#m-flsri">Structural risk index</a><a href="#m-news">News patterns</a><a href="#m-partners">Help contacts and CTDC</a><a href="#m-landscape">Related tools</a><a href="#m-reports">Anonymous reports</a><a href="#m-social">Social and image signals</a><a href="#m-data">Training data</a><a href="#m-agent">Automation</a><a href="#m-limits">Limits</a>
      </nav>

      <h2 id="m-principles">Principles</h2>
      <ol>
        <li><strong>No check returns “clear”.</strong> The strongest negative is <em>no evidence found</em>. Most small employers are in no register a browser can reach, and most scam compounds operate where no open register exists at all.</li>
        <li><strong>Silence earns nothing.</strong> A register that returns nothing adds no points and removes none. Registers that couldn't be searched are listed, so a thin check can't pass for a thorough one.</li>
        <li><strong>The score never travels alone.</strong> Coverage is computed separately and always displayed beside it.</li>
        <li><strong>Unverified by default.</strong> Nothing is called low-risk just because no warning signs were found. A result is <em>Lower concern (verified)</em> only when all four checks pass:
          <ol>
            <li>the organisation is found, active and under its exact name, in an official register;</li>
            <li>its website has existed for more than two years;</li>
            <li>the contact (email or job posting) traces back to that organisation;</li>
            <li>there are no significant warning signs.</li>
          </ol>
          Everything else is <em>Unverified</em>, including every conversation, profile, money or link check, where no organisation can be confirmed. Searches that return no match are never read as safe.</li>
        <li><strong>A second opinion, not a detector.</strong> The check never declares that someone is a trafficker or a scammer. It reports warning signs and groups them into things to consider (identity, money, pressure, isolation and control, travel and meeting, public record), with a next step and where to get confidential help. Moving from detection to prevention and intervention is the point.</li>
        <li><strong>Categories need expert validation.</strong> The warning signs draw on ILO forced-labour indicators, FTC and FinCEN scam typologies and anti-trafficking guidance on grooming and online recruitment. They are a starting point to be reviewed with anti-trafficking and online-safety practitioners, not a validated instrument.</li>
        <li><strong>Every fact carries its source.</strong> Case records cite official, court, multilateral, press or NGO sources, labelled by tier.</li>
      </ol>

      <h2 id="m-check">What you can check</h2>
      <p>Eight kinds of situation: a conversation or DM, a social profile, an invitation to travel or meet, a job opportunity, a housing offer, a request for money, a link, or a description of what's happening. Each asks for the details that matter for that situation and a few yes/no questions about what happened. The text is read with the same warning-sign rules for every kind, so a job offer that also pushes a crypto platform is caught.</p>
      <p><strong>Results</strong> come in three levels:</p>
      <ul>
        <li><em>Lower concern</em>: few warning signs.</li>
        <li><em>Caution</em>: some warning signs.</li>
        <li><em>Serious warning signs</em>: the pattern matches real scam and trafficking cases.</li>
      </ul>
      <p>A lower-concern result is never a clearance.</p>
      <p><strong>What a person can see better than a machine.</strong> Some warning signs can't be detected reliably from a browser, so the check asks about them directly:</p>
      <ul>
        <li>photos that look AI-generated, stock or copied;</li>
        <li>followers or engagement that look bought;</li>
        <li>a website that doesn't match the business it claims;</li>
        <li>complaints found on Reddit, BBB, Glassdoor or forums.</li>
      </ul>
      <p>Instagram and similar platforms offer no data access for this, and AI-image detectors are wrong often enough to mislead. Every company check links to complaint searches. A Reddit archive (PullPush) is searched for the exact website address and shown for review. Company names aren't searched automatically, because common names return unrelated posts.</p>
      <p><strong>Exact names only.</strong> A registry result counts against a company only when the registered name matches exactly, ignoring legal suffixes like LLC or Inc. Companies with similar names are listed as other companies and never scored.</p>
      <p><strong>Job posting links.</strong> Postings on Greenhouse, Lever and Ashby are read through those systems' public job APIs, directly from your browser. A posting there is a good sign but not proof, since anyone can open an account. Other links are checked by domain (registration age, certificates, archive history), and postings on free site builders or form tools are flagged.</p>
      <p><strong>Screenshots</strong> are read on your own device with open-source text recognition (Tesseract). The image is never uploaded, and you can correct the text before checking.</p>
      <p><strong>Profile photos</strong> become a 64-bit fingerprint on your device, so the same face can be matched across reports without storing the image.</p>
      <p><strong>Submitting</strong> is optional and anonymous, and you preview the exact record first.</p>

      <h2 id="m-people">People are out of scope</h2>
      <div class="callout red">
        <p><strong>Criminal background checks on people are the one piece to drop.</strong> Checkr and peers will not run checks on a company or on a recruiter you have not hired, and compiling criminal history on named individuals risks making your tool a consumer reporting agency under FCRA. Entity-level checks and principals on public enforcement lists are fine; “recruiter has a record” is not.</p>
      </div>
      <p>So the check looks at organisations, websites and email domains only. Individuals appear only where an official source already names them in an indictment, judgment or sanctions designation, and only inside that case record. There is no person search, no offender-registry lookup and no criminal-history field. Sex-offender registry data (NSOPW) has no public API, and misusing it is an offence. Fifteen US states and New York City also restrict criminal-history questions before a conditional job offer. “Recruiter's name is not among the registered officers” is an acceptable check; “recruiter has a criminal record” is not.</p>

      <h2 id="m-score">Score and coverage</h2>
      <p>The <strong>evidence score</strong> (0–100) adds up the weights of indicators found, capped at 100. Tiers: ${signals.tiers.filter((t) => t.min != null).map((t) => `<em>${esc(t.label)}</em> from ${t.min}`).join(", ")}, and <em>Unverified</em> whenever the organisation cannot be confirmed. Colours follow the tier: red for serious warning signs, yellow for caution, green for lower concern. On a case page the score counts what the sources document (lures, official actions, name history). In a live check it counts what the registers and offer text returned.</p>
      <p><strong>Coverage</strong> asks a separate question: could any open national register have recorded this entity? It is judged on the jurisdictions where the entities are based and where people were exploited.</p>
      <ul>
        <li><em>Public records: many</em>: three or more reachable registers for those countries.</li>
        <li><em>Public records: some</em>: one or two.</li>
        <li><em>Public records: none</em>: no open national register. Only global watchlists apply.</li>
      </ul>
      <p>A low score in an uncovered jurisdiction means almost nothing. Coverage is never folded into the score, because that would make one number mean two things.</p>

      <h2 id="m-signals">Risk signals</h2>
      <p>One taxonomy (<code>data/signals.json</code>) drives the live check, the lure tags on case pages and the report form, and will drive the agentic job-cleaner. Offer-text rules follow the ILO's eleven forced-labour indicators (2025 edition), FTC and BBB job-scam flags, and FinCEN money-mule typologies.</p>
      ${cats.map(([k, label]) => `<h3>${esc(label)}</h3><div class="tblwrap"><table><thead><tr><th>Signal</th><th>Weight</th><th>Why it matters</th></tr></thead><tbody>${signals.signals.filter((s) => s.category === k).sort((a, b) => b.weight - a.weight).map((s) => `<tr><td>${esc(s.label)}</td><td class="mono">+${s.weight}</td><td>${esc(s.why)}</td></tr>`).join("")}</tbody></table></div>`).join("")}

      <h2 id="m-registers">Registers</h2>
      <p>Each register is labelled by how the tool reaches it: <span class="acc a-live">queried live</span> from your browser, <span class="acc a-ref">referral</span> (public, but it needs a key, a declared client or a human search, so you get a link), or <span class="acc a-plan">planned</span> (bulk data for the backend).</p>
      ${Object.entries(registers.layers).map(([l, label]) => `<h3>${esc(label)}</h3><div class="tblwrap"><table><thead><tr><th>Register</th><th>Access</th><th>Holds</th><th>Caveat</th></tr></thead><tbody>${byLayer(l).map((r) => `<tr><td>${ext(r.url.includes("{") ? r.url.replace(/[?#].*$/, "") : r.url, r.name)}</td><td><span class="acc ${ACCESS[r.access].cls}">${ACCESS[r.access].label}</span></td><td>${esc(r.holds)}</td><td>${esc(r.caveat)}</td></tr>`).join("")}</tbody></table></div>`).join("")}
      <p><strong>Identity.</strong> The key free sources:</p>
      <ul>
        <li>GLEIF LEI API: name history and parents, no key needed.</li>
        <li>UK Companies House: previous names, officers and disqualified directors.</li>
        <li>SEC EDGAR: former names of SEC registrants.</li>
        <li>Open state data from New York; Colorado, which has a trade-name (DBA) dataset; Florida Sunbiz, whose Fictitious Name file comes by SFTP; and the Texas Comptroller, for forfeited status and the officer file.</li>
        <li>Brazil's Receita CNPJ register, which is fully open and includes the nome fantasia (trade name).</li>
      </ul>
      <p>OpenCorporates no longer has a free API; the CoLab could apply under its academic route.</p>
      <p><strong>Watchlists and enforcement.</strong> The main source is OpenSanctions bulk data: free for non-commercial use, covering OFAC, UN, EU, UK, World Bank, SAM exclusions, Interpol, FBI, SEC and CFTC, with self-hosted yente for unlimited matching. After that come DOL's OFLC recruiter list and debarments, WHD wage-theft data, the DOJ press-release API and CourtListener (no approval needed since May 2026). Court dockets are shown for review but never scored, because being named in a case is not a finding.</p>
      <p><strong>Domain and email.</strong> RDAP registration age, crt.sh, Wayback CDX, Tranco, Cloudflare Radar, Spamhaus DQS, free-mail and disposable-domain lists, and MX/DMARC checks. This layer gives the most signal per dollar and catches most impersonation cases.</p>
      <p><strong>Trafficking priors.</strong> The CTDC synthetic dataset (206,000 cases, redistributable), National Human Trafficking Hotline venue tables, the ILO's 11 indicators (2025 edition) and TIP Report tiers. Priors weight a signal's significance; they are never evidence about a particular company.</p>

      <h2 id="m-flsri">Structural risk: the ETC Forced Labor Structural Risk Index</h2>
      <p>Country context comes from the <a href="https://ethical-tech-colab.github.io/website/" target="_blank" rel="noopener">Ethical Tech CoLab</a>'s ${flLink("Forced Labor Structural Risk Index")} (FLSRI), imported unchanged from its published build (${esc(flSrc.build_date)}, ${flSrc.n_scored} of ${flSrc.n_universe} countries scored).</p>
      <p><strong>What FLSRI scores.</strong> Each country gets a 0–1 score for the structural conditions under which forced labour becomes more likely. It is organised as phase, then domain, then indicator: Recruitment (${Object.values(flsri.domains).filter((d) => d.phase === "Recruitment").map((d) => esc(d.label)).join(", ")}) and Exploitation (${Object.values(flsri.domains).filter((d) => d.phase === "Exploitation").map((d) => esc(d.label)).join(", ")}). The composite is the geometric mean of the two phases.</p>
      <p><strong>How it's read.</strong> Scores are read in tiers, with cut points at ${flSrc.tier_cuts.join(" and ")}, each with a ${esc(flSrc.rank_band)}. Countries with too little data are left unscored, not guessed.</p>
      <p>How the tool uses it:</p>
      <ul>
        <li><strong>On case pages</strong>, recruitment and transit countries are read on the Recruitment phase and exploitation countries on the Exploitation phase. Rank bands, lower-confidence flags and the highest-risk sub-national corridors are shown.</li>
        <li><strong>On the world map</strong>, countries can be shaded by FLSRI tier beneath the case journeys.</li>
        <li><strong>In a live check</strong>, the country the employer claims and the country where the job is are shown as context.</li>
        <li><strong>Never in a score.</strong> FLSRI measures conditions, not prevalence, and says nothing about any company. Adding it to the evidence score would treat where someone was recruited as evidence against an employer.</li>
      </ul>
      <p class="callout"><strong>Read destination scores with care.</strong> FLSRI reads origin-side structural risk well and under-reads destination and sponsorship systems: kafala-style tied status, recruitment debt and brokerage aren't yet sourced at country scale. Several wealthy migrant-destination states, including in the Gulf, score low despite well-documented risk. Almost every case here runs from a higher-scoring origin to a lower-scoring destination, which is exactly that gap. A low destination score means the index doesn't capture that pathway yet, not that the destination is safe.</p>

      <h2 id="m-news">News patterns</h2>
      <p>The News patterns page is rebuilt by <code>npm run news</code>, which runs a fixed set of queries through Tavily's news search over a rolling window. The API key stays on the maintainer's machine; the site only reads the generated <code>data/news.json</code>.</p>
      <p><strong>Filtering.</strong> Results are de-duplicated by URL and headline and kept only if they mention trafficking, forced labour, scam compounds, fake jobs, recruitment or related terms.</p>
      <p><strong>What the extraction reads.</strong> Rules, not a model, applied to the headline and snippet:</p>
      <ul>
        <li><strong>Countries</strong> from country names, nationality words and named compound hubs (Myawaddy, KK Park, Shwe Kokko, Sihanoukville, the Golden Triangle SEZ, Mae Sot, Alabuga, Bamban). The longest name wins, so “South Sudan” is not also counted as “Sudan”.</li>
        <li><strong>Direction.</strong> A nationality word counts as an origin only in a sentence about victims (trafficked, lured, rescued, recruited, workers, nationals…). Phrases like “trafficked to”, “lured into” and “compounds in” mark destinations. Capitals and big cities are plain mentions, because they are usually datelines or government sources.</li>
        <li><strong>Corridors</strong> pair every origin with every destination in the same article.</li>
        <li><strong>Typology and event type</strong> come from keyword rules. Lure indicators use the same offer-text rules as the live check.</li>
      </ul>
      <p><strong>Known errors.</strong> A long article that names many countries can produce false corridors; an early run paired South Africa and Kenya with Poland from an article about Russia. Snippets are short, so lures undercount. Coverage favours English-language and wire outlets. Each corridor shows the words it came from so a reader can check it, and single-article corridors are drawn dashed.</p>
      <p><strong>Use.</strong> News patterns are for spotting emerging routes, lures and recruitment channels to research. They are never case counts, never evidence about an entity, and never part of a score. A pattern that holds up is researched from primary sources and, if documented, added to the case catalog.</p>

      <h2 id="m-partners">Help contacts, partners and CTDC</h2>
      <p><strong>Hotlines and organisations.</strong> The hotlines and organisations on Get help were each checked on an official or the organisation's own website, and each links to its source. Numbers that could only be found in news or secondary sources were left out. An organisation's listing is not an endorsement, and none is affiliated with this tool. Organisations are marked as taking requests for help only where their own site says so.</p>
      <p><strong>CTDC corridor summaries.</strong> The victim corridors on the Cases map and case pages are summaries of the CTDC Global Synthetic Dataset, a differentially private synthetic version of case records from IOM, Polaris and other contributors covering over 206,000 identified victims.</p>
      <ul>
        <li><strong>Import.</strong> The dataset is downloaded by hand and summarised by <code>npm run import:ctdc</code>; the raw file is never committed or published.</li>
        <li><strong>Corridors.</strong> A corridor is citizenship → country of exploitation. Corridors with fewer than 10 records are withheld.</li>
        <li><strong>Percentages.</strong> They follow the CTDC codebook: each is a share of the records that gave any information for that group, so a group can add up to more than 100%.</li>
        <li><strong>What the counts mean.</strong> They reflect where contributing organisations identify and assist victims. They are not prevalence estimates, and a missing corridor is not evidence of no trafficking.</li>
      </ul>
      <p><strong>CTDC.</strong> The Counter-Trafficking Data Collaborative (CTDC), run by IOM, publishes victim-level trafficking data and a country map. Its terms allow non-commercial use and derived material with credit, but prohibit automated access and re-hosting its raw datasets without IOM's written consent. So this site links to the CTDC map rather than embedding or copying it. Source: Counter-Trafficking Data Collaborative (CTDC), September 2026.</p>

      <h2 id="m-landscape">Related tools</h2>
      <p>Consumer tools already let people submit a message, link or screenshot and ask whether it's a scam, and anti-trafficking organisations publish education on grooming and online recruitment. We didn't find a consumer tool that checks a whole situation (identity, pressure, isolation, money and travel together) for exploitation risk. VibeCheck aims to answer "is this situation safe?" rather than only "is this a scam?", and to lead to prevention and confidential help.</p>
      <div id="landscape"><p class="fine">Loading…</p></div>

      <h2 id="m-cases">Case catalog</h2>
      <p>Cases are researched by hand from sources opened at the time of writing. Each file in <code>data/cases/</code> is validated before publishing: known typologies and statuses, ISO country codes, coordinates, https sources, and lure tags that exist in the signal taxonomy.</p>
      <p>Facts that could only be seen in search snippets were left out. Journey pins are approximate, and an “advertised” pin for an online ad marks where the ads targeted, not a physical place. Case outcomes are reported as the sources give them, including dismissed charges.</p>
      <p>The catalog is a small set of documented examples, not a register. Not appearing in it means nothing.</p>

      <h2 id="m-reports">Anonymous reports</h2>
      <p>The report form is designed so a report can't be traced back to the person who made it:</p>
      <ul>
        <li><strong>No identity fields.</strong> The form never asks for a name, email, phone number or account.</li>
        <li><strong>Redaction on the device.</strong> Before anything is sent, the free text is scrubbed in the browser of email addresses, phone numbers, passport-style and card numbers, social-media handles, dates of birth and “my name is…” phrases.</li>
        <li><strong>Only the domain of the recruiter's email.</strong> The recruiter's address is cut down to its domain.</li>
        <li><strong>Coarse locations and dates.</strong> Countries only, never cities, and months only, never days.</li>
        <li><strong>The photo stays on the device.</strong> A recruiter photo becomes a 64-bit perceptual hash; the image is not uploaded.</li>
        <li><strong>Preview first.</strong> The reporter sees the exact record before sending it.</li>
      </ul>
      <p><strong>How reports will be used.</strong> Reports go into a ledger keyed on normalised company name, website and email domain.</p>
      <ul>
        <li>A single report is a soft flag and is never shown publicly against a name.</li>
        <li>An organisation is flagged as <em>reported</em> only after three or more independent reports, or one report plus a register or domain anomaly.</li>
        <li>Counts are published in aggregate only.</li>
      </ul>
      <p>This is the “first report versus repeatedly reported” distinction, and it is the only reputation source the project fully controls. The collection endpoint must not log IP addresses. Until one is connected, the form builds and previews the record but sends nothing.</p>

      <h2 id="m-social">Social and image signals</h2>
      <p>Instagram gives you almost nothing programmatically; AI-image detectors run 10 to 20 percent error. Better signal: the same headshot reused across “companies.” The tool therefore does not guess whether a photo is AI-generated. It fingerprints recruiter photos submitted in reports and looks for the same fingerprint appearing under different company names.</p>

      <h2 id="m-data">Training data</h2>
      <p>The only public labeled corpus of job postings (EMSCAD) is from 2014; you will need to build your own from FTC/BBB narratives, r/Scams, and Adzuna negatives. EMSCAD predates task scams and contains almost no URLs or emails, so it can't train the domain layer. The anonymised report ledger is designed to become that labeled set, with Adzuna and ATS-listed postings as negatives.</p>

      <h2 id="m-agent">Automation: the agent</h2>
      <p>An agent (<code>scripts/agent.mjs</code>, skills in <code>docs/agent-openapi.yaml</code>) runs the same check as this site on job postings, stores anonymised results, and drafts reports for the platform, the company whose name is being used, and the FTC or FBI IC3. It follows two rules. It never scrapes platforms that forbid it: LinkedIn and Handshake postings reach it only when a person shares them or through a partnership feed, while ATS boards with public APIs (Greenhouse, Lever, Ashby) are read directly. And it never sends anything itself: every report waits in a review queue, a person approves it, and each draft says the warning signs come from an automated check, not a finding. Outcomes are logged so warning signs that reviewers keep dismissing can be tuned down. Built to run as Copilot Studio skills on Azure Functions, with review cards in Teams. Details in <a href="https://github.com/carolina-moron/vibe-check/blob/main/docs/agent.md" target="_blank" rel="noopener">docs/agent.md</a>.</p>

      <h2 id="m-limits">Limits</h2>
      <ul>
        <li>Rules match patterns in text, not intent. Legitimate overseas jobs do provide flights and housing, and every indicator needs context.</li>
        <li>Browser checks reach only registers with open, CORS-enabled APIs. Companies House, OpenSanctions, SEC name search and DOL data need the planned backend.</li>
        <li>Name matching is exact or near-exact on normalised names, so it misses transliterations and catches unrelated companies with similar names. A match is a lead to verify, not an identification.</li>
        <li><strong>Cases and news are different.</strong> The case catalog holds ${cases.length} cases researched by hand, each with a sourced journey, named entities and official actions. The news layer and the News patterns page hold far more reports, gathered automatically and read by rules. Those rules can misread countries and roles, one event can appear in several articles, and a report is not a verified case. News reports are shown as a separate, faint layer and never feed a score. Turning reports into researched cases is done by hand, a batch at a time.</li>
        <li>Handshake's employer vetting is internal, and its EDU API is issued to institutions (for example NYU career services). Glassdoor and Indeed have no review API and prohibit scraping, so they are link-outs at most.</li>
      </ul>
    </article>`;
  loadLandscape().then((d) => {
    const el = $("#landscape"); if (!el) return;
    if (!d) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="tblwrap"><table><thead><tr><th>Tool</th><th>What it does</th><th>Focus</th><th>Not covered, per its own materials</th></tr></thead><tbody>${d.tools.map((t) => `<tr><td>${ext(t.url, t.name)}<div class="fine">${esc(t.maker || "")}</div></td><td>${esc(t.what)}</td><td>${esc(t.focus)}</td><td>${esc(t.gap || "—")}</td></tr>`).join("")}</tbody></table></div>
      <p class="fine">Descriptions use each tool's own website or app-store listing, checked ${esc(d.verified)}. Listed for context, not as endorsement or criticism. Tools change; check their sites for current features.</p>`;
  });
  // In-page links would otherwise change the hash and re-route.
  main.querySelectorAll(".toc a").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById(a.getAttribute("href").slice(1))?.scrollIntoView({ behavior: "smooth" });
  }));
}

const STORIES_BASE = "https://ethical-tech-colab.github.io/Avatar-Impact-Stories/";

const ETC_LINK = `<a href="https://ethical-tech-colab.github.io/website/" target="_blank" rel="noopener">Ethical Tech CoLab</a>`;

// "You are NOT alone": first-person case stories first, then the Avatar Impact Stories videos.
async function viewNotAlone(scrollTo) {
  const here = location.hash;
  main.innerHTML = `
    <section class="hero small">
      <div class="eyebrow mono">Stories and voices</div>
      <h1>You are NOT alone</h1>
      <p class="lede">What happened to you, or what's happening now, has happened to many other people. Read how real cases unfolded, and watch survivors share their stories.</p>
    </section>
    <section class="notalone" id="stories">
      <h2>Stories</h2>
      <p class="fine">Real cases from the news, retold in the first person so you can see the warning signs from the inside. The narrators are composites, not real victims. The facts, and how each case came to light, come from the public sources listed in each story.</p>
      <div class="voices-grid" id="story-list"><p class="fine">Loading stories…</p></div>
    </section>
    <section class="notalone" id="voices">
      <h2>Voices</h2>
      <p class="fine">Click a video to watch it. These are survivor accounts from <a href="${STORIES_BASE}" target="_blank" rel="noopener">Avatar Impact Stories</a> by the ${ETC_LINK}. The presenters are AI avatars, so the people who told these stories stay protected.</p>
      <div class="voices-grid" id="stories-grid"><p class="fine">Loading videos…</p></div>
    </section>
    <div id="voice-modal" class="modal" hidden>
      <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <button class="modal-close" type="button" aria-label="Close">&times;</button>
        <div class="modal-header"><h3 id="modal-title"></h3><p class="voice-role">AI presenter. The story comes from a real account.</p></div>
        <div class="modal-body"><video id="story-video" controls playsinline preload="none"></video></div>
      </div>
    </div>
    <article class="panel why-matter">
      <h2>Why these stories matter</h2>
      <p>Trafficking and exploitation take many forms: child labour, forced labour, sex trafficking, forced conscription, domestic abuse, scams. The warning signs repeat across all of them: isolation, secrecy, debt, urgency and someone else controlling your documents or money.</p>
      <p><strong>Your story matters too.</strong> If you've run into a scam or exploitation, <a href="#/report">report it</a>. Anonymous reports help us spot patterns and warn others. If you need help now, <a href="#/help">here's where to get it</a>.</p>
    </article>`;
  if (scrollTo) document.getElementById(scrollTo)?.scrollIntoView();

  fetch("stories/index.json").then((r) => r.json()).then(({ stories }) => {
    if (location.hash !== here) return;
    $("#story-list").innerHTML = stories.map((s) => `
      <a class="panel story-link" href="#/stories/${encodeURIComponent(s.file)}">
        <div class="eyebrow mono">${esc(s.type)}</div>
        <h3>${esc(s.title)}</h3>
        <p class="voice-action">Read story →</p>
      </a>`).join("");
  }).catch(() => { if (location.hash === here) $("#story-list").innerHTML = `<p>Stories could not load. Check your connection and try again.</p>`; });

  const grid = $("#stories-grid");
  let videos;
  try {
    videos = (await fetch(STORIES_BASE + "stories.json").then((r) => r.json())).stories;
    if (location.hash !== here) return;
  } catch {
    if (location.hash !== here) return;
    grid.innerHTML = `<p>Videos could not load. <a href="${STORIES_BASE}" target="_blank" rel="noopener">Watch them on Avatar Impact Stories ↗</a></p>`;
    return;
  }
  grid.innerHTML = videos.map((s, i) => `
    <button class="voice-card clickable" type="button" data-i="${i}">
      <div class="voice-image"><canvas class="voice-photo" data-src="${esc(STORIES_BASE + (s.posterWebp || s.poster))}" aria-hidden="true"></canvas></div>
      <div class="voice-info">
        <h3>${esc(s.title)}</h3>
        <p class="voice-action">▶ Watch story</p>
      </div>
    </button>`).join("");

  // Posters are animated. Draw just the first frame as a still photo; the video moves only once opened.
  const still = (canvas) => {
    const img = new Image();
    img.onload = () => {
      // Show the whole frame, centred: the photo box takes the poster's own shape, so nothing is cut off.
      const box = canvas.parentElement;
      box.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      box.style.height = "auto";
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = box.clientWidth || 300;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round((w * img.naturalHeight / img.naturalWidth) * dpr);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = canvas.dataset.src;
  };
  const io = "IntersectionObserver" in window && new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); still(e.target); } }), { rootMargin: "300px" });
  grid.querySelectorAll("canvas[data-src]").forEach((c) => (io ? io.observe(c) : still(c)));

  const modal = $("#voice-modal"), video = $("#story-video");
  let opener = null;
  const close = () => { video.pause(); video.removeAttribute("src"); video.load(); modal.hidden = true; opener?.focus(); };
  grid.querySelectorAll(".voice-card").forEach((card) => card.addEventListener("click", () => {
    const s = videos[card.dataset.i];
    $("#modal-title").textContent = s.title;
    video.poster = STORIES_BASE + (s.posterWebp || s.poster);
    video.src = STORIES_BASE + s.video;
    opener = card;
    modal.hidden = false;
    $("#voice-modal .modal-close").focus();
    video.play().catch(() => {});
  }));
  $(".modal-close").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  if (scrollTo) document.getElementById(scrollTo)?.scrollIntoView();
}

// Minimal markdown for stories/: headings, paragraphs, lists, bold, italic, links.
function mdToHtml(md) {
  const inline = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return md.trim().split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    if (/^#{1,3} /.test(block)) { const n = block.match(/^#+/)[0].length; return `<h${n + 1}>${inline(block.replace(/^#+ /, ""))}</h${n + 1}>`; }
    if (lines.every((l) => l.startsWith("- "))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join("")}</ul>`;
    return `<p>${inline(block.replace(/\n/g, " "))}</p>`;
  }).join("");
}

async function viewStory(file) {
  const here = location.hash;
  const back = `<p class="crumb"><a href="#/stories">← You are NOT alone</a></p>`;
  let md = null;
  try {
    const { stories } = await fetch("stories/index.json").then((r) => r.json());
    const story = stories.find((s) => s.file === file);
    if (story) md = await fetch(`stories/${story.file}`).then((r) => (r.ok ? r.text() : null));
  } catch { md = null; }
  if (location.hash !== here) return;
  main.innerHTML = md === null ? `${back}<p>This story could not load.</p>` : `${back}<article class="panel story-body">${mdToHtml(md)}</article>`;
}

// "The scale, right now": annual figures from data/scale.json become per-day/hour/minute rates and a live ticker.
function mountScale() {
  fetch("data/scale.json").then((r) => r.json()).then((d) => {
    const grid = document.getElementById("scale-grid"), groups = document.getElementById("scale-groups");
    if (!grid || !d.rates?.length) return;
    document.getElementById("scale").hidden = false;
    const fmt = (n, unit) => (unit === "dollars" ? "$" : "") + (n >= 1e9 ? (n / 1e9).toFixed(2) + " billion" : n >= 1e6 ? (n / 1e6).toFixed(1) + " million" : n >= 100 ? Math.round(n).toLocaleString("en-US") : n >= 10 ? n.toFixed(1) : n.toFixed(2));
    const opened = Date.now();
    grid.innerHTML = d.rates.map((r, i) => {
      const perDay = r.per_year / 365;
      return `<div class="scale-item">
        <div class="scale-big"><b id="tick-${i}">0</b><span>${r.unit === "dollars" ? "stolen" : esc(r.unit)} since you opened this page</span></div>
        <div class="scale-rates"><span><b>${fmt(perDay, r.unit)}</b> a day</span><span><b>${fmt(perDay / 24, r.unit)}</b> an hour</span><span><b>${fmt(perDay / 1440, r.unit)}</b> a minute</span></div>
        <p class="scale-what">${esc(r.label)}</p>
        <p class="fine">${esc(r.note)} Source: <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.source)}</a>.</p>
      </div>`;
    }).join("");
    groups.innerHTML = d.groups.map((g) => `<div class="scale-group"><h3>${esc(g.title)}</h3><ul>${g.items.map((it) => `<li><b>${esc(it.figure)}</b> ${esc(it.text)} <a class="fine" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.source)}</a></li>`).join("")}</ul></div>`).join("");
    const tick = () => {
      const secs = (Date.now() - opened) / 1000;
      d.rates.forEach((r, i) => { const el = document.getElementById(`tick-${i}`); if (el) el.textContent = (r.unit === "dollars" ? "$" : "") + Math.floor(secs * r.per_year / 31536000).toLocaleString("en-US"); });
      if (document.getElementById("tick-0")) requestAnimationFrame(() => setTimeout(tick, 250));
    };
    tick();
  }).catch(() => {});
}

// Partners strip, "The scale, right now" and "Impact so far": shown under the checker.
// "Why it matters": the scale of the problem, what VibeCheck has done, partners and the globe, as one block.
const logosSection = () => `
    <div class="logos" aria-label="Partners and hosts">
      <a class="logo-item" href="https://apneaap.org" target="_blank" rel="noopener"><img src="assets/partners/apne-aap.png" alt="Apne Aap Women Worldwide"><span>Nonprofit partner</span></a>
      <a class="logo-item" href="https://ethical-tech-colab.github.io/website/" target="_blank" rel="noopener"><img src="assets/partners/etc.jpg" alt="Ethical Tech CoLab"><span>Data partner</span></a>
      <a class="logo-item" href="https://innovationstudio.microsoft.com/hackathons" target="_blank" rel="noopener"><img src="assets/partners/microsoft.png" alt="Microsoft"><span>Global Hackathon · Hack for Good</span></a>
      <a class="logo-item" href="https://www.microsoft.com/en-us/garage/" target="_blank" rel="noopener"><img src="assets/partners/the-garage.png" alt="The Garage"><span>New York City</span></a>
    </div>`;
function impactSections() {
  return `
    <section class="why" id="why">
      <div class="why-head"><div class="eyebrow mono">Why it matters</div><h2>The scale, right now</h2>
        <p class="fine">Reported figures turned into rates. Counters tick from the moment you opened this page. Every number links to its source, and reported figures are a floor: most scams and most trafficking are never reported.</p></div>
      <div class="scale" id="scale" hidden>
        <div class="scale-grid" id="scale-grid"></div>
        <div class="scale-groups" id="scale-groups"></div>
      </div>
      <div class="impact" id="impact">
        <h3>What VibeCheck has done</h3>
        <div class="stats impact-stats">
          <div><b id="imp-checks">–</b><span>checks run</span></div>
          <div><b id="imp-signs">–</b><span>warning signs found</span></div>
          <div><b id="imp-acted">–</b><span>reports acted on</span></div>
          <div><b id="imp-checked">–</b><span>postings checked by the agent</span></div>
          <div><b id="imp-approved">–</b><span>reports approved by a reviewer</span></div>
          <div><b>${cases.length}</b><span>researched cases mapped</span></div>
          <div><b>${signals.signals.length}</b><span>warning-sign rules</span></div>
        </div>
        <p class="fine">Counters come from anonymous check events (kind, score tier and a count, never the text) and the agent's review log. They start low on purpose: we report outcomes, not promises.</p>
      </div>
      ${logosSection()}
      ${globeSection()}
    </section>`;
}
function mountImpact() {
  mountScale();
  loadConfig().then(({ agentUrl }) => fetch(agentUrl ? `${agentUrl.replace(/\/$/, "")}/public-stats` : "data/agent/stats.json")).then((r) => r.json()).then((st) => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = (v ?? 0).toLocaleString("en-US"); };
    set("imp-checks", st.checks_run); set("imp-signs", st.warning_signs_found); set("imp-acted", st.reports_acted_on);
    set("imp-checked", st.postings_checked); set("imp-approved", st.approved);
  }).catch(() => {});
}

function viewTeam() {
  main.innerHTML = `
    <section class="hero small">
      <div class="eyebrow mono">About</div>
      <h1>Who made VibeCheck, and why</h1>
      <p class="lede">VibeCheck was built at The Garage in New York City for the Hack for Good track of the Microsoft Global Hackathon, with the nonprofit <a href="https://apneaap.org" target="_blank" rel="noopener">Apne Aap Women Worldwide</a> and the <a href="https://ethical-tech-colab.github.io/website/" target="_blank" rel="noopener">Ethical Tech CoLab</a>. It helps people recognise warning signs of scams and exploitation before they act.</p>
      <p class="stats home-cta"><a class="help-btn" href="#/">Run a check →</a> <a class="ghostlink" href="#/methodology">Methodology</a> <a class="ghostlink" href="#/partnerships">Integrate VibeCheck</a></p>
    </section>
    <div class="poster-row">
      <figure class="poster preview"><a href="assets/poster.html" target="_blank" rel="noopener"><img src="assets/poster.png" alt="VibeCheck one-page overview for the Hack for Good track of the Microsoft Global Hackathon"></a></figure>
      <div><h2>The one-pager</h2><p>Problem, solution, what it does and why it stands out in Hack for Good, on one page.</p><p class="btns"><a class="ghostlink" href="assets/poster.html" target="_blank" rel="noopener">Open full size ↗</a> <a class="ghostlink" href="assets/poster.png" download>Download PNG</a></p></div>
    </div>
    <article class="panel">
      <h2>Mission</h2>
      <p>We believe people should be able to get a second opinion before trusting someone online or engaging with an offer. By combining public records, enforcement data, and indicators from real cases, we help identify patterns that matter.</p>
      <p>VibeCheck started as a hackathon project and has grown into a tool that serves job seekers, investors, dating app users, and anyone suspicious of an online interaction.</p>
    </article>
    <article class="panel team">
      <h2>The team</h2>
      <div class="people">
        <div class="person"><img src="assets/team/carolina-moron.jpg" alt="Carolina Pernambuco Moron"><h3>Carolina Pernambuco Moron</h3><p class="voice-role">Founder and CTO</p><p>Master of Science in Global Security, Conflict and Cybercrime at New York University.</p></div>
        <div class="person"><img src="assets/team/obianuju-okafor.jpg" alt="Dr. Obianuju Okafor"><h3>Dr. Obianuju Okafor</h3><p class="voice-role">CMO</p><p>R&amp;D Software Engineer at Microsoft, leading frontend development. Formerly a Lecturer at the University of Texas at Austin, and at IBM and Salesforce. Ph.D. in computer science; works where software engineering, human–computer interaction and AI meet. Mentors and speaks to widen participation in tech.</p></div>
        <div class="person"><img src="assets/team/elena-kennedy.jpg" alt="Elena Kennedy"><h3>Elena Kennedy</h3><p class="voice-role">COO</p><p>Sr. Partner Development Manager at Microsoft, focused on models and hardware partnerships.</p></div>
      </div>
      <figure class="teamphoto"><img src="assets/team/hackathon-nyc.jpg" alt="The team at the Microsoft Global Hackathon in New York City"><figcaption class="fine">Microsoft Global Hackathon, The Garage, New York City.</figcaption></figure>
    </article>
    <article class="panel partner-panel">
      <h2>Partners</h2>
      <div class="partner-cols">
        <div><h3>Nonprofit partner</h3><p><strong><a href="https://apneaap.org" target="_blank" rel="noopener">Apne Aap Women Worldwide</a></strong> founded by Ruchira Gupta, works to end sex trafficking by organising women and girls in India's most vulnerable communities. Apne Aap brings the frontline: who is being recruited, how, and what a warning looks like from inside a community. VibeCheck brings the tool that turns those warnings into checks anyone can run.</p></div>
        <div><h3>Data and research</h3><p><strong><a href="https://ethical-tech-colab.github.io/website/" target="_blank" rel="noopener">Ethical Tech CoLab</a></strong> publishes the Forced Labor Structural Risk Index that gives every check its country context, and the Avatar Impact Stories on the You are NOT alone page.</p></div>
        <div><h3>In conversation</h3><p>Hiring platforms (<strong>Handshake</strong>, <strong>LinkedIn</strong>, <strong>Indeed</strong>) as the place warnings reach people before they apply, and international bodies (<strong>IOM</strong>, <strong>UN</strong> agencies) whose data and country offices the site already links to. See <a href="#/partnerships">how to integrate VibeCheck</a>.</p></div>
      </div>
    </article>
    <article class="panel msstack">
      <h2>Built with Microsoft tools</h2>
      <div class="ms-cols">
        <div><h3>In use today</h3><ul>
          <li><strong>GitHub</strong> holds the source, the case data and the issues; <strong>GitHub Pages</strong> serves the site with no build step.</li>
          <li><strong>VS Code</strong> with <strong>GitHub Copilot</strong> is where it is built and tested.</li>
        </ul></div>
        <div><h3>The agent, ready for your tenant</h3><ul>
          <li><strong>Copilot Studio</strong> runs the agent; its skills are described in <code>docs/agent-openapi.yaml</code>.</li>
          <li><strong>Azure Functions</strong> host the skills (<code>scripts/agent-server.mjs</code>).</li>
          <li><strong>Microsoft Teams</strong> is the review channel: an Adaptive Card per posting with Approve and Dismiss.</li>
          <li><strong>Azure Cosmos DB</strong> (or Table Storage) keeps the anonymised records and the anonymous reports.</li>
          <li><strong>Microsoft Graph</strong> sends approved reports from a shared mailbox; <strong>Entra ID</strong> signs reviewers in so every approval has a name.</li>
        </ul></div>
        <div><h3>Next</h3><ul>
          <li><strong>Azure AI Translator</strong> for Spanish and other languages.</li>
          <li><strong>Azure OpenAI</strong> to read a screenshot or a long chat and pull out what the rules need; the rules still set the score, so results stay explainable.</li>
          <li><strong>Power Automate</strong> connectors to file platform and FTC reports after approval.</li>
          <li><strong>GitHub Actions</strong> for the nightly agent run and the weekly news refresh.</li>
        </ul></div>
      </div>
    </article>
    <article class="panel">
      <h2>Get involved</h2>
      <p>Found a scam or trafficking case? <a href="#/report">Report wrong vibes</a>. Run a platform, a career office or an NGO? See <a href="#/partnerships">how to integrate VibeCheck</a> and the agent that checks postings and drafts reports for your review. Want to help improve VibeCheck? Contribute on <a href="https://github.com/carolina-moron/vibe-check" target="_blank" rel="noopener">GitHub</a>.</p>
    </article>

    <article class="panel">
      <h2><a href="#/partnerships">Partnerships & Integration</a></h2>
      <p>Platforms, institutions, and services can integrate VibeCheck to alert users to exploitation risks. Learn about integration opportunities, resource links, and what exploitation phases mean in our <a href="#/partnerships">partnerships section</a>.</p>
    </article>`;
}

function viewPartnerships() {
  main.innerHTML = `
    <section class="hero small">
      <div class="eyebrow mono">Partnerships</div>
      <h1>Integrate VibeCheck</h1>
      <p class="lede">Platforms, institutions, and services that want to alert users to exploitation risks can integrate VibeCheck. We provide data on documented bad actors and warning signs, and help you surface safety context where people are making decisions.</p>
    </section>

    <article class="panel">
      <h2>For hiring platforms (Handshake, LinkedIn, Indeed)</h2>
      <p>Alert users when they're about to apply to a documented trafficking or scam operation, or show a yellow flag when warning signs appear in the job text. Integration points:</p>
      <ul>
        <li><strong>Company name lookup</strong> — Check if a recruiter matches entities in our case catalog</li>
        <li><strong>Job posting analysis</strong> — Scan for red flags (urgency, visa promises, upfront fees, vague location)</li>
        <li><strong>Email domain checks</strong> — Flag free email or newly-registered domains used by company recruiters</li>
        <li><strong>User warning</strong> — Show VibeCheck score (high concern, caution, or unverified) before application</li>
      </ul>
      <p class="fine">The skills are documented in <a href="https://github.com/carolina-moron/vibe-check/blob/main/docs/agent-openapi.yaml" target="_blank" rel="noopener">docs/agent-openapi.yaml</a>. Interested? <a href="https://github.com/carolina-moron/vibe-check" target="_blank" rel="noopener">Open an issue on GitHub</a>.</p>
    </article>

    <article class="panel agentflow">
      <h2>How the automation works: the VibeCheck agent</h2>
      <p>An agent runs the same check as this site on job postings, keeps anonymised results, and drafts reports. It works with platforms, not around them, and a person approves every report before it goes anywhere.</p>
      <ol class="flow">
        <li><b>1 · Intake</b>Postings arrive from job boards with public APIs (Greenhouse, Lever, Ashby), from people who share a posting, or from a partner feed such as Handshake's institutional API. No scraping of LinkedIn or Handshake.</li>
        <li><b>2 · Check</b>Warning-sign rules from ILO, FTC and FBI guidance, official registers, domain age, email checks, country context. A score out of 100 with every point explained.</li>
        <li><b>3 · Store</b>An anonymised record: personal details removed, never the person who shared it.</li>
        <li><b>4 · Review</b>Postings with warning signs wait in a queue. Reviewers see the evidence in Teams and press Approve or Dismiss.</li>
        <li><b>5 · Report</b>Drafts for the platform's abuse form, for the company whose name is being used, and for the FTC or FBI IC3. Each says the signs come from an automated check, not a finding.</li>
        <li><b>6 · Learn</b>What the platform or company did is logged, so warning signs reviewers keep dismissing are tuned down.</li>
      </ol>
      <h3>Built as Copilot Studio skills, hosted on Azure Functions, reviewed in Teams</h3>
      <div class="skills">${[["vibe_check", "Check a posting: score, warning signs, drafted reports, review card"], ["list_review_queue", "What's waiting for a reviewer"], ["get_queued_item", "The evidence for one item"], ["queue_for_review_decision", "Approve or dismiss"], ["send_report", "Release drafts for an approved item only"], ["record_outcome", "What the platform or company did"], ["agent_stats", "Reviewer agreement and noisy warning signs"], ["find_impersonated_company", "Planned: match a claimed employer to the real company's abuse contact"], ["share_posting", "Planned: browser extension and Teams message extension for LinkedIn and Handshake"]].map(([n, d]) => `<div><code>${n}</code><span>${d}</span></div>`).join("")}</div>
      <p class="fine">Design and rules in <a href="https://github.com/carolina-moron/vibe-check/blob/main/docs/agent.md" target="_blank" rel="noopener">docs/agent.md</a>; the same steps run from the command line with <code>scripts/agent.mjs</code>.</p>
    </article>

    <article class="panel">
      <h2>For dating and social platforms</h2>
      <p>Help users spot romance scams and grooming before they engage:</p>
      <ul>
        <li><strong>Profile image fingerprinting</strong> — Check if a photo is reused across multiple accounts (fake profile detector)</li>
        <li><strong>Text analysis</strong> — Flag common romance scam phrases and grooming tactics</li>
        <li><strong>Safety tips</strong> — Show context about where the user's potential connection says they are (country-specific trafficking patterns)</li>
      </ul>
      <p class="fine">Interested in integration? <a href="https://github.com/carolina-moron/vibe-check" target="_blank" rel="noopener">Contribute on GitHub</a> or open an issue.</p>
    </article>

    <article class="panel">
      <h2>For universities and EDU institutions</h2>
      <p>Handshake and career services can embed VibeCheck to help students evaluate internship and job offers:</p>
      <ul>
        <li>Real-time warnings about bad actors recruiting on campus</li>
        <li>Country context about forced labour risks if travel is involved</li>
        <li>Advice on what to verify independently before accepting</li>
      </ul>
      <p class="fine">Contact us through <a href="https://github.com/carolina-moron/vibe-check" target="_blank" rel="noopener">GitHub</a>.</p>
    </article>

    <article class="panel">
      <h2>Resources for understanding context</h2>
      <p>To better understand trafficking patterns and country risk:</p>
      <ul>
        <li><strong><a href="https://ethical-tech-colab.github.io/forced-labor-structural-risk-index/" target="_blank" rel="noopener">Forced Labor Structural Risk Index (FLSRI)</a></strong> — Country-level data on recruitment and exploitation phase risks. Scores never identify a company, only structural conditions.</li>
        <li><strong><a href="https://www.state.gov/reports/2025-trafficking-in-persons-report/" target="_blank" rel="noopener">US TIP Report</a></strong> — Annual country tiers on trafficking prevalence and government action</li>
        <li><strong><a href="https://www.ctdatacollaborative.org/page/global-dataset" target="_blank" rel="noopener">CTDC Global Synthetic Dataset</a></strong> — 206k case records showing recruitment methods, control tactics, and exploitation phases across sectors</li>
        <li><strong><a href="https://www.ilo.org/" target="_blank" rel="noopener">ILO Indicators of Forced Labour</a></strong> — 11 signs that appear in job offers and agreements before exploitation begins</li>
        <li><strong><a href="https://www.dol.gov/agencies/eta/foreign-labor" target="_blank" rel="noopener">DOL Foreign Labor Program Debarments</a></strong> — H-2A, H-2B, and PERM recruiters barred from sponsoring foreign workers</li>
      </ul>
    </article>

    <article class="panel">
      <h2>What exploitation phase means</h2>
      <p>Trafficking and scams follow a pattern. Understanding where someone is in that pattern helps you decide what to do:</p>
      <div class="phase-list">
        <div class="phase-item">
          <h3>Advertised</h3>
          <p>The offer or message appears: a job posting, a dating profile, an investment pitch. Red flags are visible in the text or the way it's presented.</p>
        </div>
        <div class="phase-item">
          <h3>Recruited</h3>
          <p>Contact deepens. The person asks for documents, money, personal details, or asks you to move to a private app. Pressure increases ("limited slots", "decide by Friday").</p>
        </div>
        <div class="phase-item">
          <h3>Transit</h3>
          <p>Travel, movement, or handover. You're on a plane, in a car, or logging in remotely. Control tightens: location kept secret, phone confiscated, documents retained.</p>
        </div>
        <div class="phase-item">
          <h3>Exploited</h3>
          <p>The real situation emerges. Wages withheld, debts invented, isolation enforced. For romance scams: requests for money escalate, isolation from friends intensifies.</p>
        </div>
        <div class="phase-item">
          <h3>Escaped / Rescued</h3>
          <p>The person leaves, is helped to leave, or is found. Recovery and repatriation begin.</p>
        </div>
        <div class="phase-item">
          <h3>Prosecuted</h3>
          <p>Case reaches law enforcement. Charges, plea, conviction, or settlement.</p>
        </div>
      </div>
      <p class="fine"><strong>Why it matters:</strong> Early phases (advertised, recruited) show warning signs you can see and act on. The earlier you stop, the safer you are. VibeCheck focuses on what you can spot at the advertised and recruited stages.</p>
    </article>`;
}

// ---- router ----------------------------------------------------------------------------

function route() {
  main.querySelectorAll("video, audio").forEach((m) => m.pause());
  globeCleanup(); globeCleanup = () => {};
  resetMaps();
  figureCleanup(); figureCleanup = () => {};
  const [, view = "", arg] = (location.hash.match(/^#\/([^/]*)\/?(.*)$/) || []);
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === (view === "case" ? "cases" : view === "voices" ? "stories" : view === "concern" || view === "" ? "check" : ["team", "partnerships", "methodology"].includes(view) ? "about" : view)));
  $("#helpstrip").hidden = view === "help";
  if (view === "case") viewCase(decodeURIComponent(arg));
  else if (view === "check" || view === "") viewCheck(decodeURIComponent(arg || ""));
  else if (view === "about" || view === "team") viewTeam();
  else if (view === "cases") viewCases();
  else if (view === "news") viewNews(decodeURIComponent(arg || ""));
  else if (view === "concern") viewConcern(decodeURIComponent(arg || ""));
  else if (view === "help") viewHelp();
  else if (view === "report") viewReport();
  else if (view === "voices") viewNotAlone("voices");
  else if (view === "stories") arg ? viewStory(decodeURIComponent(arg)) : viewNotAlone();
  else if (view === "team") viewTeam();
  else if (view === "partnerships") viewPartnerships();
  else if (view === "methodology") viewMethodology();
  else viewCases();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

$("#quick-exit").addEventListener("click", () => {
  document.body.innerHTML = "";
  location.replace("https://www.bbc.com/weather");
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const modal = $("#voice-modal");
  if (modal && !modal.hidden) return $("#voice-modal .modal-close").click();
  if (location.hash.startsWith("#/report")) $("#quick-exit").click();
});

window.addEventListener("hashchange", route);
route();
