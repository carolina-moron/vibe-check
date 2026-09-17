import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.VIBECHECK_AGENT_DIR = mkdtempSync(join(tmpdir(), "vibecheck-agent-"));
// Imported after the env is set (static imports are hoisted and would load the real store).
const { checkItem, toRecord, draftReports, intake } = await import("../scripts/agent.mjs");
import assert from "node:assert/strict";

const quiet = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });

test("agent checks a submitted posting offline and drafts reports without accusing", async () => {
  const item = { from: "submission", company: "Global Talent Bridge Ltd", email: "hr.globaltalent@gmail.com",
    text: "Urgent hiring! No experience required, $4,500 per week. Flights and accommodation provided by the employer. Send passport copy. Telegram only." };
  const checked = await checkItem(item, { fetchFn: quiet, dry: true });
  const rec = toRecord(item, checked);
  assert.ok(rec.score >= 45, `expected a serious score, got ${rec.score}`);
  assert.equal(rec.status, "pending");
  assert.ok(rec.flags.some((f) => f.id === "employer_housing_travel"));
  const d = draftReports(rec);
  assert.match(d.company, /not saying it is a scam/);
  assert.match(d.platform, /not a finding/);
  assert.ok(!/is a scam\b/.test(d.company.replace("not saying it is a scam", "")));
});

test("agent lists postings from a public ATS board and keeps submissions", async () => {
  const fetchFn = async (url) => ({ ok: true, json: async () => (url.includes("greenhouse") ? { jobs: [{ absolute_url: "https://boards.greenhouse.io/acme/jobs/1" }] } : {}) });
  const items = await intake({ sources: [{ ats: "greenhouse", board: "acme" }], submissions: [{ text: "hi" }], fetchFn });
  assert.equal(items.length, 2);
  assert.equal(items[0].url, "https://boards.greenhouse.io/acme/jobs/1");
});

test("skills API: check, review, refuses to send unapproved, stats", async () => {
  const { handle } = await import("../scripts/agent-server.mjs");
  const { record, card } = await handle("POST", "/check", { text: "No experience required, $4,500 per week. Flights and accommodation provided by the employer. Send passport copy.", company: "Test Co", dry: true, source: "test" });
  assert.ok(record.score >= 45);
  assert.equal(card.actions.length, 2);
  await assert.rejects(handle("POST", `/send/${record.id}`), /only approved/);
  const r = await handle("POST", `/review/${record.id}`, { decision: "dismissed", reviewer: "test" });
  assert.equal(r.record.status, "dismissed");
  await handle("POST", "/event", { kind: "job", tier: "high", flags: 4 });
  const pub = await handle("GET", "/public-stats"); assert.ok(pub.checks_run >= 2 && pub.postings_checked >= 1 && pub.warning_signs_found >= 4);
  const s = await handle("GET", "/stats");
  assert.ok(s.reviewed >= 1);
  assert.throws(() => handle("GET", "/nope"), /not found/);
});

test("catch-a-scam skills: text signs, sanctions match, explain for an audience", async () => {
  const { handle } = await import("../scripts/agent-server.mjs");
  const t = await handle("POST", "/text-signs", { text: "Pay $500 or I will send your photos to your family. Gift cards only." });
  assert.ok(t.signs.some((x) => x.id === "sextortion") && t.signs.some((x) => x.id === "gift_card_crypto"));
  const sm = await handle("POST", "/sanctions-match", { name: "Prince Holding Group" });
  assert.equal(sm.verdict, "hit");
  const { record } = await handle("POST", "/check", { text: "Urgent hiring! $4,500 per week, flights and accommodation provided by the employer. Send passport copy.", company: "Test Co", dry: true, queue: false });
  const ex = await handle("POST", "/explain", { record, audience: "older" });
  assert.match(ex.text, /Stop|Slow down/); assert.equal(ex.audience, "older");
  assert.equal((await handle("GET", "/audiences")).audiences.length, 4);
});

test("health endpoint and event rate limit", async () => {
  const { handle, allowEvent } = await import("../scripts/agent-server.mjs");
  const h = await handle("GET", "/health"); assert.equal(h.ok, true); assert.ok(h.ofac > 500);
  for (let i = 0; i < 60; i++) assert.ok(allowEvent("k1", 1000));
  assert.equal(allowEvent("k1", 1000), false);
  assert.ok(allowEvent("k1", 70000));
});
