import { test } from "node:test";
import assert from "node:assert/strict";
import { checkItem, toRecord, draftReports, intake } from "../scripts/agent.mjs";

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
  const pub = await handle("GET", "/public-stats"); assert.ok(pub.checks_run >= 2 && pub.warning_signs_found >= 4);
  const s = await handle("GET", "/stats");
  assert.ok(s.reviewed >= 1);
  assert.throws(() => handle("GET", "/nope"), /not found/);
});
