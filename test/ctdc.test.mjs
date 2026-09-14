import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("CTDC importer: corridors, small-count suppression, codebook percentages, credit", () => {
  const out = join(mkdtempSync(join(tmpdir(), "ctdc-")), "ctdc.json");
  execFileSync("node", ["scripts/import-ctdc.mjs", "test/fixtures/ctdc-fake.csv", "--accessed", "14 September 2026"], { env: { ...process.env, CTDC_OUT: out } });
  const d = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(d.corridors.map((c) => `${c.from}>${c.to}:${c.n}`), ["PH>MY:20", "UA>PL:12"]);
  assert.equal(d.source.withheld_small, 1, "KE>SA has 4 records and must be withheld");
  const ph = d.corridors[0];
  assert.equal(ph.minors_pct, 25);
  assert.equal(ph.control.pct["Documents withheld"], 100);
  assert.equal(ph.control.pct["False promises"], 50);
  assert.equal(ph.recruiter, null, "groups with fewer than 10 answers are withheld");
  assert.match(d.source.credit, /^Source: Counter-Trafficking Data Collaborative \(CTDC\)\. 2024\. 'Global Synthetic Dataset'.*Accessed 14 September 2026/);
  assert.equal(JSON.stringify(d).includes("yearOfRegistration"), false, "no raw columns or rows are written");
});
