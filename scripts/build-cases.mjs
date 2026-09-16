// Validates every data/cases/*.json and writes data/cases/index.json (the file the app loads).
// Run: npm run build:cases   (fails with a non-zero exit on any invalid case)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const dir = new URL("../data/cases/", import.meta.url);
const signals = new Set(JSON.parse(readFileSync(new URL("../data/signals.json", import.meta.url))).signals.map((s) => s.id));

const TYPOLOGIES = ["scam-compound", "labor-trafficking", "money-mule", "laundering", "sex-trafficking", "forced-labor-industrial", "job-scam", "deepfake-fraud", "sextortion"];
const STATUSES = ["enforcement_action", "sanctioned", "convicted", "civil_judgment", "settled", "charges_dismissed", "reported"];
const STAGES = ["advertised", "recruited", "transit", "exploited", "laundered", "escaped", "prosecuted"];
const TIERS = ["official", "court", "press", "ngo", "multilateral"];
const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const ISO2 = /^[A-Z]{2}$/;
const URL_RE = /^https:\/\/\S+$/;

const errors = [];
const cases = [];

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").sort()) {
  const err = (msg) => errors.push(`${file}: ${msg}`);
  let c;
  try { c = JSON.parse(readFileSync(new URL(file, dir), "utf8")); } catch (e) { err(`invalid JSON (${e.message})`); continue; }

  if (`${c.id}.json` !== file) err(`id "${c.id}" does not match filename`);
  for (const k of ["title", "summary", "period"]) if (!c[k]) err(`missing ${k}`);
  if (!TYPOLOGIES.includes(c.typology)) err(`unknown typology "${c.typology}"`);
  if (!STATUSES.includes(c.status)) err(`unknown status "${c.status}"`);
  if (!c.sources?.length) err("no sources");

  for (const s of c.sources || []) {
    if (!URL_RE.test(s.url)) err(`source url not https: ${s.url}`);
    if (!TIERS.includes(s.tier)) err(`source tier "${s.tier}"`);
    if (s.date && !DATE.test(s.date)) err(`source date "${s.date}"`);
  }
  for (const e of c.entities || []) {
    if (!e.name) err("entity without name");
    if (e.jurisdiction && !ISO2.test(e.jurisdiction)) err(`entity ${e.name} jurisdiction "${e.jurisdiction}"`);
    for (const n of e.names || []) if (n.source && !URL_RE.test(n.source)) err(`name ${n.name} source not https`);
    for (const a of e.actions || []) {
      if (!URL_RE.test(a.url)) err(`action on ${e.name} has no https url`);
      if (a.date && !DATE.test(a.date)) err(`action date "${a.date}" on ${e.name}`);
    }
  }
  if ((c.journey || []).length < 2) err("journey needs at least two stages");
  for (const j of c.journey || []) {
    if (!STAGES.includes(j.stage)) err(`journey stage "${j.stage}"`);
    if (!ISO2.test(j.country)) err(`journey country "${j.country}"`);
    if (!(Math.abs(j.lat) <= 90 && Math.abs(j.lon) <= 180)) err(`journey coords ${j.lat},${j.lon}`);
    if (j.source && !URL_RE.test(j.source)) err(`journey source not https at ${j.place}`);
  }
  for (const l of c.lures || []) {
    if (!signals.has(l.signal)) err(`lure signal "${l.signal}" not in signals.json`);
    if (l.source && !URL_RE.test(l.source)) err(`lure source not https (${l.signal})`);
  }
  for (const o of c.victim_origins || []) if (!ISO2.test(o)) err(`victim origin "${o}"`);
  cases.push(c);
}

if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`\n${errors.length} problem(s) in ${cases.length} case file(s).`);
  process.exit(1);
}
writeFileSync(new URL("index.json", dir), JSON.stringify({ generated: "by scripts/build-cases.mjs; do not edit", cases }, null, 1) + "\n");
console.log(`OK: ${cases.length} cases written to data/cases/index.json`);
