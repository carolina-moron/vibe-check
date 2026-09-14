import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeDomain, detectContent, checkEmail, domainAgeSignals, matchReports, assess, assessPerson } from "../src/engine.js";

const signals = JSON.parse(readFileSync(new URL("../data/signals.json", import.meta.url)));
const reports = JSON.parse(readFileSync(new URL("../data/reports.json", import.meta.url)));
const now = new Date("2026-09-14T00:00:00Z");
const ids = (hits) => hits.map((h) => h.id).sort();

test("every detectable id exists in signals.json", () => {
  const known = new Set(signals.signals.map((s) => s.id));
  const text = "Pay the visa fee. Send your passport. Telegram only. Within 24 hours. Free flight and accommodation provided. Location will be disclosed on arrival. Cambodia. Hostess. Forward payments. No experience needed, $600 per day.";
  for (const h of detectContent(text)) assert.ok(known.has(h.id), h.id);
});

test("normalizeDomain", () => {
  assert.equal(normalizeDomain("https://www.Acme.com/careers?x=1"), "acme.com");
  assert.equal(normalizeDomain("hr@jobs.acme.co.uk"), "jobs.acme.co.uk");
  assert.equal(normalizeDomain("not a domain"), "");
});

test("trafficking-style overseas offer", () => {
  const text = "URGENT hiring customer service in Sihanoukville. Free flight and accommodation provided. No experience needed, $3000 per week. Contact us on Telegram. Pay the visa processing fee within 48 hours.";
  assert.deepEqual(ids(detectContent(text)), ["chat_only_contact", "employer_housing_travel", "high_risk_region", "no_experience_high_pay", "pay_too_high", "upfront_fee", "urgency"]);
});

test("pay with thousands separators", () => {
  assert.deepEqual(ids(detectContent("Earn $3,000 per week")), ["pay_too_high"]);
  assert.deepEqual(detectContent("Earn $1,200 per week"), []);
});

test("ordinary posting has no content flags", () => {
  const text = "Software engineer, Brooklyn office. Salary $120,000–$150,000 per year. Three interview rounds with the team. Apply through our careers page.";
  assert.deepEqual(detectContent(text), []);
});

test("email checks", () => {
  assert.deepEqual(ids(checkEmail("recruit@gmail.com", "acme.com")), ["free_email"]);
  assert.deepEqual(ids(checkEmail("hr@acme-careers.net", "acme.com")), ["email_domain_mismatch"]);
  assert.deepEqual(checkEmail("hr@jobs.acme.com", "acme.com"), []);
});

test("domain age tiers", () => {
  assert.deepEqual(ids(domainAgeSignals({ created: "2026-07-01T00:00:00Z" }, now)), ["domain_new"]);
  assert.deepEqual(ids(domainAgeSignals({ created: "2025-06-01T00:00:00Z" }, now)), ["domain_young"]);
  assert.deepEqual(domainAgeSignals({ created: "2010-01-01T00:00:00Z" }, now), []);
  assert.deepEqual(ids(domainAgeSignals({ error: "x" }, now)), ["domain_unresolved"]);
});

test("report matching via old name and domain", () => {
  assert.equal(matchReports({ name: "Northstar Overseas Recruitment" }, reports)[0].entity.id, "demo-001");
  assert.equal(matchReports({ name: "", domains: ["jobs.meridian-assist.example"] }, reports)[0].entity.id, "demo-002");
  assert.equal(matchReports({ name: "Acme" }, reports).length, 0);
});

test("person lookup is never scored and needs a full name", async () => {
  const fetchFn = async (url) => ({ ok: true, json: async () => (url.includes("fbi.gov")
    ? { total: 1, items: [{ title: "JANE DOE", url: "https://www.fbi.gov/x", images: [{ thumb: "t" }] }] }
    : { count: 0, results: [] }) });
  const p = await assessPerson("Jane Doe", fetchFn);
  assert.equal(p.fbi.items[0].title, "JANE DOE");
  assert.equal(p.courts.total, 0);
  assert.equal("points" in p, false);
  assert.ok((await assessPerson("Jane", fetchFn)).error);
});

test("assess end to end with mocked RDAP", async () => {
  const fetchFn = async (url) => ({ ok: true, json: async () => (url.includes("rdap")
    ? { events: [{ eventAction: "registration", eventDate: "2026-08-01T00:00:00Z" }] }
    : { count: 0, results: [] }) });
  const r = await assess(
    { company: "BrightPath Talent", website: "brightpath-talent.example", email: "hiring@gmail.com", posting: "Send your passport before the interview." },
    { signals, reports, fetchFn, now },
  );
  assert.equal(r.tier.id, "high");
  assert.deepEqual(r.flags.map((f) => f.id).sort(), ["domain_new", "free_email", "id_before_interview", "name_change_lineage", "reported_local"]);
});
