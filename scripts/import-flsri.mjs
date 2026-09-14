// Imports the ETC Forced Labor Structural Risk Index (FLSRI) published build into data/flsri.json.
// Reads the FLSRI repo's public/data outputs as they are, without rescoring anything.
// Run: npm run import:flsri [-- /path/to/forced-labor-structural-risk-index]
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const iso = createRequire(import.meta.url)("i18n-iso-countries");
const repo = process.argv[2] || `${process.env.HOME}/forced-labor-structural-risk-index`;
const read = (p) => JSON.parse(readFileSync(`${repo}/public/data/${p}`, "utf8"));

const scores = read("scores.json");
const domains = read("domains.json");
const sub = read("subnational.json");
let commit = null;
try { commit = execSync(`git -C "${repo}" log -1 --format=%h`).toString().trim(); } catch {}

const [lowCut, highCut] = scores.meta.tier_cuts;
const tier = (v) => (v >= highCut ? "higher" : v >= lowCut ? "middle" : "lower");
const round = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

const countries = {};
const numeric = {};
const skipped = [];
for (const c of scores.countries) {
  const iso2 = iso.alpha3ToAlpha2(c.iso3);
  if (!iso2) { skipped.push(c.iso3); continue; }
  const num = iso.alpha3ToNumeric(c.iso3);
  if (num) numeric[num] = iso2;
  const d = domains[c.iso3] || {};
  countries[iso2] = c.scored ? {
    name: c.name, scored: true,
    composite: round(c.composite), R: round(c.R), E: round(c.E), tier: tier(c.composite),
    rank: c.rank, band: [c.rank_p5, c.rank_p95], lowConfidence: !!c.low_confidence,
    domains: Object.fromEntries(Object.entries(d).filter(([, v]) => v.scored).map(([k, v]) => [k, { s: round(v.score), low: !!v.low_conf }])),
    corridors: sub.corridors.filter((r) => r.iso3 === c.iso3).map((r) => ({ region: r.region, risk: round(r.risk) })),
  } : { name: c.name, scored: false };
}

const domainMeta = {};
for (const d of Object.values(domains)) for (const [k, v] of Object.entries(d)) domainMeta[k] ||= { label: v.label, phase: v.phase };

const out = {
  source: {
    name: "Forced Labor Structural Risk Index (FLSRI)",
    publisher: "Ethical Tech CoLab",
    site: "https://ethical-tech-colab.github.io/forced-labor-structural-risk-index/",
    repo: "https://github.com/Ethical-Tech-CoLab/forced-labor-structural-risk-index",
    build_date: scores.meta.build_date, commit, imported: new Date().toISOString().slice(0, 10),
    n_scored: scores.meta.n_scored, n_universe: scores.meta.n_universe, tier_cuts: scores.meta.tier_cuts,
    rank_band: `90% rank band from ${scores.meta.uncertainty.iterations.toLocaleString("en-US")} Monte-Carlo re-scorings`,
    citation: scores.meta.citation,
  },
  domains: domainMeta,
  numericToIso2: numeric,
  countries,
};
writeFileSync(new URL("../data/flsri.json", import.meta.url), JSON.stringify(out) + "\n");
console.log(`OK: ${Object.values(countries).filter((c) => c.scored).length} scored countries, build ${out.source.build_date} (${commit}).${skipped.length ? ` No ISO2 for: ${skipped.join(", ")}` : ""}`);
