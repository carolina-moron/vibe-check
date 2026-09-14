// Builds corridor summaries (citizenship → country of exploitation) from the CTDC Global
// Synthetic Dataset, downloaded by hand from https://www.ctdatacollaborative.org/page/global-synthetic-dataset
// (CTDC's terms prohibit automated access, so this script never fetches it).
//
// Only aggregates are written. The raw dataset is never copied into this repo or the site:
// CTDC's terms require IOM's written consent to re-host it. Corridors under MIN_COUNT records
// are withheld, and percentages follow the codebook: the denominator is the records that gave
// any information for that group of variables.
//
// Run: npm run import:ctdc -- /path/to/global-synthetic-dataset.csv [--accessed "14 September 2026"]
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const iso = createRequire(import.meta.url)("i18n-iso-countries");
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--accessed");
if (!file) { console.error("Usage: npm run import:ctdc -- /path/to/ctdc.csv [--accessed \"14 September 2026\"]"); process.exit(1); }
const accessed = args.includes("--accessed") ? args[args.indexOf("--accessed") + 1] : new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const MIN_COUNT = 10;
const OUT = process.env.CTDC_OUT ? new URL(process.env.CTDC_OUT, `file://${process.cwd()}/`) : new URL("../data/ctdc.json", import.meta.url);

// ---- CSV (RFC 4180: quoted fields, embedded commas and quotes) ----
function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

const raw = readFileSync(file, "utf8").replace(/^﻿/, "");
const [header, ...records] = parseCsv(raw);
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const need = ["yearOfRegistration", "gender", "ageBroad", "citizenship", "CountryOfExploitation"];
const missing = need.filter((c) => !(c in col));
if (missing.length) { console.error(`Not the CTDC Global Synthetic Dataset? Missing columns: ${missing.join(", ")}`); process.exit(1); }

const GROUPS = {
  exploitation: { isForcedLabour: "Forced labour", isSexualExploit: "Sexual exploitation", isOtherExploit: "Other exploitation" },
  control: {
    meansFalsePromises: "False promises", meansDebtBondageEarnings: "Debt bondage or withheld earnings", meansWithholdDocs: "Documents withheld",
    meansThreats: "Threats to them or family", meansAbusePsyPhySex: "Psychological, physical or sexual abuse", meansDenyBasicNeeds: "Denied basic needs",
    meansExcessiveWorkHours: "Excessive working hours", meansDrugsAlcohol: "Drugs or alcohol",
  },
  labour: { typeOfLabourAgriculture: "Agriculture", typeOfLabourConstruction: "Construction", typeOfLabourDomesticWork: "Domestic work", typeOfLabourHospitality: "Hospitality" },
  recruiter: { recruiterRelationIntimatePartner: "Intimate partner", recruiterRelationFriend: "Friend", recruiterRelationFamily: "Family", recruiterRelationOther: "Other" },
};
const NULLISH = new Set(["", "NULL", "null", "NA", "N/A", "-99", "-99.0"]);
const val = (r, c) => { const v = col[c] == null ? "" : (r[col[c]] ?? "").trim(); return NULLISH.has(v) ? null : v; };
const toIso2 = (a3) => (a3 && iso.alpha3ToAlpha2(a3.toUpperCase())) || null;

const blank = () => ({ n: 0, years: [Infinity, -Infinity], gender: {}, age: {}, groups: Object.fromEntries(Object.keys(GROUPS).map((g) => [g, { answered: 0, counts: {} }])) });
const corridors = new Map();
const countries = new Map();
let used = 0, noCountry = 0, unmapped = new Set();

for (const r of records) {
  const fromA3 = val(r, "citizenship"), toA3 = val(r, "CountryOfExploitation");
  const from = toIso2(fromA3), to = toIso2(toA3);
  if (fromA3 && !from) unmapped.add(fromA3);
  if (toA3 && !to) unmapped.add(toA3);
  if (!from || !to) { noCountry++; continue; }
  used++;
  const key = `${from}>${to}`;
  const c = corridors.get(key) || blank();
  corridors.set(key, c);
  c.n++;
  const y = Number(val(r, "yearOfRegistration"));
  if (y) { c.years[0] = Math.min(c.years[0], y); c.years[1] = Math.max(c.years[1], y); }
  const g = val(r, "gender"); if (g) c.gender[g] = (c.gender[g] || 0) + 1;
  const a = val(r, "ageBroad"); if (a) c.age[a] = (c.age[a] || 0) + 1;
  for (const [grp, vars] of Object.entries(GROUPS)) {
    const present = Object.keys(vars).filter((v) => val(r, v) === "1" || val(r, v) === "1.0");
    if (!present.length) continue;
    c.groups[grp].answered++;
    for (const v of present) c.groups[grp].counts[v] = (c.groups[grp].counts[v] || 0) + 1;
  }
  for (const [iso2, dir] of [[from, "out"], [to, "in"]]) {
    const k = countries.get(iso2) || { out: 0, in: 0, domestic: 0 };
    countries.set(iso2, k);
    if (from === to) { if (dir === "out") k.domestic++; } else k[dir]++;
  }
}

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const summarise = (key, c) => {
  const [from, to] = key.split(">");
  const gTotal = Object.values(c.gender).reduce((s, x) => s + x, 0);
  const aTotal = Object.values(c.age).reduce((s, x) => s + x, 0);
  // Age bands are "0—8" and "9—17" in the codebook; match on the lower bound so dash style doesn't matter.
  const minors = Object.entries(c.age).filter(([k]) => /^\s*(0|9)\s*\D/.test(k)).reduce((s, [, x]) => s + x, 0);
  return {
    from, to, domestic: from === to, n: c.n,
    years: Number.isFinite(c.years[0]) ? c.years : null,
    gender: gTotal ? Object.fromEntries(Object.entries(c.gender).map(([k, x]) => [k, pct(x, gTotal)])) : null,
    minors_pct: aTotal ? pct(minors, aTotal) : null,
    ...Object.fromEntries(Object.entries(GROUPS).map(([grp, vars]) => {
      const G = c.groups[grp];
      return [grp, G.answered >= MIN_COUNT ? { answered: G.answered, pct: Object.fromEntries(Object.entries(vars).map(([v, label]) => [label, pct(G.counts[v] || 0, G.answered)]).filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1])) } : null];
    })),
  };
};

const all = [...corridors.entries()].map(([k, c]) => summarise(k, c)).sort((a, b) => b.n - a.n);
const published = all.filter((c) => c.n >= MIN_COUNT);
const out = {
  source: {
    name: "Counter-Trafficking Data Collaborative (CTDC) Global Synthetic Dataset",
    publisher: "International Organization for Migration (IOM)",
    url: "https://www.ctdatacollaborative.org/page/global-synthetic-dataset",
    credit: `Source: Counter-Trafficking Data Collaborative (CTDC). 2024. 'Global Synthetic Dataset'. Available at: https://www.ctdatacollaborative.org/page/global-synthetic-dataset (Accessed ${accessed}).`,
    terms: "https://www.ctdatacollaborative.org/page/terms-use",
    note: "Derived summaries only; the raw dataset is not reproduced. Synthetic, differentially private records that preserve the statistics of identified and reported victims. Not a random sample: counts reflect where contributing organisations operate and identify victims.",
    min_count: MIN_COUNT, accessed,
    records: records.length, records_with_both_countries: used, records_missing_a_country: noCountry,
    corridors_total: all.length, corridors_published: published.length, withheld_small: all.length - published.length,
  },
  countries: Object.fromEntries([...countries.entries()].map(([k, v]) => [k, v])),
  corridors: published,
};
writeFileSync(OUT, JSON.stringify(out) + "\n");
console.log(`OK: ${records.length} records, ${used} with both countries; ${published.length} corridors published (${all.length - published.length} under ${MIN_COUNT} withheld).${unmapped.size ? ` Unmapped codes: ${[...unmapped].slice(0, 12).join(", ")}` : ""}`);
