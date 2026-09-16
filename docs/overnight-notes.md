# Overnight notes (16 September 2026)

Decisions I took on my own and doubts for Carolina to review in the morning. Newest at the bottom.

## Decisions
1. **OFAC sanctions index, entities only.** Imported the US Treasury SDN list for the GLOMAG, TCO, CYBER2, SDNTK and ILLICIT-DRUGS programs (1,621 entities). Individuals are excluded to keep the "no person checks" rule. Weight 40, so a match alone puts a check in the red. Doubt: should narcotics programs (SDNTK, ILLICIT-DRUGS) stay? Cartels recruit and traffic people, but the list adds many shell companies with generic names, which raises false-match risk. Easy to drop.
2. **urlscan.io public search** added as a domain check (no key). It only sees domains someone has scanned before, so "no scans" is neutral, never good news.
3. **FBI Wanted API left out** of the checker even though it is open: it lists people.
4. **Name matching threshold** for OFAC: exact, or containment when both names are 8+ characters, capped at 5 matches. Stricter than the case-catalog matcher (6+) because the list is large.

## Doubts to review
- Keys: several strong sources need free API keys registered under a person or organisation (Google Safe Browsing, URLhaus, PhishTank, OpenSanctions, UK Companies House, Chainabuse, World Bank debarment, EmailRep). I did not create accounts. Which should be registered, and under whose name (you, Apne Aap, ETC)?
- Audience guides (young people, older adults, families, migrant workers): I wrote them from the same FTC, FBI, ILO and UNODC guidance the checker uses, without an expert review. Please read before we point Apne Aap at them.
