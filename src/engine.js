// Risk engine: pure functions shared by the browser app and (later) the agentic skill.
// No DOM access. Network access only through an injected fetch.

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
  "yandex.com", "zoho.com", "qq.com", "163.com",
]);

const COMPANY_SUFFIX = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|gmbh|sa|s\.a|plc|group|global|international|intl)\b\.?/g;

// Each rule: signal id, regexes, optional requirement that another pattern also match.
const CONTENT_RULES = [
  { id: "upfront_fee", any: [/\b(pay|send|transfer|deposit)\b[^.]{0,40}\b(fee|deposit|training|equipment|visa|placement|registration|processing)\b/i, /\b(training|visa|placement|registration|processing|onboarding|equipment)\s+(fee|cost|charge|deposit)\b/i, /\brefundable deposit\b/i] },
  { id: "id_before_interview", any: [/\b(send|provide|upload|share)\b[^.]{0,40}\b(passport|id card|driver'?s licen[cs]e|ssn|social security|bank (account|details)|national id)\b/i, /\b(passport|ssn|social security number)\b[^.]{0,30}\b(before|prior to)\b[^.]{0,20}\binterview\b/i] },
  { id: "chat_only_contact", any: [/\b(telegram|whatsapp|signal app|wechat|line app|kakao)\b/i] },
  { id: "urgency", any: [/\b(within|in)\s+(24|48|72)\s*(h|hrs|hours)\b/i, /\b(urgent(ly)?|immediate start|start tomorrow|limited (slots|positions)|act now|today only)\b/i] },
  { id: "employer_housing_travel", any: [/\b(free|provided|company|employer)[^.]{0,20}\b(flight|ticket|accommodation|housing|dormitory|visa)\b/i, /\b(flight|accommodation|housing|visa)s?\b[^.]{0,20}\b(provided|arranged|covered|paid by)\b/i] },
  { id: "vague_location", any: [/\blocation (will be )?(disclosed|shared|provided|confirmed) (later|on arrival|after)\b/i, /\b(on arrival|upon arrival)\b[^.]{0,30}\b(location|address|workplace)\b/i] },
  { id: "high_risk_region", any: [/\b(myanmar|burma|cambodia|sihanoukville|phnom penh|laos|golden triangle|myawaddy|shwe kokko|bokeo)\b/i] },
  { id: "lure_role", any: [/\b(modeling|model agency|hostess|companion|chat operator|crypto (trader|operator)|data entry|customer service representative abroad|typing job)\b/i] },
  { id: "payment_handling", any: [/\b(receive|process|forward|transfer)\b[^.]{0,30}\b(payments?|funds|money|gift cards?|bitcoin|crypto|checks?|cheques?)\b/i, /\b(money|payment) (transfer|processing) (agent|assistant)\b/i] },
  { id: "no_experience_high_pay", any: [/\bno experience (needed|required|necessary)\b/i], also: [/\$\s?\d[\d,]{2,}\s*(\/|per)\s*(day|week)\b/i, /\burgent|high (pay|salary|income)\b/i] },
  { id: "pay_too_high", any: [/\$\s?([5-9]\d{2}|\d{1,3},?\d{3,})\s*(\/|per|a)\s*day\b/i, /\$\s?([3-9],?\d{3}|\d{2,},?\d{3})\s*(\/|per|a)\s*week\b/i, /\$\s?(1[5-9]\d|[2-9]\d{2})\s*(\/|per|an?)\s*(hr|hour)\b/i] },
];

export function normalizeDomain(input) {
  if (!input) return "";
  let s = String(input).trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at !== -1 && !s.includes("/")) s = s.slice(at + 1);
  s = s.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : "";
}

export function normalizeName(name) {
  return String(name || "").toLowerCase().replace(/&/g, " and ").replace(COMPANY_SUFFIX, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

// Registrable domain approximation: last two labels, or three for common 2-level ccTLD suffixes.
export function baseDomain(domain) {
  const parts = domain.split(".");
  const twoLevel = /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/;
  const n = parts.length >= 3 && twoLevel.test(parts.slice(-2).join(".")) ? 3 : 2;
  return parts.slice(-n).join(".");
}

function snippet(text, index, length) {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

export function detectContent(text) {
  const hits = [];
  if (!text || !text.trim()) return hits;
  for (const rule of CONTENT_RULES) {
    let match = null;
    for (const re of rule.any) { match = text.match(re); if (match) break; }
    if (!match) continue;
    if (rule.also && !rule.also.some((re) => re.test(text))) continue;
    hits.push({ id: rule.id, evidence: snippet(text, match.index, match[0].length) });
  }
  return hits;
}

export function checkEmail(email, siteDomain) {
  const hits = [];
  const emailDomain = email && email.includes("@") ? normalizeDomain(email) : "";
  if (!emailDomain) return hits;
  if (FREE_MAIL.has(emailDomain)) {
    hits.push({ id: "free_email", evidence: email });
  } else if (siteDomain && baseDomain(emailDomain) !== baseDomain(siteDomain)) {
    hits.push({ id: "email_domain_mismatch", evidence: `${emailDomain} vs ${siteDomain}` });
  }
  return hits;
}

export function domainAgeSignals(rdap, now = new Date()) {
  if (!rdap || rdap.error) return [{ id: "domain_unresolved", evidence: rdap?.error || "no data" }];
  if (!rdap.created) return [{ id: "domain_unresolved", evidence: "no registration date published" }];
  const days = Math.floor((now - new Date(rdap.created)) / 86400000);
  const evidence = `registered ${rdap.created.slice(0, 10)} (${days} days ago)`;
  if (days < 183) return [{ id: "domain_new", evidence }];
  if (days < 730) return [{ id: "domain_young", evidence }];
  return [];
}

// RDAP via rdap.org, which redirects to the authoritative registry and serves CORS headers.
export async function fetchRdap(domain, fetchFn = fetch) {
  try {
    const res = await fetchFn(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
    if (!res.ok) return { error: res.status === 404 ? "domain not found in RDAP" : `RDAP HTTP ${res.status}` };
    const json = await res.json();
    const ev = (action) => (json.events || []).find((e) => e.eventAction === action)?.eventDate;
    const registrar = (json.entities || []).find((e) => (e.roles || []).includes("registrar"));
    const registrarName = registrar?.vcardArray?.[1]?.find((f) => f[0] === "fn")?.[3];
    return { created: ev("registration") || null, updated: ev("last changed") || null, expires: ev("expiration") || null, registrar: registrarName || null };
  } catch (err) {
    return { error: "RDAP lookup failed (network or registry unavailable)" };
  }
}

export function matchReports({ name, domains = [] }, reports) {
  const q = normalizeName(name);
  const doms = new Set(domains.filter(Boolean).map(baseDomain));
  const matches = [];
  for (const entity of reports.entities) {
    const names = [entity.name, ...(entity.aliases || [])];
    const nameHit = q.length >= 3 && names.find((n) => {
      const nn = normalizeName(n);
      return nn === q || (q.length >= 5 && (nn.includes(q) || q.includes(nn)));
    });
    const domainHit = entity.domains.find((d) => doms.has(baseDomain(d)));
    if (nameHit || domainHit) {
      matches.push({ entity, via: domainHit ? `domain ${domainHit}` : `name "${nameHit}"`, matchedAlias: nameHit && nameHit !== entity.name });
    }
  }
  return matches;
}

export function score(hits, signalsDoc) {
  const byId = Object.fromEntries(signalsDoc.signals.map((s) => [s.id, s]));
  const seen = new Set();
  const flags = [];
  for (const hit of hits) {
    const def = byId[hit.id];
    if (!def || seen.has(hit.id)) continue;
    seen.add(hit.id);
    flags.push({ ...def, evidence: hit.evidence });
  }
  // A young domain is subsumed by a new one.
  const final = seen.has("domain_new") ? flags.filter((f) => f.id !== "domain_young") : flags;
  const points = final.reduce((sum, f) => sum + f.weight, 0);
  const tier = [...signalsDoc.tiers].sort((a, b) => b.min - a.min).find((t) => points >= t.min);
  final.sort((a, b) => b.weight - a.weight);
  return { points, tier, flags: final };
}

export function lookupLinks({ name, domain }) {
  const q = encodeURIComponent(name || domain || "");
  const links = [];
  if (name) {
    links.push(
      { group: "Registries", label: "OpenCorporates (company registry search)", url: `https://opencorporates.com/companies?q=${q}` },
      { group: "Registries", label: "SEC EDGAR company search", url: `https://www.sec.gov/cgi-bin/browse-edgar?company=${q}&type=&dateb=&owner=include&count=40` },
      { group: "Registries", label: "GLEIF legal entity (LEI) search", url: `https://search.gleif.org/#/search/simpleSearch=${q}` },
      { group: "Sanctions & enforcement", label: "OFAC sanctions list search", url: "https://sanctionssearch.ofac.treas.gov/" },
      { group: "Sanctions & enforcement", label: "DOL Wage & Hour enforcement data", url: "https://enforcedata.dol.gov/views/data_summary.php" },
      { group: "Sanctions & enforcement", label: "FTC cases and proceedings", url: `https://www.ftc.gov/legal-library/browse/cases-proceedings?search_api_fulltext=${q}` },
      { group: "Reputation", label: "BBB Scam Tracker", url: `https://www.bbb.org/scamtracker/lookupscam?Keywords=${q}` },
      { group: "Reputation", label: "Web search: name + scam", url: `https://duckduckgo.com/?q=${encodeURIComponent(`"${name}" scam OR fraud OR complaint`)}` },
    );
  }
  if (domain) {
    const d = encodeURIComponent(domain);
    links.push(
      { group: "Digital footprint", label: "Wayback Machine history", url: `https://web.archive.org/web/*/${d}` },
      { group: "Digital footprint", label: "urlscan.io", url: `https://urlscan.io/search/#${d}` },
      { group: "Digital footprint", label: "Google Safe Browsing status", url: `https://transparencyreport.google.com/safe-browsing/search?url=${d}` },
    );
  }
  return links;
}

// ---- Public offender and court records -------------------------------------------------
// Results are shown as possible name matches for the user to verify. They are never scored:
// a shared name is not an identity match, and scoring individuals on it invites FCRA and
// defamation problems.

export async function fetchFbiWanted(name, fetchFn = fetch) {
  try {
    const res = await fetchFn(`https://api.fbi.gov/wanted/v1/list?title=${encodeURIComponent(name)}&pageSize=10`);
    if (!res.ok) return { error: `FBI API HTTP ${res.status}`, items: [] };
    const json = await res.json();
    return {
      total: json.total || 0,
      items: (json.items || []).map((i) => ({
        title: i.title, url: i.url, description: i.description || "", subjects: i.subjects || [],
        aliases: i.aliases || [], thumb: i.images?.[0]?.thumb || null,
      })),
    };
  } catch {
    return { error: "FBI Wanted lookup failed", items: [] };
  }
}

export async function fetchCourtCases(name, fetchFn = fetch) {
  try {
    const res = await fetchFn(`https://www.courtlistener.com/api/rest/v4/search/?type=r&q=${encodeURIComponent(`"${name}"`)}`);
    if (!res.ok) return { error: `CourtListener HTTP ${res.status}`, items: [] };
    const json = await res.json();
    return {
      total: json.count || 0,
      items: (json.results || []).slice(0, 10).map((r) => ({
        title: r.caseName, court: r.court, date: r.dateFiled, docket: r.docketNumber,
        url: r.docket_absolute_url ? `https://www.courtlistener.com${r.docket_absolute_url}` : null,
      })),
    };
  } catch {
    return { error: "CourtListener lookup failed", items: [] };
  }
}

export function offenderLinks(name) {
  const q = encodeURIComponent(name || "");
  return [
    { group: "Offender registries & maps", label: "NSOPW: National Sex Offender Public Website (all US states, map search)", url: "https://www.nsopw.gov/search-public-sex-offender-registries" },
    { group: "Offender registries & maps", label: "NSOPW: list of state registry sites (most have map views)", url: "https://www.nsopw.gov/registry-sites" },
    { group: "Offender registries & maps", label: "Federal Bureau of Prisons inmate locator", url: "https://www.bop.gov/inmateloc/" },
    { group: "Offender registries & maps", label: "VINELink: state and county custody status", url: "https://vinelink.vineapps.com/search/persons" },
    { group: "Wanted & notices", label: "FBI Most Wanted", url: `https://www.fbi.gov/wanted` },
    { group: "Wanted & notices", label: "INTERPOL Red Notices (public)", url: "https://www.interpol.int/How-we-work/Notices/Red-Notices/View-Red-Notices" },
    { group: "Wanted & notices", label: "Europol EU Most Wanted", url: "https://eumostwanted.eu/" },
    { group: "Courts & sanctions", label: "CourtListener federal dockets", url: `https://www.courtlistener.com/?type=r&q=${encodeURIComponent(`"${name || ""}"`)}` },
    { group: "Courts & sanctions", label: "DOJ press releases (human trafficking, fraud)", url: `https://www.justice.gov/news?search_api_fulltext=${q}` },
    { group: "Courts & sanctions", label: "OFAC sanctions list (individuals)", url: "https://sanctionssearch.ofac.treas.gov/" },
  ];
}

export async function assessPerson(name, fetchFn = fetch) {
  const clean = String(name || "").trim();
  if (clean.split(/\s+/).length < 2) return { error: "Enter a first and last name.", fbi: null, courts: null, links: offenderLinks(clean) };
  const [fbi, courts] = await Promise.all([fetchFbiWanted(clean, fetchFn), fetchCourtCases(clean, fetchFn)]);
  return { name: clean, fbi, courts, links: offenderLinks(clean) };
}

export async function assess(input, { signals, reports, fetchFn = fetch, now = new Date() }) {
  const domain = normalizeDomain(input.website);
  const hits = [];
  let rdap = null;
  if (domain) {
    rdap = await fetchRdap(domain, fetchFn);
    hits.push(...domainAgeSignals(rdap, now));
  }
  hits.push(...checkEmail(input.email, domain));
  hits.push(...detectContent(input.posting));
  const emailDomain = input.email ? normalizeDomain(input.email) : "";
  const matches = matchReports({ name: input.company, domains: [domain, emailDomain] }, reports);
  if (matches.length) {
    hits.push({ id: "reported_local", evidence: matches.map((m) => `${m.entity.name} (via ${m.via})`).join("; ") });
    if (matches.some((m) => m.matchedAlias || (m.entity.lineage || []).length > 1)) {
      hits.push({ id: "name_change_lineage", evidence: matches.map((m) => [m.entity.name, ...(m.entity.aliases || [])].join(" → ")).join("; ") });
    }
  }
  const courts = input.company && input.company.trim().length >= 4 ? await fetchCourtCases(input.company.trim(), fetchFn) : null;
  return { domain, rdap, matches, courts, links: lookupLinks({ name: input.company, domain }), ...score(hits, signals) };
}
