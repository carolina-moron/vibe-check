// Risk engine: pure functions shared by the browser app and (later) the agentic skill.
// No DOM access. Network access only through an injected fetch.
//
// Three rules carried over from the Digital Provenance Passport:
//  1. No check returns "clear". The strongest negative is "no-evidence-found".
//  2. Silence earns nothing. Empty results add no points and subtract none.
//  3. The score never travels alone. Coverage (which registers could have seen this
//     entity at all) is computed separately and always shown next to the score.
//
// People are out of scope. Checks run on entities; individuals appear only as principals
// already named in an official enforcement or sanctions record in the case catalog.

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
  "yandex.com", "yandex.ru", "zoho.com", "qq.com", "163.com", "126.com", "mail.ru",
  "tutanota.com", "mailinator.com", "guerrillamail.com", "10minutemail.com", "temp-mail.org",
]);

const COMPANY_SUFFIX = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|gmbh|sa|s\.a|plc|group|holdings?|global|international|intl)\b\.?/g;

// Each rule: signal id, regexes, optional requirement that another pattern also match.
const CONTENT_RULES = [
  { id: "upfront_fee", any: [/\b(pay|send|transfer|deposit)\b[^.]{0,40}\b(fee|deposit|training|equipment|visa|placement|registration|processing)\b/i, /\b(training|visa|placement|registration|processing|onboarding|equipment|recruitment)\s+(fee|cost|charge|deposit)s?\b/i, /\brefundable deposit\b/i] },
  { id: "id_before_interview", any: [/\b(send|provide|upload|share|fill in|enter|submit)\b[^.]{0,40}\b(passport|id card|driver'?s licen[cs]e|ssn|social security|bank (account|details)|national id|id\.me)\b/i, /\b(passport|ssn|social security number)\b[^.]{0,30}\b(before|prior to)\b[^.]{0,20}\binterview\b/i] },
  { id: "document_retention", any: [/\b(keep|hold|retain|collect|safekeep)\w*\b[^.]{0,30}\b(your )?(passports?|id documents?|identity documents?)\b/i, /\bpassports?\b[^.]{0,30}\b(kept|held|retained) by\b/i] },
  { id: "debt_bondage", any: [/\b(deducted|repaid|paid back|recovered)\b[^.]{0,30}\b(from|out of)\b[^.]{0,15}\b(wages|salary|pay|earnings)\b/i, /\b(advance|loan)\b[^.]{0,30}\b(flight|ticket|visa|recruitment)\b/i] },
  { id: "visa_fraud", any: [/\b(tourist|visit|visitor|student)\s+visa\b[^.]{0,40}\b(work|job|employment)\b/i, /\b(work|job)\b[^.]{0,40}\b(tourist|visit|visitor)\s+visa\b/i] },
  { id: "chat_only_contact", any: [/\b(telegram|whatsapp|signal app|wechat|line app|kakao)\b/i] },
  { id: "urgency", any: [/\b(within|in)\s+(24|48|72)\s*(h|hrs|hours)\b/i, /\b(urgent(ly)?|immediate start|start tomorrow|limited (slots|positions)|act now|today only)\b/i] },
  { id: "employer_housing_travel", any: [/\b(free|provided|company|employer)[^.]{0,20}\b(flight|ticket|accommodation|housing|dormitory|visa)\b/i, /\b(flight|accommodation|housing|visa)s?\b[^.]{0,20}\b(provided|arranged|covered|paid by)\b/i] },
  { id: "vague_location", any: [/\blocation (will be )?(disclosed|shared|provided|confirmed) (later|on arrival|after)\b/i, /\b(on arrival|upon arrival)\b[^.]{0,30}\b(location|address|workplace)\b/i] },
  { id: "high_risk_region", any: [/\b(myanmar|burma|cambodia|sihanoukville|phnom penh|laos|golden triangle|myawaddy|shwe kokko|bokeo|mae sot)\b/i] },
  { id: "lure_role", any: [/\b(model(l)?ing (job|work|gig|agency|opportunit)|models? wanted|model agency|hostess|companion|chat operator|crypto (trader|operator)|data entry|typing job|game tester|online sales agent)\b/i] },
  { id: "payment_handling", any: [/\b(receive|process|forward|transfer)\b[^.]{0,30}\b(payments?|funds|money|gift cards?|bitcoin|crypto|checks?|cheques?|parcels|packages)\b/i, /\b(money|payment) (transfer|processing) (agent|assistant)\b/i, /\breshipping\b/i] },
  { id: "no_experience_high_pay", any: [/\bno experience (needed|required|necessary)\b/i], also: [/\$\s?\d[\d,]{2,}\s*(\/|per)\s*(day|week)\b/i, /\burgent|high (pay|salary|income)\b/i] },
  { id: "investment_pitch", any: [/\b(trading (platform|app|account)|crypto(currency)? (trading|platform|investment|exchange)|investment (platform|app|opportunity|plan)|forex (trading|signals)|usdt|mining pool|liquidity mining|guaranteed (returns?|profits?)|daily (returns?|profits?))\b/i] },
  { id: "romance_money", any: [/\b(send|lend|transfer|need)\b[^.]{0,40}\b(money|cash|funds)\b[^.]{0,40}\b(for|to pay|hospital|ticket|customs|fee|emergency|visa)\b/i, /\b(my love|dear|sweetheart|honey|babe)\b[^.]{0,80}\b(send|transfer|pay)\b/i] },
  { id: "secrecy", any: [/\b(don'?t|do not|never|shouldn'?t|should not|mustn'?t)\s+(tell|share with|mention (it|this) to)\b[^.]{0,30}\b(anyone|family|friends|parents|police|mine|yours)\b/i, /\bkeep (this|it) (a )?secret\b/i, /\bbetween (you and me|us)\b/i] },
  // Not a sign when the text is an employer's own warning ("we will never ask for gift cards").
  { id: "gift_card_crypto", any: [/\b(gift ?cards?|itunes cards?|steam cards?|google play cards?|bitcoin|usdt|tether|crypto wallet|western union|moneygram)\b/i], not: [/\b(never|not|won'?t|will not|do not|don'?t)\s+(ever\s+)?(ask|request|require)\b[^.]{0,80}\b(gift ?cards?|crypto|bitcoin|payment)/i] },
  { id: "carry_package", any: [/\b(carry|bring|take|deliver)\b[^.]{0,30}\b(a |the |this |some )?(package|parcel|suitcase|luggage|bag|envelope|documents) (for|to)\b/i] },
  { id: "sponsor_travel_stranger", any: [/\b(i('| wi)ll|we('| wi)ll|let me)\s+(pay|buy|book|send you)\b[^.]{0,30}\b(ticket|flight|bus|travel|trip|visa)\b/i, /\b(ticket|flight)\b[^.]{0,20}\b(is |are )?(on me|paid for|already booked)\b/i] },
  { id: "housing_unseen_deposit", any: [/\b(deposit|first month|rent|reservation fee|holding fee)\b[^.]{0,50}\b(before (viewing|seeing|you see|visiting|the viewing)|to (hold|reserve|secure) (it|the (room|flat|apartment|house)))\b/i, /\bcan'?t (show|view|see) (it|the (room|flat|apartment|house|property))\b/i] },
  { id: "owner_unavailable", any: [/\b(i am|i'm|currently|we are)\s+(abroad|overseas|out of the country|working away|on a mission|deployed|offshore)\b/i, /\b(keys?)\b[^.]{0,30}\b(by (post|mail|courier)|sent to you)\b/i] },
  { id: "housing_tied_to_job", any: [/\b(accommodation|housing|dormitory|room)\b[^.]{0,30}\b(deducted|provided by (the )?(employer|company)|comes with the job|must live)\b/i] },
  { id: "refuses_video", any: [/\b(camera|webcam)\b[^.]{0,20}\b(broken|not working|doesn'?t work)\b/i, /\b(can'?t|cannot|won'?t|not allowed to)\s+(do )?(a )?video( call)?\b/i] },
  { id: "verification_code", any: [/\b(send|share|give|tell)\b[^.]{0,30}\b(the |your |a )?(verification|security|6-digit|one-time|otp|login|whatsapp) (code|pin|password)\b/i, /\b(otp|one-time password)\b/i] },
  { id: "isolation", any: [/\b(don'?t|do not|no need to)\s+(need|tell|trust|listen to|talk to)\b[^.]{0,20}\b(your )?(family|friends|parents|mother|father|anyone else)\b/i, /\b(they|your (family|friends|parents))\b[^.]{0,30}\b(won'?t understand|don'?t understand|are jealous|don'?t care about you)\b/i, /\b(leave|give me|hand over)\b[^.]{0,15}\b(your )?(phone|sim)\b/i, /\bonly (i|we) (understand|care about) you\b/i] },
  { id: "threats_coercion", any: [/\b(or (else|i'?ll|we'?ll)|if you don'?t)\b[^.]{0,60}\b(share|post|send|leak|tell|report|hurt|police|immigration|deport|family)\b/i, /\b(you|i|we) owe (me|us|them|him|her)\b/i, /\b(i'?ll|we'?ll|going to)\s+(share|post|leak|send)\b[^.]{0,30}\b(photos?|pictures?|videos?|images?)\b/i] },
  { id: "meet_private", any: [/\b(meet|come)\b[^.]{0,25}\b(alone|by yourself|at my (place|house|flat|apartment|hotel)|in private|somewhere private)\b/i, /\b(i'?ll|we'?ll|someone will|my (friend|driver|cousin) will)\s+(pick you up|collect you|meet you at the (airport|station|border))\b/i, /\b(i'?ll|we'?ll|let me)\s+send\s+(an? |my )?(uber|lyft|car|taxi|cab|driver|ride)\b/i, /\b(his|her|their|my) (friend|driver|cousin|brother|uncle)\b[^.]{0,15}\bwill (pick (me|you|us) up|collect (me|you))\b/i] },
  { id: "link_shortener", any: [/\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy|shorturl\.at|ow\.ly|t\.ly|rebrand\.ly)\/\S+/i] },
  { id: "fast_promotion", any: [/\b(fast|rapid|quick)\s+(promotion|advancement|growth into management)\b/i, /\bmanagement (training )?(program|position)s?\b[^.]{0,40}\b(in|within)\s+\d+\s*(weeks|months)\b/i, /\b(commission[- ]only|100% commission|uncapped commission)\b/i, /\bentry[- ]level\b[^.]{0,30}\b(marketing|sales|brand ambassador|promotions?)\b[^.]{0,60}\b(no experience|management|promotion)\b/i] },
  { id: "celebrity_endorsement", any: [/\b(elon musk|musk|mrbeast|mr beast|martin lewis|oprah|taylor swift|gisele|ronaldo|celebrity|famous|billionaire)\b[^.]{0,80}\b(invest(ment|ing)?|crypto|trading|giveaway|returns?|platform|endorse[sd]?|recommends?)\b/i, /\b(endorsed|recommended|backed) by\b[^.]{0,30}\b(celebrity|billionaire|famous)\b/i, /\bdeep ?fake\b[^.]{0,60}\b(ad|advert|video)\b/i] },
  { id: "deepfake_video_call", any: [/\b(video|zoom|teams|conference) call\b[^.]{0,120}\b(ceo|cfo|boss|director|manager|executive|head office)\b[^.]{0,120}\b(transfer|wire|payment|pay|send)\b/i, /\b(ceo|cfo|boss|director|executive)\b[^.]{0,80}\b(confidential|secret|urgent)\b[^.]{0,40}\b(transaction|transfer|payment|wire)\b/i] },
  { id: "voice_clone_emergency", any: [/\b(sounded (just )?like|it was (my|his|her) voice|in (my|his|her) voice|voice of my)\b[^.]{0,120}\b(money|bail|lawyer|hospital|accident|arrested|kidnapp|send|wire)/i, /\b(grandma|grandpa|mom|mum|dad|son|daughter)\b[^.]{0,40}\b(it'?s me|i'?m in trouble|i'?ve been arrested|had an accident)\b[^.]{0,80}\b(bail|money|send|lawyer|don'?t tell)\b/i] },
  { id: "new_number_impersonation", any: [/\b(new (number|phone)|lost my phone|changed my number|this is my new)\b[^]{0,120}\b(lend|send|borrow|transfer|pay|money|\$\s?\d)/i, /\b(lend|send|borrow)\b[^]{0,80}\b(new (number|phone)|lost my phone)\b/i] },
  { id: "pay_too_high", any: [/\$\s?([5-9]\d{2}|\d{1,3},?\d{3,})\s*(\/|per|a)\s*day\b/i, /\$\s?([3-9],?\d{3}|\d{2,},?\d{3})\s*(\/|per|a)\s*week\b/i, /\$\s?(1[5-9]\d|[2-9]\d{2})\s*(\/|per|an?)\s*(hr|hour)\b/i] },
];

// ---- Normalisation ---------------------------------------------------------------------

export function normalizeDomain(input) {
  if (!input) return "";
  let s = String(input).trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at !== -1 && !s.includes("/")) s = s.slice(at + 1);
  s = s.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : "";
}

// Stricter form for deciding that two registry names are the same company: strips only legal
// suffixes, keeping words like "group" or "global" that distinguish one company from another.
export function exactName(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/,\s*(delinquent|dissolved|withdrawn|expired|noncompliant|inactive)\b.*$/i, "")
    .replace(/&/g, " and ").replace(/\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|ltd|limited|plc|pllc|lp|llp)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeName(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ").replace(COMPANY_SUFFIX, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

// Registrable domain approximation: last two labels, or three for common 2-level ccTLD suffixes.
export function baseDomain(domain) {
  const parts = domain.split(".");
  const twoLevel = /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/;
  const n = parts.length >= 3 && twoLevel.test(parts.slice(-2).join(".")) ? 3 : 2;
  return parts.slice(-n).join(".");
}

const daysSince = (iso, now) => Math.floor((now - new Date(iso)) / 86400000);

function snippet(text, index, length) {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

// ---- Offer text ------------------------------------------------------------------------

export function detectContent(text) {
  const hits = [];
  if (!text || !text.trim()) return hits;
  for (const rule of CONTENT_RULES) {
    let match = null;
    for (const re of rule.any) { match = text.match(re); if (match) break; }
    if (!match) continue;
    if (rule.also && !rule.also.some((re) => re.test(text))) continue;
    if (rule.not && rule.not.some((re) => re.test(text))) continue;
    hits.push({ id: rule.id, evidence: snippet(text, match.index, match[0].length) });
  }
  return hits;
}

export function checkEmail(email, siteDomain) {
  const hits = [];
  const emailDomain = email && email.includes("@") ? normalizeDomain(email) : "";
  if (!emailDomain) return hits;
  if (FREE_MAIL.has(emailDomain)) {
    hits.push({ id: "free_email", evidence: emailDomain });
  } else if (siteDomain && baseDomain(emailDomain) !== baseDomain(siteDomain)) {
    hits.push({ id: "email_domain_mismatch", evidence: `${emailDomain} vs ${siteDomain}` });
  }
  return hits;
}

// ---- Job posting URLs ------------------------------------------------------------------
// Greenhouse, Lever and Ashby publish postings through open, browser-readable APIs, so the
// posting text can be read directly. Other links are checked by their domain only.

const FREE_HOSTS = /(^|\.)(sites\.google\.com|docs\.google\.com|forms\.gle|wixsite\.com|weebly\.com|blogspot\.com|wordpress\.com|notion\.site|telegra\.ph|carrd\.co|linktr\.ee|jotform\.com|typeform\.com|tally\.so|000webhostapp\.com|github\.io|netlify\.app|vercel\.app|glitch\.me)$/i;

export function parsePostingUrl(raw) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(String(raw).trim()) ? String(raw).trim() : `https://${String(raw).trim()}`); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  const out = { url: u.href, host, ats: null, board: null, id: null };
  if (/^(job-)?boards\.greenhouse\.io$/.test(host) && parts[1] === "jobs") Object.assign(out, { ats: "greenhouse", board: parts[0], id: parts[2] });
  else if (host === "jobs.lever.co" && parts.length >= 2) Object.assign(out, { ats: "lever", board: parts[0], id: parts[1] });
  else if (host === "jobs.ashbyhq.com" && parts.length >= 2) Object.assign(out, { ats: "ashby", board: parts[0], id: parts[1] });
  return out;
}

const stripHtml = (html) => String(html || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
  .replace(/<(br|\/p|\/li|\/h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

export async function fetchPosting(parsed, fetchFn = fetch) {
  if (!parsed?.ats) return null;
  const b = encodeURIComponent(parsed.board), id = encodeURIComponent(parsed.id);
  if (parsed.ats === "greenhouse") {
    const j = await getJson(fetchFn, `https://boards-api.greenhouse.io/v1/boards/${b}/jobs/${id}`);
    return { title: j.title, company: j.company_name || parsed.board, location: j.location?.name || "", text: stripHtml(j.content), url: j.absolute_url };
  }
  if (parsed.ats === "lever") {
    const j = await getJson(fetchFn, `https://api.lever.co/v0/postings/${b}/${id}?mode=json`);
    const lists = (j.lists || []).map((l) => `${l.text}\n${stripHtml(l.content)}`).join("\n\n");
    return { title: j.text, company: parsed.board, location: j.categories?.location || "", text: [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join("\n\n"), url: j.hostedUrl };
  }
  if (parsed.ats === "ashby") {
    const d = await getJson(fetchFn, `https://api.ashbyhq.com/posting-api/job-board/${b}`);
    const j = (d.jobs || []).find((x) => x.id === parsed.id);
    if (!j) throw new Error("posting not found");
    return { title: j.title, company: parsed.board, location: j.location || "", text: j.descriptionPlain || stripHtml(j.descriptionHtml), url: j.jobUrl };
  }
  return null;
}

export function checkPostingHost(parsed) {
  if (!parsed) return [];
  if (FREE_HOSTS.test(parsed.host)) return [{ id: "posting_free_host", evidence: parsed.host }];
  return [];
}

// ---- Check results ---------------------------------------------------------------------
// Every register check returns { register, verdict, detail, hits, records }.
// verdict: "hit" | "no-evidence-found" | "not-searched" | "error". There is no "clear".

const result = (register, verdict, detail, hits = [], records = []) => ({ register, verdict, detail, hits, records });

async function getJson(fetchFn, url, timeoutMs = 12000) {
  // A register that doesn't answer must not hold up the result: it becomes "could not search".
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  try { res = await fetchFn(url, ctrl ? { signal: ctrl.signal } : undefined); }
  finally { if (timer) clearTimeout(timer); }
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

export async function checkRdap(domain, { fetchFn = fetch, now = new Date() } = {}) {
  try {
    const json = await getJson(fetchFn, `https://rdap.org/domain/${encodeURIComponent(domain)}`);
    const created = (json.events || []).find((e) => e.eventAction === "registration")?.eventDate;
    if (!created) return result("rdap", "no-evidence-found", "Registry publishes no registration date.");
    const days = daysSince(created, now);
    const detail = `${domain} registered ${created.slice(0, 10)} (${days} days ago).`;
    const rec = [{ created, days }];
    if (days < 183) return result("rdap", "hit", detail, [{ id: "domain_new", evidence: detail }], rec);
    if (days < 730) return result("rdap", "hit", detail, [{ id: "domain_young", evidence: detail }], rec);
    return result("rdap", "no-evidence-found", detail, [], rec);
  } catch (e) {
    return result("rdap", "error", e.status === 404 ? `${domain} is not in RDAP (unregistered, or a registry without RDAP).` : "RDAP lookup failed.");
  }
}

export async function checkCrtsh(domain, { fetchFn = fetch, now = new Date() } = {}) {
  try {
    const rows = await getJson(fetchFn, `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`);
    if (!rows.length) return result("crtsh", "no-evidence-found", "No certificates logged for this domain.");
    const first = rows.map((r) => r.not_before).sort()[0];
    const days = daysSince(first, now);
    const detail = `First certificate ${first.slice(0, 10)} (${days} days ago), ${rows.length} logged.`;
    return days < 183 ? result("crtsh", "hit", detail, [{ id: "cert_new", evidence: detail }]) : result("crtsh", "no-evidence-found", detail);
  } catch {
    return result("crtsh", "error", "crt.sh did not respond (it often times out).");
  }
}

export async function checkWayback(domain, { fetchFn = fetch } = {}) {
  try {
    const json = await getJson(fetchFn, `https://archive.org/wayback/available?url=${encodeURIComponent(domain)}&timestamp=19960101`);
    const snap = json.archived_snapshots?.closest;
    if (!snap) return result("wayback", "hit", "No archived captures of this website.", [{ id: "no_archive", evidence: domain }]);
    const ts = snap.timestamp;
    return result("wayback", "no-evidence-found", `Earliest capture found: ${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}.`);
  } catch {
    return result("wayback", "error", "Wayback Machine did not respond.");
  }
}

export async function checkTranco(domain, { fetchFn = fetch } = {}) {
  try {
    const json = await getJson(fetchFn, `https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(baseDomain(domain))}`);
    const rank = json.ranks?.[0]?.rank;
    return result("tranco", "no-evidence-found", rank ? `Ranked #${rank.toLocaleString("en-US")} in the Tranco top million.` : "Not in the Tranco top million (normal for small employers).");
  } catch {
    return result("tranco", "error", "Tranco did not respond.");
  }
}

export async function checkMailDns(emailDomain, { fetchFn = fetch } = {}) {
  if (FREE_MAIL.has(emailDomain)) return result("dns", "not-searched", "Free-mail provider; DNS says nothing about the recruiter.");
  try {
    const q = (name, type) => getJson(fetchFn, `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`);
    const [mx, dmarc] = await Promise.all([q(emailDomain, "MX"), q(`_dmarc.${emailDomain}`, "TXT")]);
    const hasMx = (mx.Answer || []).some((a) => a.type === 15);
    const hasDmarc = (dmarc.Answer || []).some((a) => /v=DMARC1/i.test(a.data));
    const detail = `${emailDomain}: ${hasMx ? "has" : "no"} MX record, ${hasDmarc ? "publishes" : "no"} DMARC policy.`;
    return hasMx ? result("dns", "no-evidence-found", detail) : result("dns", "hit", detail, [{ id: "no_mx", evidence: detail }]);
  } catch {
    return result("dns", "error", "DNS lookup failed.");
  }
}

export async function checkGleif(name, { fetchFn = fetch } = {}) {
  try {
    const json = await getJson(fetchFn, `https://api.gleif.org/api/v1/lei-records?filter[fulltext]=${encodeURIComponent(name)}&page[size]=5`);
    const q = exactName(name);
    const records = (json.data || []).map((r) => {
      const e = r.attributes.entity;
      return {
        lei: r.id, name: e.legalName.name, status: e.status, jurisdiction: e.jurisdiction, created: e.creationDate,
        otherNames: (e.otherNames || []).map((o) => ({ name: o.name, type: o.type })),
        url: `https://search.gleif.org/#/record/${r.id}`,
      };
    }).filter((r) => exactName(r.name) === q || r.otherNames.some((o) => exactName(o.name) === q));
    if (!records.length) return result("gleif", "no-evidence-found", "No LEI record with this exact name (most small employers have none).");
    const hits = [];
    const previous = records.flatMap((r) => r.otherNames.filter((o) => /PREVIOUS/.test(o.type)).map((o) => `${o.name} → ${r.name}`));
    if (previous.length) hits.push({ id: "gleif_name_history", evidence: previous.join("; ") });
    if (records.some((r) => r.status !== "ACTIVE")) hits.push({ id: "entity_bad_status", evidence: records.filter((r) => r.status !== "ACTIVE").map((r) => `${r.name}: ${r.status}`).join("; ") });
    return result("gleif", hits.length ? "hit" : "no-evidence-found", `${records.length} LEI record(s) found.`, hits, records);
  } catch {
    return result("gleif", "error", "GLEIF did not respond.");
  }
}

const socrataLike = (field, name) => `upper(${field}) like '%25${encodeURIComponent(name.toUpperCase().replace(/'/g, "''"))}%25'`;

export async function checkNewYork(name, { fetchFn = fetch, now = new Date() } = {}) {
  try {
    const rows = await getJson(fetchFn, `https://data.ny.gov/resource/n9v6-gdp6.json?$where=${socrataLike("current_entity_name", name)}&$limit=5`);
    if (!rows.length) return result("ny-dos", "no-evidence-found", "No active New York entity with this name.");
    const q = exactName(name);
    const records = rows.map((r) => ({ name: r.current_entity_name, id: r.dos_id, type: r.entity_type, created: r.initial_dos_filing_date, exact: exactName(r.current_entity_name) === q }));
    // Only an exact name match can count against someone; similar names are listed, never scored.
    const hits = records.filter((r) => r.exact && r.created && daysSince(r.created, now) < 365).map((r) => ({ id: "entity_new", evidence: `${r.name} filed ${r.created.slice(0, 10)} (NY)` }));
    const exact = records.filter((r) => r.exact).length;
    return result("ny-dos", hits.length ? "hit" : "no-evidence-found", `${exact} exact and ${records.length - exact} similar active NY name(s). Similar names are other companies and are not scored.`, hits.slice(0, 1), records);
  } catch {
    return result("ny-dos", "error", "New York open data did not respond.");
  }
}

export async function checkColorado(name, { fetchFn = fetch, now = new Date() } = {}) {
  try {
    const [entities, trade] = await Promise.all([
      getJson(fetchFn, `https://data.colorado.gov/resource/4ykn-tg5h.json?$where=${socrataLike("entityname", name)}&$limit=5`),
      getJson(fetchFn, `https://data.colorado.gov/resource/u7sb-g482.json?$where=${socrataLike("tradenamedescription", name)}&$limit=5`),
    ]);
    const q = exactName(name);
    const clean = exactName;
    const records = [
      ...entities.map((r) => ({ name: r.entityname, status: r.entitystatus, created: r.entityformdate, id: r.entityid, kind: "entity", exact: clean(r.entityname) === q })),
      ...trade.map((r) => ({ name: r.tradenamedescription, registrant: r.registrantorganization, status: r.entitystatus, created: r.entityformdate, id: r.entityid, kind: "trade name", exact: clean(r.tradenamedescription) === q })),
    ];
    if (!records.length) return result("co-sos", "no-evidence-found", "No Colorado entity or trade name with this name.");
    const hits = [];
    // Only exact name matches can count; similar names are other companies.
    const bad = records.filter((r) => r.exact && r.status && !/^(good|exists)/i.test(r.status));
    if (bad.length) hits.push({ id: "entity_bad_status", evidence: bad.map((r) => `${r.name}: ${r.status} (CO)`).join("; ") });
    const fresh = records.filter((r) => r.exact && r.created && daysSince(r.created, now) < 365);
    if (fresh.length) hits.push({ id: "entity_new", evidence: `${fresh[0].name} formed ${fresh[0].created.slice(0, 10)} (CO)` });
    const dba = records.filter((r) => r.exact && r.kind === "trade name" && r.registrant && normalizeName(r.registrant) !== normalizeName(r.name));
    const nExact = records.filter((r) => r.exact).length;
    const detail = `${nExact} exact and ${records.length - nExact} similar Colorado name(s); similar names are other companies and are not scored.${dba.length ? ` Trade name registered to: ${dba.map((r) => r.registrant).join(", ")}.` : ""}`;
    return result("co-sos", hits.length ? "hit" : "no-evidence-found", detail, hits, records);
  } catch {
    return result("co-sos", "error", "Colorado open data did not respond.");
  }
}

export async function checkCourtListener(name, { fetchFn = fetch } = {}) {
  try {
    const json = await getJson(fetchFn, `https://www.courtlistener.com/api/rest/v4/search/?type=r&q=${encodeURIComponent(`"${name}"`)}`);
    const records = (json.results || []).slice(0, 8).map((r) => ({
      name: r.caseName, court: r.court, date: r.dateFiled, docket: r.docketNumber,
      url: r.docket_absolute_url ? `https://www.courtlistener.com${r.docket_absolute_url}` : null,
    }));
    // Dockets are shown, never scored: being named in a case is not a finding.
    return result("courtlistener", "no-evidence-found", records.length ? `${json.count} federal docket(s) mention this exact name. Shown for review; not scored.` : "No federal dockets mention this exact name.", [], records);
  } catch {
    return result("courtlistener", "error", "CourtListener did not respond.");
  }
}

export async function checkRedditDomain(domain, { fetchFn = fetch } = {}) {
  try {
    const json = await getJson(fetchFn, `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(`"${domain}"`)}&size=10`);
    const needle = domain.toLowerCase();
    const records = (json.data || [])
      .filter((x) => `${x.title} ${x.selftext || ""} ${x.url || ""}`.toLowerCase().includes(needle))
      .map((x) => ({ name: x.title, subreddit: x.subreddit, date: new Date(x.created_utc * 1000).toISOString().slice(0, 10), url: x.permalink ? `https://www.reddit.com${x.permalink}` : null }));
    // Shown for a person to read, never scored: coverage is partial and posts are unverified.
    return result("pullpush", "no-evidence-found", records.length ? `${records.length} archived Reddit post(s) mention ${domain}. Read them before drawing conclusions; not scored.` : `No archived Reddit posts mention ${domain} (the archive is incomplete).`, [], records);
  } catch {
    return result("pullpush", "error", "Reddit archive did not respond.");
  }
}

// ---- Case catalog ----------------------------------------------------------------------

export function allNames(entity) {
  return [{ name: entity.name, type: "current" }, ...(entity.names || [])];
}

export function matchCatalog({ name, domains = [] }, cases) {
  const q = normalizeName(name);
  const matches = [];
  if (q.length < 4) return matches;
  for (const c of cases) {
    for (const entity of c.entities || []) {
      if (/^unnamed\b/i.test(entity.name)) continue; // descriptive placeholders are not names
      const hit = allNames(entity).find((n) => {
        const nn = normalizeName(n.name);
        return nn && (nn === q || (q.length >= 6 && nn.length >= 6 && (nn.includes(q) || q.includes(nn))));
      });
      if (hit) matches.push({ caseId: c.id, caseTitle: c.title, entity: entity.name, via: hit });
    }
  }
  return matches;
}

export function checkCatalog(name, cases) {
  const matches = matchCatalog({ name }, cases);
  if (!matches.length) return result("catalog", "no-evidence-found", "No documented case lists this name, a former name or an alias.");
  const hits = [{ id: "reported_local", evidence: matches.map((m) => `${m.entity} (${m.caseTitle})`).join("; ") }];
  const viaOther = matches.filter((m) => m.via.type !== "current");
  if (viaOther.length) hits.push({ id: "name_change_lineage", evidence: viaOther.map((m) => `${m.via.name} (${m.via.type}) → ${m.entity}`).join("; ") });
  return result("catalog", "hit", `${matches.length} match(es) in documented cases.`, hits, matches);
}

// ---- Scoring and coverage --------------------------------------------------------------

// Group scored flags into the "things to consider" a person can act on.
export function considerations(flags, signalsDoc) {
  const dims = signalsDoc.dimensions || {};
  const order = ["pressure", "isolation", "travel", "money", "identity", "record"];
  const groups = {};
  for (const f of flags) (groups[f.dimension || "pressure"] ||= []).push(f);
  return order.filter((k) => groups[k]).map((k) => ({
    id: k, ...dims[k], flags: groups[k], weight: groups[k].reduce((s, f) => s + f.weight, 0),
  })).sort((a, b) => b.weight - a.weight);
}

export function score(hits, signalsDoc) {
  const byId = Object.fromEntries(signalsDoc.signals.map((s) => [s.id, s]));
  const seen = new Map();
  for (const hit of hits) if (byId[hit.id] && !seen.has(hit.id)) seen.set(hit.id, { ...byId[hit.id], evidence: hit.evidence });
  if (seen.has("domain_new")) seen.delete("domain_young");
  const flags = [...seen.values()].sort((a, b) => b.weight - a.weight);
  const points = Math.min(100, flags.reduce((sum, f) => sum + f.weight, 0));
  const tier = [...signalsDoc.tiers].filter((t) => t.min != null).sort((a, b) => b.min - a.min).find((t) => points >= t.min);
  return { points, tier, flags };
}

// Which registers could have seen an entity at all, given the jurisdictions involved.
// Kept separate from the score on purpose: folding it in would make one number mean two things.
export function coverage(jurisdictions, registersDoc, layers = ["identity", "enforcement"]) {
  const js = new Set(jurisdictions.filter(Boolean));
  const applicable = registersDoc.registers.filter((r) => layers.includes(r.layer) && r.id !== "catalog" && r.id !== "wikidata" && r.id !== "opencorporates"
    && !r.covers.includes("*") && r.covers.some((c) => js.has(c)));
  const reachable = applicable.filter((r) => r.access !== "planned");
  const cls = reachable.length >= 3 ? "well" : reachable.length >= 1 ? "partial" : "uncovered";
  const labels = { well: "Public records: many", partial: "Public records: some", uncovered: "Public records: none" };
  const explain = {
    well: "The countries involved have three or more official registers (company, court or enforcement records) we can search, so a clean result means something.",
    partial: "Only one or two official registers cover the countries involved, so a missing record is weak evidence either way.",
    uncovered: "No open official register covers the countries involved. Only global watchlists apply, so finding nothing tells you almost nothing.",
  };
  return { class: cls, label: labels[cls], explain: explain[cls], applicable, reachable };
}

export function linkFor(register, { name = "", domain = "" }) {
  return register.url.replace("{q}", encodeURIComponent(name)).replace("{d}", encodeURIComponent(domain));
}

// ---- Verification (positive evidence) --------------------------------------------------
// Pessimistic by design: nothing is treated as safe because no warning signs were found.
// "Verified" needs every one of these to pass; otherwise the result is Unverified.

export function verification(input, checks, flags, posting = null) {
  const by = Object.fromEntries(checks.map((c) => [c.register, c]));
  const activeGleif = (by.gleif?.records || []).find((r) => r.status === "ACTIVE");
  const goodCo = (by["co-sos"]?.records || []).find((r) => r.exact && /^(good|exists)/i.test(r.status || ""));
  const activeNy = (by["ny-dos"]?.records || []).find((r) => r.exact);
  const org = activeGleif || goodCo || activeNy;
  const rdapDays = by.rdap?.records?.[0]?.days;
  const siteBase = input.domain ? baseDomain(input.domain) : "";
  const emailBase = input.emailDomain ? baseDomain(input.emailDomain) : "";
  const linked = (emailBase && siteBase && emailBase === siteBase && !FREE_MAIL.has(input.emailDomain))
    || (posting?.ats && input.name && exactName(posting.board) === exactName(input.name));
  const serious = flags.filter((f) => f.weight >= 10);

  const items = [
    { id: "organisation", label: "Organisation found in an official register", passed: !!org,
      detail: org ? `${org.name} (${activeGleif ? "GLEIF, active" : goodCo ? "Colorado, good standing" : "New York, active"})`
        : input.name ? "No exact, active registration found in the registers we can reach." : "No organisation to look up." },
    { id: "website", label: "Website established for more than 2 years", passed: rdapDays >= 730,
      detail: rdapDays != null ? `Registered ${Math.floor(rdapDays / 365)} year(s) ago.` : input.domain ? "Registration date unavailable." : "No website given." },
    { id: "contact", label: "The way they contacted you traces back to that organisation", passed: !!linked,
      detail: linked ? "Their email or job posting is on the organisation's own domain or hiring system." : input.emailDomain && FREE_MAIL.has(input.emailDomain) ? "They use a free email address, which could be anyone." : "We couldn't connect the contact to the organisation." },
    { id: "signs", label: "No significant warning signs", passed: serious.length === 0,
      detail: serious.length ? `${serious.length} significant warning sign(s).` : "None found in what was checked." },
  ];
  return { verified: items.every((i) => i.passed), items };
}

// ---- Live check ------------------------------------------------------------------------

export async function assess(input, { signals, registers, cases, fetchFn = fetch, now = new Date() }) {
  const name = String(input.company || "").trim();
  const posting = input.postingUrl ? parsePostingUrl(input.postingUrl) : null;
  const domain = normalizeDomain(input.website) || (posting && !posting.ats ? normalizeDomain(posting.host) : "");
  const emailDomain = input.email && input.email.includes("@") ? normalizeDomain(input.email) : "";
  const jurisdiction = input.jurisdiction || "";
  const opts = { fetchFn, now };
  const skip = (id, why) => Promise.resolve(result(id, "not-searched", why));
  const usState = jurisdiction === "US";

  const checks = await Promise.all([
    name ? Promise.resolve(checkCatalog(name, cases)) : skip("catalog", "No company name given."),
    name.length >= 3 ? checkGleif(name, opts) : skip("gleif", "No company name given."),
    name.length >= 3 && (usState || !jurisdiction) ? checkNewYork(name, opts) : skip("ny-dos", "Not a US employer."),
    name.length >= 3 && (usState || !jurisdiction) ? checkColorado(name, opts) : skip("co-sos", "Not a US employer."),
    name.length >= 4 ? checkCourtListener(name, opts) : skip("courtlistener", "No company name given."),
    domain ? checkRdap(domain, opts) : skip("rdap", "No website given."),
    domain ? checkCrtsh(domain, opts) : skip("crtsh", "No website given."),
    domain ? checkWayback(domain, opts) : skip("wayback", "No website given."),
    domain ? checkTranco(domain, opts) : skip("tranco", "No website given."),
    domain ? checkRedditDomain(domain, opts) : skip("pullpush", "No website given."),
    emailDomain ? checkMailDns(emailDomain, opts) : skip("dns", "No recruiter email given."),
  ]);

  const emailHits = checkEmail(input.email, domain);
  checks.push(result("freemail", emailDomain ? (emailHits.length ? "hit" : "no-evidence-found") : "not-searched",
    emailDomain ? (emailHits.length ? emailHits[0].evidence : `${emailDomain} is not a known free-mail domain.`) : "No recruiter email given.", emailHits));

  const answerHits = [].concat(input.answers || []).filter(Boolean).map((id) => ({ id, evidence: "from your answers" }));
  const siteHost = !posting && input.website ? parsePostingUrl(input.website) : null;
  const textHits = [...detectContent(input.posting), ...answerHits, ...checkPostingHost(posting), ...checkPostingHost(siteHost)];
  checks.push(result("ilo", input.posting?.trim() || answerHits.length ? (textHits.length ? "hit" : "no-evidence-found") : "not-searched",
    input.posting?.trim() || answerHits.length ? `${textHits.length} warning sign(s) in the text and your answers.` : "No text given.", textHits));

  const hits = checks.flatMap((c) => c.hits);
  const byRegister = Object.fromEntries(registers.registers.map((r) => [r.id, r]));
  const referrals = registers.registers.filter((r) => r.access !== "queried" && r.layer !== "priors"
    && (r.covers.includes("*") || !jurisdiction || r.covers.includes(jurisdiction)));

  const scored = score(hits, signals);
  const ver = verification({ name, domain, emailDomain }, checks, scored.flags, posting);
  // Unverified is the default resting state: a low score alone is never "lower concern".
  if (scored.tier.id === "low" && !ver.verified) scored.tier = signals.tiers.find((t) => t.id === "unverified");
  return {
    verification: ver,
    input: { name, domain, emailDomain, jurisdiction, kind: input.kind || null },
    checks: checks.map((c) => ({ ...c, meta: byRegister[c.register] })),
    referrals,
    coverage: coverage(jurisdiction ? [jurisdiction] : [], registers),
    catalogMatches: checks[0].records,
    ...scored,
  };
}

// ---- Case scoring ----------------------------------------------------------------------

export function caseEvidence(c, signalsDoc) {
  const hits = (c.lures || []).map((l) => ({ id: l.signal, evidence: l.quote_or_description }));
  const actions = (c.entities || []).flatMap((e) => e.actions || []);
  if (actions.length) hits.push({ id: "reported_local", evidence: `${actions.length} official action(s)` });
  if ((c.entities || []).some((e) => (e.names || []).length)) hits.push({ id: "name_change_lineage", evidence: "former names or aliases on record" });
  return score(hits, signalsDoc);
}

export function caseJurisdictions(c) {
  return [...new Set([...(c.entities || []).map((e) => e.jurisdiction), ...(c.journey || []).filter((j) => j.stage === "exploited" || j.stage === "laundered").map((j) => j.country)])];
}

// ---- Structural priors (ETC Forced Labor Structural Risk Index) -------------------------
// Country-level conditions, never evidence about an entity: shown beside a case or check,
// never added to the score. Origin-side stages read the Recruitment phase (R), destination
// stages the Exploitation phase (E), matching FLSRI's own phase structure.

const ORIGIN_STAGES = new Set(["advertised", "recruited", "transit"]);
const DEST_STAGES = new Set(["exploited", "laundered"]);

export function flsriCountry(iso2, flsri) {
  const c = flsri?.countries?.[iso2];
  if (!c) return { iso2, available: false, reason: "Not in the FLSRI country universe." };
  if (!c.scored) return { iso2, available: false, name: c.name, reason: "Not scored: FLSRI leaves countries unscored when data are too thin, rather than guessing." };
  return { iso2, available: true, ...c };
}

export function flsriRoute(c, flsri) {
  const byCountry = new Map();
  for (const j of c.journey || []) {
    const role = ORIGIN_STAGES.has(j.stage) ? "origin" : DEST_STAGES.has(j.stage) ? "destination" : null;
    if (!role) continue;
    const row = byCountry.get(j.country) || { ...flsriCountry(j.country, flsri), roles: new Set(), stages: [] };
    row.roles.add(role);
    row.stages.push(j.stage);
    byCountry.set(j.country, row);
  }
  for (const o of c.victim_origins || []) {
    if (byCountry.has(o)) continue;
    byCountry.set(o, { ...flsriCountry(o, flsri), roles: new Set(["victim origin"]), stages: [] });
  }
  const rows = [...byCountry.values()].map((r) => ({ ...r, roles: [...r.roles] }));
  const origins = rows.filter((r) => r.available && r.roles.some((x) => x !== "destination"));
  const dests = rows.filter((r) => r.available && r.roles.includes("destination"));
  // FLSRI documents that it under-reads destination and sponsorship systems.
  const destinationUnderRead = dests.some((d) => d.tier === "lower" || origins.some((o) => o.composite > d.composite));
  return { rows, destinationUnderRead };
}

// ---- Complaint anonymisation -----------------------------------------------------------
// Runs in the browser before anything leaves the device. Redacts the reporter's own
// identifiers from free text; recruiter contact details go in their own fields on purpose.

const REDACTIONS = [
  { label: "email", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { label: "url", re: /\bhttps?:\/\/\S+/gi },
  { label: "passport-or-id-number", re: /\b(?=[A-Z0-9]*\d)[A-Z]{1,2}\d{6,9}\b/g },
  { label: "card-or-account-number", re: /\b(?:\d[ -]?){12,19}\b/g },
  { label: "phone", re: /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}\b/g },
  { label: "handle", re: /(?<![\w.])@[A-Za-z0-9_]{3,}/g },
  { label: "date-of-birth", re: /\b(born|dob|date of birth)\b[^.,;\n]{0,20}\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}/gi },
  { label: "name", re: /\b(my name is|i am called|i'm called|call me)\s+[A-Z][\p{L}'-]+(\s+[A-Z][\p{L}'-]+)?/giu },
];

export function redact(text) {
  let out = String(text || "");
  const counts = {};
  for (const { label, re } of REDACTIONS) {
    out = out.replace(re, (m) => {
      if (label === "phone" && m.replace(/\D/g, "").length < 7) return m;
      counts[label] = (counts[label] || 0) + 1;
      return `[${label} removed]`;
    });
  }
  return { text: out, counts };
}

// 64-bit difference hash of a 9x8 greyscale grid (row-major, values 0–255).
// Lets reports match a reused recruiter headshot without the image ever being uploaded.
export function dHash(grey9x8) {
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += grey9x8[y * 9 + x] < grey9x8[y * 9 + x + 1] ? "1" : "0";
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}

export function hammingHex(a, b) {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

export function buildReport(form, now = new Date()) {
  const narrative = redact(form.narrative);
  return {
    schema: "vibe-check/report@2",
    kind: form.kind || null,
    profile_platform: form.profileUrl ? (normalizeDomain(form.profileUrl) || null) : null,
    submitted_month: now.toISOString().slice(0, 7),
    company_as_presented: String(form.company || "").trim() || null,
    website: normalizeDomain(form.website) || null,
    recruiter_email_domain: form.recruiterEmail && form.recruiterEmail.includes("@") ? normalizeDomain(form.recruiterEmail) : null,
    platform: form.platform || null,
    recruited_country: form.recruitedCountry || null,
    destination_country: form.destinationCountry || null,
    incident_month: form.incidentMonth || null,
    what_happened: [].concat(form.signals || []),
    outcome: form.outcome || null,
    narrative_redacted: narrative.text || null,
    redactions: narrative.counts,
    recruiter_photo_dhash: form.photoHash || null,
    consent_research_use: form.consent === true || form.consent === "on",
  };
}
