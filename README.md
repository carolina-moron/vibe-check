# Job Risk Search

Check a job offer, company or recruiter for scam and human-trafficking risk indicators. It runs as a static app with no backend and no build step.

## What it checks

**Check a job** (scored):
- **Digital footprint:** domain age from RDAP, recruiter email on a free provider, recruiter email domain that differs from the company website
- **Offer content:** upfront fees, requests for ID before an interview, chat-only contact, urgency, employer-controlled travel and housing, location withheld until arrival, high-risk regions for scam compounds, lure roles, payment handling, pay far above market
- **Reports and name-change lineage:** matches against `data/reports.json` by current name, old names, DBAs and domains
- **Federal court dockets:** live CourtListener search (shown, not scored)
- Links to OpenCorporates, SEC EDGAR, GLEIF, OFAC, DOL enforcement data, FTC, BBB and Wayback

**Check a person** (never scored):
- FBI Wanted API and CourtListener dockets, both queried live
- Links to NSOPW (every US state sex-offender registry, with map search), state registry maps, BOP inmate locator, VINELink, INTERPOL Red Notices and Europol Most Wanted

Person results are **possible name matches only**. They never feed the risk score, because a shared name is not an identity match and scoring individuals on one raises FCRA and defamation issues.

## Structure

| Path | Role |
|---|---|
| `data/signals.json` | The single risk taxonomy (ids, weights, rationale, tiers). The agentic job-cleaner skill will reuse it. |
| `data/reports.json` | Reported entities with status and lineage. **Currently fictional demo data.** |
| `src/engine.js` | Pure scoring and lookup functions, no DOM |
| `src/app.js` | Browser UI |
| `test/` | `npm test` (Node built-in test runner) |

## Run locally

```sh
npm test
npm run serve   # then open the printed URL
```

## Report statuses

A record's status is kept separate from its score: `community_report` is an allegation, `under_review` is being checked, and `enforcement_action` needs a public source link.

## Roadmap

1. Replace demo reports with sourced records (DOL WHD, FTC, DOJ press releases, H-2A violators)
2. Registry lineage: pull name, DBA and officer history from OpenCorporates or Sayari
3. Social-profile checks (AI-generated images, follower spikes)
4. Agentic job-cleaner skill that reuses `engine.js` and `signals.json`
5. Handshake partnership and a browser extension for job boards

Crisis help: US National Human Trafficking Hotline 1-888-373-7888.
