import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const ic3 = read("data/ic3-2025.json");
const u17 = read("data/ic3-2025-under17-states.json");
const scale = read("data/scale.json");
const type = Object.fromEntries(ic3.crime_types.map((c) => [c.id, c]));

test("headline figures match the report", () => {
  assert.equal(ic3.headline.complaints, 1008597);
  assert.equal(ic3.headline.average_loss, 20699);
  assert.equal(ic3.age_groups.rows["60_plus"].complaints, ic3.sixty_plus.complaints);
  assert.equal(ic3.age_groups.rows["60_plus"].loss, ic3.sixty_plus.loss);
});

test("26 crime types with unique ids, and the totals the caveat states", () => {
  assert.equal(ic3.crime_types.length, 26);
  assert.equal(new Set(ic3.crime_types.map((c) => c.id)).size, 26);
  assert.equal(ic3.crime_types.reduce((t, c) => t + c.complaints["2025"], 0), 768452);
  assert.ok(ic3.caveats.some((c) => c.includes("768,452")));
  assert.equal(type.employment.complaints["2025"], 24688);
  assert.equal(type.investment.loss["2025"], 8648617756);
});

test("breakdowns never exceed the crime type they belong to", () => {
  for (const c of ic3.crime_types) {
    const total = c.complaints["2025"];
    for (const part of ["cryptocurrency", "ai_related", "age_17_or_younger"]) assert.ok(c[part].complaints <= total, `${c.id} ${part}`);
    const aged = Object.values(c.by_age).reduce((t, a) => t + a.complaints, 0);
    assert.ok(aged <= total, `${c.id} age rows add to ${aged}, more than ${total}`);
  }
});

test("every count and loss is a non-negative whole number or null", () => {
  const walk = (o, path) => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === "object") walk(v, `${path}.${k}`);
      else if (/^(complaints|loss|count)$/.test(k) && v !== null && typeof v !== "string") assert.ok(Number.isInteger(v) && v >= 0, `${path}.${k} = ${v}`);
    }
  };
  walk({ crime_types: ic3.crime_types, descriptors: ic3.descriptors, states: ic3.states }, "ic3");
  walk(u17.states, "u17");
});

test("57 states and territories, the same names in both files", () => {
  assert.equal(ic3.states.length, 57);
  assert.equal(ic3.states[0].name, "California");
  assert.deepEqual(u17.states.map((s) => s.name).sort(), ic3.states.map((s) => s.name).sort());
});

test("the homepage counter uses the same complaint total", () => {
  const rate = scale.rates.find((r) => /FBI/.test(r.label));
  assert.equal(rate.per_year, ic3.headline.complaints);
  assert.equal(rate.url, ic3.source.url);
});
