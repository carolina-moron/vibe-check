# The VibeCheck agent

An automated pipeline that checks job postings the way the site does, stores anonymised results, and drafts reports for platforms, impersonated companies and regulators. A person reviews every report before it goes out.

## Two rules

1. **No scraping where it's forbidden.** LinkedIn and Handshake ban automated collection, so the agent never crawls them. Postings from those platforms reach it through people (a share button, a browser extension, a Teams message) or through a partnership feed such as Handshake's institutional API. The agent does pull from ATS boards that publish public APIs on purpose (Greenhouse, Lever, Ashby).
2. **The agent drafts; a person sends.** VibeCheck reports warning signs, never verdicts. A wrong accusation against a real company is defamation, so nothing leaves the queue until a reviewer approves it, and every draft says the signs come from an automated check, not a finding.

## The pipeline

| Step | What happens | Where |
|---|---|---|
| 1. Intake | Postings from allowed ATS feeds (`data/agent/sources.json`) and from people (`data/agent/submissions.jsonl`, or `POST /check`) | `intake()` |
| 2. Check | The same `assess()` the site runs: warning-sign rules, official registers, domain age, email checks, score, coverage | `checkItem()` |
| 3. Store | Anonymised record (personal details redacted) with a stable id, in `data/agent/queue/` today, a database later | `toRecord()` |
| 4. Review | Items scoring 20+ wait for a reviewer. A Teams Adaptive Card shows the evidence with Approve / Dismiss buttons | `reviewCard()`, `POST /review/{id}` |
| 5. Send | Only approved items. Drafts for the platform's abuse form, the impersonated company's security team, and FTC / IC3. Email if SMTP is configured, otherwise an outbox to paste from | `send()` |
| 6. Feedback | Outcomes (removed, confirmed, no action) and dismissals are logged; `stats` shows reviewer agreement and which warning signs get dismissed too often | `recordOutcome()`, `stats()` |

## Run it

```
node scripts/agent.mjs run --dry     # check queued submissions without network lookups
node scripts/agent.mjs review        # list the queue
node scripts/agent.mjs approve <id>  # release drafts
node scripts/agent.mjs send <id>     # email (SMTP_URL, REPORT_TO) or write to data/agent/outbox/
node scripts/agent.mjs outcome <id> removed
node scripts/agent.mjs stats
```

`node scripts/agent-server.mjs` exposes the same steps as HTTP skills (port 8787, `AGENT_TOKEN` for auth).

## As a Copilot Studio agent

The skills are described in `docs/agent-openapi.yaml`. Host `scripts/agent-server.mjs` as an Azure Function (or any Node host), import the OpenAPI file into Copilot Studio as an action set, and give the agent these instructions:

- When someone shares a posting, call `vibe_check` and reply with the score, the warning signs in plain language, and what to do next. Never call the posting a scam.
- When a posting scores 45 or more, post the review card to the reviewers' Teams channel.
- Only call `send_report` for an item whose decision is `approved`.
- After a report, ask the reviewer later what happened and call `record_outcome`.
- Once a week, call `agent_stats` and summarise reviewer agreement and noisy warning signs.

| Skill | Purpose |
|---|---|
| `vibe_check` | Check a posting; returns score, signs, drafts, review card |
| `list_review_queue` / `get_queued_item` | What's waiting, and the evidence for one item |
| `queue_for_review_decision` | Approve or dismiss |
| `send_report` | Release drafts for an approved item |
| `record_outcome` | What the platform or company did |
| `agent_stats` | Precision and feedback for tuning the rules |
| `scan_url` | Has a website been flagged malicious in public scans (urlscan.io) |
| `sanctions_match` | Does an organisation match a US-sanctioned entity (OFAC; entities only) |
| `text_warning_signs` | Warning signs in a piece of text, instantly |
| `explain_for_audience` | The result in plain words for a teenager, an older adult, a parent or a worker |
| `list_audiences` | The audiences the explainer supports |

Planned skills, not yet built: `find_impersonated_company` (match the claimed employer to the real company's abuse contact) and a browser extension / Teams message extension for sharing postings from LinkedIn and Handshake.

## Data and privacy

Records keep the posting text with emails, phone numbers, ID numbers and names removed (`redact()`), the warning signs found, the score and the review decision. They never include the person who submitted the posting.
