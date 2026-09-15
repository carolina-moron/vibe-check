// HTTP skills for the VibeCheck agent, so a Copilot Studio agent (or an Azure Function host)
// can call the same pipeline as scripts/agent.mjs. One route per skill; see docs/agent-openapi.yaml.
// Run: AGENT_TOKEN=secret node scripts/agent-server.mjs   (port 8787)
// Nothing here sends a report: send_report only works on items a person has approved.
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { checkItem, toRecord, draftReports, send, recordOutcome, stats } from "./agent.mjs";
import { writeFileSync } from "node:fs";

const QUEUE = new URL("../data/agent/queue/", import.meta.url);
const token = process.env.AGENT_TOKEN;
const readQueue = () => readdirSync(QUEUE).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(new URL(f, QUEUE), "utf8")));
const getRec = (id) => JSON.parse(readFileSync(new URL(`${id}.json`, QUEUE), "utf8"));
const putRec = (rec) => writeFileSync(new URL(`${rec.id}.json`, QUEUE), JSON.stringify(rec, null, 2) + "\n");

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
    if (body.queue !== false && rec.score >= 20) putRec(rec);
    return { record: rec, card: reviewCard(rec) };
  },
  "GET /queue": async () => ({ items: readQueue().map(({ drafts, text_redacted, ...r }) => r) }),
  "GET /queue/:id": async (_, id) => ({ record: getRec(id), card: reviewCard(getRec(id)) }),
  "POST /review/:id": async (body, id) => {
    if (!["approved", "dismissed"].includes(body.decision)) throw Object.assign(new Error("decision must be approved or dismissed"), { status: 400 });
    const rec = getRec(id); rec.status = body.decision; rec.reviewed_at = new Date().toISOString(); rec.reviewer = body.reviewer || null; putRec(rec);
    return { record: rec };
  },
  "POST /send/:id": async (_, id) => ({ record: await send(id) }),
  "POST /outcome/:id": async (body, id) => ({ record: recordOutcome(id, body.outcome) }),
  "GET /stats": async () => stats(readQueue()),
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
    if (token && req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: "unauthorised" });
    let raw = ""; for await (const c of req) raw += c;
    try { reply(200, await handle(req.method, req.url.split("?")[0], raw ? JSON.parse(raw) : {})); }
    catch (e) { reply(e.status || 500, { error: e.message }); }
  }).listen(Number(process.env.PORT) || 8787, () => console.log("agent skills on :" + (process.env.PORT || 8787)));
}
