// Benchmark: does the check catch real scams and leave real jobs alone?
// Sets: (1) real scam messages quoted by official sources (data/benchmark/scam-messages.json),
// (2) the recruitment lures documented in the case catalog, (3) the legitimate postings the agent
// checked from public job boards (data/agent/events.jsonl, source "agent", excluding submissions).
// Writes data/benchmark/results.json, which the site shows as "Does it work?".
// Run: npm run benchmark
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { detectContent, score } from "../src/engine.js";

const root = new URL("../", import.meta.url);
const load = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const signals = load("data/signals.json");
const cases = load("data/cases/index.json").cases;
const CAUTION = signals.tiers.find((t) => t.id === "caution").min;

const flagged = (text) => score(detectContent(text), signals).points >= CAUTION;

// 1. Real scam messages
const scams = existsSync(new URL("data/benchmark/scam-messages.json", root)) ? load("data/benchmark/scam-messages.json").messages : [];
const scamHits = scams.map((m) => ({ id: m.id, type: m.type, flagged: flagged(m.text), signs: detectContent(m.text).map((h) => h.id) }));

// 2. Documented lures per case (the sourced descriptions of what recruiters said or did)
const caseHits = cases.map((c) => {
  const text = c.lures.map((l) => l.quote_or_description).join(" ");
  const signs = detectContent(text).map((h) => h.id);
  return { id: c.id, recognised: signs.length > 0, signs };
});

// 3. Legitimate postings from the agent's board run (tier below caution = not flagged)
const evFile = new URL("data/agent/events.jsonl", root);
const events = existsSync(evFile) ? readFileSync(evFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const boardChecks = events.filter((e) => e.source === "agent" && e.kind === "job");
const legitFlagged = boardChecks.filter((e) => e.tier === "high" || e.tier === "caution").length;

const results = {
  generated: new Date().toISOString(),
  caution_threshold: CAUTION,
  scams: { total: scamHits.length, flagged: scamHits.filter((x) => x.flagged).length, missed: scamHits.filter((x) => !x.flagged).map((x) => x.id) },
  cases: { total: caseHits.length, recognised: caseHits.filter((x) => x.recognised).length, missed: caseHits.filter((x) => !x.recognised).map((x) => x.id) },
  legitimate: { total: boardChecks.length, wrongly_flagged: legitFlagged, sources: "Public Greenhouse, Lever and Ashby boards of established employers, checked by the agent" },
  detail: { scams: scamHits, cases: caseHits },
};
writeFileSync(new URL("data/benchmark/results.json", root), JSON.stringify(results, null, 2) + "\n");
console.log(`scam messages flagged ${results.scams.flagged}/${results.scams.total}; cases recognised ${results.cases.recognised}/${results.cases.total}; legitimate postings wrongly flagged ${results.legitimate.wrongly_flagged}/${results.legitimate.total}`);
if (results.scams.missed.length) console.log("missed scams:", results.scams.missed.join(", "));
if (results.cases.missed.length) console.log("unrecognised cases:", results.cases.missed.join(", "));
