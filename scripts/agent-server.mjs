// HTTP skills for the VibeCheck agent, so a Copilot Studio agent (or an Azure Function host)
// can call the same pipeline as scripts/agent.mjs. One route per skill; see docs/agent-openapi.yaml.
// Run: AGENT_TOKEN=secret node scripts/agent-server.mjs   (port 8787)
// Nothing here sends a report: send_report only works on items a person has approved.
import { createServer } from "node:http";
import { checkItem, toRecord, draftReports, send, recordOutcome, stats } from "./agent.mjs";
import { getStore } from "./store.mjs";
import { readFileSync, existsSync } from "node:fs";
import { checkOfac, checkUrlscan, normalizeDomain, detectContent } from "../src/engine.js";

const ROOT = new URL("../", import.meta.url);
const ofac = existsSync(new URL("data/ofac.json", ROOT)) ? JSON.parse(readFileSync(new URL("data/ofac.json", ROOT), "utf8")) : null;
const audiences = JSON.parse(readFileSync(new URL("data/audiences.json", ROOT), "utf8")).audiences;
const signalsDoc = JSON.parse(readFileSync(new URL("data/signals.json", ROOT), "utf8"));
const label = Object.fromEntries(signalsDoc.signals.map((x) => [x.id, x]));

// Plain-language explanation of a check for a given audience: short sentences, the top three signs, one action, who to call.
export function explainFor(rec, audienceId = "families") {
  const a = audiences.find((x) => x.id === audienceId) || audiences[2];
  const top = (rec.flags || []).slice(0, 3).map((f) => label[f.id]?.label || f.label || f.id);
  const verdict = rec.tier === "high" ? "Stop. This looks like the way scams and trafficking start." : rec.tier === "caution" ? "Slow down. There are warning signs here." : rec.tier === "low" ? "We found few warning signs." : "We could not confirm this is safe.";
  const lines = [verdict, top.length ? `What we noticed: ${top.join("; ")}.` : "", `What to do: ${a.do[0]}`, `Who to call: ${a.help[0].label}.`].filter(Boolean);
  return { audience: a.id, title: a.title, text: lines.join(" "), reading: a.reading };
}

const token = process.env.AGENT_TOKEN;
const readQueue = async () => (await getStore()).list();
const getRec = async (id) => (await getStore()).get(id);
const putRec = async (rec) => (await getStore()).put(rec);
// Routes a browser may call without the token: anonymous usage events and public counters.
export const PUBLIC = new Set(["POST /event", "GET /public-stats", "GET /health"]);
// Rate limit for the anonymous event endpoint: per caller key (IP from the host), 60 events a minute.
const buckets = new Map();
export function allowEvent(key, now = Date.now()) {
  const b = buckets.get(key) || { n: 0, t: now };
  if (now - b.t > 60000) { b.n = 0; b.t = now; }
  b.n++; buckets.set(key, b);
  return b.n <= 60;
}

// Adaptive Card for a Teams review channel: the evidence, and Approve / Dismiss buttons.
export const reviewCard = (rec) => ({
  type: "AdaptiveCard", version: "1.5", $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
  body: [
    { type: "TextBlock", size: "Large", weight: "Bolder", text: `VibeCheck: ${rec.score}/100, ${rec.tier_label}` },
    { type: "TextBlock", text: `${rec.company || "No employer named"}${rec.url ? ` · ${rec.url}` : ""}`, wrap: true },
    { type: "FactSet", facts: rec.flags.slice(0, 8).map((f) => ({ title: f.label, value: f.evidence || "" })) },
    { type: "TextBlock", text: "Warning signs from an automated check, not a finding. Approve to release drafted reports for sending.", wrap: true, isSubtle: true, size: "Small" },
  ],
  actions: [
    { type: "Action.Http", title: "Approve", method: "POST", url: `{{baseUrl}}/review/${rec.id}`, body: JSON.stringify({ decision: "approved" }) },
    { type: "Action.Http", title: "Dismiss", method: "POST", url: `{{baseUrl}}/review/${rec.id}`, body: JSON.stringify({ decision: "dismissed" }) },
  ],
});

const routes = {
  "POST /check": async (body) => {
    const item = { from: body.source || "api", url: body.url, company: body.company, text: body.text, email: body.email, website: body.website, jurisdiction: body.jurisdiction };
    const rec = toRecord(item, await checkItem(item, { dry: !!body.dry }));
    rec.drafts = draftReports(rec);
    await (await getStore()).event({ type: "check", source: "agent", kind: "job", tier: rec.tier, flags: rec.flags.length, signs: rec.flags.map((f) => f.id), at: new Date().toISOString() });
    if (body.queue !== false && rec.score >= 20) await putRec(rec);
    return { record: rec, card: reviewCard(rec) };
  },
  "GET /queue": async () => ({ items: (await readQueue()).map(({ drafts, text_redacted, ...r }) => r) }),
  "GET /queue/:id": async (_, id) => { const rec = await getRec(id); return { record: rec, card: reviewCard(rec) }; },
  "POST /review/:id": async (body, id) => {
    if (!["approved", "dismissed"].includes(body.decision)) throw Object.assign(new Error("decision must be approved or dismissed"), { status: 400 });
    const rec = await getRec(id); rec.status = body.decision; rec.reviewed_at = new Date().toISOString(); rec.reviewer = body.reviewer || null; await putRec(rec);
    return { record: rec };
  },
  "POST /send/:id": async (_, id) => ({ record: await send(id) }),
  "POST /outcome/:id": async (body, id) => ({ record: await recordOutcome(id, body.outcome) }),
  "GET /stats": async () => { const st = await getStore(); return stats(await st.list(), await st.events()); },
  // Catch-a-scam skills: quick single-purpose checks a Copilot agent can call mid-conversation.
  "POST /scan-url": async (body) => {
    const domain = normalizeDomain(body.url || body.domain || "");
    if (!domain) throw Object.assign(new Error("url or domain required"), { status: 400 });
    const r = await checkUrlscan(domain);
    return { domain, verdict: r.verdict, detail: r.detail, flagged: r.verdict === "hit", scans: r.records };
  },
  "POST /sanctions-match": async (body) => {
    if (!body.name) throw Object.assign(new Error("name required"), { status: 400 });
    const r = checkOfac(body.name, ofac);
    return { name: body.name, verdict: r.verdict, detail: r.detail, matches: r.records || [], source: ofac?.source };
  },
  "POST /text-signs": async (body) => {
    const hits = detectContent(String(body.text || ""));
    return { count: hits.length, signs: hits.map((h) => ({ id: h.id, label: label[h.id]?.label || h.id, weight: label[h.id]?.weight || 0, evidence: h.evidence })) };
  },
  "POST /explain": async (body) => {
    const rec = body.record || (body.id ? await getRec(body.id) : null);
    if (!rec) throw Object.assign(new Error("record or id required"), { status: 400 });
    return explainFor(rec, body.audience);
  },
  "GET /audiences": async () => ({ audiences: audiences.map(({ id, title, who }) => ({ id, title, who })) }),
  // The site sends one event per check: kind, tier and how many warning signs. Nothing else is accepted.
  "POST /event": async (body, _id, ctx = {}) => {
    if (!allowEvent(ctx.ip || "anon")) throw Object.assign(new Error("too many events"), { status: 429 });
    const tier = ["low", "unverified", "caution", "high"].includes(body.tier) ? body.tier : "unknown";
    const kind = String(body.kind || "other").slice(0, 20).replace(/[^a-z_-]/g, "");
    const signs = Array.isArray(body.signs) ? body.signs.filter((x) => typeof x === "string" && /^[a-z_]{3,40}$/.test(x)).slice(0, 30) : [];
    await (await getStore()).event({ type: "check", kind, tier, flags: Math.max(0, Math.min(60, Number(body.flags) || 0)), signs, at: new Date().toISOString() });
    return { ok: true };
  },
  "GET /health": async () => ({ ok: true, store: (await getStore()).kind, ofac: ofac?.count || 0, signals: signalsDoc.signals.length, time: new Date().toISOString() }),
  "GET /public-stats": async () => { const st = await getStore(); const { noisy, precision, ...pub } = stats(await st.list(), await st.events()); return { generated: new Date().toISOString(), ...pub }; },
};

export function handle(method, path, body, ctx = {}) {
  for (const [key, fn] of Object.entries(routes)) {
    const [m, pattern] = key.split(" ");
    const re = new RegExp("^" + pattern.replace(":id", "([a-f0-9]{12})") + "$");
    const mt = method === m && path.match(re);
    if (mt) return fn(body || {}, mt[1], ctx);
  }
  throw Object.assign(new Error("not found"), { status: 404 });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  createServer(async (req, res) => {
    const reply = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    const path0 = req.url.split("?")[0];
    if (token && !PUBLIC.has(`${req.method} ${path0}`) && req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: "unauthorised" });
    let raw = ""; for await (const c of req) raw += c;
    try { reply(200, await handle(req.method, path0, raw ? JSON.parse(raw) : {}, { ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress })); }
    catch (e) { reply(e.status || 500, { error: e.message }); }
  }).listen(Number(process.env.PORT) || 8787, () => console.log("agent skills on :" + (process.env.PORT || 8787)));
}
