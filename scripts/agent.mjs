// VibeCheck agent: pulls job postings from sources that allow it, runs the same check as the
// site, stores anonymised results, and drafts reports for a person to review and send.
// It never scrapes platforms that forbid it, and it never sends anything by itself.
//
// Run:  node scripts/agent.mjs run            fetch, check, queue (writes data/agent/queue/)
//       node scripts/agent.mjs run --dry      same, but skip network register lookups
//       node scripts/agent.mjs review         list the queue
//       node scripts/agent.mjs approve <id>   mark a queued item approved (reports become sendable)
//       node scripts/agent.mjs dismiss <id>   mark it dismissed (feeds back as a false positive)
//       node scripts/agent.mjs send <id>      send an approved item's drafts (SMTP if configured, else outbox/)
//       node scripts/agent.mjs outcome <id> <removed|confirmed|no-action>   what the platform or company did
//       node scripts/agent.mjs stats          precision so far, and which warning signs get dismissed
//
// Sources: data/agent/sources.json (ATS boards with public APIs) and data/agent/submissions.jsonl
// (postings people share with us, one JSON object per line: {url?, company?, text?, email?, website?}).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assess, parsePostingUrl, fetchPosting, redact } from "../src/engine.js";

const root = new URL("../", import.meta.url);
const load = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const signals = load("data/signals.json");
const registers = load("data/registers.json");
const cases = load("data/cases/index.json").cases || load("data/cases/index.json");
const QUEUE = new URL("data/agent/queue/", root);
const LOG = new URL("data/agent/outcomes.jsonl", root);
mkdirSync(QUEUE, { recursive: true });

// ---- 1. intake: only channels the platforms allow ------------------------------------------

async function listBoard(src, fetchFn) {
  const b = encodeURIComponent(src.board);
  if (src.ats === "greenhouse") {
    const j = await (await fetchFn(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs`)).json();
    return (j.jobs || []).map((x) => x.absolute_url);
  }
  if (src.ats === "lever") {
    const j = await (await fetchFn(`https://api.lever.co/v0/postings/${b}?mode=json`)).json();
    return (j || []).map((x) => x.hostedUrl);
  }
  if (src.ats === "ashby") {
    const j = await (await fetchFn(`https://api.ashbyhq.com/posting-api/job-board/${b}`)).json();
    return (j.jobs || []).map((x) => x.jobUrl);
  }
  throw new Error(`unknown ats ${src.ats}`);
}

export async function intake({ sources, submissions, fetchFn = fetch, limit = 25 }) {
  const items = [];
  for (const src of sources) {
    try {
      for (const url of (await listBoard(src, fetchFn)).slice(0, limit)) items.push({ from: `ats:${src.ats}/${src.board}`, url });
    } catch (e) { items.push({ from: `ats:${src.ats}/${src.board}`, error: e.message }); }
  }
  for (const s of submissions) items.push({ from: "submission", ...s });
  return items;
}

// ---- 2. check: the same engine the site uses ------------------------------------------------

export async function checkItem(item, { fetchFn = fetch, dry = false, now = new Date() } = {}) {
  let posting = null;
  const parsed = item.url ? parsePostingUrl(item.url) : null;
  if (parsed?.ats) { try { posting = await fetchPosting(parsed, fetchFn); } catch { posting = null; } }
  const input = {
    kind: "job",
    company: item.company || posting?.company || "",
    website: item.website || "",
    email: item.email || "",
    postingUrl: item.url || "",
    posting: [posting?.title, posting?.text, item.text].filter(Boolean).join("\n\n"),
    jurisdiction: item.jurisdiction || "",
  };
  // --dry answers every register with "not searched" so the text rules still run offline.
  const quiet = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
  const r = await assess(input, { signals, registers, cases, fetchFn: dry ? quiet : fetchFn, now });
  return { input, posting, result: r };
}

// ---- 3. store: anonymised record, stable id ------------------------------------------------

export function toRecord(item, { input, result }, now = new Date()) {
  const id = createHash("sha256").update(item.url || input.posting || JSON.stringify(item)).digest("hex").slice(0, 12);
  const red = redact(input.posting);
  return {
    id, checked_at: now.toISOString(), source: item.from,
    url: item.url || null, company: input.company || null, domain: result.input.domain || null,
    score: result.points, tier: result.tier.id, tier_label: result.tier.label,
    flags: result.flags.map((f) => ({ id: f.id, label: f.label, weight: f.weight, evidence: f.evidence })),
    verification: result.verification?.items?.map((i) => ({ id: i.id, passed: i.passed })) || [],
    coverage: result.coverage.class,
    text_redacted: red.text.slice(0, 4000), redactions: red.counts,
    status: "pending", // pending | approved | dismissed | sent
  };
}

// ---- 4. drafts: written by the agent, sent by a person -------------------------------------

const evidenceLines = (rec) => rec.flags.map((f) => `- ${f.label}${f.evidence ? ` (${f.evidence})` : ""}`).join("\n");

export function draftReports(rec) {
  const where = rec.url ? `Posting: ${rec.url}` : "Posting text attached (personal details removed).";
  const evidence = evidenceLines(rec) || "- (none recorded)";
  const caveat = "These are warning signs found by an automated check, not a finding. Please verify against your own records.";
  const platform = `Subject: Possible fraudulent job posting for your review

${where}
Claimed employer: ${rec.company || "not stated"}
Automated check: ${rec.score}/100, ${rec.tier_label}.

Warning signs found:
${evidence}

${caveat}`;
  const company = rec.company ? `Subject: A job posting appears to use ${rec.company}'s name

Hello,

We run VibeCheck, a free tool that checks job offers for signs of scams and trafficking. A posting that names ${rec.company} as the employer shows the warning signs below. We are not saying it is a scam; we are passing it on so your security team can confirm whether it is yours.

${where}

Warning signs found:
${evidence}

If it is not yours, you may want to ask the platform to remove it and warn applicants on your careers page.

${caveat}` : null;
  const ftc = `Report to reportfraud.ftc.gov (US) or ic3.gov. Category: job scam. ${where} Employer named: ${rec.company || "not stated"}. Summary of signs:\n${evidence}`;
  return { platform, company, ftc };
}

// ---- pipeline ------------------------------------------------------------------------------

export async function run({ sources, submissions, fetchFn = fetch, dry = false, now = new Date(), minScore = 20 }) {
  const items = await intake({ sources, submissions, fetchFn });
  const out = { checked: 0, queued: 0, errors: [] };
  for (const item of items) {
    if (item.error) { out.errors.push(item); continue; }
    const checked = await checkItem(item, { fetchFn, dry, now });
    out.checked++;
    const rec = toRecord(item, checked, now);
    if (rec.score < minScore) continue;
    rec.drafts = draftReports(rec);
    writeFileSync(new URL(`${rec.id}.json`, QUEUE), JSON.stringify(rec, null, 2) + "\n");
    out.queued++;
  }
  return out;
}

// ---- 5. send: only approved items, only where a person pressed approve -------------------
// With SMTP_URL and REPORT_TO set the drafts go by email; otherwise they land in data/agent/outbox/
// so the reviewer can paste them into the platform's own abuse form.
export async function send(id, { mailer = null } = {}) {
  const file = new URL(`${id}.json`, QUEUE);
  const rec = JSON.parse(readFileSync(file, "utf8"));
  if (rec.status !== "approved") throw new Error(`${id} is ${rec.status}; only approved items can be sent`);
  const body = [rec.drafts.platform, rec.drafts.company, rec.drafts.ftc].filter(Boolean).join("\n\n---\n\n");
  if (mailer) await mailer({ subject: `VibeCheck report ${id}`, body });
  else {
    const outbox = new URL("data/agent/outbox/", root); mkdirSync(outbox, { recursive: true });
    writeFileSync(new URL(`${id}.txt`, outbox), body + "\n");
  }
  rec.status = "sent"; rec.sent_at = new Date().toISOString();
  writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
  appendFileSync(LOG, JSON.stringify({ id, status: "sent", at: rec.sent_at }) + "\n");
  return rec;
}

// ---- 6. feedback: outcomes make the next run better ------------------------------------------
export function recordOutcome(id, outcome) {
  if (!["removed", "confirmed", "no-action"].includes(outcome)) throw new Error("outcome must be removed, confirmed or no-action");
  const file = new URL(`${id}.json`, QUEUE);
  const rec = JSON.parse(readFileSync(file, "utf8"));
  rec.outcome = outcome; rec.outcome_at = new Date().toISOString();
  writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
  appendFileSync(LOG, JSON.stringify({ id, status: "outcome", outcome, at: rec.outcome_at, flags: rec.flags.map((f) => f.id) }) + "\n");
  return rec;
}

export function stats(records) {
  const reviewed = records.filter((r) => ["approved", "dismissed", "sent"].includes(r.status));
  const approved = reviewed.filter((r) => r.status !== "dismissed");
  const confirmed = records.filter((r) => r.outcome === "removed" || r.outcome === "confirmed");
  const byFlag = {};
  for (const r of reviewed) for (const f of r.flags) {
    byFlag[f.id] ||= { label: f.label, seen: 0, dismissed: 0 };
    byFlag[f.id].seen++; if (r.status === "dismissed") byFlag[f.id].dismissed++;
  }
  const noisy = Object.entries(byFlag).filter(([, v]) => v.seen >= 3 && v.dismissed / v.seen > 0.5).map(([id, v]) => ({ id, ...v }));
  return { queued: records.length, reviewed: reviewed.length, approved: approved.length, dismissed: reviewed.length - approved.length,
    confirmed: confirmed.length, precision: reviewed.length ? approved.length / reviewed.length : null, noisy };
}

function readQueue() {
  return readdirSync(QUEUE).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(new URL(f, QUEUE), "utf8")));
}

function setStatus(id, status) {
  const file = new URL(`${id}.json`, QUEUE);
  if (!existsSync(file)) throw new Error(`no queued item ${id}`);
  const rec = JSON.parse(readFileSync(file, "utf8"));
  rec.status = status; rec.reviewed_at = new Date().toISOString();
  writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
  appendFileSync(LOG, JSON.stringify({ id, status, at: rec.reviewed_at, score: rec.score, flags: rec.flags.map((f) => f.id) }) + "\n");
  return rec;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [cmd, arg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dry = process.argv.includes("--dry");
  if (cmd === "run") {
    const sources = existsSync(new URL("data/agent/sources.json", root)) ? load("data/agent/sources.json").sources : [];
    const subFile = new URL("data/agent/submissions.jsonl", root);
    const submissions = existsSync(subFile) ? readFileSync(subFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    const r = await run({ sources, submissions, dry });
    console.log(`checked ${r.checked}, queued ${r.queued} for review${r.errors.length ? `, ${r.errors.length} source error(s)` : ""}`);
    for (const e of r.errors) console.log(`  ${e.from}: ${e.error}`);
  } else if (cmd === "review") {
    for (const r of readQueue()) console.log(`${r.id}  ${String(r.score).padStart(3)}/100  ${r.status.padEnd(9)}  ${r.company || "(no name)"}  ${r.url || ""}`);
  } else if (cmd === "approve" || cmd === "dismiss") {
    const r = setStatus(arg, cmd === "approve" ? "approved" : "dismissed");
    console.log(`${r.id} ${r.status}`);
    if (cmd === "approve") console.log("\nDrafts ready to send (copy into the platform form / email):\n\n" + [r.drafts.platform, r.drafts.company, r.drafts.ftc].filter(Boolean).join("\n\n---\n\n"));
  } else if (cmd === "send") {
    const r = await send(arg);
    console.log(`${r.id} sent (${process.env.SMTP_URL ? "email" : "written to data/agent/outbox/"})`);
  } else if (cmd === "outcome") {
    const r = recordOutcome(arg, process.argv.slice(2).filter((a) => !a.startsWith("--"))[2]);
    console.log(`${r.id} outcome: ${r.outcome}`);
  } else if (cmd === "stats") {
    const s = stats(readQueue());
    // The site reads data/agent/stats.json for its impact counters.
    writeFileSync(new URL("data/agent/stats.json", root), JSON.stringify({ generated: new Date().toISOString(), ...s, noisy: undefined }, null, 2) + "\n");
    console.log(`queued ${s.queued}, reviewed ${s.reviewed} (approved ${s.approved}, dismissed ${s.dismissed}), confirmed by platform/company ${s.confirmed}`);
    if (s.precision != null) console.log(`reviewer agreement with the agent: ${Math.round(s.precision * 100)}%`);
    for (const n of s.noisy) console.log(`  consider lowering: ${n.label} (dismissed ${n.dismissed}/${n.seen})`);
  } else {
    console.log("usage: node scripts/agent.mjs run [--dry] | review | approve <id> | dismiss <id> | send <id> | outcome <id> <removed|confirmed|no-action> | stats");
  }
}
