# Backlog

Open work, gathered from this build so far. Ticked items are done; the rest is in rough priority order within each section. `PEER_REVIEW.md` has the longer-term roadmap.

## Agent and automation
- [ ] Host `scripts/agent-server.mjs` as an Azure Function and import `docs/agent-openapi.yaml` into Copilot Studio (needs the Microsoft tenant)
- [ ] Point the review Adaptive Card at a Teams channel; wire `{{baseUrl}}`
- [ ] `find_impersonated_company` skill: match a claimed employer to the real company and its security/abuse contact
- [ ] `share_posting`: browser extension and Teams message extension so people can send LinkedIn/Handshake postings to the agent
- [ ] Handshake institutional (EDU API) partnership feed via a university career office
- [ ] Real database for agent records instead of `data/agent/queue/` (Azure Table or Cosmos DB); same choice should serve the report backend
- [ ] SMTP or Graph mail for `send`; today it writes to an outbox unless `SMTP_URL` is set
- [ ] Add real ATS boards to `data/agent/sources.json` (it ships empty)
- [ ] Nightly agent run (GitHub Action) once sources exist

## Cases and map
- [ ] Turn news reports into researched cases in batches of ~10, starting with arrests, charges and convictions (the second half of "show more cases")
- [ ] Balance regions: Gulf domestic work, EU/UK rings, Latin America, West Africa; 10 of 23 cases are US
- [ ] Filters on the Cases page by type, outcome and country
- [ ] Cluster crowded pins (US east coast) and highlight a case's route when hovering its card
- [ ] Case timeline view
- [ ] Deepfake cases rely on press sources only; add official Hong Kong Police / FCC / Brazilian police sources when reachable
- [ ] Find a documented cloned-voice "grandparent scam" prosecution (none verified yet)
- [ ] Rebalance the Cases page like News: notes under the map still sit left, last card row half-empty

## News patterns
- [ ] Weekly automatic Tavily refresh via GitHub Action (blocked: `gh` token lacks `workflow` scope; run `gh auth refresh -s workflow`)
- [ ] Tighten origin/destination extraction; add tests with real headlines (e.g. "South Africa → Poland" misread)
- [ ] Trends over time per typology (deepfake coverage rising)
- [ ] Link articles that name a catalogued entity to its case page (partially done via `relatedCases`)
- [ ] Prune lure indicators that match almost any scam-compound headline
- [ ] Role filters (origin / destination / mentioned) should also filter the countries chart and article list, not only the map
- [ ] Lure indicators column is much taller than the column beside it

## Scam types and warning signs
- [ ] Pig butchering as its own scam type and story
- [ ] Sextortion warning signs in the check (story script exists; no detection rules yet)
- [ ] Everyday scams: fake tech support, bank/government impersonation, delivery texts
- [ ] Expert validation of the warning-sign categories (Methodology already flags this)

## Stories and voices
- [ ] Produce the AI avatar videos from `stories/voices-scripts.md`; confirm the FBI sextortion link by hand first
- [ ] Add quotes to voice cards only from the videos verbatim or approved excerpts
- [ ] Voice-only or animated versions of the sextortion and sex-trafficking scripts for younger audiences
- [ ] More first-person stories: only 7 of 23 cases have one

## Site
- [x] Phone audit: no page scrolls sideways; nav strip has a scroll hint
- [ ] Update poster metrics and re-render `assets/poster.html` before the demo; confirm event city/year
- [ ] Report backend still undecided (see agent database above)
- [ ] Multi-language: Spanish first, given the H-2A and Latin America cases

## Done in this build
- [x] Voices page: real Avatar Impact Stories videos, still photos, pop-up that closes
- [x] "You are NOT alone" tab merging Stories and Voices; first-person case stories with sources
- [x] Deepfake and voice-clone cases, warning signs, rules, tests, scam-type card
- [x] Map arcs take the short way across the date line
- [x] Score colours and plain-language explanations; "Public records" instead of "Structurally uncovered"
- [x] News: Tavily refresh with deepfake queries, tags on every article, role filters, no-country-ruled-out note, layout using full width
- [x] News reports layer on the Cases map with a Methodology limits note
- [x] Hack for Good poster; ETC credited only as a data source
- [x] Agent pipeline, skills API, OpenAPI spec, docs, Methodology and Partnerships sections

## Design pass, remaining
- [ ] Section heading case: uppercase for section labels, sentence case for titles, everywhere
- [ ] Case cards: align score and Public records badges as one row on narrow cards
- [ ] News page: lure indicators column much taller than its neighbour
- [ ] About page: shorten the Mission text (it repeats the hero)
