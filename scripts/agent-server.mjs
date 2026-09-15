// HTTP skills for the VibeCheck agent, so a Copilot Studio agent (or an Azure Function host)
// can call the same pipeline as scripts/agent.mjs. One route per skill; see docs/agent-openapi.yaml.
// Run: AGENT_TOKEN=secret node scripts/agent-server.mjs   (port 8787)
// Nothing here sends a report: send_report only works on items a person has approved.
import { createServer } from "node:http";
import { checkItem, toRecord, draftReports, send, recordOutcome, stats } from "./agent.mjs";
import { getStore } from "./store.mjs";

const token = process.env.AGENT_TOKEN;
const readQueue = async () => (await getStore()).list();
const getRec = async (id) => (await getStore()).get(id);
const putRec = async (rec) => (await getStore()).put(rec);
// Routes a browser may call without the token: anonymous usage events and public counters.
export const PUBLIC = new Set(["POST /event", "GET /public-stats"]);

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
    await (await getStore()).event({ type: "check", source: "agent", kind: "job", tier: rec.tier, flags: rec.flags.length, at: new Date().toISOString() });
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
  // The site sends one event per check: kind, tier and how many warning signs. Nothing else is accepted.
  "POST /event": async (body) => {
    const tier = ["low", "unverified", "caution", "high"].includes(body.tier) ? body.tier : "unknown";
    const kind = String(body.kind || "other").slice(0, 20).replace(/[^a-z_-]/g, "");
    await (await getStore()).event({ type: "check", kind, tier, flags: Math.max(0, Math.min(60, Number(body.flags) || 0)), at: new Date().toISOString() });
    return { ok: true };
  },
  "GET /public-stats": async () => { const st = await getStore(); const { noisy, precision, ...pub } = stats(await st.list(), await st.events()); return { generated: new Date().toISOString(), ...pub }; },
};

export function handle(method, path, body) {
  for (const [key, fn] of Object.entries(routes)) {
    const [m, pattern] = key.split(" ");
    const re = new RegExp("^" + pattern.replace(":id", "([a-f0-9]{12})") + "$");
    const mt = method === m && path.match(re);
    if (mt) return fn(body || {}, mt[1]);
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
    try { reply(200, await handle(req.method, req.url.split("?")[0], raw ? JSON.parse(raw) : {})); }
    catch (e) { reply(e.status || 500, { error: e.message }); }
  }).listen(Number(process.env.PORT) || 8787, () => console.log("agent skills on :" + (process.env.PORT || 8787)));
}
