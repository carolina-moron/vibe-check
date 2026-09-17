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

## Cases added overnight (14 new, 37 total)
Sourced from press and official pages that loaded; every link checked. Please skim before judging:
- **Gulf/India:** Dubai Al Hamriya (convicted, no names published), Bengaluru "TikTok Ridoy" (convicted; two named), Hyderabad NIA (convicted; three named), Saudi Kenyan domestic workers (Amnesty investigation, status "reported"), CBI Hisar Instagram recruiter (arrest only; the arrested man is not named in our record).
- **West Africa/online:** Ogoshi brothers sextortion (convicted; new "sextortion" case type), Daren Li pig-butchering laundering (DOJ, convicted), Josephine Iyamu (NCA, convicted), Abidjan fake Canada jobs (INTERPOL, arrests), Accra 57 Nigerians (arrests; suspect names left out because they came only from a search snippet).
- **Europe/LatAm:** Operation Fort (UK, convicted), Operación Balarama (Spain, arrests), Medellín to Greece (convicted; plea deals), two Brazilians in KK Park (reported; no prosecution).
- **Skipped:** the Kuwait Demafelis case (a murder conviction, not a trafficking charge) and a duplicate of Los Villatoros.
- Doubt: the Bengaluru case is also a rape case with a viral video. I kept the wording clinical and excluded the victim's details, but you may prefer to drop it.
- Doubt: naming convicted individuals. The catalog already does (Mattox, Raniere, Smith), so I followed that rule; arrested-only people are never named.

## Other decisions
- "Who it's for" guides are live in the nav. Reading levels: young = simple, older = large text.
- Poster and submission now say 37 cases, 60 warning signs.

## Round 2 (4 more cases, 41 total; two upgraded to official sources)
- **Added:** Cuautitlán, Mexico (Facebook job lure, convicted); New Hampshire grandparent bail-scam courier (convicted; AI voice use is what victims and local reporting say, not an official finding, and the record says so); Kizzy Kalu, Filipino nurses in Colorado (ICE, USCIS, 10th Circuit); Satnam Singh, Latina, Italy (homicide conviction at first instance; the labour-exploitation charges are still at trial and are labelled allegations).
- **Upgraded:** the AI Biden robocall case now cites the FCC forfeiture order and the Lingo Telecom consent decree directly; the Arup case now cites the Hong Kong government's Legislative Council reply (HK$200 million, five accounts) as official context.
- **Doubt:** Satnam Singh is a workplace death; the trafficking link is the article 603-bis exploitation charge, still unproven. Keep or drop as you see fit.
- **Doubt:** the New Hampshire case sits under "Deepfakes and voice clones" on the strength of victim testimony. If that feels too thin, move it to job-scam or drop it.
- **Not found:** a Qatar or UAE construction-worker prosecution with a loadable official source, and an official police release for the Hong Kong deepfake romance ring.

## Audit (17 September)
- **Sourcing:** 12 of 41 cases rest on press only (Accra, Bengaluru, Gisele Bündchen ads, Brazilians in KK Park, CBI Hisar, Cuautitlán, Dubai Al Hamriya, Hyderabad NIA, Medellín to Greece, New Hampshire courier, Ogoshi brothers, Satnam Singh). Case cards now show "Official source", "UN or INTERPOL source" or "Press only". An agent is hunting official documents for the twelve.
- **Rules:** 22 text rules never fire on case summaries or news snippets. Expected: they are written for first-person messages (secrecy, refuses video, sextortion, wrong-number opener) and each has a unit test. No rule fired on a legitimate posting in the corrected board run.
- **Duplication removed:** globe and statistics only on the landing page; About lost a repeated partnerships panel. The footer hotlines repeat the Help page on purpose.
