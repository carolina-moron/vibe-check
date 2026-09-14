import {
  assess, caseEvidence, caseJurisdictions, coverage, linkFor, allNames, buildReport, dHash, flsriCountry, flsriRoute,
} from "./engine.js";
import { REPORT_ENDPOINT } from "./config.js";

const [signals, registers, { cases }, flsri] = await Promise.all(
  ["data/signals.json", "data/registers.json", "data/cases/index.json", "data/flsri.json"].map((p) => fetch(p).then((r) => r.json())),
);

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
  "scam-compound": { label: "Scam compound", color: "#B4392C" },
  "labor-trafficking": { label: "Labour trafficking", color: "#B27A1B" },
  "forced-labor-industrial": { label: "Industrial forced labour", color: "#7A4FA0" },
  "laundering": { label: "Laundering network", color: "#2F6DB5" },
  "money-mule": { label: "Money mules", color: "#2F6DB5" },
  "job-scam": { label: "Job scam", color: "#0E6B60" },
  "sex-trafficking": { label: "Sex trafficking", color: "#A33A6B" },
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

const scoreBadge = (s, cov) => `
  <div class="scorebox t-${esc(s.tier.id)}">
    <div class="num">${s.points}<small>/100</small></div>
    <div><div class="tierlabel">${esc(s.tier.label)}</div><div class="cov c-${esc(cov.class)}" title="${esc(cov.explain)}">${esc(cov.label)}</div></div>
  </div>`;

const flagList = (flags) => flags.length ? `<ul class="flags">${flags.map((f) => `
  <li class="${f.weight >= 20 ? "w-hi" : f.weight >= 10 ? "w-md" : "w-lo"}">
    <div class="row"><strong>${esc(f.label)}</strong><span class="pts mono">+${f.weight}</span></div>
    <div class="meta">${esc(signals.categories[f.category])}${f.evidence ? ` · <q>${esc(f.evidence)}</q>` : ""}</div>
    <div class="why">${esc(f.why)}</div>
  </li>`).join("")}</ul>` : `<p class="muted">No indicators recorded.</p>`;

// ---- FLSRI structural risk -------------------------------------------------------------

const FL_TIER = {
  higher: { label: "Higher", color: "#A8472A" },
  middle: { label: "Middle", color: "#D99A6C" },
  lower: { label: "Lower", color: "#F0DCC8" },
};
const flSrc = flsri.source;
const flLink = (label = "FLSRI") => ext(flSrc.site, label);
const bar = (v, color = "var(--risk)") => v == null ? `<span class="muted">—</span>` : `<span class="meter"><i style="width:${Math.round(v * 100)}%;background:${color}"></i></span><span class="mono">${v.toFixed(2)}</span>`;
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

function flsriLayer(geo) {
  return L.geoJSON(geo, {
    style: (f) => {
      const c = flsri.countries[flsri.numericToIso2[f.id]];
      return { stroke: true, weight: 0.5, color: "#fff", fillOpacity: c?.scored ? 0.75 : 0.25, fillColor: c?.scored ? FL_TIER[c.tier].color : "#bbb" };
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

// A gentle great-circle-ish arc so overlapping legs stay readable.
function arc(a, b, n = 24) {
  const pts = [];
  const [lat1, lon1] = a, [lat2, lon2] = b;
  const dx = lon2 - lon1, dy = lat2 - lat1, bend = 0.18;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([lat1 + dy * t + -dx * bend * t * (1 - t), lon1 + dx * t + dy * bend * t * (1 - t)]);
  }
  return pts;
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
      <h1>Where fake job offers lead</h1>
      <p class="lede">Each case follows a recruitment journey from the job ad to the place people were exploited, and the entities behind it through their former names, aliases and enforcement record. Every fact links to the source it came from.</p>
      <div class="stats">
        <div><b>${cases.length}</b><span>cases</span></div>
        <div><b>${actions}</b><span>official actions</span></div>
        <div><b>${names}</b><span>former names &amp; aliases</span></div>
        <div><b>${origins.size}</b><span>victim origin countries</span></div>
      </div>
    </section>
    <section class="mapcard">
      <div class="maphead">
        <div><h2>Global map of recruitment journeys</h2>
          <label class="check toggle"><input type="checkbox" id="fl-toggle"> Shade countries by structural forced-labour risk (${flLink()})</label></div>
        <div class="legend" id="legend">${Object.entries(counts).map(([t, n]) => `
          <button type="button" class="lg on" data-typ="${esc(t)}" aria-pressed="true"><i style="background:${TYPOLOGY[t].color}"></i>${esc(TYPOLOGY[t].label)} <span class="mono">${n}</span></button>`).join("")}
        </div>
      </div>
      <div id="worldmap" class="map world" role="img" aria-label="World map of case journeys"></div>
      <div id="fl-legend" class="fllegend pad" hidden>
        <span class="fine">FLSRI tier:</span>${Object.values(FL_TIER).map((t) => `<span><i style="background:${t.color}"></i>${t.label}</span>`).join("")}<span><i style="background:#bbb;opacity:.5"></i>Not scored</span>
        <span class="fine">Structural conditions, not prevalence. Build ${esc(flSrc.build_date)}. Under-reads destination and sponsorship systems such as the Gulf.</span>
      </div>
      <p class="fine pad">Pins are approximate, city or country level. Lines join the stages of each journey in order; dashed segments lead to where the case was prosecuted or sanctioned. Click a pin for the stage, or a card below for the full case.</p>
    </section>
    <section>
      <div class="gridhead"><h2>Cases</h2><input id="filter" type="search" placeholder="Filter by name, alias, country…" aria-label="Filter cases"></div>
      <div class="cards" id="cards"></div>
    </section>`;

  const map = baseMap($("#worldmap"), { center: [22, 40], zoom: 2, minZoom: 2 });
  const groups = {};
  if (map) {
    cases.forEach((c) => {
      const g = drawJourney(map, c, { numbered: false, weight: 2.5, link: true });
      (groups[c.typology] ||= []).push(g);
    });
  }
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
        <div class="cardfoot"><span class="status">${esc(STATUS[c.status])}</span><span class="mini t-${esc(s.tier.id)}">${s.points}</span><span class="cov c-${esc(cov.class)}">${esc(cov.label)}</span></div>
      </a>`;
    }).join("") || `<p class="muted">No cases match.</p>`;
  };
  render();
  $("#filter").addEventListener("input", (e) => render(e.target.value));
}

// ---- views: one case -------------------------------------------------------------------

function viewCase(id) {
  const c = cases.find((x) => x.id === id);
  if (!c) { main.innerHTML = `<section><h1>Case not found</h1><p><a href="#/">Back to cases</a></p></section>`; return; }
  const s = caseEvidence(c, signals);
  const cov = coverage(caseJurisdictions(c), registers);
  const typ = TYPOLOGY[c.typology] || {};

  main.innerHTML = `
    <p class="crumb"><a href="#/">← All cases</a></p>
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
        <h2>Evidence score</h2>
        <p class="fine">Counts what is documented: lure indicators, official actions and name history. <strong>${esc(cov.label)}:</strong> ${esc(cov.explain)}</p>
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

      <section class="panel span2">
        <h2>Sources</h2>
        <ul class="sources">${c.sources.map((src) => `<li><span class="acc">${esc(src.tier)}</span> ${ext(src.url, src.title)} <span class="muted">· ${esc(src.publisher)}${src.date ? `, ${esc(src.date)}` : ""}</span></li>`).join("")}</ul>
      </section>
    </div>`;

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

// ---- views: live check -----------------------------------------------------------------

function viewCheck() {
  main.innerHTML = `
    <section class="hero small">
      <div class="eyebrow mono">Live check</div>
      <h1>Check a job offer</h1>
      <p class="lede">Runs the organisation, its website and the recruiter's email domain through open registers, then reads the offer text for forced-labour and scam indicators. Results show what each register returned, including the ones that couldn't be searched.</p>
    </section>
    <form id="check" class="panel">
      <div class="grid3">
        <label>Company name <input name="company" autocomplete="off" placeholder="As written in the offer"></label>
        <label>Website <input name="website" autocomplete="off" placeholder="company.com"></label>
        <label>Recruiter email <input name="email" autocomplete="off" placeholder="recruiter@…"></label>
      </div>
      <label>Where the employer says it is based
        <select name="jurisdiction"><option value="">Not stated</option>${["US", "GB", "BR", "CA", "AE", "TH", "KH", "MM", "LA", "MY", "PH", "RU", "IN", "NG", "KE"].map((c) => `<option value="${c}">${esc(country(c))}</option>`).join("")}</select>
      </label>
      <label>Country where the job is <span class="muted">(optional)</span>
        <select name="workCountry"><option value="">Not stated</option>${Object.entries(flsri.countries).filter(([, c]) => c.scored).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([k]) => `<option value="${k}">${esc(country(k))}</option>`).join("")}</select>
      </label>
      <label>Offer text <textarea name="posting" rows="6" placeholder="Paste the job ad, email or chat messages"></textarea></label>
      <div class="btns"><button class="primary" type="submit">Run checks</button><button class="ghost" type="button" id="example">Load an example</button></div>
      <p class="fine">Only organisations are checked. This tool does not search criminal records or registries about individuals (see <a href="#/methodology">Methodology</a>).</p>
    </form>
    <div id="out" aria-live="polite"></div>`;

  $("#example").addEventListener("click", () => {
    const f = $("#check");
    f.company.value = "Huione Guarantee";
    f.website.value = "";
    f.email.value = "hr.bangkokjobs@gmail.com";
    f.jurisdiction.value = "TH";
    f.workCountry.value = "KH";
    f.posting.value = "URGENT: customer service representatives for an online company in Thailand. No experience needed, earn $3,000 per week! Free flight and accommodation provided. Exact workplace location will be disclosed on arrival. Interviews on Telegram only. Send your passport scan and pay the visa processing fee within 48 hours.";
  });

  $("#check").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = Object.fromEntries(new FormData(ev.target));
    if (![input.company, input.website, input.email, input.posting].some((v) => v.trim())) return;
    const btn = ev.target.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Checking registers…";
    $("#out").innerHTML = `<p class="muted pad">Querying registers…</p>`;
    try { renderCheck(await assess(input, { signals, registers, cases }), input); }
    finally { btn.disabled = false; btn.textContent = "Run checks"; }
  });
}

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

function renderCheck(r, input = {}) {
  const layers = ["identity", "enforcement", "domain", "priors"];
  const grouped = Object.fromEntries(layers.map((l) => [l, r.checks.filter((c) => c.meta?.layer === l)]));
  const counts = { searched: r.checks.filter((c) => c.verdict === "hit" || c.verdict === "no-evidence-found").length, failed: r.checks.filter((c) => c.verdict === "error").length };

  $("#out").innerHTML = `
    <section class="casehead">
      <div><h2>${esc(r.input.name || r.input.domain || "Offer")}</h2>
        <p class="fine">${counts.searched} register(s) searched, ${counts.failed} unreachable, ${r.referrals.length} more need a manual search (below). Nothing on this page is a clearance.</p></div>
      ${scoreBadge(r, r.coverage)}
    </section>
    ${r.catalogMatches.length ? `<div class="callout red">Matches a documented case: ${r.catalogMatches.map((m) => `<a href="#/case/${esc(m.caseId)}">${esc(m.entity)}</a> via ${esc(m.via.type)} name “${esc(m.via.name)}”`).join("; ")}</div>` : ""}
    <div class="dash">
      <section class="panel"><h2>Indicators found</h2>${flagList(r.flags)}</section>
      <section class="panel"><h2>What each register returned</h2>
        ${layers.filter((l) => grouped[l].length).map((l) => `<h3>${esc(registers.layers[l])}</h3><ul class="checks">${grouped[l].map((c) => `
          <li><div class="row"><span>${esc(c.meta?.name || c.register)} <span class="acc ${ACCESS[c.meta?.access]?.cls || ""}">${esc(ACCESS[c.meta?.access]?.label || "")}</span></span><span class="verdict ${VERDICT[c.verdict].cls}">${VERDICT[c.verdict].label}</span></div>
            <div class="meta">${esc(c.detail)}</div>
            ${c.register === "courtlistener" && c.records.length ? `<ul class="records">${c.records.map((d) => `<li>${d.url ? ext(d.url, d.name) : esc(d.name)} <span class="muted">${esc(d.court)} · ${esc(d.date)}</span></li>`).join("")}</ul>` : ""}
            ${c.register === "gleif" && c.records.length ? `<ul class="records">${c.records.map((d) => `<li>${ext(d.url, d.name)} <span class="muted">${esc(d.status)} · ${esc(d.jurisdiction)}${d.otherNames.length ? ` · also: ${esc(d.otherNames.map((o) => o.name).join(", "))}` : ""}</span></li>`).join("")}</ul>` : ""}
            <div class="fine">${esc(c.meta?.caveat || "")}</div></li>`).join("")}</ul>`).join("")}
      </section>
      ${contextPanel(input)}
      <section class="panel span2"><h2>Search these by hand</h2>
        <p class="fine">These registers are public but can't be queried from a browser (they need a key, a declared client, or have no API). ${esc(r.coverage.explain)}</p>
        <ul class="reglist cols">${r.referrals.map((reg) => `<li><span class="acc ${ACCESS[reg.access].cls}">${ACCESS[reg.access].label}</span> ${ext(linkFor(reg, { name: r.input.name, domain: r.input.domain }), reg.name)}<div class="fine">${esc(reg.holds)}</div></li>`).join("")}</ul>
      </section>
    </div>`;
}

// ---- views: report ---------------------------------------------------------------------

const REPORT_SIGNALS = ["upfront_fee", "id_before_interview", "document_retention", "debt_bondage", "chat_only_contact", "employer_housing_travel", "vague_location", "visa_fraud", "payment_handling", "pay_too_high", "urgency"];

function viewReport() {
  main.innerHTML = `
    <section class="hero small">
      <div class="eyebrow mono">Anonymous report</div>
      <h1>Report a job offer or abuse</h1>
      <p class="lede">Tell us about a recruiter, agency or employer. Reports are anonymous: we never ask who you are, your details are removed from your story in this browser before anything is sent, and you see exactly what will be sent first.</p>
    </section>
    <div class="callout red"><strong>If you are in danger or can't leave, call for help first.</strong> US 1-888-373-7888 (text 233733) · UK 08000 121 700 · or local police. Use a device and connection you feel safe on. The <em>Quick exit</em> button at the top leaves this site immediately.</div>
    <form id="report" class="panel">
      <h2>About the offer</h2>
      <div class="grid3">
        <label>Company or agency name, as they presented it <input name="company" autocomplete="off"></label>
        <label>Their website <input name="website" autocomplete="off"></label>
        <label>Their email address <input name="recruiterEmail" autocomplete="off"><span class="fine">Only the domain is kept (e.g. gmail.com).</span></label>
      </div>
      <div class="grid3">
        <label>Where you saw it
          <select name="platform"><option value="">Choose…</option>${["Facebook", "Instagram", "TikTok", "Telegram", "WhatsApp", "LinkedIn", "Handshake", "Indeed", "Job board (other)", "Recruitment agency", "Friend or relative", "Other"].map((p) => `<option>${p}</option>`).join("")}</select></label>
        <label>Country you were recruited in <input name="recruitedCountry" list="countries" autocomplete="off"></label>
        <label>Country you were sent to or offered work in <input name="destinationCountry" list="countries" autocomplete="off"></label>
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

      <label class="check consent"><input type="checkbox" name="consent" required> I agree that this anonymous report can be stored and used, in aggregate, to warn job seekers and for research. It won't be published word for word.</label>
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

function viewMethodology() {
  const byLayer = (l) => registers.registers.filter((r) => r.layer === l && r.id !== "catalog");
  const cats = Object.entries(signals.categories);
  main.innerHTML = `
    <article class="doc">
      <div class="eyebrow mono">Methodology</div>
      <h1>How the tracer works, and what it won't do</h1>
      <p class="lede">The tracer is built on the same rules as the Digital Provenance Passport: no claim without a source, no check that can return “clear”, and a score that is always shown with how much could have been found.</p>

      <nav class="toc" aria-label="On this page">
        <a href="#m-principles">Principles</a><a href="#m-people">People are out of scope</a><a href="#m-score">Score and coverage</a>
        <a href="#m-signals">Risk signals</a><a href="#m-registers">Registers</a><a href="#m-cases">Case catalog</a>
        <a href="#m-flsri">Structural risk index</a><a href="#m-reports">Anonymous reports</a><a href="#m-social">Social and image signals</a><a href="#m-data">Training data</a><a href="#m-limits">Limits</a>
      </nav>

      <h2 id="m-principles">Principles</h2>
      <ol>
        <li><strong>No check returns “clear”.</strong> The strongest negative is <em>no evidence found</em>. Most small employers are in no register a browser can reach, and most scam compounds operate where no open register exists at all.</li>
        <li><strong>Silence earns nothing.</strong> A register that returns nothing adds no points and removes none. Registers that couldn't be searched are listed, so a thin check can't pass for a thorough one.</li>
        <li><strong>The score never travels alone.</strong> Coverage is computed separately and always displayed beside it.</li>
        <li><strong>Every fact carries its source.</strong> Case records cite official, court, multilateral, press or NGO sources, labelled by tier.</li>
      </ol>

      <h2 id="m-people">People are out of scope</h2>
      <div class="callout red">
        <p><strong>Criminal background checks on people are the one piece to drop.</strong> Checkr and peers will not run checks on a company or on a recruiter you have not hired, and compiling criminal history on named individuals risks making your tool a consumer reporting agency under FCRA. Entity-level checks and principals on public enforcement lists are fine; “recruiter has a record” is not.</p>
      </div>
      <p>So the tracer checks organisations, websites and email domains only. Individuals appear only where an official source already names them in an indictment, judgment or sanctions designation, and only inside that case record. There is no person search, no offender-registry lookup and no criminal-history field. Sex-offender registry data (NSOPW) has no public API, and misusing it is an offence. Fifteen US states and New York City also restrict criminal-history questions before a conditional job offer. “Recruiter's name is not among the registered officers” is an acceptable check; “recruiter has a criminal record” is not.</p>

      <h2 id="m-score">Score and coverage</h2>
      <p>The <strong>evidence score</strong> (0–100) adds up the weights of indicators found, capped at 100. Tiers: ${signals.tiers.map((t) => `<em>${esc(t.label)}</em> from ${t.min}`).join(", ")}. On a case page the score counts what the sources document (lures, official actions, name history). In a live check it counts what the registers and offer text returned.</p>
      <p><strong>Coverage</strong> asks a separate question: could any open national register have recorded this entity? It is judged on the jurisdictions where the entities are based and where people were exploited.</p>
      <ul>
        <li><em>Well covered</em>: three or more reachable jurisdiction-specific registers.</li>
        <li><em>Partly covered</em>: one or two.</li>
        <li><em>Structurally uncovered</em>: none. Only global watchlists apply.</li>
      </ul>
      <p>A low score in an uncovered jurisdiction means almost nothing. Coverage is never folded into the score, because that would make one number mean two things.</p>

      <h2 id="m-signals">Risk signals</h2>
      <p>One taxonomy (<code>data/signals.json</code>) drives the live check, the lure tags on case pages and the report form, and will drive the agentic job-cleaner. Offer-text rules follow the ILO's eleven forced-labour indicators (2025 edition), FTC and BBB job-scam flags, and FinCEN money-mule typologies.</p>
      ${cats.map(([k, label]) => `<h3>${esc(label)}</h3><div class="tblwrap"><table><thead><tr><th>Signal</th><th>Weight</th><th>Why it matters</th></tr></thead><tbody>${signals.signals.filter((s) => s.category === k).sort((a, b) => b.weight - a.weight).map((s) => `<tr><td>${esc(s.label)}</td><td class="mono">+${s.weight}</td><td>${esc(s.why)}</td></tr>`).join("")}</tbody></table></div>`).join("")}

      <h2 id="m-registers">Registers</h2>
      <p>Each register is labelled by how the tracer reaches it: <span class="acc a-live">queried live</span> from your browser, <span class="acc a-ref">referral</span> (public, but it needs a key, a declared client or a human search, so you get a link), or <span class="acc a-plan">planned</span> (bulk data for the backend).</p>
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
      <p>Country context comes from the Ethical Tech CoLab's ${flLink("Forced Labor Structural Risk Index")} (FLSRI), imported unchanged from its published build (${esc(flSrc.build_date)}, ${flSrc.n_scored} of ${flSrc.n_universe} countries scored).</p>
      <p><strong>What FLSRI scores.</strong> Each country gets a 0–1 score for the structural conditions under which forced labour becomes more likely. It is organised as phase, then domain, then indicator: Recruitment (${Object.values(flsri.domains).filter((d) => d.phase === "Recruitment").map((d) => esc(d.label)).join(", ")}) and Exploitation (${Object.values(flsri.domains).filter((d) => d.phase === "Exploitation").map((d) => esc(d.label)).join(", ")}). The composite is the geometric mean of the two phases.</p>
      <p><strong>How it's read.</strong> Scores are read in tiers, with cut points at ${flSrc.tier_cuts.join(" and ")}, each with a ${esc(flSrc.rank_band)}. Countries with too little data are left unscored, not guessed.</p>
      <p>How the tracer uses it:</p>
      <ul>
        <li><strong>On case pages</strong>, recruitment and transit countries are read on the Recruitment phase and exploitation countries on the Exploitation phase. Rank bands, lower-confidence flags and the highest-risk sub-national corridors are shown.</li>
        <li><strong>On the world map</strong>, countries can be shaded by FLSRI tier beneath the case journeys.</li>
        <li><strong>In a live check</strong>, the country the employer claims and the country where the job is are shown as context.</li>
        <li><strong>Never in a score.</strong> FLSRI measures conditions, not prevalence, and says nothing about any company. Adding it to the evidence score would treat where someone was recruited as evidence against an employer.</li>
      </ul>
      <p class="callout"><strong>Read destination scores with care.</strong> FLSRI reads origin-side structural risk well and under-reads destination and sponsorship systems: kafala-style tied status, recruitment debt and brokerage aren't yet sourced at country scale. Several wealthy migrant-destination states, including in the Gulf, score low despite well-documented risk. Almost every case here runs from a higher-scoring origin to a lower-scoring destination, which is exactly that gap. A low destination score means the index doesn't capture that pathway yet, not that the destination is safe.</p>

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
      <p>Instagram gives you almost nothing programmatically; AI-image detectors run 10 to 20 percent error. Better signal: the same headshot reused across “companies.” The tracer therefore does not guess whether a photo is AI-generated. It fingerprints recruiter photos submitted in reports and looks for the same fingerprint appearing under different company names.</p>

      <h2 id="m-data">Training data</h2>
      <p>The only public labeled corpus of job postings (EMSCAD) is from 2014; you will need to build your own from FTC/BBB narratives, r/Scams, and Adzuna negatives. EMSCAD predates task scams and contains almost no URLs or emails, so it can't train the domain layer. The anonymised report ledger is designed to become that labeled set, with Adzuna and ATS-listed postings as negatives.</p>

      <h2 id="m-limits">Limits</h2>
      <ul>
        <li>Rules match patterns in text, not intent. Legitimate overseas jobs do provide flights and housing, and every indicator needs context.</li>
        <li>Browser checks reach only registers with open, CORS-enabled APIs. Companies House, OpenSanctions, SEC name search and DOL data need the planned backend.</li>
        <li>Name matching is exact or near-exact on normalised names, so it misses transliterations and catches unrelated companies with similar names. A match is a lead to verify, not an identification.</li>
        <li>Handshake's employer vetting is internal, and its EDU API is issued to institutions (for example NYU career services). Glassdoor and Indeed have no review API and prohibit scraping, so they are link-outs at most.</li>
      </ul>
    </article>`;
  // In-page links would otherwise change the hash and re-route.
  main.querySelectorAll(".toc a").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById(a.getAttribute("href").slice(1))?.scrollIntoView({ behavior: "smooth" });
  }));
}

// ---- router ----------------------------------------------------------------------------

function route() {
  resetMaps();
  const [, view = "", arg] = (location.hash.match(/^#\/([^/]*)\/?(.*)$/) || []);
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === (view === "case" || view === "" ? "cases" : view)));
  if (view === "case") viewCase(decodeURIComponent(arg));
  else if (view === "check") viewCheck();
  else if (view === "report") viewReport();
  else if (view === "methodology") viewMethodology();
  else viewCases();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

$("#quick-exit").addEventListener("click", () => {
  document.body.innerHTML = "";
  location.replace("https://www.bbc.com/weather");
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && location.hash.startsWith("#/report")) $("#quick-exit").click(); });

window.addEventListener("hashchange", route);
route();
