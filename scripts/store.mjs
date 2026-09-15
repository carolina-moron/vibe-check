// Storage for agent records and anonymous usage events.
// Azure Cosmos DB when COSMOS_ENDPOINT is set (managed identity or COSMOS_KEY); local JSON files otherwise.
// Both backends expose the same six calls, so scripts/agent.mjs and agent-server.mjs never know which one runs.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, appendFileSync } from "node:fs";

const root = new URL("../data/agent/", import.meta.url);

function fileStore() {
  const QUEUE = new URL("queue/", root); mkdirSync(QUEUE, { recursive: true });
  const EVENTS = new URL("events.jsonl", root);
  return {
    kind: "files",
    async put(rec) { writeFileSync(new URL(`${rec.id}.json`, QUEUE), JSON.stringify(rec, null, 2) + "\n"); return rec; },
    async get(id) { const f = new URL(`${id}.json`, QUEUE); if (!existsSync(f)) throw Object.assign(new Error(`no queued item ${id}`), { status: 404 }); return JSON.parse(readFileSync(f, "utf8")); },
    async list() { return readdirSync(QUEUE).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(new URL(f, QUEUE), "utf8"))); },
    async event(e) { appendFileSync(EVENTS, JSON.stringify(e) + "\n"); },
    async events() { return existsSync(EVENTS) ? readFileSync(EVENTS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; },
  };
}

async function cosmosStore() {
  const { CosmosClient } = await import("@azure/cosmos");
  const endpoint = process.env.COSMOS_ENDPOINT;
  let client;
  if (process.env.COSMOS_KEY) client = new CosmosClient({ endpoint, key: process.env.COSMOS_KEY });
  else { const { DefaultAzureCredential } = await import("@azure/identity"); client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() }); }
  const { database } = await client.databases.createIfNotExists({ id: process.env.COSMOS_DB || "vibecheck" });
  const { container: records } = await database.containers.createIfNotExists({ id: "records", partitionKey: { paths: ["/id"] } });
  const { container: events } = await database.containers.createIfNotExists({ id: "events", partitionKey: { paths: ["/day"] } });
  return {
    kind: "cosmos",
    async put(rec) { await records.items.upsert(rec); return rec; },
    async get(id) { const { resource } = await records.item(id, id).read(); if (!resource) throw Object.assign(new Error(`no queued item ${id}`), { status: 404 }); return resource; },
    async list() { const { resources } = await records.items.readAll().fetchAll(); return resources; },
    async event(e) { await events.items.create({ ...e, day: e.at.slice(0, 10) }); },
    async events() { const { resources } = await events.items.readAll().fetchAll(); return resources; },
  };
}

let store;
export async function getStore() {
  return (store ||= process.env.COSMOS_ENDPOINT ? await cosmosStore() : fileStore());
}

// Anonymous usage: the site reports {kind, tier, flags} per check. No text, no identifiers, no IP.
export function summarise(events, records) {
  const checks = events.filter((e) => e.type === "check");
  const signs = checks.reduce((n, e) => n + (e.flags || 0), 0) + records.reduce((n, r) => n + (r.flags?.length || 0), 0);
  const reviewed = records.filter((r) => ["approved", "dismissed", "sent"].includes(r.status));
  const approved = reviewed.filter((r) => r.status !== "dismissed");
  const acted = records.filter((r) => r.outcome === "removed" || r.outcome === "confirmed");
  const byFlag = {};
  for (const r of reviewed) for (const f of r.flags || []) { byFlag[f.id] ||= { label: f.label, seen: 0, dismissed: 0 }; byFlag[f.id].seen++; if (r.status === "dismissed") byFlag[f.id].dismissed++; }
  return {
    checks_run: checks.length + records.length,
    site_checks: checks.length,
    postings_checked: records.length,
    warning_signs_found: signs,
    serious: checks.filter((e) => e.tier === "high").length + records.filter((r) => r.tier === "high").length,
    queued: records.length, reviewed: reviewed.length, approved: approved.length, dismissed: reviewed.length - approved.length,
    reports_acted_on: acted.length,
    precision: reviewed.length ? approved.length / reviewed.length : null,
    noisy: Object.entries(byFlag).filter(([, v]) => v.seen >= 3 && v.dismissed / v.seen > 0.5).map(([id, v]) => ({ id, ...v })),
  };
}
