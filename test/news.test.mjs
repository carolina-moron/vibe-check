import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractArticle, extractPlaces, aggregate } from "../scripts/news-extract.mjs";

const roles = (text) => Object.fromEntries(extractPlaces(text).map((p) => [p.iso2, p.roles.join("/")]));

test("nationality in a victim sentence is an origin; a named compound is a destination", () => {
  const r = roles("Kenyans were rescued from compounds in Myawaddy.");
  assert.equal(r.KE, "origin");
  assert.equal(r.MM, "destination");
});

test("nationality outside a victim context is only a mention", () => {
  assert.equal(roles("Ukrainians celebrated the national holiday.").UA, "mentioned");
});

test("capitals are mentions, not destinations", () => {
  assert.equal(roles("Officials in Bangkok said the ministry would review the policy.").TH, "mentioned");
});

test("trafficked to X gives a directed corridor", () => {
  const a = extractArticle({ title: "Ethiopians trafficked to Saudi Arabia", content: "Ethiopian women were lured with promises of domestic work." });
  assert.deepEqual(a.corridors, [["ET", "SA"]]);
  assert.ok(a.typologies.includes("labor-trafficking"));
  assert.ok(a.fake_job === false || a.fake_job === true);
});

test("longest country name wins", () => {
  const r = roles("Aid reached South Sudan.");
  assert.ok("SS" in r && !("SD" in r));
});

test("aggregate counts corridors and countries", () => {
  const arts = [
    { places: [{ iso2: "BD", roles: ["origin"] }, { iso2: "MY", roles: ["destination"] }], corridors: [["BD", "MY"]], typologies: [], signals: [], events: [], date: "2026-09-01" },
    { places: [{ iso2: "BD", roles: ["origin"] }, { iso2: "MY", roles: ["destination"] }], corridors: [["BD", "MY"]], typologies: [], signals: [], events: [], date: "2026-09-08" },
  ];
  const g = aggregate(arts);
  assert.equal(g.corridors[0].count, 2);
  assert.equal(g.byCountry.BD.origin, 2);
  assert.equal(g.weeks.length, 2);
});

test("published news.json is well formed", () => {
  const d = JSON.parse(readFileSync(new URL("../data/news.json", import.meta.url)));
  assert.ok(d.articles.length > 0);
  for (const a of d.articles) assert.match(a.url, /^https?:\/\//);
  for (const c of d.aggregates.corridors) assert.ok(c.articles.every((i) => d.articles[i]));
});
