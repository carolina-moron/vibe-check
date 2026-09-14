import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeDomain, detectContent, checkEmail, checkRdap, checkGleif, checkCatalog, matchCatalog,
  coverage, assess, caseEvidence, redact, buildReport, dHash, hammingHex,
} from "../src/engine.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const signals = load("../data/signals.json");
const registers = load("../data/registers.json");
const now = new Date("2026-09-14T00:00:00Z");
const ids = (hits) => hits.map((h) => h.id).sort();

const CASES = [{
  id: "t", title: "Test case", entities: [
    { name: "Brightpath Global Staffing LLC", jurisdiction: "US", names: [{ name: "Northstar Overseas Recruitment", type: "former" }], actions: [{ url: "https://x" }] },
  ], lures: [{ signal: "upfront_fee" }, { signal: "document_retention" }],
}];

// A fetch stub routed by URL substring.
const stub = (routes) => async (url) => {
  const key = Object.keys(routes).find((k) => url.includes(k));
  if (!key) return { ok: false, status: 404, json: async () => ({}) };
  const v = routes[key];
  return v instanceof Error ? Promise.reject(v) : { ok: true, status: 200, json: async () => v };
};

test("every registered signal id used by rules or cases exists", () => {
  const known = new Set(signals.signals.map((s) => s.id));
  const text = "Pay the visa fee. Send your passport. We keep your passport. Deducted from your wages. Tourist visa for work. Telegram only. Within 24 hours. Free flight provided. Location will be disclosed on arrival. Cambodia. Hostess. Forward payments. No experience needed, $600 per day.";
  const found = detectContent(text);
  assert.ok(found.length >= 12);
  for (const h of found) assert.ok(known.has(h.id), h.id);
  const cases = load("../data/cases/index.json").cases;
  for (const c of cases) for (const l of c.lures || []) assert.ok(known.has(l.signal), `${c.id}: ${l.signal}`);
});

test("normalizeDomain", () => {
  assert.equal(normalizeDomain("https://www.Acme.com/careers?x=1"), "acme.com");
  assert.equal(normalizeDomain("hr@jobs.acme.co.uk"), "jobs.acme.co.uk");
  assert.equal(normalizeDomain("not a domain"), "");
});

test("scam-compound style offer", () => {
  const text = "URGENT hiring customer service in Sihanoukville. Free flight and accommodation provided. No experience needed, $3,000 per week. Contact us on Telegram. Pay the visa processing fee within 48 hours.";
  assert.deepEqual(ids(detectContent(text)), ["chat_only_contact", "employer_housing_travel", "high_risk_region", "no_experience_high_pay", "pay_too_high", "upfront_fee", "urgency"]);
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

test("no check ever returns 'clear'; silence adds nothing", async () => {
  const fetchFn = stub({ "rdap.org": { events: [{ eventAction: "registration", eventDate: "2001-01-01T00:00:00Z" }] }, "api.gleif.org": { data: [] } });
  const r1 = await checkRdap("old.com", { fetchFn, now });
  const r2 = await checkGleif("Nobody Ltd", { fetchFn, now });
  for (const r of [r1, r2]) {
    assert.equal(r.verdict, "no-evidence-found");
    assert.deepEqual(r.hits, []);
  }
});

test("RDAP: new domain is a hit, missing domain is an error not a clearance", async () => {
  const hit = await checkRdap("new.com", { fetchFn: stub({ "rdap.org": { events: [{ eventAction: "registration", eventDate: "2026-08-01T00:00:00Z" }] } }), now });
  assert.deepEqual(ids(hit.hits), ["domain_new"]);
  const missing = await checkRdap("nope.example", { fetchFn: stub({}), now });
  assert.equal(missing.verdict, "error");
});

test("GLEIF surfaces previous legal names", async () => {
  const fetchFn = stub({ "api.gleif.org": { data: [{ id: "LEI1", attributes: { entity: {
    legalName: { name: "New Name Holdings Ltd" }, status: "ACTIVE", jurisdiction: "GB", creationDate: "2020-01-01",
    otherNames: [{ name: "Old Name Ltd", type: "PREVIOUS_LEGAL_NAME" }] } } }] } });
  const r = await checkGleif("Old Name Ltd", { fetchFn, now });
  assert.equal(r.verdict, "hit");
  assert.deepEqual(ids(r.hits), ["gleif_name_history"]);
});

test("catalog matches through a former name", () => {
  const r = checkCatalog("Northstar Overseas Recruitment", CASES);
  assert.deepEqual(ids(r.hits), ["name_change_lineage", "reported_local"]);
  assert.equal(matchCatalog({ name: "Acme" }, CASES).length, 0);
});

test("coverage is separate from score", () => {
  assert.equal(coverage(["GB", "US"], registers).class, "well");
  assert.equal(coverage(["MM"], registers).class, "uncovered");
  assert.equal(coverage(["BR"], registers).class, "partial");
});

test("case evidence is scored from lures and actions", () => {
  const s = caseEvidence(CASES[0], signals);
  assert.deepEqual(s.flags.map((f) => f.id).sort(), ["document_retention", "name_change_lineage", "reported_local", "upfront_fee"]);
});

test("assess end to end with every network call stubbed", async () => {
  const fetchFn = stub({
    "rdap.org": { events: [{ eventAction: "registration", eventDate: "2026-08-01T00:00:00Z" }] },
    "crt.sh": [{ not_before: "2026-08-02T00:00:00" }],
    "archive.org": { archived_snapshots: {} },
    "tranco-list.eu": { ranks: [] },
    "api.gleif.org": { data: [] },
    "data.ny.gov": [], "data.colorado.gov": [],
    "courtlistener.com": { count: 0, results: [] },
  });
  const r = await assess(
    { company: "Northstar Overseas Recruitment", website: "northstar-jobs.example", email: "hr@gmail.com", posting: "Send your passport scan before the interview.", jurisdiction: "US" },
    { signals, registers, cases: CASES, fetchFn, now },
  );
  assert.equal(r.tier.id, "high");
  assert.deepEqual(r.flags.map((f) => f.id).sort(), ["cert_new", "domain_new", "free_email", "id_before_interview", "name_change_lineage", "no_archive", "reported_local"]);
  assert.ok(r.checks.every((c) => ["hit", "no-evidence-found", "not-searched", "error"].includes(c.verdict)));
  assert.ok(!r.checks.some((c) => c.register === "fbi-wanted"), "no person checks");
});

test("redaction strips reporter identifiers", () => {
  const { text, counts } = redact("My name is Ana Souza, email ana.s@example.com, phone +1 (212) 555-0199, passport AB1234567, @ana_insta. They paid $300.");
  assert.ok(!/Ana|ana\.s@|555-0199|AB1234567|@ana_insta/.test(text), text);
  assert.ok(text.includes("$300"));
  assert.deepEqual(Object.keys(counts).sort(), ["email", "handle", "name", "passport-or-id-number", "phone"]);
});

test("report contains no reporter identity fields", () => {
  const r = buildReport({ company: "X Ltd", recruiterEmail: "boss@x-jobs.example", narrative: "call me at 212 555 0199", consent: "on", signals: ["upfront_fee"] }, now);
  assert.equal(r.recruiter_email_domain, "x-jobs.example");
  assert.equal(r.submitted_month, "2026-09");
  assert.ok(!JSON.stringify(r).includes("555"));
  for (const k of ["name", "email", "phone", "ip"]) assert.equal(k in r, false);
});

test("dHash matches near-identical images and separates different ones", () => {
  const a = Array.from({ length: 72 }, (_, i) => (i * 37) % 256);
  const b = a.map((v) => Math.min(255, v + 2));
  const c = Array.from({ length: 72 }, (_, i) => (i * 91 + 13) % 256);
  assert.ok(hammingHex(dHash(a), dHash(b)) <= 4);
  assert.ok(hammingHex(dHash(a), dHash(c)) > 10);
});

test("FLSRI priors: origin and destination roles, never scored", async () => {
  const { flsriRoute, flsriCountry } = await import("../src/engine.js");
  const flsri = load("../data/flsri.json");
  const c = { journey: [
    { stage: "recruited", country: "UG" }, { stage: "exploited", country: "RU" }, { stage: "prosecuted", country: "US" },
  ], victim_origins: ["KE"] };
  const r = flsriRoute(c, flsri);
  assert.deepEqual(r.rows.map((x) => [x.iso2, x.roles.join()]), [["UG", "origin"], ["RU", "destination"], ["KE", "victim origin"]]);
  assert.equal(r.destinationUnderRead, true, "higher-risk origin feeding a lower-scored destination is flagged");
  assert.equal(flsriCountry("ZZ", flsri).available, false);
  assert.equal(caseEvidence({ lures: [], entities: [], journey: c.journey }, signals).points, 0);
  for (const x of Object.values(flsri.countries)) if (x.scored) assert.ok(x.composite >= 0 && x.composite <= 1 && ["lower", "middle", "higher"].includes(x.tier));
});

test("social, travel and housing warning signs", () => {
  const t = (text) => detectContent(text).map((h) => h.id).sort();
  assert.ok(t("My camera is broken. Try this crypto trading platform with daily profits.").includes("investment_pitch"));
  assert.ok(t("My camera is broken so no video.").includes("refuses_video"));
  assert.ok(t("Please send the verification code you received.").includes("verification_code"));
  assert.ok(t("I'll pay for your flight, and can you bring a package for my friend?").includes("carry_package"));
  assert.ok(t("Pay the deposit before viewing to reserve it. I'm currently abroad.").includes("housing_unseen_deposit"));
  assert.deepEqual(t("We invest in our employees' training and growth."), []);
  const labels = signals.tiers.map((x) => x.label);
  assert.deepEqual(labels, ["Lower concern", "Caution", "Serious warning signs"]);
});

test("situation-level signals and considerations", async () => {
  const { considerations, score } = await import("../src/engine.js");
  const t = (text) => detectContent(text).map((h) => h.id);
  assert.ok(t("Your family won't understand us. Don't tell your parents.").includes("isolation"));
  assert.ok(t("If you don't pay I'll share your photos with your family.").includes("threats_coercion"));
  assert.ok(t("Come alone, my driver will pick you up at the airport.").includes("meet_private"));
  assert.ok(t("Click bit.ly/3xYz to claim").includes("link_shortener"));
  for (const s of signals.signals) assert.ok(signals.dimensions[s.dimension], `${s.id} has a known dimension`);
  const flags = score([{ id: "secrecy" }, { id: "sponsor_travel_stranger" }, { id: "profile_mismatch" }], signals).flags;
  const c = considerations(flags, signals);
  assert.deepEqual(c.map((x) => x.id).sort(), ["identity", "isolation", "travel"]);
  assert.ok(c.every((x) => x.consider && x.step));
});

test("job posting URLs: ATS parsing, reading, free hosts", async () => {
  const { parsePostingUrl, fetchPosting, checkPostingHost } = await import("../src/engine.js");
  assert.deepEqual((({ ats, board, id }) => ({ ats, board, id }))(parsePostingUrl("https://job-boards.greenhouse.io/acme/jobs/123")), { ats: "greenhouse", board: "acme", id: "123" });
  assert.equal(parsePostingUrl("jobs.lever.co/acme/ab-12").ats, "lever");
  assert.equal(parsePostingUrl("https://jobs.ashbyhq.com/acme/uuid-1").ats, "ashby");
  assert.equal(parsePostingUrl("https://example.com/careers/1").ats, null);
  const gh = await fetchPosting(parsePostingUrl("https://boards.greenhouse.io/acme/jobs/9"), stub({ "boards-api.greenhouse.io": { title: "Driver", company_name: "Acme", location: { name: "Dubai" }, content: "&lt;p&gt;Pay the visa fee&lt;/p&gt;", absolute_url: "https://x" } }));
  assert.equal(gh.title, "Driver");
  assert.equal(gh.text, "Pay the visa fee");
  assert.deepEqual(checkPostingHost(parsePostingUrl("https://hiring-now.wixsite.com/jobs")).map((h) => h.id), ["posting_free_host"]);
  assert.deepEqual(checkPostingHost(parsePostingUrl("https://jobs.lever.co/acme/1")), []);
});
