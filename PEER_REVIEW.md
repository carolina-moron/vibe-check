# VibeCheck — Peer Review
**Date:** September 14, 2026 (hackathon evaluation added September 15) | **Reviewer:** Claude  
**Project:** Static no-build safety-check app for trafficking/scam risk assessment

---

## Executive Summary

**Status:** ✓ Functional MVP with strong foundations; ready for user testing

**Strengths:** Clear methodology, multi-register architecture, honest scoring model (no false "clear"), excellent sourcing discipline  
**Gaps:** Report backend undefined, CTDC integration pending, limited geographic coverage (US/EU-centric registers)  
**Risk:** Legal/defamation risk if screening logic keys on geography instead of entity-specific conduct

---

## Architecture & Code Quality

### Core Engine (`src/engine.js` — 629 lines)
**Grade: B+**
- ✓ Pure functions; no side effects; easy to test
- ✓ Pessimistic scoring: unverified by default (safe for users)
- ✓ Exact-name-only matching (prevents false positives on "Quillmere Freight" vs "Northfield Logistics")
- ⚠ `assess()` is 100+ lines; consider breaking into `assessOrganisation()`, `assessText()`, `assessDomain()`
- ⚠ No caching of register lookups; every check re-queries (slow for repeated searches of same company)

### UI & State (`src/app.js` — 1,714 lines)
**Grade: B**
- ✓ Modular view functions (viewCheck, viewCases, viewTeam, etc.)
- ✓ Responsive routing with hash-based navigation
- ⚠ Single 1,700+ line file; consider splitting into views/, components/, pages/
- ⚠ Inline SVG namespacing in HTML; could cause parsing issues in some contexts

### Visual Design & Animation (`src/figure.js`, `src/styles.css`)
**Grade: A−**
- ✓ Globe animation accurately shows trafficking corridors (20 nodes, real endpoints)
- ✓ Color coding clear: red=sources, blue=transit/destination
- ✓ Paper aesthetic consistent; beige + navy + accent blue cohesive
- ⚠ Globe projection assumes cylindrical; poles are distorted (not critical for UI, but noted)
- ⚠ Animation timing: edges + nodes don't stagger enough; could feel slower

---

## Data Integrity & Sourcing

**Grade: A**
- ✓ 20 documented cases; all sourced to DOJ, FinCEN, UNODC, news
- ✓ NXIVM case excellent: true positive with court records, sentencing, beneficial owners
- ✓ No victim names in cases; unnamed network entities excluded from matching
- ✓ Methodology page transparent about FCRA constraints (no person checks)
- ⚠ Cases are static; no automated updates from DOJ press releases or court dockets

**Signal Taxonomy** (`data/signals.json`):
- ✓ 50 signals organized into 6 dimensions (identity, money, pressure, isolation, travel, record)
- ✓ Weights assigned (low/medium/high concern) with justification
- ⚠ Some signals under-tested (e.g., `followers_fake`, `images_ai` — no test cases verify these work)

---

## User Experience

### Strengths
- ✓ **Clear value prop:** "Something feels off? Check the vibe." (vs. vague "safety score")
- ✓ **Multiple input paths:** profile, screenshot (OCR), job posting, free text, etc.
- ✓ **Honest results:** Shows "Unverified" when incomplete, not "clear"
- ✓ **Privacy-first:** Form removes personal details before preview; photo → perceptual hash only
- ✓ **Help integration:** Hotlines on every page; quick-exit button

### Gaps
- ⚠ **Report backend is null:** Forms build/preview correctly, but nothing actually submits (expected, but confusing UX)
- ⚠ **CTDC not loaded:** "Show prevalence by corridor" feature ready but data missing (need manual CSV import)
- ⚠ **Screenshot OCR slow:** Tesseract.js on large images can block UI for 3–5 seconds
- ⚠ **No offline mode:** If registers time out, user sees "could not search" without context (should suggest manual checks)

### Recommendations
1. **Disable report form** if `REPORT_ENDPOINT === null`, or show "reporting coming soon"
2. **Add loading state** during OCR: "Reading screenshot… 45%"
3. **Offer manual register links** if lookup fails (fallback: "Search by hand here: [DOL] [OpenSanctions] [BBB]")

---

## Register Integration

**Coverage:**
- ✓ **GLEIF** (global legal entities) — queried live
- ✓ **NY DOS** + **Colorado SOS** (US incorporations) — queried live, exact-name matching
- ✓ **RDAP** (domain registration), **crt.sh** (certificates) — queried live
- ✓ **CourtListener** (federal dockets) — queried live
- ⚠ **Referral tier** (BBB, OpenSanctions, Glassdoor, Reddit) — manual only

**Gaps:**
- ⚠ No **Companies House** (UK) — blocked by browser (needs server-side key)
- ⚠ No **OFLC debarments** (H-2A/H-2B recruiters) — not integrated yet
- ⚠ No **Companies House** officer disqualifications (EU trafficking often involves disqualified directors)

---

## Legal & Compliance

**✓ Strengths:**
- FCRA-compliant: no person checks, no criminal-record lookups
- Methodology page discloses limitations: "checks run on organisations, never on private individuals"
- Coverage model shown (what was searched, what couldn't be reached)

**⚠ Risks:**
- **False positive on geography:** If screening logic flags "US small business" because CPI score is low, product becomes defamatory. Sayari handoff warned on this. Current logic appears sound (entity-specific flags only), but worth periodic audit.
- **Religious organization exclusion:** BAPS case correctly identified out of scope; good precedent to document.
- **Benchmark clarity:** "Serious warning signs" tier could be misread as "conviction" instead of "warning signs." Consider: "High concern — requires verification before proceeding"

---

## Testing

**Grade: B+**
- ✓ 31 unit tests; all pass
- ✓ Tests cover: exact-name matching, verification model, corridor parsing, news aggregation
- ⚠ No integration tests (e.g., "user uploads screenshot → OCR → check → report preview")
- ⚠ No end-to-end tests (actual register queries)
- ⚠ No accessibility tests (keyboard nav, screen reader, WCAG AA)

**Missing Test Cases:**
- Register timeout recovery
- Concurrent request limits (what if 5 registers are queried at once?)
- Edge case: company name with Unicode characters
- Verify that `iso2` codes in cases match FLSRI country keys

---

## Performance

**Grade: B**
- ✓ Static site; no server required
- ✓ Lazy load news data (on-demand)
- ✓ 12-second timeout on register queries (prevents blocking)
- ⚠ No code splitting; app.js is 1,714 lines in a single module
- ⚠ No caching of register results (every check re-queries)
- ⚠ Tesseract.js (OCR library) is ~400KB; slow on 3G

**Recommendations:**
1. Cache register results in sessionStorage (30-min TTL)
2. Lazy-load Tesseract only when screenshot tab clicked
3. Split app.js into views/ + components/ for faster parsing

---

## Accessibility

**Grade: B−**
- ✓ Semantic HTML (nav, article, section, main)
- ✓ ARIA live regions (`aria-live="polite"`)
- ✓ Skip link (`<a class="skip" href="#main">`)
- ⚠ Color-only indicators (red=high, blue=normal) — needs label
- ⚠ No keyboard-only navigation test
- ⚠ Animation can't be paused (only respects `prefers-reduced-motion`)

**Quick Wins:**
- Add `aria-label` to risk color badges ("High concern: red")
- Test with keyboard only (Tab through entire form)
- Add pause button to globe animation for motion-sensitive users

---

## Missing Features (Roadmap)

**Phase 1 (In Progress)**
- [ ] Report backend selection + integration
- [ ] CTDC corridor import (manual CSV)
- [ ] Bridging Freedom source verification

**Phase 2 (Next)**
- [ ] Platform integrations (Handshake API, LinkedIn, dating apps)
- [ ] Server-side checks: Companies House, OFLC, SEC EDGAR
- [ ] Agentic job-cleaner skill (on `engine.js` + `signals.json`)

**Phase 3 (Future)**
- [ ] Continuous case updates (automated DOJ press release parsing)
- [ ] Multi-language support
- [ ] Mobile app wrapper

---

## Hackathon evaluation: VibeCheck vs. last year's Hack for Good winner

**Date:** September 15, 2026. **Benchmark:** Team Transaction Intercept with Street Grace, first place, Hack for Good with a Nonprofit 2025 (and placings every year since 2022). Their platform lets law enforcement deploy SMS bots behind online ads to intercept buyers of child sex; their project page opens with a US map and three counters: 35,530 buyers, 1,013,648 texts, 47,791 disruptions.

### Scorecard

| What the judges rewarded last year | Transaction Intercept | VibeCheck today | Gap |
|---|---|---|---|
| Nonprofit that owns the problem | Street Grace, four years, staff who use it | Apne Aap Women Worldwide (agreed, logo approved), Ethical Tech CoLab for data | Partner exists; no Apne Aap staff have used the tool yet |
| A named operational user and workflow | Officer creates an operation, deploys a number, bot engages | Anyone can run a check; agent queues postings for a reviewer | No named reviewer team or deployment site running it |
| Outcome numbers, not features | Buyers, texts, disruptions | Checks run 103, warning signs 59, reports acted on 0; scale panel is third-party statistics | Our counters are days old and mostly from our own board run |
| Azure-native, in production for years | Functions, Cosmos DB, Azure OpenAI/CLU, App Insights, secure network | Bicep, Functions host, Cosmos adapter written and tested locally; site on GitHub Pages | Nothing deployed to Azure yet |
| Demo that shows the system working | Map with live counters, 10-second video | 62-second walkthrough, Teams card is a mock rendered from real agent output | Teams card is not a real Teams post |
| Continuity | Multi-year volunteer team, backlog of projects | Open source, BACKLOG.md, one build week | No evidence yet of a second month |
| Distinct angle | Demand side: intercept buyers | Supply side: stop recruitment; also online scams and deepfakes | Strength. Complementary to the winner, not a copy |
| Safety and ethics | Law-enforcement controlled | Indicators not verdicts, human approval, on-device redaction, no person checks | Strength. Better documented than most entries |

### What VibeCheck does better
- Prevention before harm, for anyone with a phone, in any country; the winner is US law enforcement only.
- Every fact sourced; no check returns "clear"; a wrong accusation is designed out (drafts, human approval).
- Empathy layer: survivor videos, first-person retellings, the scale panel with sources.
- Breadth: trafficking, labour exploitation, deepfakes, romance-investment, sextortion, in one explainable rules engine with 58 tested signals.
- Zero-cost, no-build deployment any NGO can fork; agent designed for the Microsoft stack end to end.

### What must improve to win (priority order)

1. **Real outcomes before judging.** Judges believed 47,791 disruptions because they came from a running system. Ours must come from use, not from our own test run. Actions: deploy the agent (item 2); put the check in front of Apne Aap organisers and NYU students this week and count the checks; have a reviewer approve at least a handful of real reports and record what the platform did. Report the numbers honestly, even if small; label the source of each counter.
2. **Deploy to Azure and say so.** Run `infra/deploy.sh`, switch `data/config.json` to the live URL, and change the About/Partnerships wording from "designed for" to "running on Azure Functions and Cosmos DB". Add Application Insights to the story (the winner's team talked about telemetry and Cosmos throttling; judges are engineers).
3. **A real Copilot Studio agent in a real Teams channel.** Import `docs/agent-openapi.yaml`, post one real review card, approve it, and record that 20-second clip. Replace the mock in the demo with the recording.
4. **Name the users.** One paragraph on the About page: who reviews (names or roles), where the first deployment is (Apne Aap community centre, NYU career services), and how a student or organiser sends a posting today (the share flow). Build the simplest share path: a mailto/Teams link or a bookmarklet, so there is a way in that is not the website.
5. **Impact metrics that mirror the winner's three.** Keep checks run, warning signs found, reports acted on as the headline trio on the landing page, big, above the fold of the Why it matters block, with "since launch" dates. Move the third-party scale figures below them so our numbers lead.
6. **A quote from the nonprofit.** One sentence from Ruchira Gupta on the About page and in the submission. Street Grace's endorsement is the spine of the winner's story.
7. **Evidence of continuity.** A dated roadmap on the About page (next 90 days: Hindi and Bengali, Handshake feed, first pilot results) and an open-issues link. Judges reward projects that will still exist in March.
8. **Tighten the pitch to the executive challenge.** The submission should answer, in order: who is harmed, what the nonprofit needs, what we built, what it did (numbers), what Microsoft technology made it possible, what happens next. `docs/hackathon-submission.md` covers these; cut it to one screen and lead with the numbers.
9. **Production hygiene the winner's team talks about.** Add App Insights telemetry to the Functions host, a health endpoint, a rate limit on `/event`, and a note on Cosmos partitioning. Small, but they signal a system rather than a prototype.
10. **Video.** Sixty seconds is right; add a two-line title card (problem, partner) and end on the three counters, matching the visual grammar judges saw last year.

### Risks to manage
- **Overclaiming.** Nothing on the site should say "live on Azure" or "in use by Apne Aap" until it is. Judges check.
- **Defamation.** Keep the drafts-plus-approval rule; never auto-send.
- **Scraping.** Keep LinkedIn and Handshake out of the agent's sources; say so in the pitch, it is a strength.
- **Time.** Items 1 to 3 need the tenant. Everything else can be done from this repo.

### Bottom line
On idea, ethics, breadth and craft, VibeCheck is ahead of a typical entry and complementary to last year's winner. On the three things that won, a running system, real outcome numbers and a nonprofit visibly using it, we are behind. The week's remaining time should go to deployment, first real users and their numbers, in that order.

## Recommendations (Priority Order)

### Must-Do (Before Public Launch)
1. **Define report backend.** (Supabase? Firebase? Custom Node?) Without it, "Report wrong vibes" is incomplete UX.
2. **Add fallback if registers time out.** Show manual search links instead of silent "could not search."
3. **Audit screening logic** against Sayari handoff to confirm no false-positive geography flags.

### Should-Do (v0.2.1)
1. Split app.js into views/ subdirectory
2. Add unit tests for OCR + screenshot handling
3. Cache register results (sessionStorage, 30-min TTL)
4. Keyboard navigation audit + ARIA labels

### Nice-To-Do (v0.3)
1. Lazy-load Tesseract.js
2. Add pause button to globe animation
3. Case update automation (RSS from DOJ + FinCEN)

---

## Conclusion

**VibeCheck is a thoughtfully designed, well-sourced safety-check tool.** The pessimistic scoring model (unverified by default), exact-name matching to avoid false positives, and transparent methodology set it apart from clickbait "scam checkers."

**Ready for:**
- ✓ User testing with beta cohort
- ✓ Security audit (especially form anonymisation)
- ✓ Legal review (defamation, FCRA compliance)

**Not ready for:**
- ⚠ Public launch (report backend missing; UX falls short when registers timeout)
- ⚠ Platform integration (APIs not built yet)

**Overall: B+ (75–85%)**  
Solid foundation; ship with backend and fallback UX; plan Phase 2 in Q4.
