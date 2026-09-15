// Pulls recent human-trafficking and fake-job recruitment news from Tavily, extracts
// patterns, and writes data/news.json for the News patterns page.
// The Tavily key stays on this machine: the site only ever reads the generated file.
// Run: TAVILY_API_KEY=... npm run news [-- --days 30]
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { extractArticle, aggregate } from "./news-extract.mjs";

const require = createRequire(import.meta.url);
const topojson = require("topojson-client");
const iso = require("i18n-iso-countries");

// --offline re-runs extraction on the last fetch (cached in .cache/, not committed).
const offline = process.argv.includes("--offline");
const cache = new URL("../.cache/news-raw.json", import.meta.url);
const key = process.env.TAVILY_API_KEY;
if (!key && !offline) { console.error("TAVILY_API_KEY is not set (or pass --offline to reuse the last fetch)."); process.exit(1); }
const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || 30;

const QUERIES = [
  "human trafficking fake job offer",
  "trafficked scam compound job offer rescued",
  "scam centre workers rescued repatriated nationals",
  "labour trafficking recruitment agency arrested",
  "forced labour migrant workers recruitment fees debt bondage",
  "money mule recruitment fake job arrested",
  "lured with job offers trafficked abroad",
  "domestic workers trafficking recruitment Gulf",
  "tricked into fighting for Russia job offer",
  "sex trafficking fake modelling job offer",
  "online job scam trafficking warning government",
  "human trafficking ring busted job promises",
  "deepfake video scam celebrity investment",
  "AI voice cloning scam family emergency money",
  "deepfake video call fraud company transfer",
  "deepfake romance scam arrested",
];

// Search-hit snippets that are about something else entirely.
const RELEVANT = /\b(deep ?fakes?|voice[- ]clon|AI[- ]generated|traffick|forced labou?r|scam (centre|center|compound)|lured|fake jobs?|job (scam|offer)|recruit|debt bondage|money mules?|exploitat|smuggl|slavery|rescued)/i;

async function search(query) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, topic: "news", days, max_results: 20, search_depth: "advanced" }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status} for "${query}": ${await res.text()}`);
  return (await res.json()).results || [];
}

// Country label points: centroid of each country's largest polygon (so France isn't
// placed in the Atlantic because of its overseas territories).
async function centroids() {
  const topo = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json").then((r) => r.json());
  const out = {};
  for (const f of topojson.feature(topo, topo.objects.countries).features) {
    const iso2 = f.id && iso.numericToAlpha2(f.id);
    if (!iso2 || !f.geometry) continue;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best = null;
    for (const poly of polys) {
      const ring = poly[0];
      let a = 0, cx = 0, cy = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
        const k = x0 * y1 - x1 * y0;
        a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
      }
      if (a === 0) continue;
      const c = { area: Math.abs(a / 2), lon: cx / (3 * a), lat: cy / (3 * a) };
      if (!best || c.area > best.area) best = c;
    }
    if (best) out[iso2] = [Math.round(best.lat * 100) / 100, Math.round(best.lon * 100) / 100];
  }
  // Small states missing or unreliable at this resolution.
  Object.assign(out, { SG: [1.35, 103.82], BH: [26.07, 50.56], MT: [35.94, 14.38], MV: [3.2, 73.22], MU: [-20.3, 57.58], HK: [22.32, 114.17], MO: [22.2, 113.55], US: [39.8, -98.6], RU: [61.5, 96.0], NO: [61.5, 9.5], CA: [56.0, -106.0] });
  return out;
}

const seen = new Map();
let fetchedAt = new Date().toISOString();
if (offline) {
  if (!existsSync(cache)) { console.error("No cached fetch; run without --offline first."); process.exit(1); }
  const raw = JSON.parse(readFileSync(cache, "utf8"));
  fetchedAt = raw.fetched;
  for (const r of raw.results) seen.set(r.url, r);
} else {
  for (const q of QUERIES) {
    const results = await search(q);
    for (const r of results) {
      const url = r.url.replace(/\/amp\//, "/").replace(/[?#].*$/, "");
      if (seen.has(url)) { seen.get(url).queries.push(q); continue; }
      seen.set(url, { ...r, url, queries: [q] });
    }
    process.stdout.write(`  ${results.length} ← ${q}\n`);
  }
  mkdirSync(new URL("../.cache/", import.meta.url), { recursive: true });
  writeFileSync(cache, JSON.stringify({ fetched: fetchedAt, days, results: [...seen.values()] }));
}

const titleKey = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").slice(0, 8).join(" ");
const byTitle = new Set();
const articles = [];
for (const r of [...seen.values()].sort((a, b) => new Date(b.published_date) - new Date(a.published_date))) {
  const text = `${r.title} ${r.content}`;
  if (!RELEVANT.test(text)) continue;
  const tk = titleKey(r.title);
  if (byTitle.has(tk)) continue;
  byTitle.add(tk);
  const x = extractArticle(r);
  articles.push({
    title: r.title.replace(/\s*[|–-]\s*[^|–-]{2,40}$/, "").trim(),
    url: r.url,
    source: new URL(r.url).hostname.replace(/^www\./, ""),
    date: r.published_date ? new Date(r.published_date).toISOString().slice(0, 10) : null,
    snippet: r.content.replace(/\s+/g, " ").slice(0, 320),
    ...x,
  });
}

const points = await centroids();
const agg = aggregate(articles);
const missing = Object.keys(agg.byCountry).filter((c) => !points[c]);
const out = {
  generated: fetchedAt,
  window_days: days,
  provider: "Tavily news search",
  queries: QUERIES,
  n_results: seen.size,
  n_articles: articles.length,
  points: Object.fromEntries(Object.keys(agg.byCountry).filter((c) => points[c]).map((c) => [c, points[c]])),
  aggregates: agg,
  articles,
};
writeFileSync(new URL("../data/news.json", import.meta.url), JSON.stringify(out) + "\n");
console.log(`OK: ${articles.length} relevant articles from ${seen.size} results, ${Object.keys(agg.byCountry).length} countries, ${agg.corridors.length} corridors.${missing.length ? ` No map point for: ${missing.join(", ")}` : ""}`);
