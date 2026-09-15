// Pattern extraction from news items (title + snippet). Pure and deterministic, so the
// agentic job-cleaner can reuse it. Rules, not a model: it reads what the text says about
// places, direction, typology and lures, and reports what it could not tell.
import { createRequire } from "node:module";
import { detectContent } from "../src/engine.js";

const require = createRequire(import.meta.url);
const iso = require("i18n-iso-countries");
iso.registerLocale(require("i18n-iso-countries/langs/en.json"));

// Names that are too ambiguous as bare words, or are also common English.
const SKIP_NAMES = new Set(["US", "U.S.", "USA", "U.S.A.", "Congo", "Guinea", "Georgia", "Jordan", "Chad", "Niger", "Turkey", "Mali"]);
const EXTRA_NAMES = {
  US: ["United States", "U.S.", "USA"], LA: ["Laos"], KR: ["South Korea"], KP: ["North Korea"], VN: ["Vietnam"],
  RU: ["Russia"], SY: ["Syria"], IR: ["Iran"], TZ: ["Tanzania"], BO: ["Bolivia"], VE: ["Venezuela"], MD: ["Moldova"],
  CD: ["DR Congo", "DRC", "Democratic Republic of Congo"], CG: ["Republic of the Congo"], CI: ["Ivory Coast", "Côte d'Ivoire"],
  GB: ["UK", "U.K.", "Britain", "England", "Scotland", "Wales"], MM: ["Burma"], TR: ["Türkiye"], CZ: ["Czech Republic"],
  GE: ["Georgia (country)"], PS: ["Palestine", "Gaza", "West Bank"], TW: ["Taiwan"], BN: ["Brunei"], MK: ["North Macedonia"],
};
// Demonyms mark nationality, which in trafficking reporting is almost always the origin side.
const DEMONYMS = {
  PH: ["Filipino", "Filipinos", "Filipina", "Filipinas"], IN: ["Indian nationals", "Indians"], KE: ["Kenyan", "Kenyans"],
  UG: ["Ugandan", "Ugandans"], NG: ["Nigerian", "Nigerians"], ET: ["Ethiopian", "Ethiopians"], GH: ["Ghanaian", "Ghanaians"],
  CN: ["Chinese nationals"], TH: ["Thai nationals"], ID: ["Indonesian", "Indonesians"], VN: ["Vietnamese"],
  LK: ["Sri Lankan", "Sri Lankans"], NP: ["Nepali", "Nepalis", "Nepalese"], BD: ["Bangladeshi", "Bangladeshis"],
  PK: ["Pakistani", "Pakistanis"], ZA: ["South African", "South Africans"], MX: ["Mexican nationals"], KH: ["Cambodian nationals"],
  MM: ["Burmese nationals"], LA: ["Laotian", "Laotians"], MY: ["Malaysian", "Malaysians"], UA: ["Ukrainian", "Ukrainians"],
  MD: ["Moldovan", "Moldovans"], RO: ["Romanian", "Romanians"], BG: ["Bulgarian", "Bulgarians"], SK: ["Slovak nationals"],
  PL: ["Polish nationals"], BR: ["Brazilian", "Brazilians"], CO: ["Colombian", "Colombians"], VE: ["Venezuelan", "Venezuelans"],
  GT: ["Guatemalan", "Guatemalans"], HN: ["Honduran", "Hondurans"], SV: ["Salvadoran", "Salvadorans"], TZ: ["Tanzanian", "Tanzanians"],
  RW: ["Rwandan", "Rwandans"], SL: ["Sierra Leonean", "Sierra Leoneans"], ZW: ["Zimbabwean", "Zimbabweans"], MA: ["Moroccan", "Moroccans"],
  EG: ["Egyptian", "Egyptians"], SN: ["Senegalese"], CM: ["Cameroonian", "Cameroonians"], KG: ["Kyrgyz nationals"],
  UZ: ["Uzbek", "Uzbeks"], TJ: ["Tajik", "Tajiks"], TW: ["Taiwanese"], KR: ["South Koreans"], JP: ["Japanese nationals"],
};
// Place names that pin a destination hub to a country.
const HUBS = {
  MM: ["Myawaddy", "KK Park", "Shwe Kokko", "Karen State", "Shan State", "Tachileik"], KH: ["Sihanoukville", "Phnom Penh", "Bavet", "Poipet"],
  LA: ["Golden Triangle Special Economic Zone", "Bokeo"], TH: ["Mae Sot"], RU: ["Alabuga"], PH: ["Bamban"],
};
// Capitals and big cities show up as datelines and government sources far more often than as
// places people were taken, so they count as plain mentions of their country.
const CITIES = {
  MM: ["Yangon", "Naypyidaw"], KH: ["Phnom Penh"], TH: ["Bangkok"], AE: ["Dubai", "Abu Dhabi"], RU: ["Moscow", "Tatarstan"],
  PH: ["Manila", "Pampanga"], SA: ["Riyadh", "Jeddah"], LY: ["Tripoli"], KE: ["Nairobi"], NG: ["Lagos", "Abuja"], IN: ["New Delhi", "Mumbai"],
};
// A nationality word marks an origin only in a sentence about people being moved or exploited.
const VICTIM_CUE = /\b(traffick\w*|lured|tricked|deceived|recruited|rescued|repatriat\w*|victims?|stranded|trapped|held|freed|escaped|forced|workers?|job seekers?|nationals|citizens|women|men|youths?|migrants?)\b/i;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buildLexicon() {
  const entries = [];
  const names = iso.getNames("en", { select: "all" });
  for (const [code, list] of Object.entries(names)) {
    for (const n of [...list, ...(EXTRA_NAMES[code] || [])]) {
      if (SKIP_NAMES.has(n) || n.length < 4 || /,/.test(n)) continue;
      entries.push({ code, term: n, kind: "country" });
    }
  }
  for (const [code, list] of Object.entries(EXTRA_NAMES)) for (const n of list) if (["U.S.", "USA", "UK", "U.K.", "DRC"].includes(n)) entries.push({ code, term: n, kind: "country" });
  for (const [code, list] of Object.entries(DEMONYMS)) for (const n of list) entries.push({ code, term: n, kind: "demonym" });
  for (const [code, list] of Object.entries(HUBS)) for (const n of list) entries.push({ code, term: n, kind: "hub" });
  for (const [code, list] of Object.entries(CITIES)) for (const n of list) entries.push({ code, term: n, kind: "city" });
  // Longest first, so "South Sudan" wins over "Sudan" and "Republic of the Congo" over "Congo".
  entries.sort((a, b) => b.term.length - a.term.length);
  return entries.map((e) => ({ ...e, re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(e.term)}(?![\\p{L}\\p{N}])`, /^[A-Z.]+$/.test(e.term) ? "gu" : "giu") }));
}
const LEXICON = buildLexicon();

const DEST_CUE = /\b(trafficked|lured|taken|sent|smuggled|transported|brought|moved|recruited|tricked|deceived|forced|held|working|work|rescued|repatriated|freed|escaped|stranded|jobs?)\s+(?:\w+\s+){0,3}?(to|into|in|from|out of)\s*$/i;
const COMPOUND_CUE = /\b(scam (centres?|centers?|compounds?|hubs?|parks?)|compounds?)\s+(in|of|near|across)\s*$/i;

const TYPOLOGY_RULES = [
  ["scam-compound", /\b(scam (centre|center|compound|hub|park|factory|factories)|cyber ?scam|online scam operations?|pig[- ]butchering|forced (to )?(commit|run|carry out) (online )?(scams|fraud)|trafficked into (online )?(fraud|scams?|scam work)|Myawaddy|KK Park|Shwe Kokko|Sihanoukville|Golden Triangle)/i],
  ["military-recruitment", /\b(fight(ing)? for russia|russian army|russia'?s (armed forces|army|military)|foreign (recruits?|fighters?)|recruits?\b[^.]{0,40}\brussia|russia'?s [^.]{0,30}recruitment|recruit(s|ed|ment)? (drive )?(for|into|to) (the )?(russian|russia)|combat roles?|front ?line|mercenar(y|ies)|drone factory)\b/i],
  ["labor-trafficking", /\b(labou?r trafficking|forced labou?r|debt bondage|recruitment fees?|domestic work(ers?)?|farm ?workers?|construction workers?|fishing vessels?|H-2A|H-2B|kafala|bonded labou?r|modern slavery|(migrant|foreign) workers?|workers? recruitment|recruit\w* [\d,.]+ (\w+ )?workers)\b/i],
  ["sex-trafficking", /\b(sex(ual)? (trafficking|exploitation)|forced prostitution|brothels?)\b/i],
  ["money-mule", /\b(money mules?|mule accounts?|money laundering)\b/i],
  ["organ-trafficking", /\b(organ (trafficking|harvesting|removal))\b/i],
  ["deepfake-fraud", /\b(deep ?fakes?|voice[- ]clon(e|ed|ing)|cloned (voice|his voice|her voice)|AI[- ](generated|cloned) (video|voice|image)s?)\b/i],
  ["cartel-recruitment", /\b(cartels?|gangs? recruit)/i],
  ["online-scam", /\b(scams?|scammers?|fraud(sters?)?|phishing|fake (job )?postings?)\b/i],
  ["human-trafficking", /\b(human trafficking|trafficked|traffickers?|trafficking)\b/i],
];
const EVENT_RULES = [
  ["rescue", /\b(rescued|freed|repatriated|returned home|escaped|evacuated)\b/i],
  ["arrest", /\b(arrested|detained|charged|indicted|raided|raid|crackdown|busted)\b/i],
  ["conviction", /\b(convicted|sentenced|jailed|found guilty|pleaded guilty)\b/i],
  ["sanction", /\b(sanction(s|ed)?|designat(ed|ion))\b/i],
  ["warning", /\b(warn(s|ed|ing)?|advisory|alert|caution(s|ed)?)\b/i],
];

export function extractPlaces(text) {
  const found = new Map();
  const taken = [];
  for (const e of LEXICON) {
    e.re.lastIndex = 0;
    let m;
    while ((m = e.re.exec(text))) {
      const start = m.index, end = start + m[0].length;
      if (taken.some(([s, t]) => start < t && end > s)) continue;
      taken.push([start, end]);
      const before = text.slice(Math.max(0, start - 60), start);
      const sentence = text.slice(text.lastIndexOf(".", start) + 1, (text.indexOf(".", end) + 1 || text.length));
      let role = "mentioned";
      if (e.kind === "demonym") role = VICTIM_CUE.test(sentence) ? "origin" : "mentioned";
      else if (e.kind === "city") role = "mentioned";
      else if (DEST_CUE.test(before)) role = /\b(from|out of)\s*$/i.test(before) && !/\b(rescued|repatriated|freed|escaped)\b[^.]*$/i.test(before) ? "origin" : "destination";
      else if (COMPOUND_CUE.test(before) || e.kind === "hub") role = "destination";
      const prev = found.get(e.code);
      if (!prev) found.set(e.code, { iso2: e.code, roles: new Set([role]), terms: new Set([m[0]]) });
      else { prev.roles.add(role); prev.terms.add(m[0]); }
    }
  }
  return [...found.values()].map((p) => {
    const roles = [...p.roles];
    return { iso2: p.iso2, roles: roles.length > 1 ? roles.filter((r) => r !== "mentioned") : roles, terms: [...p.terms] };
  });
}

export function extractArticle({ title = "", content = "" }) {
  const text = `${title}. ${content}`.replace(/\s+/g, " ");
  const places = extractPlaces(text);
  const origins = places.filter((p) => p.roles.includes("origin")).map((p) => p.iso2);
  const dests = places.filter((p) => p.roles.includes("destination")).map((p) => p.iso2);
  const corridors = [];
  for (const o of origins) for (const d of dests) if (o !== d) corridors.push([o, d]);
  return {
    places,
    corridors,
    typologies: TYPOLOGY_RULES.filter(([, re]) => re.test(text)).map(([t]) => t),
    events: EVENT_RULES.filter(([, re]) => re.test(text)).map(([t]) => t),
    signals: [...new Set(detectContent(text).map((h) => h.id))],
    fake_job: /\b(fake|bogus|fraudulent|false|lucrative|promised|well-paid|high-paying)\s+(\w+\s+){0,2}(jobs?|job offers?|employment|work)\b|\bjob (scams?|offers?)\b|\blured\b[^.]{0,40}\bjobs?\b/i.test(text),
  };
}

export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  return d.toISOString().slice(0, 10).replace(/-\d\d$/, "") + "-W" + String(Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(2, "0");
}

export function aggregate(articles) {
  const byCountry = {}, corridors = {}, typologies = {}, signals = {}, events = {}, weeks = {};
  articles.forEach((a, i) => {
    for (const p of a.places) {
      const c = (byCountry[p.iso2] ||= { mentions: 0, origin: 0, destination: 0, articles: [] });
      c.mentions++; c.articles.push(i);
      if (p.roles.includes("origin")) c.origin++;
      if (p.roles.includes("destination")) c.destination++;
    }
    for (const [o, d] of a.corridors) {
      const k = `${o}>${d}`;
      (corridors[k] ||= { from: o, to: d, count: 0, articles: [] });
      corridors[k].count++; corridors[k].articles.push(i);
    }
    for (const t of a.typologies) typologies[t] = (typologies[t] || 0) + 1;
    for (const s of a.signals) signals[s] = (signals[s] || 0) + 1;
    for (const e of a.events) events[e] = (events[e] || 0) + 1;
    if (a.date) weeks[isoWeek(new Date(a.date))] = (weeks[isoWeek(new Date(a.date))] || 0) + 1;
  });
  return {
    byCountry,
    corridors: Object.values(corridors).sort((a, b) => b.count - a.count),
    typologies, signals, events,
    weeks: Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b)).map(([week, n]) => ({ week, n })),
  };
}
