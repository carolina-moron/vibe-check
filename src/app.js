import { assess, assessPerson } from "./engine.js";

const [signals, reports] = await Promise.all([
  fetch("data/signals.json").then((r) => r.json()),
  fetch("data/reports.json").then((r) => r.json()),
]);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https:\/\//.test(u || "") ? esc(u) : "#");
const $ = (sel) => document.querySelector(sel);

document.querySelectorAll("[data-tab]").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
  $("#tab-job").hidden = btn.dataset.tab !== "job";
  $("#tab-person").hidden = btn.dataset.tab !== "person";
}));

function linkList(links) {
  const groups = {};
  for (const l of links) (groups[l.group] ||= []).push(l);
  return Object.entries(groups).map(([g, ls]) => `
    <div class="linkgroup"><h4>${esc(g)}</h4><ul>${ls.map((l) => `<li><a href="${safeUrl(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a></li>`).join("")}</ul></div>`).join("");
}

function courtList(courts, emptyText) {
  if (!courts) return "";
  if (courts.error) return `<p class="note">${esc(courts.error)}</p>`;
  if (!courts.items.length) return `<p class="note">${esc(emptyText)}</p>`;
  return `<p class="note">${courts.total} docket(s) mention this exact name. Being named in a case is not a finding of wrongdoing.</p>
    <ul class="records">${courts.items.map((c) => `<li><a href="${safeUrl(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a><span>${esc(c.court)} · ${esc(c.docket)} · filed ${esc(c.date)}</span></li>`).join("")}</ul>`;
}

function renderJob(r) {
  const catLabel = signals.categories;
  const flags = r.flags.length
    ? `<ul class="flags">${r.flags.map((f) => `
        <li class="w${f.weight >= 20 ? "hi" : f.weight >= 10 ? "md" : "lo"}">
          <div class="flaghead"><strong>${esc(f.label)}</strong><span class="pts">+${f.weight}</span></div>
          <div class="meta">${esc(catLabel[f.category])}${f.evidence ? ` · <q>${esc(f.evidence)}</q>` : ""}</div>
          <div class="why">${esc(f.why)}</div>
        </li>`).join("")}</ul>`
    : `<p>No automated flags triggered.</p>`;

  const rdap = r.rdap && !r.rdap.error
    ? `<p class="note">Domain <strong>${esc(r.domain)}</strong>: registered ${esc(r.rdap.created?.slice(0, 10) || "unknown")}${r.rdap.registrar ? ` via ${esc(r.rdap.registrar)}` : ""}.</p>` : "";

  const matches = r.matches.map(({ entity: e, via }) => `
    <div class="report">
      <div class="flaghead"><strong>${esc(e.name)}</strong><span class="status s-${esc(e.status)}">${esc(reports.statuses[e.status])}</span></div>
      ${e.demo ? `<div class="demo">Demo record: fictional entity</div>` : ""}
      <p>${esc(e.summary)}</p>
      <p class="meta">Matched via ${esc(via)}. Also known as: ${esc((e.aliases || []).join(", ") || "none")}</p>
      ${(e.lineage || []).length ? `<ol class="lineage">${e.lineage.map((l) => `<li><time>${esc(l.date)}</time>${esc(l.event)}</li>`).join("")}</ol>` : ""}
    </div>`).join("");

  $("#job-result").innerHTML = `
    <div class="card verdict t-${esc(r.tier.id)}">
      <div class="score"><span>${r.points}</span><small>points</small></div>
      <div><h2>${esc(r.tier.label)}</h2><p>${esc(r.tier.advice)}</p></div>
    </div>
    <div class="card"><h3>Flags</h3>${rdap}${flags}</div>
    ${matches ? `<div class="card"><h3>Reports & name-change lineage</h3>${matches}</div>` : ""}
    ${r.courts ? `<div class="card"><h3>Federal court dockets (CourtListener)</h3>${courtList(r.courts, "No federal dockets mention this exact company name.")}</div>` : ""}
    ${r.links.length ? `<div class="card"><h3>Verify in official sources</h3><div class="links">${linkList(r.links)}</div></div>` : ""}`;
}

function renderPerson(p) {
  if (p.error) { $("#person-result").innerHTML = `<div class="card"><p>${esc(p.error)}</p></div>`; return; }
  const fbi = p.fbi.error
    ? `<p class="note">${esc(p.fbi.error)}</p>`
    : p.fbi.items.length
      ? `<p class="note">${p.fbi.total} possible name match(es). Compare photos and details carefully.</p>
         <ul class="records">${p.fbi.items.map((i) => `<li class="person">${i.thumb ? `<img src="${safeUrl(i.thumb)}" alt="" loading="lazy">` : ""}<div><a href="${safeUrl(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a><span>${esc(i.subjects.join(", "))}</span><span>${esc(i.description)}</span></div></li>`).join("")}</ul>`
      : `<p class="note">No FBI Wanted entries with this name.</p>`;
  $("#person-result").innerHTML = `
    <div class="card"><h3>FBI Wanted (live)</h3>${fbi}</div>
    <div class="card"><h3>Federal court dockets (CourtListener, live)</h3>${courtList(p.courts, "No federal dockets mention this exact name.")}</div>
    <div class="card"><h3>Offender registries, maps & notices</h3>
      <p class="note">These official sites don't allow automated queries. Open them and search <strong>${esc(p.name)}</strong>. NSOPW covers every US state registry and has a map search.</p>
      <div class="links">${linkList(p.links)}</div></div>`;
}

async function busy(form, target, fn) {
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true; btn.dataset.label ||= btn.textContent; btn.textContent = "Checking…";
  target.innerHTML = "";
  try { await fn(); } finally { btn.disabled = false; btn.textContent = btn.dataset.label; }
}

$("#job-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const input = Object.fromEntries(new FormData(ev.target));
  if (!Object.values(input).some((v) => v.trim())) return;
  busy(ev.target, $("#job-result"), async () => renderJob(await assess(input, { signals, reports })));
});

$("#person-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const { name } = Object.fromEntries(new FormData(ev.target));
  busy(ev.target, $("#person-result"), async () => renderPerson(await assessPerson(name)));
});

$("#demo").addEventListener("click", () => {
  const f = $("#job-form");
  f.company.value = "BrightPath Talent";
  f.website.value = "brightpath-talent.example";
  f.email.value = "brightpath.hr@gmail.com";
  f.posting.value = "URGENT: Customer service representatives needed in Sihanoukville, Cambodia. No experience needed, earn $3,000 per week! Free flight and accommodation provided. Exact location will be disclosed on arrival. Interviews on Telegram only. Please send your passport scan and pay the visa processing fee within 48 hours to secure your place.";
});
