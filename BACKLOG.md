# Backlog

See `PEER_REVIEW.md`, section "Hackathon evaluation", for the ten things that matter most for the submission.

Open work, gathered from this build so far. Ticked items are done; the rest is in rough priority order within each section. `PEER_REVIEW.md` has the longer-term roadmap.

## Agent and automation
- [ ] Azure deploy (owner: Carolina, needs tenant access): `infra/deploy.sh vibecheck-rg eastus` on a machine with `az login` and Functions Core Tools, then paste the printed URL into `data/config.json` as `agentUrl`
- [ ] Copilot Studio setup (owner: Carolina): create the agent, add the action from `docs/agent-openapi.yaml` with the printed token, paste the agent instructions from `docs/agent.md`, choose the Teams review channel. The site already describes the agent as built (Partnerships and About pages); update those to "live" once deployed
- [ ] Host `scripts/agent-server.mjs` as an Azure Function and import `docs/agent-openapi.yaml` into Copilot Studio (needs the Microsoft tenant)
- [ ] Point the review Adaptive Card at a Teams channel; wire `{{baseUrl}}`
- [ ] `find_impersonated_company` skill: match a claimed employer to the real company and its security/abuse contact
- [ ] `share_posting`: browser extension and Teams message extension so people can send LinkedIn/Handshake postings to the agent
- [ ] Handshake institutional (EDU API) partnership feed: NYU career services contact in progress (Carolina)
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
- [x] Pig butchering scam type with wrong-number and withdrawal-fee warning signs (story script exists)
- [x] Sextortion warning sign, rule and scam-type card
- [ ] Everyday scams: fake tech support, bank/government impersonation, delivery texts
- [ ] Expert validation of the warning-sign categories (Methodology already flags this)

## Stories and voices
- [ ] Produce the AI avatar videos from `stories/voices-scripts.md`; confirm the FBI sextortion link by hand first
- [ ] Add quotes to voice cards only from the videos verbatim or approved excerpts
- [ ] Voice-only or animated versions of the sextortion and sex-trafficking scripts for younger audiences
- [ ] More first-person stories: only 7 of 23 cases have one

## Win the hackathon (from the peer review)
- [ ] Real outcome numbers from real use: Apne Aap organisers and NYU students run checks this week; a reviewer approves real reports; record platform outcomes
- [ ] Name the users on About: who reviews, where the first deployment is, how to send a posting
- [ ] Landing: checks run / warning signs / reports acted on as the headline trio with "since launch" dates; third-party figures below
- [ ] Quote from Ruchira Gupta on About and in the submission
- [ ] 90-day roadmap on About (Hindi and Bengali, Handshake feed, pilot results)
- [ ] Functions host: App Insights telemetry, health endpoint, rate limit on /event
- [ ] Video: title card and closing counters; replace the Teams mock with a real recording once deployed
- [ ] Simplest share path that is not the website (bookmarklet or mailto/Teams link)

## Site
- [ ] Innovation Studio submission (owner: Carolina): open the project, then fit `docs/hackathon-submission.md` to the form fields
- [x] Phone audit: no page scrolls sideways; nav strip has a scroll hint
- [ ] Update poster metrics and re-render `assets/poster.html` right before submission
- [ ] Report backend still undecided (see agent database above)
- [ ] Multi-language: Spanish first, given the H-2A and Latin America cases

## Done in this build
- [x] Team photos confirmed; titles Founder and CTO, CMO, COO; Apne Aap logo approved
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
