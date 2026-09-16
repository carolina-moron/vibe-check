# VibeCheck: Hack for Good submission

**Track:** Hack for Good with a Nonprofit · **Venue:** The Garage, New York City · **Live:** https://carolina-moron.github.io/vibe-check · **Code:** https://github.com/carolina-moron/vibe-check

## One line

Something feels off? Check the vibe. A free second opinion on a job, a message, a date or an offer, before someone pays, sends documents or travels.

## Problem or opportunity statement

Trafficking and scams start the same way: an offer that looks easy, a friendly message, a little urgency. By the time someone realises they are trapped they have lost money, documents or the people around them. Last year's winning project intercepts buyers after the fact. VibeCheck works at the other end: it stops recruitment before it happens, and catches the online scams (deepfakes, cloned voices, romance-investment schemes) that fund the same networks.

## Who is this for

- **People being recruited or approached online:** job seekers, students, migrants, anyone on a dating app, anyone who gets a message that feels off.
- **Nonprofits and frontline workers:** Apne Aap Women Worldwide's community organisers, career offices, hotlines, who need a fast, explainable check they can run with someone in front of them.
- **Platforms:** Handshake, LinkedIn, Indeed, dating apps, who can surface a warning before a user applies or replies.

## Nonprofit partner

**Apne Aap Women Worldwide** (apneaap.org), founded by Ruchira Gupta, works to end sex trafficking by organising women and girls in India's most vulnerable communities. They bring the frontline: who is recruited, how, and what a warning looks like from inside a community. VibeCheck turns that knowledge into checks anyone can run and reports a reviewer can send. The **Ethical Tech CoLab** provides the open data the site is built on (the Forced Labor Structural Risk Index and Avatar Impact Stories).

## What it does

1. **Warning-sign check** on text, links, profiles and screenshots: 60 signs drawn from ILO forced-labour indicators, FTC and FBI guidance, in eight kinds of situation.
2. **Verification** against official registers, the US Treasury sanctions list (1,600+ entities under human-rights, organised-crime and cyber programs), public security scans of the website, enforcement records, domain age and email checks. No check ever returns "clear".
3. **A score, explained:** 0–100, red / yellow / green, every point traceable to evidence and every fact linked to its source.
4. **Cases and map:** 41 researched cases on five continents with sourced journeys from first contact to exploitation, plus 161 recent news reports read for countries, routes and lures.
5. **You are NOT alone** and **Who it's for:** survivor videos, first-person retellings, and plain-language guides for young people, older adults, families and migrant workers, with read-aloud and large-text modes.
6. **The agent:** checks postings from allowed feeds and user submissions, queues them for human review in Teams, drafts reports to the platform, the impersonated company and the FTC/IC3. A person approves every report.

## Built on Microsoft

GitHub and GitHub Pages (live today) · Copilot Studio agent with seven skills (`docs/agent-openapi.yaml`) · Azure Functions host (`azure/`) · Cosmos DB, Key Vault, Application Insights (`infra/main.bicep`, one-command `infra/deploy.sh`) · Teams Adaptive Cards for review · Microsoft Graph for sending · Entra ID for reviewers · VS Code and GitHub Copilot to build it.

## Why it can win

- **Prevention, not only interception.** Complementary to Transaction Intercept: we stop the supply side.
- **Explainable and non-accusatory.** Indicators, never verdicts; a wrong accusation is defamation, so the agent drafts and a person sends.
- **Global from day one.** Country risk context for 190+ countries, 41 cases on five continents, a nonprofit partner in India.
- **Empathy built in.** Survivor voices and first-person stories, not only scores.
- **Open source, no build step, nothing stored without consent.** Any NGO can fork it.

## Impact metrics we report

Researched cases mapped · warning signs detected · news reports analysed · postings checked by the agent · reports approved by a reviewer · reports confirmed removed or acted on. The agent counters start at zero and come from its own review log.

## Team

- **Carolina Pernambuco Moron**, Master of Science in Global Security, Conflict and Cybercrime, New York University. Founder and CTO.
- **Dr. Obianuju Okafor**, R&D Software Engineer at Microsoft, leads frontend development; formerly Lecturer at UT Austin, IBM, Salesforce; Ph.D. in computer science. CMO.
- **Elena Kennedy**, Sr. Partner Development Manager at Microsoft, models and hardware partnerships. COO.

## Next

Deploy the agent in the Microsoft tenant · first live deployment with Apne Aap and a university career office · Handshake EDU feed · Spanish and Hindi · researched cases from news in batches.
