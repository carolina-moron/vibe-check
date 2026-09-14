import {
  assess, caseEvidence, caseJurisdictions, coverage, linkFor, allNames, buildReport, dHash, flsriCountry, flsriRoute,
} from "./engine.js";
import { REPORT_ENDPOINT } from "./config.js";

const [signals, registers, { cases }, flsri] = await Promise.all(
  ["data/signals.json", "data/registers.json", "data/cases/index.json", "data/flsri.json"].map((p) => fetch(p).then((r) => r.json())),
);
let newsData = null;
let helpData = null;
const loadHelp = async () => (helpData ||= await fetch("data/help.json").then((r) => (r.ok ? r.json() : null)).catch(() => null));
const loadNews = async () => (newsData ||= await fetch("data/news.json").then((r) => r.json()));

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
    "If you're abroad, contact your own country's embassy or consulate, or IOM. They help people stranded or exploited abroad, including without a passport.",
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
  const help = await loadHelp();
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
          <select id="help-country">${countries.map((c) => `<option value="${esc(c.iso2)}"${c.iso2 === initial ? " selected" : ""}>${esc(country(c.iso2))}</option>`).join("")}</select>
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
      <div class="lines">${c.lines.map((l) => `
        <div class="line"><div class="fine for">${esc(FOR_LABEL[l.for] || l.for)}</div><h3>${esc(l.name)}</h3>
          <ul class="contacts">${l.contacts.map(contactHtml).join("")}</ul>
          <div class="fine">${ext(l.source, "Source")}</div></div>`).join("")}</div>`;
    try { localStorage.setItem("jrt-help-country", iso2); } catch {}
  };
  if (help) { render(initial); $("#help-country").addEventListener("change", (e) => render(e.target.value)); }
}

// ---- views: news patterns --------------------------------------------------------------

const NEWS_TYP = {
  "scam-compound": "Scam compounds", "labor-trafficking": "Labour trafficking", "military-recruitment": "Recruited to fight",
  "money-mule": "Money mules", "sex-trafficking": "Sex trafficking", "organ-trafficking": "Organ trafficking", "cartel-recruitment": "Cartel recruitment",
};
const NEWS_EVENT = { arrest: "Arrests & raids", warning: "Warnings & advisories", rescue: "Rescues & repatriation", sanction: "Sanctions", conviction: "Convictions" };
const ROLE_COLOR = { origin: "#0E6B60", destination: "#B4392C", mentioned: "#8B95A1" };

// Catalog entities named in an article (names of 6+ characters, whole words).
const entityIndex = cases.flatMap((c) => c.entities.flatMap((e) => allNames(e).map((n) => n.name)
  .filter((n) => n.length >= 6)
  .map((n) => ({ caseId: c.id, title: c.title, re: new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "iu") }))));
const relatedCases = (a) => [...new Map(entityIndex.filter((x) => x.re.test(`${a.title} ${a.snippet}`)).map((x) => [x.caseId, x])).values()];

const hbars = (obj, labels, max = null) => {
  const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const top = max ?? Math.max(1, ...rows.map(([, n]) => n));
  return rows.length ? `<ul class="hbars">${rows.map(([k, n]) => `<li><span>${esc(labels[k] || k)}</span><span class="hb"><i style="width:${Math.round((n / top) * 100)}%"></i></span><span class="mono">${n}</span></li>`).join("")}</ul>` : `<p class="muted">None detected.</p>`;
};

async function viewNews() {
  main.innerHTML = `<section class="hero small"><div class="eyebrow mono">News patterns</div><h1>What the news is reporting</h1><p class="muted">Loading…</p></section>`;
  const n = await loadNews();
  const a = n.aggregates;
  const state = { country: null, typology: null, limit: 20 };
  const gen = new Date(n.generated);

  main.innerHTML = `
    <section class="hero small">
      <div class="eyebrow mono">News patterns · last ${n.window_days} days · updated ${esc(gen.toISOString().slice(0, 10))}</div>
      <h1>What the news is reporting</h1>
      <p class="lede">${n.n_articles} recent news reports on trafficking, forced labour and fake-job recruitment, gathered with ${esc(n.provider)} and read by rules for countries, direction of movement, typology and lure indicators. The map shows where reporting points, not where most cases are.</p>
    </section>
    <div class="callout">This is <strong>media attention, not case counts</strong>. Coverage follows English-language outlets, government press releases and whatever is in the news cycle. Country roles and corridors are extracted automatically from headlines and snippets and can be wrong; each corridor lists the words it came from. Nothing here feeds a score.</div>

    <section class="mapcard">
      <div class="maphead">
        <div><h2>Countries and corridors in the news</h2>
          <label class="check toggle"><input type="checkbox" id="news-fl"> Shade countries by structural forced-labour risk (${flLink()})</label></div>
        <div class="legend">
          <span class="lg on"><i style="background:${ROLE_COLOR.origin}"></i>Mostly origin</span>
          <span class="lg on"><i style="background:${ROLE_COLOR.destination}"></i>Mostly destination</span>
          <span class="lg on"><i style="background:${ROLE_COLOR.mentioned}"></i>Mentioned</span>
        </div>
      </div>
      <div id="newsmap" class="map world" role="img" aria-label="Map of countries and corridors in recent news"></div>
      <p class="fine pad">Circle size = number of articles naming the country. Arrows run from origin to destination; solid lines have two or more articles behind them, dashed lines one. Click a country to filter the articles.</p>
    </section>

    <div class="dash">
      <section class="panel">
        <h2>Corridors</h2>
        <p class="fine">Origin to destination, as extracted from the text.</p>
        <ol class="corrlist">${a.corridors.slice(0, 14).map((c) => {
          const art = n.articles[c.articles[0]];
          const why = art.places.filter((p) => p.iso2 === c.from || p.iso2 === c.to).map((p) => `${p.terms.join(" / ")} → ${p.roles.join("/")}`).join("; ");
          return `<li><div class="row"><strong>${esc(country(c.from))} → ${esc(country(c.to))}</strong><span class="mono">${c.count} article${c.count > 1 ? "s" : ""}</span></div>
            <div class="fine">${ext(art.url, art.title)} · <span title="Words the extractor used">${esc(why)}</span></div></li>`;
        }).join("") || `<li class="muted">No directed corridors detected.</li>`}</ol>
      </section>
      <section class="panel">
        <h2>Most-named countries</h2>
        <ul class="hbars">${Object.entries(a.byCountry).sort((x, y) => y[1].mentions - x[1].mentions).slice(0, 12).map(([k, v]) => {
          const top = Math.max(...Object.values(a.byCountry).map((x) => x.mentions));
          return `<li><button type="button" class="linklike" data-country="${esc(k)}">${esc(country(k))}</button><span class="hb split"><i style="width:${(v.origin / top) * 100}%;background:${ROLE_COLOR.origin}"></i><i style="width:${(v.destination / top) * 100}%;background:${ROLE_COLOR.destination}"></i><i style="width:${((v.mentions - v.origin - v.destination) / top) * 100}%;background:${ROLE_COLOR.mentioned}"></i></span><span class="mono">${v.mentions}</span></li>`;
        }).join("")}</ul>
        <p class="fine">Green = named as an origin, red = as a destination, grey = mentioned without a clear role.</p>
      </section>
      <section class="panel">
        <h2>Typologies</h2>${hbars(a.typologies, NEWS_TYP)}
        <h3>What happened</h3>${hbars(a.events, NEWS_EVENT)}
      </section>
      <section class="panel">
        <h2>Lure indicators in coverage</h2>
        <p class="fine">The same offer-text rules as the live check, run on headlines and snippets. Snippets are short, so these undercount.</p>
        ${hbars(a.signals, Object.fromEntries(signals.signals.map((s) => [s.id, s.label])))}
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
        <p class="fine">Queries run through Tavily's news search (${n.queries.length} queries, ${n.n_results} results, ${n.n_articles} kept after relevance filtering and de-duplication): ${n.queries.map(esc).join(" · ")}. Countries are matched from names, nationality words and known compound hubs. A nationality counts as an origin only in a sentence about victims; capital cities count as plain mentions because they are usually datelines. See <a href="#/methodology">Methodology</a>.</p>
      </section>
    </div>`;

  // map
  const map = baseMap($("#newsmap"), { center: [20, 40], zoom: 2, minZoom: 2 });
  if (map) {
    const top = Math.max(...Object.values(a.byCountry).map((v) => v.mentions));
    for (const c of a.corridors) {
      const p1 = n.points[c.from], p2 = n.points[c.to];
      if (!p1 || !p2) continue;
      const line = L.polyline(arc(p1, p2), { color: "#5A5F9E", weight: 1.5 + c.count * 1.5, opacity: 0.7, dashArray: c.count > 1 ? null : "5 6" }).addTo(map);
      line.bindTooltip(`${esc(country(c.from))} → ${esc(country(c.to))}: ${c.count} article${c.count > 1 ? "s" : ""}`, { sticky: true });
      const tip = arc(p1, p2);
      const [ya, xa] = tip[tip.length - 3], [yb, xb] = tip[tip.length - 1];
      const ang = Math.atan2(yb - ya, xb - xa) * 180 / Math.PI;
      L.marker([yb, xb], { icon: L.divIcon({ className: "arrow", html: `<span style="transform:rotate(${-ang}deg)">➤</span>`, iconSize: [14, 14] }), interactive: false }).addTo(map);
    }
    for (const [k, v] of Object.entries(a.byCountry)) {
      const pt = n.points[k]; if (!pt) continue;
      const dom = v.origin > v.destination ? "origin" : v.destination > v.origin ? "destination" : v.origin ? "origin" : "mentioned";
      L.circleMarker(pt, { radius: 4 + Math.sqrt(v.mentions / top) * 18, color: "#fff", weight: 1, fillColor: ROLE_COLOR[dom], fillOpacity: 0.75 })
        .addTo(map)
        .bindTooltip(`<strong>${esc(country(k))}</strong><br>${v.mentions} article(s): ${v.origin} as origin, ${v.destination} as destination`)
        .on("click", () => setCountry(k));
    }
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
        <div class="row"><span class="mono muted">${esc(x.date || "")} · ${esc(x.source)}</span>${x.fake_job ? `<span class="tag">fake job offer</span>` : ""}</div>
        <h3>${ext(x.url, x.title)}</h3>
        <p>${esc(x.snippet)}…</p>
        <div class="chips">
          ${x.places.map((p) => `<span class="pchip" style="--c:${ROLE_COLOR[p.roles.includes("origin") ? "origin" : p.roles.includes("destination") ? "destination" : "mentioned"]}" title="${esc(p.terms.join(", "))}">${esc(country(p.iso2))} · ${esc(p.roles.join("/"))}</span>`).join("")}
          ${x.typologies.map((t) => `<span class="acc">${esc(NEWS_TYP[t] || t)}</span>`).join("")}
          ${x.signals.map((sid) => `<span class="acc a-plan">${esc(signalById[sid]?.label || sid)}</span>`).join("")}
          ${rel.map((r) => `<a class="acc a-live" href="#/case/${esc(r.caseId)}">case: ${esc(r.title)}</a>`).join("")}
        </div></li>`;
    }).join("") || `<li class="muted">No articles match.</li>`;
  };
  $("#more").addEventListener("click", () => { state.limit += 20; renderArticles(); });
  const setCountry = (k) => { state.country = k; state.limit = 20; renderArticles(); if (k) $("#articles").scrollIntoView({ behavior: "smooth", block: "start" }); };
  $("#nf-typ").addEventListener("change", (e) => { state.typology = e.target.value || null; state.limit = 20; renderArticles(); });
  main.querySelectorAll("[data-country]").forEach((b) => b.addEventListener("click", () => setCountry(b.dataset.country)));
  renderArticles();
}

// ---- views: live check -----------------------------------------------------------------

const KINDS = {
  profile: { label: "Social media profile", hint: "An account that contacted you, or that you met on an app", fields: ["profileUrl", "photo"], text: "Bio, posts or messages from this account", questions: ["profile_new", "profile_photos_too_polished", "profile_mismatch", "refuses_video", "chat_only_contact", "romance_money", "investment_pitch"] },
  screenshot: { label: "Screenshot of messages", hint: "A chat, DM, text or email you received", fields: ["profileUrl"], text: "Text from the messages", screenshotFirst: true, questions: ["secrecy", "urgency", "refuses_video", "verification_code", "gift_card_crypto", "romance_money"] },
  travel: { label: "Travel invitation", hint: "Someone offering to bring you somewhere to meet, study or work", fields: ["destination", "profileUrl"], text: "The invitation or messages about the trip", questions: ["sponsor_travel_stranger", "carry_package", "vague_location", "document_retention", "secrecy", "visa_fraud"] },
  housing: { label: "Housing offer", hint: "A room, flat or accommodation offered to you", fields: ["website", "email", "destination"], text: "The listing or messages from the landlord or host", questions: ["housing_unseen_deposit", "owner_unavailable", "housing_tied_to_job", "gift_card_crypto", "urgency"] },
  job: { label: "Job offer", hint: "A job ad, offer letter or contract", fields: ["company", "website", "email", "jurisdiction", "workCountry"], text: "The job ad or offer", questions: ["upfront_fee", "id_before_interview", "chat_only_contact", "employer_housing_travel", "vague_location", "document_retention", "debt_bondage"] },
  recruiter: { label: "Recruiter message", hint: "A recruiter or agent who reached out to you", fields: ["company", "email", "profileUrl", "workCountry"], text: "What the recruiter wrote", questions: ["chat_only_contact", "upfront_fee", "id_before_interview", "urgency", "pay_too_high", "payment_handling"] },
  other: { label: "Other suspicious interaction", hint: "Anything else that doesn't feel right", fields: ["profileUrl", "website", "email"], text: "What happened, or what they said", questions: ["secrecy", "verification_code", "gift_card_crypto", "urgency", "investment_pitch", "carry_package"] },
};
const FIELD = {
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
const KIND_ICON = { profile: "◉", screenshot: "▣", travel: "✈", housing: "⌂", job: "▤", recruiter: "✉", other: "?" };

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
  main.innerHTML = `
    <section class="hero small check-hero">
      <div class="eyebrow mono">Digital Safety Check</div>
      <h1>Before you trust someone online, check the situation.</h1>
      <p class="lede">Choose what you want to check. We look for the warning signs seen in real scam and trafficking cases, and tell you whether it's a lower concern, a reason for caution, or a serious warning sign. Nothing you enter is stored unless you choose to submit it.</p>
    </section>
    <nav class="kinds" aria-label="What do you want to check?">${Object.entries(KINDS).map(([id, x]) => `
      <a class="kind${id === kind ? " on" : ""}" href="#/check/${id}"${id === kind ? ' aria-current="true"' : ""}><span class="ki" aria-hidden="true">${KIND_ICON[id]}</span><strong>${esc(x.label)}</strong><span class="fine">${esc(x.hint)}</span></a>`).join("")}
    </nav>
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
      <p class="fine">We check organisations, websites and email domains, never a private person's criminal record (see <a href="#/methodology">Methodology</a>). If you feel unsafe, <a href="#/help">get help now</a>.</p>
    </form>
    <div id="out" aria-live="polite"></div>` : `<p class="muted pad">Choose one of the options above to start.</p>`}`;
  if (!k) return;

  const form = $("#check");
  let photoHash = null;
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

  const EXAMPLES = {
    profile: { posting: "Hi dear, I saw your profile and felt a connection. I'm an engineer working offshore so my camera is broken for video calls. My uncle taught me a crypto trading platform with daily profits, I can show you. Let's continue on Telegram.", answers: ["profile_new", "profile_photos_too_polished"] },
    screenshot: { posting: "You've been selected! Just send the 6-digit verification code we texted you so we can confirm your account. Don't tell anyone, this offer is only for today. Payment by Steam gift cards is fine." },
    travel: { posting: "I'll pay for your flight to Bangkok, the ticket is already booked. My friend there has a job for you. Could you bring a small package for him? Keep it between us for now, the workplace location will be shared on arrival." },
    housing: { posting: "The flat is available now. I'm currently abroad so I can't show it, but the keys will be sent to you by courier. Please pay the first month and deposit before viewing to reserve it. Western Union preferred." },
    job: { company: "Huione Guarantee", email: "hr.bangkokjobs@gmail.com", posting: "URGENT: customer service representatives for an online company. No experience needed, earn $3,000 per week! Free flight and accommodation provided. Exact workplace location will be disclosed on arrival. Send your passport scan and pay the visa processing fee within 48 hours.", workCountry: "KH" },
    recruiter: { company: "Global Talent Link", email: "talentlink.hiring@outlook.com", posting: "Hello! We found your CV. Remote data entry, $200 per hour, start tomorrow. Interview on WhatsApp only. You will receive payments and forward them to our clients. A small training fee is required.", workCountry: "" },
    other: { posting: "This is your bank's security team. Share the one-time password you just received so we can stop the fraud on your account. Do not tell anyone at the branch." },
  };
  $("#example").addEventListener("click", () => {
    const ex = EXAMPLES[kind];
    for (const [f, v] of Object.entries(ex)) if (f !== "answers" && form[f]) form[f].value = v;
    form.querySelectorAll("[name=answers]").forEach((c) => { c.checked = (ex.answers || []).includes(c.value); });
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
    try { renderCheck(await assess(input, { signals, registers, cases }), { ...input, photoHash }); }
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

function verdictBox(r, orgChecked) {
  return `<div class="scorebox t-${esc(r.tier.id)}">
    <div class="num">${r.points}<small>/100</small></div>
    <div><div class="tierlabel">${esc(r.tier.label)}</div>${orgChecked && r.input.jurisdiction ? `<div class="cov c-${esc(r.coverage.class)}" title="${esc(r.coverage.explain)}">${esc(r.coverage.label)}</div>` : `<div class="fine">${r.flags.length} warning sign${r.flags.length === 1 ? "" : "s"}</div>`}</div>
  </div>`;
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
    <div class="submitbox">
      <h3>Submit this check anonymously</h3>
      <p class="fine">Help warn others. We send only the type of check, the warning signs, the website and email domains, and your text with personal details removed. No name, contact details or IP address, and never the screenshots. You'll see exactly what will be sent first.</p>
      <label class="check consent"><input type="checkbox" id="sub-consent"> I agree this anonymous record can be stored and used, in aggregate, to warn others and for research.</label>
      <div class="btns"><button type="button" class="ghost" id="sub-preview">Preview what will be sent</button></div>
      <div id="sub-out"></div>
    </div>
  </section>`;
}

function wireSubmit(r, input) {
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
    ${r.catalogMatches.length ? `<div class="callout red">Matches a documented case: ${r.catalogMatches.map((m) => `<a href="#/case/${esc(m.caseId)}">${esc(m.entity)}</a> via ${esc(m.via.type)} name “${esc(m.via.name)}”`).join("; ")}</div>` : ""}
    <div class="dash">
      <section class="panel${orgChecked ? "" : " span2"}"><h2>Warning signs found</h2>${flagList(r.flags)}</section>
      ${orgChecked ? `<section class="panel"><h2>What each register returned</h2>
        ${layers.filter((l) => grouped[l].length).map((l) => `<h3>${esc(registers.layers[l])}</h3><ul class="checks">${grouped[l].map((c) => `
          <li><div class="row"><span>${esc(c.meta?.name || c.register)} <span class="acc ${ACCESS[c.meta?.access]?.cls || ""}">${esc(ACCESS[c.meta?.access]?.label || "")}</span></span><span class="verdict ${VERDICT[c.verdict].cls}">${VERDICT[c.verdict].label}</span></div>
            <div class="meta">${esc(c.detail)}</div>
            ${c.register === "courtlistener" && c.records.length ? `<ul class="records">${c.records.map((d) => `<li>${d.url ? ext(d.url, d.name) : esc(d.name)} <span class="muted">${esc(d.court)} · ${esc(d.date)}</span></li>`).join("")}</ul>` : ""}
            ${c.register === "gleif" && c.records.length ? `<ul class="records">${c.records.map((d) => `<li>${ext(d.url, d.name)} <span class="muted">${esc(d.status)} · ${esc(d.jurisdiction)}${d.otherNames.length ? ` · also: ${esc(d.otherNames.map((o) => o.name).join(", "))}` : ""}</span></li>`).join("")}</ul>` : ""}
            <div class="fine">${esc(c.meta?.caveat || "")}</div></li>`).join("")}</ul>`).join("")}
      </section>` : ""}
      ${contextPanel(input)}
      ${nextSteps(r, input)}
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
      <h1>Report a job offer or abuse</h1>
      <p class="lede">Tell us about a recruiter, agency or employer. Reports are anonymous: we never ask who you are, your details are removed from your story in this browser before anything is sent, and you see exactly what will be sent first.</p>
    </section>
    <div class="callout red"><strong>If you are in danger or can't leave, call for help first.</strong> <a href="#/help">Find the hotline for your country</a>, or call local emergency services. Use a device and connection you feel safe on. The <em>Quick exit</em> button at the top leaves this site immediately.</div>
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
      <h1>How Digital Safety Check works, and what it won't do</h1>
      <p class="lede">Digital Safety Check is built on the same rules as the Digital Provenance Passport: no claim without a source, no check that can return “clear”, and a score that is always shown with how much could have been found.</p>

      <nav class="toc" aria-label="On this page">
        <a href="#m-principles">Principles</a><a href="#m-check">What you can check</a><a href="#m-people">People are out of scope</a><a href="#m-score">Score and coverage</a>
        <a href="#m-signals">Risk signals</a><a href="#m-registers">Registers</a><a href="#m-cases">Case catalog</a>
        <a href="#m-flsri">Structural risk index</a><a href="#m-news">News patterns</a><a href="#m-reports">Anonymous reports</a><a href="#m-social">Social and image signals</a><a href="#m-data">Training data</a><a href="#m-limits">Limits</a>
      </nav>

      <h2 id="m-principles">Principles</h2>
      <ol>
        <li><strong>No check returns “clear”.</strong> The strongest negative is <em>no evidence found</em>. Most small employers are in no register a browser can reach, and most scam compounds operate where no open register exists at all.</li>
        <li><strong>Silence earns nothing.</strong> A register that returns nothing adds no points and removes none. Registers that couldn't be searched are listed, so a thin check can't pass for a thorough one.</li>
        <li><strong>The score never travels alone.</strong> Coverage is computed separately and always displayed beside it.</li>
        <li><strong>Every fact carries its source.</strong> Case records cite official, court, multilateral, press or NGO sources, labelled by tier.</li>
      </ol>

      <h2 id="m-check">What you can check</h2>
      <p>Seven kinds of situation: a social media profile, a screenshot of messages, a travel invitation, a housing offer, a job offer, a recruiter message, or another suspicious interaction. Each asks for the details that matter for that situation and a few yes/no questions about what happened. The text is read with the same warning-sign rules for every kind, so a job offer that also pushes a crypto platform is caught.</p>
      <p><strong>Results</strong> come in three levels:</p>
      <ul>
        <li><em>Lower concern</em>: few warning signs.</li>
        <li><em>Caution</em>: some warning signs.</li>
        <li><em>Serious warning signs</em>: the pattern matches real scam and trafficking cases.</li>
      </ul>
      <p>A lower-concern result is never a clearance.</p>
      <p><strong>Screenshots</strong> are read on your own device with open-source text recognition (Tesseract). The image is never uploaded, and you can correct the text before checking.</p>
      <p><strong>Profile photos</strong> become a 64-bit fingerprint on your device, so the same face can be matched across reports without storing the image.</p>
      <p><strong>Submitting</strong> is optional and anonymous, and you preview the exact record first.</p>

      <h2 id="m-people">People are out of scope</h2>
      <div class="callout red">
        <p><strong>Criminal background checks on people are the one piece to drop.</strong> Checkr and peers will not run checks on a company or on a recruiter you have not hired, and compiling criminal history on named individuals risks making your tool a consumer reporting agency under FCRA. Entity-level checks and principals on public enforcement lists are fine; “recruiter has a record” is not.</p>
      </div>
      <p>So the check looks at organisations, websites and email domains only. Individuals appear only where an official source already names them in an indictment, judgment or sanctions designation, and only inside that case record. There is no person search, no offender-registry lookup and no criminal-history field. Sex-offender registry data (NSOPW) has no public API, and misusing it is an offence. Fifteen US states and New York City also restrict criminal-history questions before a conditional job offer. “Recruiter's name is not among the registered officers” is an acceptable check; “recruiter has a criminal record” is not.</p>

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
      <p>Country context comes from the Ethical Tech CoLab's ${flLink("Forced Labor Structural Risk Index")} (FLSRI), imported unchanged from its published build (${esc(flSrc.build_date)}, ${flSrc.n_scored} of ${flSrc.n_universe} countries scored).</p>
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
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === (view === "case" ? "cases" : view === "" ? "check" : view)));
  $("#helpstrip").hidden = view === "help";
  if (view === "case") viewCase(decodeURIComponent(arg));
  else if (view === "check" || view === "") viewCheck(decodeURIComponent(arg || ""));
  else if (view === "cases") viewCases();
  else if (view === "news") viewNews();
  else if (view === "help") viewHelp();
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
