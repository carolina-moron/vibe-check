// Imports the US Treasury OFAC SDN list (public domain, CORS-open) into a compact local index of
// sanctioned ENTITIES under the programs that cover trafficking, scam compounds and organised crime.
// People are left out on purpose: VibeCheck checks organisations, never private individuals.
// Run: npm run import:ofac        writes data/ofac.json
import { writeFileSync } from "node:fs";

const SRC = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
// GLOMAG: Global Magnitsky (human rights abuse, incl. scam compounds and trafficking networks)
// TCO: transnational criminal organisations. CYBER2: malicious cyber activity (scam operations).
// SDNTK / ILLICIT-DRUGS: cartels, which also recruit and traffic people.
const PROGRAMS = new Set(["GLOMAG", "TCO", "CYBER2", "SDNTK", "ILLICIT-DRUGS-EO14059"]);

const xml = await (await fetch(SRC)).text();
const published = xml.match(/<Publish_Date>([^<]+)</)?.[1] || "";
const entries = [];
for (const m of xml.matchAll(/<sdnEntry>([\s\S]*?)<\/sdnEntry>/g)) {
  const e = m[1];
  if (!/<sdnType>Entity<\/sdnType>/.test(e)) continue;
  const programs = [...e.matchAll(/<program>([^<]+)<\/program>/g)].map((p) => p[1]);
  if (!programs.some((p) => PROGRAMS.has(p))) continue;
  const name = e.match(/<lastName>([^<]+)<\/lastName>/)?.[1];
  if (!name) continue;
  const akas = [...e.matchAll(/<aka>[\s\S]*?<lastName>([^<]+)<\/lastName>[\s\S]*?<\/aka>/g)].map((a) => a[1]);
  const countries = [...new Set([...e.matchAll(/<country>([^<]+)<\/country>/g)].map((c) => c[1]))];
  const uid = e.match(/<uid>(\d+)<\/uid>/)?.[1];
  entries.push({ uid, name: decode(name), akas: akas.map(decode), programs: programs.filter((p) => PROGRAMS.has(p)), countries });
}
function decode(s) { return s.replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">"); }

const out = {
  source: { name: "US Treasury OFAC Specially Designated Nationals list", url: "https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists", published, programs: [...PROGRAMS],
    note: "Entities only, under human-rights (GLOMAG), transnational crime (TCO), cyber (CYBER2) and narcotics programs. A name match is a lead to verify against the linked SDN entry, not an identification.",
    lookup: "https://sanctionssearch.ofac.treas.gov/Details.aspx?id={uid}" },
  count: entries.length,
  entries,
};
writeFileSync(new URL("../data/ofac.json", import.meta.url), JSON.stringify(out) + "\n");
console.log(`OFAC: ${entries.length} entities from ${[...PROGRAMS].join(", ")} (published ${published})`);
