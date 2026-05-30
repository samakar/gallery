# Gallery Platform Security

---

## SUMMARY

Gallery sells tethered digital autographs where forged mints are permanent and irrevocable. This report identifies 16 Gallery-specific attack vectors across content authenticity, custody, display, payment, signing-authority, watermark-identity, and legal-enforcement domains, classified per Immunefi v2.3. Scope is limited to platform-specific threats arising from Gallery's design; general cybersecurity (credential attacks, device security, telco-layer, wallet key loss, generic identity-proofing attacks) is addressed separately, mirroring R25's methodology. Museum-tier and secondary-sale attacks are also out of scope.

Of the 16 vectors, 3 are addressed by design (Arweave hot mirror with Solana hash integrity, blockchain-evidence chargeback defense). 11 are mitigated to Low residual by layered controls (reputation-gated onboarding plus listing limit, heartbeat plus SSDMF cross-check, watermark-based false-origin defense, choice-of-law clauses, takedown infrastructure, KMS envelope encryption + IAM least-privilege on the server-side Original, HSM-backed mint-authority custody with schema-constrained variant-hash signing, and an on-chain sha256 attestation anchor backed by an off-chain image match engine for payload-forgery detection). 1 remains a Low-severity baseline (license-scope enforcement). 1 retains Medium residual (owner wallet inheritance) by architectural choice aligned with the sovereignty thesis.

Key defenses: 72-hour mint repudiation window; reputation-gated creator onboarding plus 30/month listing limit; heartbeat plus SSDMF cross-check for absent-creator detection; Arweave hot mirror with Solana hash integrity; blockchain-evidence Stripe chargeback defense; spectrographic deep-watermark on all circulating artifacts; on-chain `(variant_identity, sha256)` attestation as the §1.5 public-verifiability anchor, backed by an off-chain image match engine. Pre-mainnet third-party audit of mint-authority and custody pipelines required.

---

## 1. BACKGROUND

### 1.1 Problem Statement

Gallery sells tethered digital autographs where each Master carries an authenticated signing event, an exclusive copyright license, and Arweave-custody custody. A Master minted under forged or compromised signing authority, once minted and transferred, is permanent and irrevocable. Gallery therefore cannot absorb forged-provenance losses through chargeback mechanics the way banks absorb card fraud. The security architecture must make forgery economically unattractive per attempt and make the rare successful attempt detectable and reversible before the Master enters circulation.

### 1.2 Scope and Design Principle

This document covers the Gallery primary product only: creator onboarding, Master minting, primary Stripe-rail sale to the first collector, Arweave custody, gallery display, and license issuance. Museum-tier authentication workflows (FADGI 4-Star, COOP-governed institutional custody, archival physical reproduction) and secondary-sale attacks (wash trading, secondary pump-and-dump, royalty-enforcement bypass, resale-market price manipulation) are out of scope and will be addressed in separate analyses.

Consistent with R25's methodology, this analysis covers threats that arise from Gallery's specific design choices: tethered provenance, exclusive-license issuance, Arweave custody, and blockchain-evidence dispute resolution. General cybersecurity threats applicable to any online platform, including credential compromise, signing-key exfiltration, device theft, brand-impersonation phishing, SIM-swap attacks, non-custodial wallet key loss, and generic identity-proofing attacks (deepfake presentation, injection, document forgery) at creator onboarding, are explicitly out of scope. Those threats are real and require defense, but are handled through standard platform-security measures (phishing-resistant authentication, device attestation, SOC2 controls, incident response, liveness and injection-detection vendors per NIST SP 800-63-4) rather than through Gallery-specific threat modeling. R25 applies the same boundary via its §3.16 Server Infrastructure Security (Out of Scope) notation.

Signing authority is separated from session authentication: a login gets the creator into the dashboard, but signing a Master requires an independent device-bound phishing-resistant factor co-signed by a Magic MPC threshold. Every mint passes through a 72-hour repudiation window before the resulting Master becomes transferable.

### 1.3 Attack Surface Domains

To provide a comprehensive risk assessment, this report segments the security landscape into two distinct domains based on the platform's span of control.

**Internal Attack Surface (Platform-Controlled Core):** Vulnerabilities within systems Gallery designs, deploys, and operates. Includes the creator account model, signing-authority pipeline, Mint Authority, license-issuance contract, content-submission pipeline, gallery display architecture, brand and domain control, and the platform's own dispute resolution logic. Risks identified here represent endogenous flaws requiring direct remediation by the platform engineering team.

**External Attack Surface (Third-Party and Environmental):** Vulnerabilities arising from dependencies on third-party infrastructure and the legal environment. Includes payment-rail attacks (Stripe chargeback on the primary sale), Arweave protocol and endowment risks, and cross-jurisdictional legal-enforcement gaps. Identity-provider, telecommunications-layer, and custodial-wallet attacks are handled through vendor selection and standard platform-security measures (see §1.2 scope). Risks in scope here cannot be patched and must be managed through defense-in-depth, jurisdictional anchoring, and architectural isolation.

### 1.4 Platform-Wide Foundational Controls

Two controls apply across multiple threats rather than being scoped to a single attack vector and are documented here to avoid duplication in §3.x.

**Creator Onboarding Gate.** Creator admission requires (1) a pre-existing public-reputation threshold: YouTube Silver Creator Award (100K subscribers) or equivalent on Instagram, TikTok, Substack, or comparable surface, and (2) Stripe Connect KYC verification establishing legal identity, jurisdiction, and payout-account ownership. The reputation threshold establishes reputation capital as a bond; a creator with verified six-figure-plus audience faces career-ending consequences from fraud-driven termination that vastly exceed any per-creator fraud payout. The KYC layer establishes the legal identity required for downstream processes including death-registry matching, jurisdictional anchoring, and post-fact civil and criminal recovery. Referenced from §3.1 (creator content misconduct) and §3.2 (creator death and incapacity).

**Listing Limit.** Each admitted creator is capped at 30 mints per month. This bounds maximum per-creator monthly fraud exposure to 30 × Master price, holding extraction below the threshold that would justify forfeiting reputation capital. Referenced from §3.1.

### 1.5 Public Verifiability Requirement

**Requirement.** Several threat analyses in this report -> §3.13 (False Origin Claim), §3.14 (Server-Side Original Leak), §3.15 (Mint Authority Compromise), §3.16 (Payload-Forgery-with-Re-encode-Cover), and §A.6 (Gallery's C2PA Verifier Implementation) -> assume that image payload authenticity can be verified by a non-Gallery party (a court forensic examiner, secondary marketplace, opposing counsel, journalist, or academic researcher) without platform credentials, API access, or proprietary tooling. If verification required platform cooperation, the platform itself would become a trust dependency and the deed would lose meaning as a third-party-verifiable ownership receipt.

R65 does not specify this capability. The public-verifiability requirement is owned by R67 §5.12 Public Verifiability of Image Authenticity. The verification mechanism that satisfies it -> the on-chain `(variant_identity, sha256)` mapping covering Master and Edition variants and their owner-ordinal successors, the off-chain image match engine for public-circulation variants (Listing preview, Thumbnail, Copy), the in-pixel URL text on the Copy, the verification flow, and the four-state verdict -> is specified in R62 §2.1 Certification and R62 §7.4 Storage Model. This report assumes that mechanism as given and analyzes platform-specific threats against it.

**Partition rationale.** The on-chain sha256 anchor and the off-chain match engine are two verification tools with disjoint operating ranges. The sha256 is byte-exact and brittle to re-encoding: it returns match-or-no-match against byte-identical candidates. The match engine is perceptual and byte-flexible: it returns match-or-no-match across re-encoded, resized, cropped, and recompressed candidates. These tools partition cleanly along the circulation axis of the variant set. Non-circulating ownership-critical artifacts (the on-Arweave Master and the deed-holder Edition) are only ever presented for verification as the bytes Gallery delivered -- candidates are byte-identical to the emitted bytes -- so the sha256 is the right tool and the match engine's perceptual tolerance would be a weakness (it would say "close enough" when ownership semantics require exact). Public-circulation artifacts (Listing preview, Thumbnail, Copy) are only ever presented for verification as candidates that have been recompressed by social platforms, screenshot tooling, or viewer-side processing -- candidates are almost never byte-identical to the emitted bytes -- so the sha256 has near-zero hit rate on real-world candidates and the match engine is the right tool. The Copy additionally carries in-pixel URL text (R62 §7.6) as the primary human-readable identification path; the match engine is the perceptual fallback for stripped-URL-text candidates.

This partition is the reason non-circulating variants are saved server-side after creation while public-circulation variants are not. Server-side custody of the Master and Edition is the platform's commitment to byte-stable retrieval -- the bytes the deed-holder receives years after purchase are byte-identical to the bytes recorded on-chain at mint, which is the load-bearing property for ownership semantics. Public-circulation variants do not require byte-stable custody because their verification path (match engine + URL text) is itself byte-flexible: a Copy whose bytes drift across CDN re-encodes still resolves to its deed via the match engine and the URL text. Saving public-circulation variants server-side would commit the platform to byte stability for artifacts whose verification path does not require it -- additional custody cost with no protocol benefit. The Edition, conversely, must be byte-stable from build forward: it is generated once per (deed, owner) pair by Cloudinary at Card 6, the byte stream is persisted to server-side encrypted custody, and every subsequent deed-holder download is served from the server-side repository rather than re-derived. Re-deriving the Edition on each access would risk byte drift against the on-chain `{E+N}` record (Cloudinary's transformation engine is not strictly guaranteed deterministic across infrastructure changes), so the build-once-and-serve-from-custody pattern is the only architecture consistent with the byte-exact verification commitment.

### 1.6 Image Variants

Gallery derives four image variants from each Master. They differ in role, in how they are distributed, and -- the distinction that scopes this report's reproduction threat -- in whether image theft applies to them at all.

| Variant | Role | Distribution and Custody | Image-Theft Surface |
|---|---|---|---|
| Master | Canonical one-of-one source file | Encrypted at rest in custody; never displayed or distributed in the clear | None. Encrypted in custody; a decrypted Master still cannot be transacted through Gallery, which sells only deed-backed editions |
| Thumbnail/Listing preview | Low-resolution public listing preview | Public by design | None. Public by design; there is no protected state to steal |
| Edition | The deed-backed owned instance; the sellable asset | Held by the owner as a high-fidelity rendering | Yes -- the only variant with a theft surface. An acquired edition image can be used, shared, or sold without a deed |
| Copy | The owner-shareable rendering | Circulated by the owner by design | None. The owner shares it intentionally; circulation is expected behavior, not theft |

Image theft is applicable to the Edition only. The Thumbnail is public by design, the Copy is circulated by the owner by design, and the Master is encrypted in custody and unsaleable on-platform even if decrypted. The Edition is the sole variant that carries a theft surface; §3.3 analyzes the reproduction and deedless-resale threat against it.

---

## 2. RISK ANALYSIS

### 2.1 Internal Attack Surface

| Sec. | Actor | Intent | Attack Vector | Impacted Party | Severity | Vulnerability |
|------|-------|--------|---------------|----------------|----------|---------------|
| 3.1 | Creator or Ghost-Operator | Mint AI-generated content as human work | Content Misrepresentation: submit AI-generated work bypassing authorship claim | Buyers (fraud), platform (reputation) | High | Content Authenticity |
| 3.2 | N/A (Environmental) | Signing authority becomes unattended | Creator Death or Incapacity: signing-authority orphan state | Heirs, collectors | Low | Account Lifecycle |
| 3.3 | External (Image Copier / Deedless Reseller) | Reproduce and resell the edition image without a deed | Unauthorized Reproduction and Deedless Resale of the Edition Image: capture the edition image, then use, share, or sell it without a deed | Buyers (deedless-sale fraud), resale-market confidence | Medium | Provenance Verification / Display Architecture |
| 3.4 | Buyer | Exceed licensed usage scope | License-Scope Overreach: commercial exploitation beyond granted rights | Creator, platform reputation | Low | License Enforcement |
| 3.10 | N/A (Operational) | Action takedown notices within statutory windows | Takedown Non-Compliance: late response producing safe-harbor loss and §2258A penalties | Platform (direct fund loss, safe-harbor loss, reputation) | High | Legal Process |
| 3.12 | N/A (Environmental) | Buyer dies without configuring wallet recovery | Owner Death Without Wallet Recovery: deed and decryption key permanently inaccessible | Heirs (loss of asset value); platform reputation (indirect) | High | Account Lifecycle |
| 3.14 | External (Infrastructure Attacker) or Insider | Obtain cleartext Originals from server-side custody | Server-Side Original Leak: KMS / IAM / VPC compromise, insider exfiltration, or backup-tier exposure yielding clean unwatermarked Originals | Platform (catastrophic if archive-wide), creators (uncredited redistribution), buyers (deed-value erosion via uncontrolled copies) | High | Custody Protocol / Cloud Infrastructure |
| 3.15 | External (Compromised Signing Key) or Insider | Forge or suppress on-chain variant-hash records | Mint Authority Compromise: sign fraudulent `(variant_identity, image_hash)` records or omit attestations, defeating §1.5 public-verifiability anchor | Buyers (false-origin defense degradation), platform (catastrophic if archive-wide), creators (false attribution) | Critical | Custody Protocol / Signing Authority |
| 3.16 | External (Any party with public SDK) | Fabricate Gallery attribution for an unrelated image | Payload-Forgery-with-Re-encode-Cover: embed a Gallery-style watermark payload on an unrelated image and exploit "Modified Gallery artifact" verdict ambiguity by attributing hash mismatch to benign re-encoding | Creators (false attribution at scale), platform (false-origin defense undermined), buyers (provenance erosion) | High | Content Authenticity / Watermark Identity |

### 2.2 External Attack Surface

| Sec. | Actor | Intent | Attack Vector | Impacted Party | Severity | Vulnerability |
|------|-------|--------|---------------|----------------|----------|---------------|
| 3.5 | Buyer | Obtain Master without payment | Stripe Chargeback Fraud: reverse primary-sale payment after delivery | Platform (direct fund loss) | High | Payment Rail |
| 3.6 | N/A (Environmental) | Custody storage becomes unavailable | Arweave Endowment Depletion: long-horizon economic failure of storage protocol | All Masters in custody | Critical | Custody Protocol |
| 3.7 | External (Protocol Attacker) | Corrupt or erase Arweave-stored Masters | Arweave Protocol Compromise: 51% attack or cryptographic break | All Masters in custody | Critical | Custody Protocol |
| 3.8 | Non-US Buyer | Exploit weak enforcement jurisdiction | Cross-Jurisdictional Enforcement Gap: UCC Article 12 not applicable | Creator (license), platform | Low | Legal Environment |
| 3.9 | Infringer | Evade takedown through counter-notice | DMCA Counter-Notice Abuse: false counter-notice to restore infringing copy | Creator royalty, platform operations | Low | Legal Process |
| 3.11 | Adversary (harasser, extortionist, competitor) | Suppress display and resale through frivolous takedowns | Adversarial Takedown Abuse: false DMCA notices to harass creator or extract concessions | Creator (revenue, reputation), platform (operational burden) | Medium | Legal Process |
| 3.13 | Adversary (litigant, harasser, competitor) | Force settlement, harm reputation, or burden operations through fabricated platform-origin claims | False Origin Claim: assert Gallery distributed image platform never had | Platform (defense cost, reputation) | Medium | Legal Process |

### 2.3 Vulnerability Definitions

| Vulnerability | Definition |
|---|---|
| Content Authenticity | Failure modes where content submitted to the platform does not match the authorship claim embedded in the Master |
| Account Lifecycle | Edge states of the creator account (death, incapacity, prolonged absence) that the authentication model does not natively address |
| Display Architecture | Limits of the four-layer glass-box display architecture (R62 Section 5.4) against determined high-effort copying |
| License Enforcement | Disputes arising from buyer use of a Master beyond the scope granted by the exclusive license |
| Payment Rail | Attacks flowing through the card network or payment processor that the platform cannot directly control |
| Custody Protocol | Failure modes of the permanent-storage protocol (Arweave) underlying Master custody |
| Legal Environment | Gaps in the legal framework that make license enforcement costly, slow, or impossible in a particular jurisdiction |
| Legal Process | Adversarial use of legitimate legal processes (DMCA counter-notice, jurisdictional forum shopping) to frustrate enforcement |

### 2.4 Severity Classification

Severity follows the Immunefi Vulnerability Severity Classification System v2.3, Smart Contracts table [immunefi-2023]: a four-level scale set largely by the impact of a successful exploit, with downgrade where an exploit needs elevated privileges or uncommon user interaction. The Definition column restates the Immunefi v2.3 Smart Contracts impacts. Most Gallery threats are not smart-contract exploits, so the Gallery column places each representative §3 vector at the level whose impact bar it matches, extending the Immunefi calibration to Gallery's custody, payment, and legal-process domains.

| Severity | Definition (Immunefi v2.3, Smart Contracts) | Gallery Applicable Impacts |
|---|---|---|
| Critical | Direct theft of user funds or NFTs, other than unclaimed yield or royalties; permanent freezing of funds or NFTs; unauthorized minting of NFTs; unintended alteration of what an NFT represents, such as its token URI, payload, or artistic content; governance-result manipulation; protocol insolvency | Mint authority compromise (§3.15); Arweave protocol compromise (§3.7); Arweave endowment depletion (§3.6) |
| High | Theft of unclaimed yield or royalties; permanent freezing of unclaimed yield or royalties; temporary freezing of funds or NFTs | AI-generated content minted as human work (§3.1); Stripe chargeback fraud on the primary sale (§3.5); payload-forgery-with-re-encode-cover (§3.16); takedown non-compliance (§3.10); owner death without wallet recovery (§3.12) |
| Medium | Smart contract unable to operate; griefing, where there is no profit motive for the attacker but damage to users or the protocol; block stuffing; theft of gas; unbounded gas consumption | Unauthorized reproduction and deedless resale (§3.3); adversarial takedown abuse (§3.11); false origin claim (§3.13) |
| Low | Contract fails to deliver promised returns but does not lose value | Creator death or incapacity (§3.2); license-scope overreach by buyer (§3.4); cross-jurisdictional enforcement gap (§3.8); DMCA counter-notice abuse (§3.9) |

### 2.5 Control Types

| Type | Definition | Gallery Example |
|---|---|---|
| Preventative | Stops the attack before it happens | Device-bound passkey plus Magic MPC threshold signing on every mint |
| Detective | Identifies an attack in progress so operators can react | Creator dashboard real-time mint log; velocity-limit anomaly detection |
| Corrective | Limits damage after an attack begins | 72-hour mint repudiation window freezing Master transferability; signing-key rotation tooling |
| Recovery | Restores the system after damage occurs | Beneficiary registration and probate-integration template for collector wallets; DMCA takedown with blockchain-evidence submission |

---

## 3. THREAT ANALYSIS

### 3.1 AI-Generated Content Submitted as Human Work

**Attack Scenario:**

A creator (legitimately authenticated) submits AI-generated or third-party-authored work and mints it as human-made original. Signing authority is genuine; the attack is on content provenance, not account security. Attack paths:

1. AI-generated image passed through lightweight editing to defeat GAN-artifact detection.
2. Ghost-operator produces the work; creator claims authorship.
3. Third-party work (scraped, licensed for other purposes, stolen) minted under creator's authentication.
4. Multiple creators independently mint the same source content (stock photo, public-domain, scraped), producing cross-creator catalog duplication indistinguishable from genuine one-of-one Masters.

**Platform-Reputation Impact:**

Scale-sensitive. Isolated cases produce per-buyer harm recoverable via dispute channel and creator reserve (Low platform impact). Accumulation contaminates the catalog beyond buyer discrimination (existential platform impact). The 2024-2026 NFT autograph platforms (Autograph, Nifty Gateway, Foundation) collapsed from provenance-integrity failures at scale, not smart-contract exploits. Gallery's catalog-reputation asset is a security-grade concern.

**Attack Economics:**

At $100 Master price, 10/day velocity limit, and 30/month listing limit, a single creator could extract up to $3,000/month in fraudulent content at near-zero marginal cost if undetected. The monthly limit is the binding constraint; daily velocity prevents bursts but the monthly cap bounds sustained extraction. Detection risk plus reputation-capital forfeiture is the binding deterrent: a flagged creator loses account standing, back-catalog value, and external reputation capital pledged at onboarding.

**Mitigation: Onboarding Gate Plus Volume Cap Plus Content-Authenticity Checks**

1. **Creator onboarding gate (§1.4).** Reputation gate plus KYC; reputation capital as bond against fraud-driven termination.
2. **Listing limit (§1.4).** 30 mints/month per creator caps maximum monthly fraud exposure.
3. **AI-generation detection at submission.** GAN-fingerprint and model-specific artifact analysis (Stable Diffusion latent patterns, Midjourney style signatures). C2PA verifier per Appendix A.6 applied when manifests are present; mandatory-C2PA intake deferred to the emerging tier per A.7's tiered policy, with the §1.4 reputation gate providing the primary authenticity binding at the current silver-tier supply.
4. **Content similarity search.** Image match engine search against training datasets, the open web, and Gallery's own catalog -> catches near-duplicate variations of the creator's own or others' prior work.
5. **Platform reputation scoring.** Risk-based check intensity for ongoing behavior; flags creators whose detection-signal pattern shifts over time.
6. **Buyer dispute mechanism.** Investigation triggered by buyer complaint; refund from creator reserve and account termination on substantiated claims.
7. **Creator signed attestation at mint.** ESIGN-bound declaration of original authorship; creates legal evidence supporting post-fact refund, account termination, and criminal-fraud referral.
8. **Creator reserve escrow.** Portion of creator payout held for N months to fund refunds within the dispute window.

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | Creator onboarding gate (§1.4) | Reputation gate plus KYC; reputation capital as bond | High -> hit-and-run economically irrational |
| Preventative | Listing limit (§1.4) | 30 mints/month per creator | High -> caps maximum monthly fraud exposure |
| Preventative | Creator reputation scoring | Risk-based check intensity by ongoing creator standing | Medium |
| Preventative | R62 §6.4 Content Authenticity Gate | Four-value origin disclosure (Captured / Hand-produced / AI-assisted / AI-generated) plus GAN-fingerprint and model-specific artifact detection; Tier 2 detection contradicting declaration triggers graduated penalties | High -> shifts equilibrium so undisclosed AI is the only failure mode |
| Preventative | R62 §6.7 Provenance and Rights Verification Gate | Image match engine search against training datasets, open web, and Gallery's own catalog combined with five-path rights-resolution workflow addressing attack paths 3 and 4 (including near-duplicate variations of own or others' work) | High -> closes rights-verification residual |
| Detective | Buyer dispute channel | Investigation on buyer complaint | Medium -> only catches discovered fraud |
| Corrective | Signed authorship attestation | ESIGN-bound legal declaration at mint; enables post-fact legal action | Medium -> legal deterrent against adversarial creators |
| Corrective | Creator account termination | Removes fraudulent creator | High -> prevents repeat |
| Recovery | Creator reserve escrow | CMA-authorized Stripe Connect payout holdback for N months; debited to fund refunds on substantiated dispute. Weekly/monthly payouts release funds before late-detected fraud surfaces; reserve only covers fraud detected within the payout-hold period | Low -> covers narrow dispute window only |

**Residual Risk:** Low at scale, Low per individual case. The load-bearing defense is the onboarding gate plus listing limit, not recovery: reputation-gated onboarding filters out the population most likely to commit hit-and-run fraud, and the 30/month listing limit bounds maximum monthly extraction per creator to 30 × Master price. Five fraud surfaces persist: established creators choosing to burn their reputation capital anyway (rare given structural incentives against), gaming the reputation gate via purchased channels or compromised Silver-medal accounts, sophisticated AI content evading GAN-fingerprint and artifact detection AND falsely declared as Captured or Hand-produced (the gate catches contradiction between signal and declaration, not cases where both fail simultaneously), forged rights documentation through §7.1.7's rights-resolution paths, and ghost-operator authorship (technically undetectable). Per-case impact is Low because the listing limit caps maximum monthly extraction; at-scale impact is Low because meaningful catalog contamination would require dozens of admitted creators acting fraudulently in parallel, each accepting career-ending consequences -> a structurally unlikely tail event rather than a routine concern. Reputational tail risk from a single high-profile admitted-creator fraud event remains a non-zero but low-frequency concern. Late-detected fraud beyond the payout-hold window is absorbed by the platform via direct write-down, with ESIGN-bound civil and criminal recovery clauses as a low-probability backstop against disappeared actors.


### 3.2 Creator Death or Incapacity

**Attack Scenario:**

Not an attack in the adversarial sense but a failure mode where signing authority is no longer attended by the legitimate signer. Subpaths:

1. **Sudden death.** Creator dies; credentials remain live; platform does not learn until estate notifies.
2. **Incapacitation.** Creator is medically incapacitated for extended period; family may or may not know credentials.
3. **Unreported abandonment.** Creator stops using platform but takes no affirmative retirement action.

In all three cases the signing authority is unattended, which creates exposure to opportunistic impersonation if any credential leak occurs during the unattended period.

**Mitigation: Heartbeat Protocol Plus Death-Signal Integration Plus Estate Portal**

1. **Heartbeat requirement.** Creator must perform a lightweight signed-message "liveness" check every 90 days (configurable). Not a mint, just a signed authentication event. Absence triggers minting-authority freeze until resumed or estate submits formal retirement.
2. **Social Security Death Master File integration.** Identity provider (Magic Passport or underlying KYC layer per §1.4) subscribes to SSDMF and equivalent international death-registry feeds. Match against the creator identity triggers automatic signing-authority freeze pending estate verification.
3. **Estate portal.** Dedicated workflow for estate representatives to submit death certificate, retire creator signing keys on-chain, and transition platform royalty streams to estate-designated beneficiary.
4. **Authorized posthumous continuation.** Optional feature where creator pre-authorizes release of pre-signed inventory (signed-while-alive works scheduled for posthumous release), analogous to the music industry's posthumous release conventions. Any such release is transparently flagged as posthumous to buyers.
5. **Inactivity reversion.** After 24 months without heartbeat and without estate contact, account escalates to formal abandoned-asset handling per RUUPA.

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | Heartbeat freeze at 90 days | Auto-freeze absent-creator signing | High -> bounds unattended-signing window |
| Detective | SSDMF feed integration | Automated death-signal detection | Medium -> 1-30 day lag, 90% coverage of US deaths |
| Detective | Social signal monitoring | Obituary / memorialization as weak prompt | Low -> prompts manual verification only |
| Corrective | Estate portal workflow | Formal key retirement and royalty transition | High -> legally clean succession |
| Recovery | Authorized posthumous release | Pre-signed inventory released per creator directive | Medium -> only for creators who planned ahead |
| Recovery | RUUPA abandoned-asset escalation | 24-month inactivity triggers formal handling | High -> legal disposition pathway |

**Residual Risk:** Low. The heartbeat freeze converts "detect death in real time" (unsolvable) into "detect absence of live participation within 90 days" (solvable). Creator dashboard visibility plus the 72-hour repudiation window ensure that any opportunistic forgery during the unattended window is reversible.

### 3.3 Unauthorized Reproduction and Deedless Resale of the Edition Image

**Attack Scenario:**

An attacker obtains a high-fidelity copy of a circulating edition image and then uses, shares, or sells it without the deed that authenticates ownership. The threat has two stages: acquisition of the pixels, then deedless misuse of them.

Acquisition is not confined to one vector. The four-layer glass-box display architecture (R62 Section 5.4) degrades reproductions attempted through screen capture, browser-tool extraction, or photographic recording, but a determined attacker can still produce a collector-grade copy via:

1. Professional photography of the display screen with color-calibrated equipment.
2. Multi-exposure capture assembled via post-processing.
3. Direct GPU-frame-buffer extraction on a compromised client device.
4. Assembly of a full-resolution image from multiple partial captures at different display states.

An edition image can also leak outside the display path entirely, from the holder's own stored rendering or any context in which the holder has displayed it. Pixels are not the defended surface.

The misuse stage carries the harm. The attacker does not forge a deed and does not need to: the low-effort attack is to present the copied image to a buyer who does not verify, or to circulate it as their own. The attacker acts entirely without a deed.

**Impact Assessment:**

The impact splits by victim.

Against the genuine owner, this remains a non-attack in the provenance-security sense. The owner's deed-backed edition is unaffected, since a copy does not alter authenticity or the exclusivity of the license grant. This is the physical-autograph baseline: a photograph of an autographed photograph does not reduce the value of the original, whose value is its provenance, not its uniqueness as an image.

Against a buyer, the deedless sale is a real attack. A buyer who pays the attacker receives pixels and no deed, and therefore no enforceable ownership. The harm is fraud on that buyer and, in aggregate, erosion of confidence in the Gallery resale market when deedless copies are mistaken for authentic editions. This second track is what makes the deedless sale a threat rather than a copyright nuisance.

**Mitigation: Public Verification, with Reproduction and Enforcement Controls**

1. **Public verification of the deed binding.** The primary defense. Any image can be checked against Gallery's records: the image match engine resolves a candidate image to a registered edition, and the on-chain anchor identifies the deed and its current holder. A deedless copy resolves to a registered work whose deed is held by someone other than the seller, so the §1.5 verdict exposes the sale as conveying no ownership. The attacker can move the pixels but can never produce the deed.
2. **Glass-box display degradation** (R62 §5.4) raises the cost of acquiring a collector-grade copy, defeating casual capture though not a determined professional.
3. **DMCA takedown infrastructure.** The deed's on-chain provenance record is submissible as evidence in DMCA requests, enabling removal of unauthorized reproductions from major platforms and search-engine delisting.
4. **Forensic watermark (optional layer).** Where applied, the §2.1 watermark attributes a recovered copy to a specific edition and holder via on-chain image-ID lookup, supporting reverse-image monitoring and the DMCA evidentiary path. Per Appendix B and Appendix C it is the optional, non-load-bearing layer: it adds forensic traceability but is not the control that defeats a deedless sale.
5. **Value-is-provenance framing.** Collector value derives from holding the deed-backed edition, not from possessing an image file. Buyer education reinforces that the deed, confirmed by verification, is what is being bought.

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | Public verification of the deed binding | Image match engine and on-chain anchor resolve a candidate image to its registered edition and current deed holder; the §1.5 verdict exposes a deedless copy | High; a deedless sale is verifiably detectable and conveys no ownership |
| Preventative | Glass-box display degradation | R62 §5.4 architecture raises acquisition cost | Medium; defeats casual capture, not a determined professional |
| Detective | Reverse-image monitoring | Match-engine search for unauthorized copies, with optional watermark confirmation on candidates | Medium-High; surfaces circulating copies for enforcement |
| Corrective | DMCA takedown via on-chain provenance evidence | Deed provenance record submissible as rights-holder evidence | High; Gallery is rights-holder on record with cryptographic provenance |
| Recovery | License-violation civil remedy | Contract or copyright suit against identified infringers | Medium; slow, jurisdiction-dependent |

**Residual Risk:** Low. Determined high-effort copying is not a platform security failure; it is the physical-analog baseline, and against the genuine owner it is not an attack at all. The residual exposure is the buyer track: verification makes a deedless copy detectable and verifiably worthless, but it cannot compel a buyer to verify. A buyer who never checks can still be defrauded by a deedless sale, though the genuine owner and the broader market are untouched because the attacker holds no deed. Closing that residual depends on public verifiability being easy and culturally expected, the §1.5 requirement and a verification-UX concern, rather than on any control internal to this threat. Value accrues to the deed-backed edition, which a copy cannot replicate.

### 3.4 License-Scope Overreach by Buyer

**Attack Scenario:**

A buyer, having legitimately acquired a Master with its Exclusive License, exceeds the scope granted. Examples:
1. Buyer uses the work commercially when the grant was personal-use-only.
2. Buyer sublicenses to a third party when the grant prohibits sublicensing.
3. Buyer modifies the work and attempts to claim derivative-work rights beyond the license scope.
4. Buyer publicly displays the work in a way the license does not permit.

This is a routine contract-law dispute, not a platform intrusion; but it affects creator royalty streams and, at scale, undermines the tethering guarantee the platform sells.

**Mitigation: License Drafting Precision Plus On-Chain License Tethering Plus Civil Enforcement Pathway**

1. **Tight license scope drafting.** Exclusive License template specifies field of use, territory, term, sublicensing rights, derivative-work rights, commercial use permissions, and display permissions. Ambiguity is the root cause of overreach disputes; precision eliminates most cases at drafting.
2. **On-chain license tethering.** License terms are part of the Master's on-chain metadata (R62 §4.3). Transfer of the Master transfers the license with its terms; no separate contract execution is required. This is the statutory UCC Article 12 "controllable payment intangible" or "controllable electronic record" mechanism in CER-enacting jurisdictions.
3. **Creator reporting mechanism.** Creator can flag suspected overreach through the platform; Gallery triages and provides standardized takedown and cease-and-desist templates.
4. **Civil enforcement pathway.** For substantive disputes, Gallery provides referrals to counsel familiar with digital-asset licensing; platform does not litigate on creator's behalf but facilitates the process.
5. **Public license registry.** Anyone can verify the exact license scope of any Master via the platform API, eliminating the "I didn't know what I bought" defense.

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | Precise license drafting | Template eliminates scope ambiguity | High -> prevents most disputes at formation |
| Preventative | On-chain license tethering | License travels with Master automatically | High -> statutory mechanism in Article 12 states |
| Preventative | Public license registry | Terms verifiable by anyone | High -> defeats "didn't know" defense |
| Detective | Creator flag-reporting workflow | Platform triage of reported overreach | Medium |
| Corrective | Takedown and cease-and-desist templates | Standardized first-response | Medium |
| Recovery | Counsel referral | Civil litigation pathway | Low -> slow, costly for creator |

**Residual Risk:** Low. This is ordinary contract enforcement, not a platform failure. Gallery's role is to make license terms unambiguous and discoverable and to make enforcement pathways accessible; actual enforcement is a legal-system function. UCC Article 12 statutory tethering (where enacted) reduces this to a contract-dispute category rather than an existential threat.

### 3.5 Stripe Chargeback Fraud on Primary Sale

**Attack Scenario:**

A buyer purchases a Master through the Stripe primary-sale rail, receives the Master, and subsequently files a chargeback claiming either non-delivery, unauthorized transaction, or dissatisfaction. If Gallery loses the chargeback, the platform forfeits the transaction value plus a chargeback fee (typically $15-$25) while the buyer retains the Master.

Three chargeback categories are relevant:
1. **Fraud/unauthorized** (reason code 10.4, 4837, etc.): cardholder asserts the transaction was unauthorized. Highest win rate for merchant if delivery evidence is clean.
2. **Product not received** (13.1, 4855): buyer claims the Master was not delivered. Gallery's defense is blockchain evidence of delivery.
3. **Product not as described** (13.3, 4853): structurally defeated for Gallery. The buyer views the actual Master through the four-layer glass-box display (R62 §5.4) before purchase, license scope is machine-readable on-chain metadata with explicit click-through consent, and the post-purchase display pipeline is identical to the pre-purchase preview. Authorship-misrepresentation disputes are handled separately under §3.1 through the content-authenticity dispute channel and creator reserve clawback, not as payment-rail chargebacks.

Industry baseline chargeback rate is ~0.65% of transactions; "friendly fraud" (legitimate buyers who charge back to get the product free) is the largest subset.

**Mitigation: Blockchain-Evidence Chargeback Defense Plus Stripe Radar Plus Policy Design**

The mitigation stack mirrors R25 Appendix B applied to Gallery's primary-sale category:

1. **Blockchain-immutable delivery evidence.** Master mint transaction, Arweave storage transaction, and wallet-transfer transaction all produce timestamped on-chain records. Submitted as chargeback evidence via Stripe API automation, this evidence achieves approximately 99% win rate against "not received" claims (mirroring R25 chargeback defense results).
2. **Stripe Radar ML scoring.** ~$0.05 per screened transaction; flags card-testing, velocity, stolen-card patterns pre-authorization. Gallery configures stricter thresholds than default (reduce false-negative tolerance given irreversibility).
3. **3D Secure (3DS2) mandatory above threshold.** Liability shift: 3DS-authenticated transactions push fraud liability from merchant to issuer. Gallery applies 3DS to all primary-sale transactions above $50.
4. **Clear product description and terms.** Every Master listing discloses exactly what the buyer receives (license scope, custody terms, display rights). Reduces "not as described" exposure.
5. **Cooling-off period.** Buyer may cancel purchase within 24 hours of primary sale for full refund minus Stripe fee. Converts potential chargeback into platform-managed refund.
6. **Chargeback insurance optional.** Stripe Chargeback Protection covers up to 0.4% of transaction volume for ~1% fee. Gallery evaluates per-quarter economics against in-house defense cost.

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | Stripe Radar ML scoring | Pre-authorization fraud detection | Medium-High |
| Preventative | 3DS2 authentication above $50 | Liability shift to issuer | High for authenticated transactions |
| Preventative | Cooling-off refund window | Converts potential chargebacks to refunds | Medium |
| Preventative | Clear listing disclosure | Reduces "not as described" category | Medium |
| Detective | Chargeback pattern monitoring | Flags repeat offenders | Medium |
| Corrective | Blockchain-evidence defense | Auto-submit on-chain delivery proof | Very High (~99% win vs "not received") |
| Recovery | Stripe Chargeback Protection | Absorbs residual loss at 0.4% transaction volume | Medium (cost-dependent) |

**Residual Risk:** Low. Blockchain-evidence defense is structurally strong for "not received" claims, and "not as described" is structurally defeated by pre-purchase glass-box display and on-chain license metadata. Residual exposure reduces to "unauthorized transaction" claims, handled via Stripe Radar ML scoring and 3DS2 liability shift.

### 3.6 Arweave Endowment Depletion

**Attack Scenario:**

Not an adversarial attack but an economic failure mode of the custody protocol. Arweave's model stores data permanently funded by a one-time payment at upload, with the payment sized to cover 200+ years of storage at declining storage-cost projections. If storage costs decline more slowly than projected, or if the endowment yield is lower than projected, the endowment could deplete before the intended horizon, and Masters stored on Arweave could become inaccessible.

**Assessment:**

As of October 2024 Arweave passed 10 billion transactions, and the endowment model has been empirically validated through 6+ years of protocol operation. Real-world storage cost declines have matched or exceeded the yellow paper projections. The primary risk is not near-term depletion but long-tail model uncertainty over a 50-200 year horizon.

**Mitigation: Redundant Custody Plus Protocol Diversification Plus Gallery-Controlled Hot Mirror**

1. **Hot mirror at Gallery infrastructure.** Every Master stored on Arweave is simultaneously stored in Gallery's S3-equivalent hot storage for immediate retrieval and as redundancy against gateway failures. Gallery commitment: maintain hot mirror for the life of the platform.
2. **Protocol diversification roadmap.** When additional permanent-storage protocols mature (Filecoin, Storj with permanence guarantees, IPFS with IPNS anchoring), Gallery copies Master storage across multiple protocols, reducing single-protocol dependency.
3. **Arweave economic monitoring.** Gallery tracks Arweave endowment metrics quarterly; significant deviation from projected storage-cost curves triggers evaluation of additional funding or protocol migration.
4. **Migration capability.** Gallery maintains the technical capability to migrate Master custody to a successor protocol if Arweave were to announce end-of-life. Master provenance is portable; only the file custody mechanism needs migration.
5. **Insurance investigation.** As permanent-storage insurance markets mature (currently nascent), Gallery evaluates coverage for long-tail custody failure.

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | Arweave endowment model | Protocol-level economic sustainability | High per empirical validation to date |
| Preventative | Hot mirror at Gallery | Immediate redundancy | High for short-term availability |
| Preventative | Protocol diversification roadmap | Multi-protocol custody | Medium -> maturity-dependent |
| Detective | Quarterly economic monitoring | Tracks endowment health | High -> early warning |
| Corrective | Platform-funded storage supplement | Gallery treasury funds gap if needed | High -> directly addressable |
| Recovery | Successor-protocol migration | Custody migrated if needed | High -> capability maintained |

**Residual Risk:** Low near-term, Medium long-tail. Near-term risk is low because the endowment model has been empirically validated and Gallery maintains a hot mirror. Long-tail (50-200 year) risk is inherent to permanent-custody claims in any protocol and is partially addressed through diversification and platform commitment. Buyers should understand that digital permanence claims rest on protocol sustainability; Gallery's layered approach provides defense-in-depth beyond any single-protocol dependence.

### 3.7 Arweave Protocol Compromise

**Attack Scenario:**

Adversarial compromise of the Arweave protocol itself, causing data loss or corruption across stored Masters. Categories:
1. **51% attack on Arweave consensus** (requires control of majority of storage capacity and mining rewards).
2. **Cryptographic break** in protocol primitives (SHA-2, RandomX).
3. **Critical bug in the blockweave model** allowing retroactive modification of historical data.
4. **Gateway-layer compromise** (not the protocol but the retrieval gateways).

**Assessment:**

The economic cost of a 51% attack on Arweave is high and rising with protocol adoption; current protocol economic security is measured in hundreds of millions of dollars. Cryptographic breaks are existential risks for any blockchain-based protocol and are not Gallery-specific. Gateway-layer compromise is a temporary-availability issue, not a data-integrity issue.

**Mitigation: Hot Mirror Plus Gateway Diversification Plus Cryptographic Agility Roadmap**

1. **Gallery hot mirror** (same as 3.6): every Master independently held in Gallery-controlled storage, so Arweave availability is not a single point of failure for Master retrieval.
2. **Gateway diversification.** Gallery does not depend on a single Arweave gateway; retrieval uses multiple gateways with health-check-based routing.
3. **Content integrity hashing independent of Arweave.** Each Master's SHA-256 hash is recorded on the Solana blockchain at mint. Even if Arweave data is corrupted, Gallery can detect corruption by hash comparison and reconstruct from the hot mirror.
4. **Cryptographic agility.** Master provenance signatures use standard elliptic-curve cryptography that can be rotated if a primitive is broken; protocol dependencies are tracked and migration plans exist for primitive replacement.
5. **Third-party security audit of custody pipeline.** Pre-mainnet audit includes Arweave integration, gateway selection logic, and hash-verification flow.

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | Economic security of Arweave protocol | Native protocol defense | High -> rising attack cost |
| Preventative | Hot mirror | Gallery-controlled redundancy | High -> eliminates Arweave-only dependence |
| Preventative | Content hash on Solana | Independent integrity check | High |
| Preventative | Gateway diversification | No single-gateway dependency | High for retrieval availability |
| Detective | Hash-mismatch monitoring | Flags any retrieved Master not matching on-chain hash | High |
| Corrective | Hot-mirror fallback retrieval | Automatic failover on mismatch | High |
| Recovery | Cryptographic migration capability | Primitive replacement pathway | Medium -> rare event but supported |

**Residual Risk:** Very Low near-term, Low long-tail. The hot mirror and independent content hashing isolate Gallery from Arweave protocol failure. The remaining residual is the shared existential risk common to all cryptographically-secured systems.

### 3.8 Cross-Jurisdictional Enforcement Gap

**Attack Scenario:**

UCC Article 12 (2022 amendments) provides the statutory "controllable electronic record" framework that underlies Gallery's tethered-token architecture. As of end-2025, 33 U.S. states plus DC have enacted Article 12; New York signed in December 2025 with effective date June 2026. Outside the enactment footprint, Gallery Masters fall back to general-intangible + contract law, which is a weaker enforcement basis. Non-US buyers in jurisdictions without equivalent digital-asset commercial law face even thinner enforcement.

Specific gaps:
1. **Seventeen US states not yet Article 12 enactors.** License enforcement, priority in secured transactions, and "take free" rule unavailable.
2. **Non-US jurisdictions.** No UCC equivalent. Buyer in a jurisdiction without comparable law has only contract recourse.
3. **Jurisdictional forum-shopping.** Buyer in a friendly jurisdiction may attempt to assert foreign law over the terms-of-service choice-of-law clause.

**Mitigation: Choice-of-Law Clause Plus Documentation Plus Risk Disclosure**

1. **Choice-of-law clause.** Gallery terms of service elect an Article-12 state (Delaware or California) as governing law. Enforceable in most contexts per standard conflicts-of-law rules for consumer contracts.
2. **Mandatory arbitration clause with US seat.** Arbitration in a US Article-12 jurisdiction anchors enforcement venue.
3. **License terms restated at buyer consent.** Each primary purchase includes an explicit consent click to the license scope, creating contractual tethering that operates even where statutory tethering does not.
4. **Document scope of tethering in buyer-facing materials.** Buyer disclosure: "This Master is a tethered digital autograph under U.S. law. Enforcement outside the US relies on contractual recourse and may be subject to jurisdictional limitations."
5. **Track enactment progress.** Quarterly monitoring of UCC Article 12 enactment; footprint growing, approaching uniform coverage in commercially significant jurisdictions.

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | Choice-of-law to Article-12 state | Statutory tethering applies | High -> standard conflicts-of-law respects choice |
| Preventative | Mandatory arbitration US seat | Enforcement venue fixed | High |
| Preventative | Explicit contractual tethering | Parallel to statutory | Medium-High |
| Detective | Enactment monitoring | Tracks footprint expansion | N/A |
| Corrective | Buyer risk disclosure | Informed consent to jurisdictional risk | Medium -> defeats "didn't know" |
| Recovery | Civil enforcement with contract basis | Always available; slower | Low-Medium |

**Residual Risk:** Low. Choice-of-law clauses plus contractual tethering cover the gap in non-Article-12 jurisdictions; statutory enactment is trending toward uniform coverage. Residual risk is concentrated in buyers who litigate in non-US jurisdictions against creator counterparties also in non-US jurisdictions, which is a narrow case and commercially marginal.

### 3.9 DMCA Counter-Notice Abuse

**Attack Scenario:**

An infringer who reproduces a Gallery Master without license receives a DMCA takedown notice. Rather than remove the content, the infringer files a counter-notice under 17 U.S.C. §512(g) claiming good-faith belief the material was removed in error. The counter-notice requires the service provider (YouTube, Instagram, etc.) to restore the content unless the rightsholder files suit within 10-14 business days.

A rightsholder (creator, via Gallery facilitation) then faces a binary choice: sue immediately, or let the infringing content remain. Sophisticated infringers exploit this by filing boilerplate counter-notices at scale, knowing the rightsholder cost of litigation per instance often exceeds per-case damages.

**Mitigation: Blockchain-Evidence Filing Plus Scale Reduction Plus Litigation Aggregation**

1. **Blockchain provenance as takedown evidence.** Gallery's DMCA filings include on-chain provenance, Master hash, mint timestamp, and license terms -> converting what would be a he-said-she-said dispute into an evidentiary clear case. Strong evidence discourages frivolous counter-notices because §512(f) creates liability for knowingly false counter-notices.
2. **Automated counter-notice response.** Gallery infrastructure generates a template §512(f) response for counter-notices that are boilerplate or contradict on-chain evidence, including a cease-and-desist warning of §512(f) damages.
3. **Litigation aggregation.** Where a single infringer files counter-notices across multiple Masters, Gallery aggregates into a single lawsuit across the infringer rather than filing per-Master. Economics shift back to creator favor.
4. **Trusted-rightsholder status.** Large platforms (YouTube, Meta) operate trusted-rightsholder programs with faster takedown and slower counter-notice restoration. Gallery pursues enrollment for creator benefit.
5. **§512(f) standing.** Gallery-facilitated rightsholder suits for knowing misrepresentation in counter-notices, where successful, create enforcement precedent.

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | Blockchain provenance in DMCA | Evidentiary strength | High -> deters boilerplate counter-notice |
| Preventative | Trusted-rightsholder status | Faster removal, slower restoration | Medium -> platform-specific |
| Detective | Counter-notice pattern monitoring | Flags repeat abusers | Medium |
| Corrective | Automated §512(f) response | Template cease-and-desist | Medium |
| Recovery | Aggregated litigation | Economics per-infringer not per-Master | High |

**Residual Risk:** Low. DMCA counter-notice abuse is a known feature of the legal regime; blockchain evidence strengthens the rightsholder position materially. The residual is the baseline cost of legal enforcement, which Gallery cannot eliminate but can reduce through aggregation.

---


### 3.10 Takedown Non-Compliance and Late Response

**Attack Scenario:**

The platform's exposure to legal mandates (DMCA §512(c), Take It Down Act, state NCII statutes, right-of-publicity injunctions, §2258A NCMEC reporting, court orders, foreign-jurisdiction orders) is bounded by procedural compliance. Failure to action takedown notices within statutory or judicially-determined response windows -- whether through operational backlog, classifier oversight, intentional delay, or organizational capacity gaps -- exposes the platform to safe-harbor loss, statutory penalties, and secondary-liability claims that the substantive ingestion-time gates (R62 §6.4, §7.1.5, §7.1.6, §7.1.7) cannot themselves prevent.

The threat is operational rather than adversarial: the attack vector is the platform's own response infrastructure rather than an external actor. The economic and legal consequences are nonetheless first-order.

**Platform-Reputation and Legal Impact:**

Loss of DMCA §512 safe harbor exposes the platform to statutory damages of $750 to $30,000 per work for ordinary infringement, up to $150,000 per work for willful infringement, plus attorney's fees and injunctive relief. §2258A reporting failure carries fines up to $300,000 per violation. Take It Down Act non-compliance carries federal criminal exposure and civil damages. State NCII statutes carry per-violation civil damages and criminal exposure in some jurisdictions. Foreign-jurisdiction non-compliance under EU DSA Article 16, UK Online Safety Act, and equivalent regimes carries fines up to 6% of global revenue.

The reputational layer compounds the legal layer: a single high-profile late-takedown case (especially involving CSAM, NCII, or a public-figure right-of-publicity claim) destroys platform credibility with payment processors, advertisers, and the broader market irrespective of the eventual legal resolution.

**Mitigation: Procedural Infrastructure Plus Audit Trail Plus Insurance**

1. **Statutory-clock tracking system.** Every takedown notice on receipt is timestamped, classified by regime (per R62 §4.9 dispatch table), and assigned a statutory or operationally-stricter response deadline. Automated escalation triggers if deadlines approach without resolution.
2. **Tiered response infrastructure.** CSAM and NCII receive synchronous response (within 24 hours operationally, well inside statutory windows). DMCA receives expedited response (24-48 hours). Court orders and foreign-jurisdiction demands receive case-by-case legal review with deadline tracking.
3. **Designated agent capacity.** R62 §2.4 establishes a designated DMCA agent. Takedown infrastructure scales with platform volume; staffing model and on-call rotation track notice volume.
4. **Audit trail.** Every takedown notice and platform response is recorded in append-only audit logs supporting subsequent good-faith compliance demonstrations under §512(g), §2258B, and equivalent immunity provisions.
5. **Insurance.** Cyber-liability and media-liability insurance covers takedown-non-compliance exposure. Coverage scales with platform volume and is repriced based on incident history.

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | Statutory-clock tracking | Notice timestamp, regime classification, automated escalation | High -> structural |
| Preventative | Tiered response infrastructure | Synchronous CSAM/NCII; expedited DMCA; case-by-case court orders | High -> volume-calibrated |
| Detective | Audit trail of takedown response | Append-only logs supporting good-faith demonstrations | High -> supports immunity defense |
| Recovery | Cyber-liability and media-liability insurance | Coverage for late-response exposure | Medium -> caps direct loss; does not address reputation |

**Residual Risk:** Medium. Procedural infrastructure substantially mitigates the operational failure mode but cannot eliminate it -- volume spikes, edge-case regime ambiguity, and good-faith disputes can produce response gaps that fail strict statutory timing. The audit-trail and insurance layers are the load-bearing defense for the residual cases that procedural infrastructure does not catch.


### 3.11 Adversarial Takedown Abuse

**Attack Scenario:**

An adversarial actor files takedown notices targeting the platform's deeds with the intent of harassing the creator-buyer pair or extracting concessions through the rights-disputed state's economic effects (suspended display, suspended deed-holder download, halted resale). The attack does not require valid grounds -- the §512 safe-harbor architecture obligates the platform to action notices within "expeditious" windows before validity adjudication. The economic effect on the targeted deed is felt immediately upon rights-disputed transition; resolution through counter-notice or court order takes 10-14 business days minimum.

Attack paths include:

1. **Creator-targeting harassment.** Adversary files DMCA notices against multiple Masters from a single creator, triggering rights-disputed states across the catalog and damaging the creator's revenue stream until counter-notices resolve.
2. **Resale-suppression.** Adversary times takedown notices against a deed with an active secondary-market listing, suspending the sale and damaging the seller's price discovery.
3. **Extortion.** Adversary contacts the creator privately demanding payment to withdraw the takedown threat or notice.
4. **Competitive sabotage.** Adversary tied to a competing creator files takedowns to suppress a rival creator's marketplace presence during contested launch windows or exhibition periods.

**Platform-Reputation Impact:**

Frivolous-takedown abuse damages the creator-platform relationship: creators experiencing repeated unsubstantiated takedowns lose confidence in platform protection. Aggregate abuse degrades the catalog's discoverability as legitimate Masters drift in and out of rights-disputed states. The platform's defensive posture is pinned to §512 safe-harbor procedural compliance, which limits the platform's discretion to refuse facially-deficient notices.

**Attack Economics:**

Filing a DMCA notice has near-zero cost to the adversary (no fee, online submission). The §512(f) misrepresentation penalty creates legal exposure for knowingly-false claims but is rarely litigated. The asymmetric cost structure (cheap to file, expensive to defend, slow to resolve) is the load-bearing dynamic the abuse exploits.

**Mitigation: Notice Validation Plus Counter-Notice Streamlining Plus §512(f) Enforcement**

1. **Notice-validity pre-screen.** Notices undergo automated validity checks before triggering rights-disputed: requesting party's claim of ownership, identification of the alleged infringing material, statement of good-faith belief, statement under penalty of perjury, electronic signature. Notices failing pre-screen are returned to sender for completion rather than processed.
2. **Repeat-claimant tracking.** Adversaries with patterns of unsubstantiated notices are flagged and subjected to enhanced validity scrutiny, including manual legal review before rights-disputed transition.
3. **Streamlined counter-notice infrastructure.** Creators receive automated counter-notice templates pre-filled with relevant deed metadata. Counter-notice filing is single-click for the creator with platform-provided legal-advisory text.
4. **§512(f) enforcement support.** Platform retains records of notices and counter-notices supporting subsequent §512(f) misrepresentation actions by injured creators. Aggregate adversary-pattern data is shared with creator legal counsel on request.
5. **Velocity limits on rights-disputed transitions.** Per-creator and per-deed rate limits on takedown notices prevent denial-of-service-style takedown floods. Excessive notice rates trigger legal-team review before further notices are processed.
6. **Coordination with R62 §4.9.5 adversarial-takedown protections.** R62 §4.9.5 documents the deed-side response to adversarial takedowns; this section documents the platform-side response.

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | Notice-validity pre-screen | Automated check of §512(c)(3) elements before processing | Medium -> catches facially-deficient notices |
| Preventative | Repeat-claimant tracking | Enhanced validity scrutiny for pattern adversaries | High -> identifies bad actors over time |
| Preventative | Velocity limits on takedown processing | Rate limits prevent flood-style abuse | High -> structural |
| Detective | Streamlined counter-notice | Automated templates and legal advisory | High -> reduces creator response burden |
| Recovery | §512(f) enforcement support | Records and pattern data for misrepresentation actions | Medium -> deters repeat adversaries; slow resolution |

**Residual Risk:** Medium. The §512 architecture's structural asymmetry favors notice filers, and platform discretion to refuse processing is bounded by safe-harbor compliance requirements. The mitigation stack reduces but does not eliminate the abuse surface; the load-bearing defenses are the streamlined counter-notice infrastructure (which limits creator harm to the 10-14 day window) and the §512(f) deterrent (which discourages repeat adversaries over time).



### 3.12 Owner Death Without Wallet Recovery

**Attack Scenario:**

The buyer dies without having configured wallet recovery: no Magic guardian designated, no email-account fiduciary access arranged, no will-directed wallet credentials, no beneficiary heir wallet address. The deed and its encrypted decryption key are anchored to the deceased's Magic wallet, and Magic's authentication path is typically email-based; without executor access to the deceased's email account or alternative recovery primitive, the wallet -- and therefore the deed and the encrypted Master decryption key -- becomes functionally inaccessible. The platform cannot recover the wallet because it does not hold the keys (per R62 §3.4 license-survival design and R67 §5.13 RUFADAA compliance posture).

The threat is structural rather than adversarial: it arises from the architectural choice to preserve buyer wallet control, which is also what protects buyers from platform-shutdown risk (§3.6, §3.7).

**Buyer-Asset Impact:**

The deed-as-asset becomes orphaned: the on-chain record persists immutably, but no party can transfer it on-chain or decrypt the Master. The economic value to heirs is forfeited unless wallet recovery succeeds through Magic's email-recovery path or guardian-designation path. For high-value Masters (premium-tier or museum-tier in forward-looking adjacent markets), the loss can be substantial.

The threat is buyer-borne, not platform-borne -- platform reputation is impacted only insofar as buyers learn of the inheritance complexity post-purchase rather than pre-purchase, generating dissatisfaction that should have been addressed by clear disclosure.

**Attack Economics:**

There is no adversary; the cost is asymmetric education-plus-planning failure. Buyers under-prepare for digital-asset inheritance because the asset class is novel and estate-planning conventions have not caught up. Magic's email-recovery model means many buyers' deeds are recoverable IF the executor accesses the deceased's email account, but this requires both the executor knowing to attempt it and the email provider's fiduciary-access policy permitting it. Major email providers (Google Inactive Account Manager, Apple Digital Legacy, Microsoft Next-of-Kin) provide partial fiduciary access but coverage is non-universal and procedurally complex.

**Mitigation: Disclosure Plus Education Plus Estate-Planning Integration**

1. **Buyer Master Agreement disclosure (R62 §3.4).** The BMA includes an inheritance-and-wallet-control clause directing buyers to address wallet recovery in their estate plan and disclosing the platform's structural inability to recover wallet keys. The disclosure operates as the RUFADAA Tier 3 instrument under R67 §5.13.
2. **Onboarding education.** Buyer onboarding includes a brief explainer surface covering the three layers: legal (will or trust designating heirs and a digital executor), technical (Magic wallet recovery configuration, email-account fiduciary access), and on-chain (the heir's wallet address). The explainer is presented at first purchase above a configurable threshold and is acknowledgment-required.
3. **Pre-purchase prompts at high-value transactions.** For purchases above a calibrated threshold, the platform surfaces an inheritance-planning prompt with options: review estate-planning resources, schedule a reminder to update will, integrate with estate-planning platforms (Trust & Will, Wealth.com, LegalZoom) where partnership integrations exist.
4. **Magic guardian / multi-device recovery promotion.** The platform UI promotes Magic's guardian and multi-device recovery features to buyers, with one-click setup flows where Magic supports them.
5. **Executor-disclosure pipeline (R67 §5.13).** Upon valid executor request with death certificate plus letters testamentary, the platform discloses the deceased's deed records and assists with re-encryption-to-heir-wallet upon verified on-chain transfer (which the executor must accomplish through Magic recovery or alternative key access).

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | BMA disclosure clause | Click-wrap acknowledgment of wallet-control responsibility | Medium -> ensures legal disclosure; does not change behavior |
| Preventative | Onboarding education | Three-layer explainer at first high-value purchase | Medium -> educates engaged buyers |
| Preventative | Magic guardian / recovery promotion | UI promotion with one-click setup | Medium -> reduces recovery friction |
| Detective | Executor-disclosure pipeline | RUFADAA-compliant disclosure on valid request | High -> supports legal-layer compliance |
| Recovery | Estate-planning platform partnerships | Integration referrals at purchase | Low-Medium -> structural; uptake limited by buyer behavior |

**Residual Risk:** Medium. The mitigation stack reduces but does not eliminate the buyer-side education-and-planning failure mode. The architectural choice to preserve buyer wallet control means some fraction of deeds will be lost to inheritance failures regardless of platform mitigation. The trade-off is intentional and aligned with the asset-class sovereignty thesis: the same property that produces inheritance complexity is the property that produces platform-shutdown immunity. Buyers who fail to plan are accepting the risk implicitly; the BMA disclosure is the contractual instrument that makes the risk explicit and shifts the responsibility allocation cleanly.


### 3.13 False Origin Claim

**Attack Scenario:**

An adversary claims Gallery is the source of an image they hold, when Gallery never minted, displayed, or distributed it. The asserted source link is fabricated. Motivations include litigation extortion (settlement-pressure suits), competitive sabotage (reputation attack during sensitive periods such as funding rounds or exhibitions), coordinated harassment (multiple small claims exhausting defense resources), and discovery fishing (meritless suit as pretext for compelling platform discovery of creator KYC or buyer wallet data).

The threat differs from §3.9 (external infringers using counter-notices on real Gallery content) and §3.11 (false DMCA notices against real Masters). Here the adversary fabricates the Gallery link entirely.

**Platform-Reputation Impact:**

Meritless claims generate "Gallery sued over allegedly illegal content" headlines during pending litigation, with reputational damage independent of outcome. Coordinated small-claim campaigns can impose aggregate operational burden exceeding any single-case settlement value.

**Attack Economics:**

Filing a federal civil suit costs the plaintiff $400-10,000 in fees plus counsel. Defense cost per case is $20K-100K through motion to dismiss; discovery-phase costs run $200K-1M if the suit survives initial motions. The asymmetric cost structure favors plaintiffs filing facially-weak claims for nuisance settlement value.

**Mitigation: Watermark-Based Cryptographic Proof of Non-Origin**

1. **Spectrographic deep-watermark on all circulating artifacts.** Every Master, Edition, Copy, Listing preview, and Thumbnail Gallery issues carries the §2.1 watermark (per R62 §2.1 single-watermark architecture). The watermark survives re-encoding, resizing, screenshot, partial cropping, and print-and-scan. An image carrying the watermark is provably Gallery-derived; an image not carrying it is provably not.
2. **Watermark-detection declaration.** Upon receiving a false-origin claim, Gallery runs its detector against the plaintiff's image and files a sworn declaration with detector output. Negative detection disposes of the threshold "did Gallery distribute this" element.
3. **Motion to dismiss with watermark exhibit.** Early motion at the pleading stage with the watermark-detection declaration as exhibit. Plaintiff must produce a Gallery-watermarked artifact to survive dismissal; mere assertion is insufficient.
4. **§230 and §512 procedural defenses.** For claims where watermark-detected content is established, §230 (non-IP) and §512 (copyright) procedural defenses apply per §3.9-3.11.
5. **Anti-SLAPP filings in applicable jurisdictions.** Early dismissal plus attorney-fee award against plaintiffs in California, Texas, and 30+ other states with anti-SLAPP statutes.

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | Spectrographic deep-watermark on all circulating artifacts | Watermark embedded at Edition/Copy/preview build per §3.3; survives common manipulations (re-encoding, resizing, screenshot, partial cropping, print-and-scan) | High -> binary detection answer to "is this Gallery-derived?" |
| Detective | Watermark detector run on claimed image | Returns Gallery-derived / not Gallery-derived | High -> definitive cryptographic answer |
| Corrective | Motion to dismiss with watermark exhibit | Sworn declaration disposing of threshold "Gallery distributed" element at pleading stage | High -> dismisses meritless false-origin claims early |
| Corrective | Anti-SLAPP filing | Early dismissal plus fee-shifting in applicable jurisdictions | Medium-High -> deters repeat filers |

**Residual Risk:** Low. The watermark architecture combined with the exact-hash anchor and the image match engine (per §1.5 and §3.16) produces a binary verifiable answer to "is this Gallery-derived?" that disposes of false-origin claims at the threshold. The image match engine specifically closes the Payload-Forgery-with-Re-encode-Cover gap (§3.16) -- an attacker who embeds a fake watermark payload on an unrelated image cannot pass the match-engine check against the claimed deed's recorded reference. Per-case impact is bounded by motion-to-dismiss defense cost ($20K-100K). The non-zero residual is reputational damage during pending litigation regardless of outcome, plus the risk that jurisdictions hostile to anti-SLAPP or §230 application accept facially meritless claims past motion to dismiss.

### 3.14 Server-Side Original Leak

**Attack Scenario:**

The Original (clean unwatermarked source) is held in server-side encrypted-at-rest custody (S3 Glacier IR + KMS envelope encryption per R62 §2.2 Master storage) as the canonical workhorse for every variant build across the deed's lifetime. An adversary obtains the encrypted Original bytes via one of:

1. **Platform infrastructure compromise.** AWS account credential leak, IAM role takeover, CI/CD pipeline secrets exposure, supply-chain attack on the variant-build service.
2. **Insider threat.** Platform employee with KMS Decrypt + S3 Read permissions exfiltrating Originals.
3. **Cleartext memory exposure.** Variant-build service memory dump or container disk image leaked while Originals are decrypted in working memory.
4. **Backup tier compromise.** S3 versioning, cross-region replication, or cold-archive backups under weaker key controls.

The Original is the highest-value leak target in the system because, unlike every other artifact in the protocol (Master, Edition, Copy, Listing preview, Thumbnail), it carries no §2.1 watermark. A leaked Original is image-identifiable via content-hash matching but owner-unidentifiable via watermark inspection. The leaked plaintext supplies clean unwatermarked content suitable for unrestricted redistribution.

Combined-condition scenario - buyer wallet compromise plus Original-bytes leak: under the same-DEK architecture (single per-image DEK with dual wrap; see Decryption-Key Architecture below), a buyer-wallet compromise gives the attacker decryption capability for THAT buyer's currently-owned Originals if the corresponding encrypted bytes leak. The exposure is bounded to the deeds the compromised buyer currently holds (typically a handful per buyer, not the platform-wide archive).

**Assessment:**

Platform-wide catastrophic exposure requires KMS CMK compromise, which is hardware-protected (HSM-backed; CMK material never leaves the HSM) and extremely costly to achieve. Targeted exposure (single-buyer scope via wallet-plus-bytes-leak combo) is bounded by the deeds the compromised buyer currently owns. Industry baseline for image-licensing platforms (Getty, Shutterstock, Adobe Stock, Apple Photos / iCloud, Google Photos, Adobe Creative Cloud Documents) operates on the same server-side encrypted-original model with platform-managed keys and has avoided catastrophic archive breaches over 20+ years through standard cloud-security controls.

**Mitigation: Defense-in-Depth Cloud Security Stack**

1. **AWS KMS envelope encryption.** Each Original encrypted with a per-image AES-256 DEK; the DEK encrypted (wrapped) with the platform Customer Master Key (CMK). The CMK is HSM-backed; never leaves AWS HSM; cannot be exported. Decryption requires calling KMS Decrypt API with proper IAM credentials.

2. **IAM least-privilege.** Only the variant-build service's IAM role can call KMS Decrypt on the Original-encryption CMK. Role bound to specific VPC + subnet + instance metadata service requirement. No human user, no other service, no public-facing surface has decryption capability.

3. **VPC isolation.** Variant-build service runs in a private subnet with no internet egress. All decryption operations and Original byte reads stay inside the VPC.

4. **CloudTrail audit logging.** Every KMS Decrypt operation logged with caller identity, source IP, timestamp, and encryption-context tags (image-id, requesting variant). SIEM integration flags anomalous patterns (bulk decryption, off-hours access, unfamiliar source IPs) in real time.

5. **Rate limiting on decryption.** Service-level rate limit on KMS Decrypt operations per minute per service instance. Bounds bulk exfiltration speed even under service compromise.

6. **Just-in-time decryption.** Originals decrypted into memory only at variant-build time. Cleartext bytes never touch disk. Memory zeroed immediately after variant composition. Variant-build runs in stateless containers with tmpfs only.

7. **Internal forensic marker (optional).** Variant-build service embeds a transient internal-event watermark on the decrypted Original before composing the variant (encoding image-id + decryption-event-id + service-instance-id + timestamp). The final variant payload overwrite-embeds this internal marker, but a partial composition or memory-dumped working copy retains the internal forensic marker for service-side leak attribution.

8. **AWS Nitro Enclaves for high-value images.** For high-priced or celebrity-collaboration Originals, decryption operations run inside Nitro Enclaves - hardware-isolated VMs that the host OS cannot inspect. Adds latency but eliminates the host-OS compromise surface.

9. **Two-person sensitive-operation control.** Administrative changes to the KMS CMK key policy (e.g., adding a new role to the decryption allowlist) require multi-party approval flow with audit trail. No single employee can grant themselves decryption capability.

10. **Per-incident key rotation.** On confirmed breach, KMS CMK is rotated and all Originals re-encrypted with new DEKs derived from the rotated CMK. The operation is expensive but bounded by the active Original archive size.

**Decryption-Key Architecture Rationale:**

The platform's encryption architecture pairs each image with a per-image DEK used to encrypt both the server-side Original and the on-Arweave Master. Two design alternatives were considered:

| Approach | Mechanism | Buyer wallet capability | Platform variant-build capability |
|---|---|---|---|
| **Same-DEK (chosen)** | Single per-image DEK encrypts both Original and Master. Wrapped to platform CMK at Card 2 (variant-build access) AND to current owner's wallet pubkey at Card 5 in deed metadata (license-survival access). Buyer-wrap rotates on transfer; platform-wrap is stable. | Can decrypt own Master via wallet unwrap; can decrypt own Original if encrypted bytes leak | Can decrypt Original via platform CMK unwrap; can decrypt own-stored Master via platform CMK unwrap |
| **Separate-DEK (rejected)** | Two per-image DEKs: DEK_original wrapped only to platform CMK; DEK_master wrapped only to current-owner wallet. | Can decrypt own Master; cannot decrypt Original under any conditions | Can decrypt Original; cannot decrypt on-Arweave Master without buyer cooperation |

**Tradeoff analysis underlying the choice:**

The dominant catastrophic threat - KMS CMK compromise - is unchanged by this choice; all platform-stored Originals are at risk regardless. The marginal difference appears only in the multi-condition combined-leak scenario (buyer-wallet compromise simultaneously with Original-bytes leak from S3), which exposes the compromised buyer's owned Originals under same-DEK but not under separate-DEK.

Three factors favor same-DEK:

1. **Bounded scope under same-DEK exposure.** A compromised buyer's wallet only unwraps the wrapped DEKs in the deeds that buyer currently owns - typically a handful of images per buyer, not the platform-wide archive. The leak surface area is small.

2. **Marginal-not-fundamental capability gain.** The buyer who owns deed N already has cryptographic access (via license-survival) to the on-Arweave Master for deed N, which is image-id watermarked but image-content-identical to the Original modulo the watermark. Obtaining the Original instead of the Master removes only the image-id watermark, not the visible content; this is a marginal upgrade rather than a fundamentally new capability. A determined adversary can also attempt adversarial removal of the watermark on the Master, so the Original is not the only path to unwatermarked content for the motivated buyer.

3. **Architectural simplicity.** One DEK per image with two wraps (platform CMK + buyer wallet) is operationally simpler than two distinct DEKs with separate wrap-target management. KMS operation count is lower; key lifecycle is unified per image.

The architectural decision is **same-DEK**. Per-image DEK lifecycle: generated at Card 2 with platform-KEK wrap; additional buyer-wallet wrap added at Card 5 mint; buyer-wrap rotates on each transfer via the Metaplex Core UpdateDelegate plugin; platform-wrap stable for the lifetime of the Original.

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | AWS KMS HSM-backed CMK | Hardware-protected; non-extractable | High |
| Preventative | IAM least-privilege | Variant-build service sole CMK Decrypt principal | High |
| Preventative | VPC isolation | No internet egress from variant-build service | Medium-High |
| Preventative | Just-in-time decryption | Cleartext in memory only, never on disk | Medium-High |
| Preventative | Nitro Enclaves (high-value tier) | Hardware-isolated VM excludes host OS | High where applied |
| Preventative | Two-person control on KMS policy | Multi-party approval for capability changes | High |
| Detective | CloudTrail audit logging | Every Decrypt operation tagged with caller + context | High |
| Detective | SIEM anomaly alerting | Bulk / off-hours / unfamiliar-IP patterns flagged | High for in-flight detection |
| Detective | Internal forensic marker (optional) | Decryption-event-id on transient working copy | Medium |
| Corrective | Rate limiting on Decrypt | Bounds bulk exfiltration speed | High |
| Corrective | Per-incident KMS rotation | Re-key all Originals on confirmed breach | Medium -- significant operational cost |
| Recovery | Cyber-liability insurance | Coverage for breach notification, IR, legal | Medium |

**Residual Risk:** Low to Medium. Dominant residual is sophisticated insider threat or AWS-platform-level supply-chain attack that bypasses HSM protections - both well outside Gallery's elevated-threat profile relative to industry baseline. Combined buyer-wallet-compromise plus Original-bytes leak is bounded to single-buyer scope and is operationally rare. Per-MVP scope (10 founder-vetted creators, ~100 Originals at first measurement window), the lean control posture (KMS + IAM least-privilege + CloudTrail + rate limiting; no Nitro Enclaves, no two-person control) is sufficient; the full stack including hardware-isolated decryption activates at MMP scale.


### 3.15 Mint Authority Compromise (Watermark Verification Implications)

**Attack Scenario:**

The mint authority keypair, custody-protected through the signing-authority pipeline documented in R35, signs two distinct classes of Gallery transaction:

1. **Deed mint at Card 5.** Creates the on-chain ownership record (existing scope; controls per §3.1 et seq.).
2. **Variant-hash attestation.** At each non-circulating variant build event - Card 5 (on-Arweave Master), Card 6 (Edition per owner), and §7.5 Master download (platform-delivered Master ordinal per owner) - the mint authority signs a Solana transaction recording `(variant_identity, sha256(canonical_pixels))` to deed metadata. The Listing preview and Thumbnail (Card 2) and the Copy (Card 6) are public-circulation variants delivered through the CDN and are not on-chain-anchored per R62 §7.4 -- their verification routes through the off-chain match engine and, for the Copy, the in-pixel URL text. The on-chain mapping is the cryptographic anchor underlying §1.5 Public Verifiability and §3.16 Payload-Forgery defense for Master and Edition.

An adversary holding the mint authority keypair (or coercing a signing operation through the pipeline) could:

1. **Bind a forged image hash to a legitimate variant identity.** Sign a deed record mapping `(image_id_X, variant_E, edition_5)` to the hash of a forger-supplied image, defeating §3.13 False Origin Claim defense for that variant.
2. **Selectively suppress variant-hash records.** Omit on-chain records for specific variants, producing variants with no verifiable anchor. Public verifiers cannot distinguish "platform never recorded" from "this variant is forged."
3. **Mass-corrupt the watermark verification corpus.** Both attacks scale across the entire Gallery footprint, not a single deed, while the compromise remains undetected.

**Assessment:**

Severity Critical because the entire §1.5 public-verifiability guarantee rests on the integrity of mint-authority-signed records. Two structural properties bound the realized damage:

**Anchor only, not gatekeeper.** The mint authority records `(variant_identity, image_hash)` on-chain; any third party reads the record through public Solana RPC without platform credentials. Compromise of the mint authority does not break verification *access* (anyone can still query); it breaks verification *correctness* (the recorded hash for affected variants may be attacker-supplied).

**Asymmetric protection from Solana finality.** Once a legitimate record is finalized on-chain, an attacker cannot retroactively overwrite it. The vulnerability is therefore one-directional: damage bounds to records signed during the active compromise window. Pre-compromise records remain trustworthy and continue to support public verification.

**Public detectability.** Because variant-hash records are public, sustained compromise produces observable on-chain anomalies. External observers - secondary marketplaces, forensic examiners, the §A.6 C2PA verifier corpus, academic monitoring - can independently detect divergence between recorded hashes and the variants in circulation. Detection is not dependent on platform cooperation.

**Mitigation: Existing Mint-Authority Protection Controls**

This threat does not introduce a new attack surface. The mint authority is already mission-critical for §3.1 (deed mint) and §3.13 (False Origin Claim defense). The existing controls cover variant-hash attestation without modification:

1. **HSM-backed keypair custody.** Mint authority private key held in cloud HSM (AWS CloudHSM or equivalent); key material non-extractable; signing operations require API call to HSM. Identical custody posture as deed-mint signing.
2. **Multi-party signing-pipeline control.** Variant-hash transactions, like deed-mint transactions, route through the R35 signing-authority pipeline. No single operator can produce a signature unilaterally; programmatic invocation requires service-role credentials separated from human user credentials.
3. **Schema-constrained signing service.** The variant-hash signing service accepts only payloads matching the Metaplex variant-hash schema (fixed structure: `{variant_identity, sha256, build_event_timestamp}`). Free-form payloads, payloads with mismatched schema, or payloads referencing nonexistent deeds are rejected before the HSM is called.
4. **CloudTrail and SIEM anomaly detection.** Every mint-authority signing operation logged with caller, context, and structured payload. SIEM flags out-of-pattern volume (e.g., burst of variant-hash records without corresponding variant-build pipeline events), off-hours signing, signing from unexpected service principals, and payload patterns inconsistent with normal Card-2/5/6 build cadence.
5. **72-hour repudiation window on variant-hash records.** Newly recorded `(variant_identity, image_hash)` mappings enter a repudiation window mirroring §3.1's deed-mint 72-hour window. Verification consumers treat records within the window as provisional; platform incident response can flag and revoke an unauthorized record before it becomes authoritative.
6. **Pre-mainnet third-party audit.** Mint authority and signing pipeline subject to independent audit before mainnet launch, covering both deed-mint and variant-hash attestation flows.
7. **External public-detectability surface.** Because §1.5 makes the verification corpus open, sustained compromise produces detectable hash-divergence patterns observable by any third party with sample variants in hand. This converts mint-authority misbehavior from an insider-only signal into a market-visible signal.

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | HSM-backed mint-authority key | Hardware-protected; non-extractable | High |
| Preventative | Multi-party signing pipeline (R35) | No single-operator signing path | High |
| Preventative | Schema-constrained signing service | Free-form or off-template payloads rejected | High |
| Detective | CloudTrail + SIEM on signing operations | Burst, off-hours, off-pattern detection | High |
| Detective | External public-detectability surface | Third-party observers detect record/image-hash divergence | Medium-High |
| Corrective | 72-hour repudiation window on variant-hash records | Revocation window before consumers treat as authoritative | High |
| Recovery | Pre-mainnet third-party audit | Independent validation of signing pipeline | High |

**Residual Risk:** Low. The mint authority is already protected at the level required by the deed-mint threat model. Extending the authority's role to variant-hash attestation does not increase the attack surface beyond what existing controls cover. The dominant residual is the same sophisticated insider or HSM-platform compromise that bounds §3.1, with the public-detectability surface providing additional out-of-band detection. Combined with §1.5's structural property that verification is open to all parties, even an undetected compromise window has bounded fraud capacity before external observers detect divergence between on-chain records and circulating variants.


### 3.16 Payload-Forgery-with-Re-encode-Cover

**Attack Scenario:**

An attacker holds an arbitrary image (not Gallery-emitted, not derived from any Gallery work). Using the public §1.5 extractor SDK in reverse, the attacker embeds a Gallery-style watermark payload onto the image. The payload references a real existing deed and a plausible variant identity (e.g., `image_id = abc12 / variant = C / edition = 05 / owner = 03`). The attacker then circulates the fabricated artifact and claims it is a Gallery-distributed Copy:

1. Verifier (court forensic examiner, secondary marketplace, journalist, opposing counsel) runs the §1.5 verification flow on the suspect image.
2. SDK extracts the payload -> valid 10-char base-36 structure.
3. Solana query for deed `abc12` -> deed exists with creator and owner.
4. Recompute `sha256(canonical_pixels)` -> mismatches the recorded hash for `C+05` of deed `abc12` (because the attacker's image bytes are unrelated to the genuine Copy).

Under sha256-only verification, the verdict is **Modified Gallery artifact** -- watermark identity recovered, hash mismatch -- which the attacker can plausibly attribute to benign re-encoding (Instagram round-trip, mobile compression, screenshot). The verdict ambiguity is the attack surface.

The attack supports several downstream patterns:

1. **§3.13 False Origin Claim amplification.** Attacker fabricates Gallery-distributed content as the basis for litigation extortion, defamation, or competitive sabotage. The watermark identity gives the false-origin claim a surface plausibility that the §3.13 watermark architecture was designed to defeat.
2. **Creator defamation.** Fake explicit, infringing, or politically charged content attributed to a real creator via fabricated watermark.
3. **Market manipulation.** False scarcity or fake "early Gallery work" claims propagated through social media with surface verification.
4. **Mass-scale fabrication.** The attack is per-image trivial, so coordinated campaigns producing hundreds or thousands of fake "Gallery" artifacts are operationally cheap.

**Attack Economics:**

Per-image cost: seconds of compute. The watermark SDK is open-source (§1.5 requirement); the embedding operation is symmetric (encoder and decoder both in the SDK, per the StegaStamp-class commodity-infrastructure design). The schema is documented in R62 §2.1. No platform credentials are required. Discovering a real deed to claim against is a one-time effort (any public deed page); reusing the same target deed against many fake images is trivial.

Defense cost without mitigation: high. Each meritless false-origin claim defeated by sha256 mismatch alone is vulnerable to the re-encoding excuse, requiring expert testimony or extended discovery to falsify the claim. Per-case defense cost matches §3.13's $20K-100K motion-to-dismiss range, multiplied across the volume of coordinated attacks.

**Severity:**

High. The attack is cheap, scales arbitrarily, can target any creator or deed, and produces verification results that require manual investigation rather than binary cryptographic disposition. It directly undermines the §3.13 False Origin Claim defense by exploiting the ambiguity in the "Modified Gallery artifact" verdict.

**Mitigation: Off-Chain Image Match Engine**

The on-chain variant-hash map records `{variant_identity: sha256}` for the non-circulating variants only (Master, Edition, and their owner-ordinal successors) per R62 §7.4 -- a single exact hash per recorded variant, with no perceptual fingerprint recorded on-chain. The discriminating control for public-circulation variants (Listing preview, Thumbnail, Copy) is the off-chain image match engine: a Gallery-operated service that resolves a suspect image against Gallery's registered corpus of Originals and emitted variants. It returns a match for an artifact altered only by mild manipulation (JPEG re-encoding, modest resize, screenshot, format conversion) and a non-match for an unrelated image; its security contract is stated in Appendix C, and its matching method is a protocol detail specified in R62. The engine is rebuildable from Gallery's owned corpus and depends on no on-chain or vendor-specific artifact. Verification verdicts become four-state per §1.5; the Payload-Forgery attack falls into the Forged state because the attacker's unrelated image fails the match-engine comparison against Gallery's registered corpus for the claimed deed.

| Verifier observation | Attacker's image | Legitimate re-encoded Copy |
|---|---|---|
| Watermark recovered | Yes (attacker embedded it) | Yes (survives re-encoding) |
| sha256 match | No (different image bytes) | No (re-encoding changed bytes) |
| Match-engine verdict | **No match** (content unrelated) | **Match** (content unchanged) |
| Verdict | **Forged** | **Modified Gallery artifact** |

The on-chain sha256 anchor remains the tamper-evident public primitive: mint-authority-signed on Solana, finality-protected against retroactive modification, and queryable via public RPC (per §1.5 and §3.15). The match engine adds no on-chain surface -- it operates entirely off-chain over Gallery's registered corpus -- so the mitigation requires no new cryptographic infrastructure and no change to the on-chain variant-hash schema.

**Controls:**

| Type | Control | Mechanism | Effectiveness |
|---|---|---|---|
| Preventative | Off-chain image match engine | Resolves a suspect image against Gallery's registered corpus; returns no-match for an unrelated image and a match for a legitimately re-encoded variant; on-chain sha256 anchor unchanged | High; closes the verdict ambiguity that the attack exploits |
| Detective | Four-state verification widget (deed page) | Renders Authentic / Modified / Forged / Not Gallery-generated distinctly to verifiers | High; users immediately see whether the claim is genuine or fabricated |
| Detective | Forensic SDK reporting | Public SDK returns a structured verdict surfacing the sha256 comparison and the match-engine result | High; supports automated provenance checks by secondary marketplaces and forensic firms |
| Corrective | Cross-reference with §3.13 motion-to-dismiss | Sworn declaration includes match-engine non-match evidence | High; converts ambiguous claim into definitively disposed claim |
| Corrective | Anti-SLAPP filing for repeat fabricators | Statutory fee-shifting in applicable jurisdictions | Medium-High; deters coordinated campaigns |

**Residual Risk:** Low. The mechanism closes the attack class structurally: any unrelated image fails the match-engine comparison against Gallery's registered corpus for the claimed deed. The remaining residual is the narrower **Re-watermark-with-Different-Owner-Ordinal** attack class -- an attacker who (a) obtains a real Gallery Copy and (b) successfully removes its watermark and re-embeds with payload claiming a different owner of the same deed could pass both the sha256 (with re-encoding excuse) and the match-engine check against Gallery's registered corpus, because the image visually matches the claimed deed's actual Copy with only an imperceptible watermark difference. This attack class requires sophisticated watermark-removal-and-re-embed capability AND possession of a real Copy. It enables false attribution but does not transfer asset ownership or fabricate the existence of a Gallery work; the deed itself is unaffected. Cryptographic payload signing would close this residual fully but is infeasible due to watermark payload-size constraints (Ed25519 / BLS / Schnorr signatures all require 384-512 bits vs the 52-bit current payload). The architectural decision: accept the narrow residual against the much wider Payload-Forgery-with-Re-encode-Cover attack, which the image match engine closes at trivial implementation cost.

---

## 4. CONCLUSIONS

### 4.1 Defense Effectiveness

Gallery's architecture demonstrates defense-in-depth against platform-specific threats. Of 16 vectors, 3 are addressed by design, 11 mitigated to Low residual by layered controls, 1 remains a Low-severity baseline, and 1 retains Medium residual by architectural choice. Load-bearing mechanisms: 72-hour mint repudiation, reputation-gated creator onboarding plus 30/month listing limit, heartbeat plus SSDMF cross-check, Arweave hot mirror with Solana hash integrity, blockchain-evidence chargeback defense, on-chain sha256 variant-attestation as the §1.5 verification anchor with an off-chain image match engine as the §3.16 payload-forgery defense, and KMS-backed envelope encryption with IAM least-privilege on the server-side Original.

### 4.2 Residual Risk Assessment

| Risk | Severity | Notes |
|---|---|---|
| Unauthorized Reproduction and Deedless Resale | Low | Verification exposes a deedless copy as conveying no ownership, and against the genuine owner it is not an attack; residual is the buyer who does not verify, which depends on verification being easy and culturally expected |
| License-Scope Overreach | Low | Routine contract enforcement |
| DMCA Counter-Notice Abuse | Low | Baseline legal-process cost; blockchain evidence strengthens rightsholder position |
| False Origin Claim | Low | Watermark architecture produces binary cryptographic answer at threshold; residual is defense cost through motion to dismiss and reputational damage during pendency |
| Mint Authority Compromise | Low | Existing R35 signing-pipeline controls cover variant-hash attestation; public detectability via §1.5 surface provides out-of-band detection; damage bounds to compromise window via Solana finality |
| Payload-Forgery-with-Re-encode-Cover | Low | The off-chain image match engine, resolving suspect images against Gallery's registered corpus, discriminates fabricated watermarks on unrelated images from legitimately re-encoded Gallery variants; closes verdict ambiguity that §3.13 defense depends on |

Museum-tier workflows, secondary-sale attacks, and general cybersecurity threats (credential attacks, device security, telco-layer, wallet key loss) are out of scope and addressed separately.

### 4.3 Regulatory and Consumer-Protection Implications

Gallery meets or exceeds PSD2 SCA and FFIEC MFA standards at the authentication layer. UCC Article 12 enactment in 33+ states creates statutory tethering supporting Gallery's license-enforcement claims. Identity-proofing at creator onboarding follows standard platform-security practice per NIST SP 800-63-4 (PAD and injection attack detection as distinct normative requirements) and is out of scope for this threat model. Pre-mainnet third-party audit of mint-authority and custody pipelines remains a prerequisite.

---

## 5. REFERENCES

**Cross-Document Dependencies:**

- **Document R13 (DAO Token Design):** Exclusive License structure and on-chain license metadata anchoring; used in Sections 3.4 and 3.8.
- **Document R25 (DAO Platform Security):** Immunefi v2.3 severity framework, control-type taxonomy, scope-definition methodology (platform-specific threats only), and blockchain-evidence chargeback defense mechanics (R25 Appendix B) adapted to Gallery primary-sale context in Section 3.5.
- **Document R35 (DAO Web2 Abstraction):** Server-side Mint Authority, identity-based PDAs, and Transfer Hooks underlying the signing-authority pipeline.
- **Document R39 (Multi-Entity Legal Architecture):** Choice-of-law framework and arbitration seat selection referenced in Section 3.8.
- **Document R42 (Money Transfer Compliance Analysis):** Stripe Connect flow, 3DS2 application, and chargeback defense economics referenced in Section 3.5.
- **Document R58 (Crypto Regulation Compliance):** UCC Article 12 enactment tracking and CER-classification alignment referenced in Section 3.8.
- **Document R62 (Digital Art Protocol):** Four-layer glass-box display architecture (§5.4), NFT Market Security Countermeasures (§5.7), and authentication procedure (§4.1) underlying Sections 3.3 and 3.4.

**Analysis Code:**

- **R65_Gallery_Security_analysis.py** - Attack-cost economics for creator content misconduct and chargeback fraud; forged-mint capacity simulation under velocity-limit and repudiation-window parameters; Arweave endowment sensitivity analysis.
- **R65_attack_economics.py** - Break-even-listings calculator for Appendix A.2 attack pathways across a range of creator-set listing prices; CLI scenario flags for gallery-take, stripe-fee, sell-through, and price grid.

**External References:**

All external sources cataloged in **Reference.txt**. Entries used in this document: arweave-2024, immunefi-2023, moringiello__odinet-2022, stripe-2024, stripe-2026, striperadar-nodate, magiclabs-2026, 17usc-1976, nist-sp80063-2025, iso-30107-3-2017, ucc-article12-2022, carta-etal-2022, group-ib-2025, ruupa-2016, c2pa-2025, krawetz-c2pa-2024, krawetz-untrusted-certs-2024, krawetz-pixel10-2025, google-pixel10-2025, nodle-click-2024, proofmode-2026, lumethic-cameras-2026, zhao-etal-2024, liang-etal-2025, cao-etal-2026, denny-2026.

---

## APPENDIX A. CAPTURE-SOURCE COMPARISON AND ATTACK ECONOMICS

This appendix documents Gallery's C2PA verification architecture and intake policy. With a strict verification policy -> A.6's signer whitelist, full-chain validation, required capture-source origin, action assertion filter, AI-assertion filter, and eight operational policies -> C2PA verification can serve as a security gate. Gallery does not enforce mandatory-C2PA intake at the current creator-supply tier because adoption among silver and established creators is too low for a universal mandate without losing the supply Gallery's market position depends on (A.7 documents the leverage analysis and the tiered intake plan). At present scale, the §1.4 reputation gate plus ESIGN-bound attestation plus the composite gate's other layers provide the binding authenticity constraint; A.6's verifier output contributes as one signal among many when C2PA is present. The tiered intake policy in A.7 makes C2PA mandatory at the future 10K+ scale tier where Gallery has the market position to set the requirement and where the emerging creator base operates on phones that emit C2PA cheaply.

The architectural reason a strict verification policy is necessary if C2PA is going to be used as a gate at all: C2PA provides **authentication** (a cryptographically tamper-evident signed claim by a signer) but not **validation** (verification that the signed claim is factually true or that the signer is properly authorized) [krawetz-c2pa-2024]. The authorization gap is structural at two levels. First, C2PA's trust model itself does not use industry-standard certificate authorities (CCADB-listed); it uses its own self-signed root certificates and distributes its own certs, with vetting criteria that do not require CCADB inclusion [krawetz-untrusted-certs-2024]. Second, even via the industry-standard CA path, anyone can purchase a CA-issued signing certificate (approximately $230/year from DigiCert): CAs like DigiCert verify entity legitimacy (business registration, contact information per CA-Browser Forum standards) but do not verify authorization over specific content claims. C2PA's trust list also includes non-CCADB paths (C2PA-distributed certs, self-signed roots submitted to C2PA's trust list) where no comparable entity vetting occurs, and validators cannot distinguish vetted from unvetted signer paths without inspecting the cert chain. The truth gap is equally structural -> C2PA surfaces declarations the signer makes; it does not verify them. A.6's verifier components and operational policy address what a strict verifier can address; A.7 explains why Gallery applies that verifier conditionally rather than universally given current market position.

The remaining sections quantify the economic implications and document the verifier and policy architecture. The capture-source comparison (A.1) maps C2PA-capable sources against verification-relevant dimensions. The attack-pathway table (A.2) ranks adversarial methods with tool and capital estimates. The specification comparison (A.3) details the two specs side by side, the break-even analysis (A.4) computes listing volumes required to recover attacker capital, and A.5 notes what the specs do not defeat plus Gallery's architectural response. A.6 documents Gallery's C2PA verifier implementation -> five components plus eight operational policies. A.7 documents the tiered intake policy -> silver tier optional, emerging tier mandatory at the 10K+ scale -> and the market-leverage analysis behind it.

### A.1 Capture-Source Comparison

Four canonical sources representative of Gallery's CA allow-list (the only signers accepted for C2PA verification): two consumer phone applications conformant or compliant with the C2PA standard, one phone platform with hardware-attested signing, and one professional camera body with dedicated signing silicon. Compared on the dimensions that drive verification policy.

| Dimension | Click [nodle-click-2024] | ProofMode [proofmode-2026] | Pixel 10 [google-pixel10-2025] | Pro camera (Leica M11-P) [lumethic-cameras-2026] |
|---|---|---|---|---|
| Platform coverage | iOS, Android | iOS, Android | Pixel 10 family only | Camera body, factory provisioned |
| C2PA Conformance Program | Not certified (compliant implementation) | Android Conformant (May 2026); iOS pending | Assurance Level 2, highest defined | Conformant Generator Product |
| Hardware signing | Phone secure element via c2pa-rs mobile bindings | Phone secure element plus hardware attestation (Android Play Integrity, iOS App Attest) | Tensor G5 with Titan M2 (Android StrongBox) | Dedicated secure chipset, certificate provisioned at factory |
| Certificate authority | Nodle PKI (centralized, mobile-scale issuance) | Self-signed on device combined with hardware attestation | Google C2PA CA (hardware-backed) | Leica Camera AG manufacturer CA |
| Tamper-evident timestamp | Ethereum transaction reference per manifest | Optional Filecoin/IPFS notarization | On-device offline timestamp plus Google timestamp service | Manufacturer-CA-bound timestamp (no chain anchoring) |
| RAW image export | No (JPEG, HEIC only) | No (JPEG, MP4, HEIC, AAC, M4A) | Yes (DNG, computational pipeline; multi-frame fusion baked in pre-write) | Yes (DNG, sensor-true single-frame) |
| Camera settings carried in signed manifest | Limited: device model, location, timestamp | EXIF plus hardware-attestation assertions | Full EXIF including computational-pipeline metadata | Full EXIF: aperture, shutter, ISO, focal length, focus distance, white balance, lens model |
| GPS in signed manifest | Yes, capture-time, mandatory | Yes, capture-time, optional precision obfuscation | Yes, capture-time, optional | Variable: Leica M11-P requires GPS accessory; Sony Alpha uses paired-phone GPS; Nikon Z6III uses paired-phone GPS |
| Variable-aperture support | No (fixed f/1.5-2.8) | No (fixed f/1.5-2.8) | No (fixed f/1.7) | Yes (f/1.4-f/22 depending on lens) |
| Source code | Closed | Open source (GitLab) | Closed | Closed |
| Capital cost to creator | $800-1,200 (phone) | $800-1,200 (phone) | $999-1,199 (Pixel 10) | $9,195 (Leica M11-P body) |

Three implications follow:

First, the variable-aperture column matters more than it appears. Phone capture cannot support the aperture-versus-depth-of-field consistency check that hardware cameras enable. For scenes whose rendered depth-of-field would only be physically consistent with a specific aperture, hardware capture provides a forensic signal phone capture cannot.

Second, Pixel 10's "RAW" output is computational. The DNG written by Pixel Camera embeds the results of multi-frame fusion, Smart HDR, and Night Mode processing before flushing to storage. PRNU extraction from a Pixel 10 DNG is materially weaker than from a Leica M11-P DNG because the sensor's per-pixel fingerprint is partially averaged out across the merged frames [krawetz-pixel10-2025]. RAW availability per se is not interchangeable across sources.

Third, the trust topology splits cleanly across three patterns. Click and Pixel 10 anchor to organization-controlled CAs (Nodle, Google). ProofMode anchors to device hardware attestation with self-signed certificates. Pro camera anchors to manufacturer CA only. Each pattern carries distinct trust assumptions and enumerates a distinct chain type.

### A.2 Attack Methods Ordered by Cost

Each row produces an image carrying credentials that a conforming C2PA verifier would validate as cryptographically intact. Time per image assumes a practiced operator with a pre-configured rig and batched workflow. The C2PA architectural critique underlying these attacks is documented in [krawetz-c2pa-2024]; the Pixel 10-specific weaknesses in [krawetz-pixel10-2025].

| # | Attack | Tools required | Capital (8x10 JPEG) | Capital (20x30 TIFF) | Time per image | What it defeats |
|---|---|---|---|---|---|---|
| 1 | Unsigned AI generation | Stable Diffusion (local), Midjourney, Flux, DALL-E 3 | $0 | $0 | 1-3 min | Permissive trust list (any C2PA or no C2PA accepted) |
| 2 | AI plus C2PA-valid signing cert | Item 1 plus any valid C2PA signing path: C2PA's own distributed certificates, self-signed root via C2PA trust list, or paid commercial CA cert ($230/yr DigiCert) plus c2patool | $0-$230/yr | $0-$230/yr | 3-5 min | Any verifier conforming to C2PA's trust model (industry-standard CCADB not required) |
| 3 | Ingredient laundering | Real legitimate signed source RAW (from creator's own legitimate camera) plus Lightroom plus AI editor | $800-1,200 | $800-1,200 | 15-25 min | Chain-of-edits verifier that does not cross-verify ingredient-to-final content similarity |
| 4 | Phone display recapture | AI tool plus phone (Click, ProofMode, or Pixel 10) plus 4K monitor plus tripod and framing mount | $1,500-2,500 | $6,000-7,000 | 4-7 min | Phone-authenticated tier; most EXIF-consistency checks (fixed aperture and close-focus norms apply) |
| 5 | Pro-camera display recapture | AI tool plus Leica/Sony/Nikon body plus 4K HDR monitor plus framing rig | $9,500-13,000 | $15,000-16,000 | 5-8 min | Hardware-camera tier for non-landscape scenes; aperture/DOF check requires careful settings choice |
| 6 | Pro-camera with collimator | Item 5 plus collimating optics (Schmidt-Pechan system or large objective reversed) to project screen to infinity focus | $11,000-30,000 | $24,000-25,000 | 8-12 min | All EXIF consistency including focus-at-infinity landscape checks |
| 7 | Pro-camera print recapture | AI tool plus archival inkjet printer (Epson SureColor or equivalent) plus pro camera plus studio strobes | $12,000-18,000 plus $2-5/image | $15,000 plus $15-25/image | 12-20 min (incl. print drying) | All EXIF consistency; all C2PA cryptographic checks; screen-recapture forensic signals (no moire, no refresh artifacts) |
| 8 | Secure-element compromise | Laser fault injection rig, focused ion beam, side-channel analyzer, expert labor | $100,000+ | $100,000+ | Weeks-months R&D per chip family | Any C2PA gate trusting the compromised manufacturer's CA |
| 9 | Manufacturer-CA compromise | Social engineering, supply-chain attack, insider threat | Nation-state level | Nation-state level | Months-years | Everything chained to the compromised CA |

The 8 x 10 JPEG spec assumes a 4K monitor source and no specific print-size requirement (matching the tooling above). Under the 20 x 30 TIFF spec, the phone tier (Attack 4) sees a larger jump because the format constraint requires a top-tier 50 MP+ phone plus reference-grade display. Pro-camera and collimator tiers (Attacks 5-6) rise more modestly because pro bodies in the $9-13K range already exceed 50 MP (Leica M11 at 60 MP, Sony A7R V at 61 MP, Fujifilm GFX100 II at 102 MP); the increase reflects a marginal upgrade plus calibrated-display requirements.

Attack 7 capital and per-image variable cost assume in-house printing on an owned printer; outsourcing to a print house would shift costs from capital to per-image variable and change the break-even profile.

PRNU clustering and pattern-detection forensics become effective against attacks 4-7 once listing volume crosses a detection threshold. Attacks 8-9 require state-actor-class resources and are outside the scope of platform-level cryptographic gates.

### A.3 Specification Comparison

R62 Gallery Protocol contemplates two candidate deliverable specs whose differences govern attacker economics:

- **20 x 30 TIFF spec**: 300 DPI minimum, TIFF-only encoding, 54 MP source resolution (6,000 x 9,000 pixels).
- **8 x 10 JPEG spec**: 300 DPI minimum, JPEG at >95% quality, 7.2 MP source resolution (2,400 x 3,000 pixels).

The two sit at opposite ends of the print-grade band. The 20 x 30 TIFF spec is a wall-piece deliverable for large-format collector display; the 8 x 10 JPEG spec is a portfolio-print deliverable for standard-frame display. Each implies a different attack-economics regime. Effects are purely on capital floors and per-image costs that govern break-even arithmetic.

| Dimension | 20 x 30 TIFF spec | 8 x 10 JPEG spec |
|---|---|---|
| Print size | 20 x 30 inches | 8 x 10 inches |
| Minimum DPI | 300 (hard) | 300 (hard) |
| Source resolution (min) | 54 MP (6,000 x 9,000) | 7.2 MP (2,400 x 3,000) |
| Required file format | TIFF (16-bit) | JPEG (>95% quality) |
| Typical delivered file size | 150-300 MB | 3-8 MB |
| AI generator native output | Rare (most emit PNG/JPEG) | Common (most emit JPEG natively) |
| Phone C2PA native output | Not supported (Click, ProofMode, Pixel Camera emit JPEG) | Native (no transcoding) |
| Transcoding required post-recapture | Yes (JPEG/PNG/HEIC -> 16-bit TIFF) | No (JPEG -> JPEG) |
| Phone tier eligibility | Top-tier only (50 MP+ sensors) | Any modern phone (12 MP+ clears 7.2 MP) |
| Archival print cost per image | $15-25 | $2-5 |
| Archival print time per image | 25-60 min (incl. drying) | 5-15 min (incl. drying) |

### A.4 Break-Even Shifts at $50 List

Break-even count at $50 list under each candidate spec at midpoint capital, computed at 10% Gallery take, 3% Stripe fee, and 40% sell-through, ignoring labor and detection cost:

| Pathway | 20 x 30 TIFF spec | 8 x 10 JPEG spec |
|---|---:|---:|
| 3 Ingredient laundering | 57 | 57 |
| 4 Phone recapture | 374 | 115 |
| 5 Pro-camera recapture | 891 | 632 |
| 6 Collimator recapture | 1,408 | 1,149 |
| 7 Print recapture | infinite at $50; 1,014 at $100 | 1,079 |

The 20 x 30 spec figures are computed by `R65_attack_economics.py --scenario 20x30-tiff`. The 8 x 10 spec figures are computed by `R65_attack_economics.py --scenario 8x10-jpeg`. Pathway 3 (ingredient laundering) is the cheapest C2PA-valid attack: a $1,000 phone produces a signed source whose hash becomes the ingredient reference in an AI-edited final, and Gallery's standard-C2PA acceptance with hash-only ingredient references leaves no automatic content-similarity check available. Capital is identical across both specs because the AI editor outputs at any required resolution. The 20 x 30 spec produces a break-even roughly 3x the 8 x 10 spec on the phone tier (374 vs 115), 1.4x on pro-camera (891 vs 632), and 1.2x on collimator (1,408 vs 1,149). The gap is largest on the lowest-capital recapture pathway because the format constraint is what compresses the phone tier; the higher-capital pathways are less affected because the qualifying equipment already clears 54 MP. On the print pathway, the 20 x 30 spec is loss-making at $50 (variable cost exceeds expected revenue) and only becomes recoverable above approximately $100 list, while the 8 x 10 spec keeps the print pathway contribution-positive at all relevant prices.

Break-even falls sharply with list price under both specs. At $1,000 list, the phone-tier break-even drops to approximately 19 listings under the 20 x 30 spec and 6 under the 8 x 10 spec; the collimator tier drops to approximately 70 and 57 respectively. Cryptographic gates that suffice at $50 listing become structurally insufficient as per-listing fraud revenue rises toward attacker capital.

### A.5 What the Constraints Do Not Defeat

Format and resolution requirements raise the floor of the attack distribution materially under the 20 x 30 spec; they barely move it under the 8 x 10 spec. Neither changes the architecture. A sufficiently capitalized attacker can still produce a compliant TIFF at 54 MP or a compliant JPEG at 7.2 MP carrying a cryptographically valid C2PA chain through any of pathways 4-7. The 20 x 30 spec lengthens the equipment list, raises the listing volume required to recover that equipment, and slows per-image throughput. The 8 x 10 spec changes none of these except adding a small per-image variable cost to the print pathway. Both specs are observational inputs to the cost model, not gates.

C2PA does not prove a picture is real. It only proves the file carries a semantically valid signature. The signature can be made by an unauthorized signer. The signed content can be fake. It's not possible to verify the signer is authorized or the content is real. C2PA does protect the signer's ability to prove authorship of what they signed (the signer registers with a CA and cannot later deny their signature); it does not protect the buyer's ability to determine authenticity of what they are buying.

Gallery's response to the authentication-vs-validation gap: the deed package authenticates the creator's claim and validates what is verifiable -> timestamp on Solana, file integrity by content hash, identity binding by Stripe Connect KYC, content uniqueness by spectrographic watermark -> while accepting that the underlying scene's authenticity is unverifiable by any current technology and is therefore controlled by reputation selection at onboarding (§1.4) rather than by cryptographic attestation. Critically, every signer in the deed package is verified through Gallery's onboarding (creator: KYC plus reputation gate per §1.4; buyer: Stripe KYC plus wallet binding; platform: institutional key management), so signer identity is verified to a consistent standard for every signature in contrast to C2PA where identity vetting varies by which CA issued the cert (DigiCert verifies entity legitimacy; C2PA-distributed certs and self-signed roots in C2PA's trust list do not) and where no CA verifies signer authorization over specific content claims.

The capital figures in this appendix are floors derived from publicly available equipment pricing as of May 2026; actual attacker capital may be higher with operational overhead (rigging, lighting, calibration, PRNU diversity acquisition through multiple bodies) but the break-even direction is robust to those adjustments.

### A.6 Gallery's C2PA Verifier Implementation

This subsection documents Gallery's implementation of the C2PA verifier role. A.6 applies whenever C2PA is present in a submission, regardless of the intake policy under which the submission was accepted. A.7 documents the intake policy itself -> when C2PA presence is required versus optional -> and the market analysis behind it.

**What C2PA verification delivers:**

A C2PA verifier confirms that the manifest chain was signed by holders of private keys whose certificates chain to an approved set, that the hashes in each manifest match the asset state at the time the manifest was applied, and that the chain has not been tampered with between signer and verifier. The cryptographic claim is faithful delivery of the signers' assertions, not validation of the assertions themselves -> what a signer asserts about capture device, GPS, timestamp, action history, or AI use is delivered intact; the truth of those assertions is anchored in the legal and reputational structures the signer operates within. Gallery's verifier supports this claim and applies the policy choices below to determine which signer assertions Gallery accepts for the authentic-photograph tier.

**Five components of the verifier implementation:**

1. **Signer whitelist applied to every cert in the manifest chain.** Gallery maintains a curated subset of the C2PA Trust List as the set of signers it accepts: cameras (Leica, Sony, Nikon, Canon, Fujifilm, Panasonic bodies shipping C2PA; Pixel 10+; Apple if shipped), capture apps (ProofMode, Click), and editing software (Adobe Creative Cloud excluding AI-generation tools). Every certificate in every manifest's chain must terminate at a whitelisted vendor.

2. **Full-chain validation at intake.** Validation walks every manifest in the manifest store rather than only the active manifest. Each hard binding (hash) is verified against the asset state at the time that manifest was applied, and every ingredient assertion is verified against the referenced ingredient manifest's hash. Any broken link in the chain rejects the file. This detects modify-then-resign patterns where a non-C2PA-aware tool modifies the image between two C2PA signing events.

3. **Required capture-source origin in chain.** The chain must contain a whitelisted capture-source signer (camera or capture app) as the origin manifest. This closes chain-stripping variants where a claim generator removes a broken parent and starts a fresh chain from itself.

4. **Action assertion filter.** Manifests containing `c2pa.removed`, `c2pa.placed`, or `c2pa.combined` are rejected -> these signal substantive content alteration that Gallery does not accept in the authentic-photograph tier. Routine darkroom-equivalent adjustments (exposure, color grading, white balance, sharpening, cropping, tone curve) are permitted, attributed in the chain by whitelisted tools, and do not trigger rejection.

5. **AI-assertion filter.** Any manifest carrying AI assertions anywhere in the chain is rejected. Gallery's authentic-photograph tier does not list AI-tool-touched content; the AI-assertion filter enforces this at the signer-assertion level. This is a tools-used claim about the documented chain, not a depicted-content claim about the photographed subject -> a real camera photographing AI on a screen carries no AI assertions and passes this component.

**What the verifier confirms:**

- The chain of manifests was delivered intact.
- Every signer in the chain holds a certificate chaining to a Gallery-approved vendor.
- A whitelisted capture-source signer appears as the chain origin.
- No `removed`, `placed`, or `combined` action assertion appears.
- No AI assertion appears in any manifest.
- The signers' assertions about capture device, action history, and content hashes were faithfully delivered.

**What the verifier does not confirm:**

- The truth of any signer's assertions. C2PA delivers assertions intact; assertion truth is anchored downstream in the signer's accountability structures.
- Pre-capture scene reality. A whitelisted camera honestly photographing a screen, print, projection, or staged composite produces an intact and clean chain. Scene construction has been a property of photography since 1839 -> Daguerre staged still lifes, Civil War photographers repositioned bodies, Sherman, Crewdson, and Wall built their careers on fabricated scenes -> and no provenance technology in the 185-year history of the medium has certified the relationship between a photograph and any underlying reality. Scene construction is bounded by capital plus skill plus opportunity cost plus the layers outside A.6 (see filter table below), not by A.6 itself.
- Absence of AI in the depicted content. Component 5 confirms no AI tools touched the file within the documented chain; it does not confirm the photographed subject was not AI.

**Scene-construction filter (operating outside the verifier):**

| Filter | Floor under Gallery configuration | Effect |
|---|---|---|
| Capital | $1,500-$2,500 phone display recapture; $9,500-$30,000 pro-camera tier (Table A.2) | Eliminates zero-capital opportunists |
| Photographic skill | 3-10+ years of practice to commercial-quality output; portfolio development; compositional and lighting craft | Sellable aesthetic quality is a precondition |
| Recapture sub-skill | Moiré suppression, refresh-rate matching, screen-camera angle, color-profile chaining, framing to hide bezels, focus on flat subject without revealing flatness | Excludes general photographers who lack the specific sub-specialty |
| Studio-staging sub-skill | Production design, set construction, model direction, costume, multi-source lighting -> approaches filmmaking-level production for Crewdson-class staged work | Excludes attackers lacking production capability |
| Opportunity cost | Skilled photographers have legitimate revenue paths -> Gallery's own creator base, gallery representation, commercial work, licensing | Effective cost is $100K-$500K in foregone earnings, dwarfing equipment capital |
| Reputation capital (§1.4) | Reputation gate requires established creator history | Self-selects creators with most to lose |
| Legal exposure (ESIGN) | Bilateral wallet signatures plus Stripe Connect KYC plus Vermont 12 V.S.A. §1913 presumption | Adds civil and criminal exposure per fraudulent mint |
| Listing limit | 30 mints per month per creator | Caps per-identity damage |
| Spectrographic watermark | Catalog-wide uniqueness check | Forces per-listing unique content |

**Verifier operational policy:**

Gallery's verifier implementation includes the following operational policies to align with sound C2PA verification practice:

1. **Validator pinning.** Gallery specifies the validator implementation and version used at intake (e.g., `c2patool v0.x.y`). The validator identity and version are recorded in each deed package alongside the validation result so future re-validation has a deterministic baseline.
2. **Manifest archival.** The original C2PA manifest binary is archived to Arweave alongside the encrypted master file. Future re-validation can use the historically-correct manifest bytes regardless of intervening spec or validator evolution.
3. **Validation order.** Manifest parsing and cryptographic validation of the local manifest complete before any external network fetch (trust-list refresh, CRL lookup, sidecar retrieval). External fetches are predicated on successful local validation, preventing the verifier from being used as a reflection surface by malformed inputs.
4. **Metadata handling.** Non-essential metadata (GPS coordinates beyond city-level resolution, hardware serial numbers, full EXIF) is stripped before propagation to buyer-visible surfaces unless the creator opts in to disclosure.
5. **Parser isolation.** The C2PA validator runs in a sandboxed process with no network access during validation, strict resource limits, and crash isolation from the rest of the intake pipeline.
6. **Rate limiting.** Per-source-IP and per-submitting-wallet rate limits at intake bound abuse of the validator surface.
7. **Whitelist management.** Gallery's signer whitelist is a Gallery-controlled policy artifact, updated on creator petitions for new tools, new C2PA-emitting tools shipping, detected abuse from a previously whitelisted vendor, or upstream revocation events. Updates take effect at intake within hours of decision. The whitelist is always a strict subset of the C2PA Trust List. The current whitelist membership and the criteria Gallery applies are published in Gallery's verifier documentation; revisions are versioned and historical whitelist states are retained alongside archived manifests so each deed package can be re-validated against the whitelist state in effect at mint time.
8. **Independent timestamp anchoring.** Gallery's authoritative "when" for each mint event is the Solana transaction timestamp at the slot in which the deed minted. The C2PA signing timestamp within the manifest is logged as informational metadata, not the basis of Gallery's temporal claim. If the two diverge materially, the discrepancy is surfaced in the deed package rather than reconciled. This anchors the temporal element of each deed in an infrastructure independent of the signing certificate's validity window.

**Composite intake gate (verifier as one layer):**

A.6 is one layer in Gallery's composite gate. The full stack:

| Layer | Mechanism | What it filters |
|---|---|---|
| A.6 (this section) | Verifier implementation with five components plus operational policy | Confirms intact delivery of approved-signer assertions when C2PA is present; closes the C2PA-defeatable pathways for any submission that carries C2PA |
| R62 §6.4 GAN-fingerprint and model-artifact detection | Content-analysis detection of AI residue in pixels | Catches AI tells visible in pixels regardless of C2PA state |
| R62 §6.7 image match engine | Catalog-wide and open-web duplicate detection | Forces unique content per listing; catches LAION-scale theft |
| ESIGN attestation | Bilateral signatures plus KYC plus Vermont presumption | Legal exposure per fraudulent mint |
| §1.4 reputation gate | Creator vetting and reputation-capital requirement | Adversely selects skilled creators with most to lose |
| Listing limit | 30 mints per month per creator | Caps per-identity damage |
| Spectrographic watermark | Catalog-wide uniqueness check | Detects duplication; forces per-image content investment |

**Architectural conclusion:**

A.6 implements C2PA verification within the role the specification defines, with Gallery-curated policy choices on signer set, action filters, and AI-assertion filter, and operational policy choices on validator pinning, manifest archival, validation order, metadata handling, parser isolation, rate limiting, whitelist management, and independent timestamp anchoring. The verifier confirms what C2PA delivers -> intact assertion chain from approved signers -> and the composite gate handles what sits outside the verifier role. Scene construction sits outside C2PA's scope by design of the medium and is bounded by capital plus skill plus opportunity cost plus reputation plus ESIGN plus listing limit plus spectrographic watermark. Gallery monitors the C2PA patent policy as a future-state consideration: if the policy shifts to fee-based licensing or another commercial structure that materially changes the cost equation, Gallery is positioned to layer alternative attribution systems in parallel without reworking the composite-gate architecture, since C2PA contributes one verifier layer rather than the entire trust model.

### A.7 Tiered Intake Policy

A.6 documents the verifier mechanics -> what happens when C2PA is present. A.7 documents the intake policy -> when C2PA is required versus optional. The policy is tier-conditioned, and the conditioning reflects Gallery's actual market position at each creator-supply tier rather than an architectural preference.

**Why universal mandatory C2PA is not viable at launch:**

Two compounding reasons make a universal mandate fail on the established creator tier today.

1. **Gallery lacks the platform brand status to dictate hardware requirements to established creators.** Gallery is a new platform competing for scarce high-leverage supply. Silver and established creators have working alternatives -> traditional gallery representation, Foundation, Exchange.art, OpenSea, direct sales, print channels, commercial assignment work. They do not need Gallery; Gallery needs them for initial legitimacy, marquee names, market signal, and the quality bar that distinguishes Gallery from open NFT marketplaces. Demanding that an established photographer purchase a $9,500-$13,000 C2PA-emitting body, or even spend the setup time to install ProofMode, before listing means they list somewhere else. The supply-side leverage runs the wrong direction; Gallery cannot make the requirement stick on this tier.

2. **Mandating C2PA on established creators signals distrust of reputation the market already trusts.** Independent of cost, requiring a photographer with decades of recognized work to prove capture-authenticity cryptographically tells them Gallery does not trust the brand capital the market has already validated. The requirement adds no marginal trust value -> buyers already trust the creator because of their work history -> while signaling that Gallery treats established creators as suspect by default. Established creators have economic anchors that bind them to honest attestation more tightly than cryptography would: gallery contracts, commercial work, named-creator value, multi-decade reputation capital, all of which would be forfeited on a single fraud finding at a forfeiture cost measured in hundreds of thousands to millions of dollars.

The two reasons compound: even if the gear were free, the distrust signal would still be wrong; even if the signal were neutral, the leverage would still be insufficient.

**Where the leverage flips:**

At the 10K+ scale tier (future state, when Gallery has the market position to set requirements on emerging creators), the leverage flips. Emerging creators want access; Gallery provides the audience, deed package, payment rails, and curation. The C2PA requirement is satisfiable cheaply -> Pixel 9 or Pixel 10 ($400-$700), or free apps (ProofMode, Click) on existing phones. Gallery's value proposition exceeds the friction cost for creators without established channels. The supply side is large; Gallery does not need any specific emerging creator. The mandate carries no distrust signal because there is no established reputation to discount.

**Tier-conditioned intake:**

| Tier | Market position | C2PA at intake | Primary binding constraint |
|---|---|---|---|
| Silver / established | Creator leverage > Gallery leverage; many alternatives | Optional; A.6 verifier output is one signal among many when C2PA is present | §1.4 reputation capital -> forfeiture cost dominates economics; ESIGN attestation; content analysis; listing limit; spectrographic watermark |
| Emerging (10K+ scale tier, future state) | Gallery leverage > creator leverage; access to deed infrastructure and curated audience is the creator's primary alternative | Mandatory at intake, no downgrade path | A.6 verifier implementation -> closes pathways 1-3; capital floor rises from $0 to $1,500+ |

**Pathway analysis under each tier:**

*Emerging tier (mandatory C2PA with no downgrade).* The no-downgrade premise binds, and the closure arguments below hold:

- Pathway 1 (pure AI, no C2PA) -> intake rejection.
- Pathway 2 (AI with non-whitelisted signing cert) -> A.6 component 1.
- Pathway 3a (AI editing in C2PA chain) -> A.6 component 5.
- Pathway 3b (substantive manual edits attributed) -> A.6 component 4.
- Pathway 3c (modify-then-resign with chain break) -> A.6 components 2 plus 3.

Capital floor for any C2PA-defeatable attack on the emerging tier rises from $0 to $1,500+ (Table A.2 pathway 4) or $9,500+ (pathway 5). The zero-capital opportunistic-fraud population is eliminated for this tier.

*Silver tier (C2PA optional).* Pathways 1-3 are not eliminated at intake by A.6; they are bounded by the composite gate's other layers. The binding constraints on this tier are different in character but stronger in magnitude: §1.4 reputation capital forfeiture cost for a named-creator fraud finding is measured in hundreds of thousands to millions of dollars; ESIGN plus Vermont §1913 attestation creates direct civil and criminal exposure; the creator's other revenue channels (gallery, commercial, licensing) impose opportunity costs that dwarf any per-image $50-list fraud gain. The silver tier's economic structure binds it more tightly than mandatory C2PA would bind the emerging tier.

**Creator-population implication for the emerging tier:**

Mandatory C2PA at the 10K+ scale restricts the emerging-tier creator base to those operating C2PA-emitting tools: Pixel 9/10 native camera (default on, hardware-backed), ProofMode on Android, Click on iOS or Android, and any C2PA-emitting phone or app shipping during the period. The hardware bar is low because phones suffice; cost is $0-$700 capital. This is reasonable preselection for an emerging-tier intake -> creators willing to install a free app or spend $400 on a Pixel are exhibiting the same minimal-investment signal any platform requires of new participants.

**Architectural conclusion for the tiered model:**

The tiered intake policy aligns Gallery's gating mechanism with Gallery's actual market position at each creator-supply tier. At launch and through the silver/established creator phase, reputation does the binding work and C2PA is informational. At the 10K+ scale tier (future state), C2PA becomes mandatory and the verifier in A.6 becomes load-bearing for that tier. The two-tier configuration is not an architectural compromise; it is the photographic market's actual hierarchy -> established artists are vouched for by their bodies of work, emerging artists are vouched for by credentialing infrastructure -> applied to Gallery's intake gate. Gallery defers to reputation where reputation works, and applies cryptography where reputation has not yet been built. The transition from emerging tier to silver tier is the natural promotion arc as a creator's reputation capital accumulates and the technical scaffolding becomes redundant.

---

## APPENDIX B. INVISIBLE WATERMARKING CAPABILITY AND FORENSIC ROLE

This appendix documents the invisible-watermark layer specified in R62 §2.1 and carried on every circulating Gallery artifact per §1.5. Appendix C established by scenario analysis that the watermark is the optional layer of the three-layer verification anchor and that the image match engine is load-bearing. This appendix examines the watermark layer on its own terms -> what it can do, how readily it is removed, and the forensic roles it should and should not be assigned. It does not revisit the Appendix C comparison; it documents the layer.

The framing principle parallels Appendix A's authentication-versus-validation gap for C2PA. An invisible watermark is an identifier-delivery mechanism, not an authenticity proof. It answers "does this artifact carry a Gallery-issued payload" and, paired with the on-chain anchor, "which deed, variant, and holder does that payload name." It does not answer "is this image genuine," "does the bearer own it," or "has the payload been forged." Those questions are answered by the deed, not by the pixels. The watermark is forgeable by construction and removable by a determined adversary; both properties are documented below. Its value is forensic convenience -> crop-surviving per-holder attribution at low cost -> not cryptographic assurance.

The remaining sections proceed as follows. B.1 documents what the watermark layer can and cannot do. B.2 quantifies removal -> the two adversarial classes, which defeats the §2.1 watermark and which does not, and why. B.3 states where the watermark belongs: an informational feature for the accidental-leak case, not a security control.

### B.1 Capabilities and Functional Limitations

The §2.1 watermark embeds a machine-readable payload below the threshold of human perception, recoverable by a decoder. It is distinct from a visible watermark, which announces itself and can be cropped or painted out. The payload is the 10-char base-36 identity string -> image ID (5) plus variant (1) plus edition (2) plus owner ordinal (2), approximately 52 bits -> written at each variant-build event, so a recovered artifact decodes to (master, variant, instance within a Limited mint, Nth holder) via on-chain image-ID lookup. The watermark is built to survive incidental transformation: re-encoding, resizing, partial cropping, screenshot capture, color-space conversion, and print-and-scan. That survivability is what makes it forensically useful -> a leaked Copy that has passed through several social-media re-encodings still decodes. Its distinct contribution, the one capability no other layer provides, is crop-surviving per-holder attribution: identifying which of N holders of a deed was the source of a leak, even from a fragment. The watermark's construction is a StegaStamp-class deep encoder-decoder, specified in R62 Appendix E; method-class selection is a protocol matter and is not revisited here.

The functional limitations are the more important half of the picture.

1. **The imperceptibility-robustness-capacity trilemma.** These three properties are mathematically coupled; no scheme maximizes all three. A scheme tuned for survivability sacrifices either invisibility or payload size. Gallery's schema is deliberately small (~52 bits) to buy robustness headroom.
2. **It is forgeable.** The watermark encoder is symmetric with the decoder, and §1.5 requires the extractor SDK be public. Anyone can embed any payload into any image. A watermark therefore proves nothing on its own; a detected payload is evidence only when cross-checked against the on-chain anchor, which is exactly what the §3.16 defense does.
3. **The payload is too small to self-authenticate.** Practical capacity for a robust scheme is roughly 52 to 100 bits. A cryptographic signature (Ed25519, BLS, Schnorr) requires 384 to 512 bits. The payload cannot carry its own signature; this is the structural reason §3.16 anchors trust in the on-chain record rather than in the payload.
4. **It does not bind ownership.** The payload is a label that names a deed; it is not the deed. Possession of a watermarked artifact is not ownership, just as possession of a printed photograph is not ownership of its copyright.
5. **It does not attest reality.** A valid Gallery payload attests only that the artifact passed through Gallery's variant-build pipeline. It does not attest that the photographed scene is real, un-staged, or AI-free. This is a strictly weaker claim than C2PA's (Appendix A): C2PA at least delivers a signer's capture-device assertion, while the watermark delivers only pipeline passage.
6. **It does not survive a determined adversary.** Documented in B.2.

| Question | Watermark layer answer |
|---|---|
| Does this artifact carry a Gallery-issued payload? | Yes, by decoder extraction, subject to B.2 removal |
| Which deed, variant, edition, and holder does the payload name? | Yes, by payload decode plus on-chain image-ID lookup |
| Did a specific holder's copy leak, surviving a crop? | Yes -> the layer's distinct contribution |
| Has the payload been forged onto an unrelated image? | No -> requires the on-chain anchor (§3.16) to determine |
| Does the bearer own the work? | No -> the deed answers this |
| Is the photographed scene real, un-staged, or AI-free? | No -> outside the layer's scope entirely |

### B.2 Adversarial Removal

Beyond the incidental transformations the watermark is built to survive, it is exposed to deliberate removal. Removal attacks split into two classes that differ fundamentally in cost, in what they defeat, and in what they leave behind.

| Class | Methods | Effect on the §2.1 StegaStamp watermark |
|---|---|---|
| Cheap, non-regenerative | Classical distortion (JPEG, noise, blur); Deep-Image-Prior frequency separation [liang-etal-2025]; spectral-codebook subtraction [denny-2026] | Largely fails -> StegaStamp resists this entire class |
| Generative regeneration | Diffusion-based regeneration [zhao-etal-2024]; no-box regeneration variants [cao-etal-2026]; removal followed by AI super-resolution | Succeeds -> defeats the watermark, but leaves an exploitable residue |

The cheap class is not a practical threat to the §2.1 watermark. Classical distortion fails because StegaStamp is trained against it. The Deep-Image-Prior frequency-separation attack fails because StegaStamp embeds in the low and mid bands, which the attack cannot separate from image content [liang-etal-2025]. Spectral-codebook subtraction does not transfer: that technique discovers a watermark's fixed, model-level carrier frequencies and phase template -> a codebook stable across all images -> and subtracts it, and it has been demonstrated against fixed-template schemes such as Google's SynthID [denny-2026]; the StegaStamp encoder produces a per-image, learned, content-dependent perturbation, so there is no fixed codebook to discover and subtract. A casual redistributor armed with the commodity toolkit does not strip the §2.1 watermark. One secondary cost of the §1.5 public-extractor requirement is noted for completeness: publishing the decoder enables a decoder-guided (GradCAM-localized) attack on the watermark-bearing pixels. This does not change the assessment, because the effective removal attack -> generative regeneration -> is decoder-blind and succeeds whether or not the extractor is public.

The generative-regeneration class does defeat it. The work in [zhao-etal-2024] proves, with formal guarantees rather than only empirically, that any pixel-level invisible watermark within a bounded perturbation is removable by regeneration, and demonstrates it across four schemes including StegaStamp. The capability is current and commodity: 2026 work continues to lower the bar, with no-box regeneration variants such as MarkSweep [cao-etal-2026] removing watermarks without any access to the watermarking model. A defense argument that regeneration deters because it degrades image quality does not hold -> AI super-resolution restores quality after removal, and removal followed by super-resolution is not an escape from the regeneration class but an instance of it, since super-resolution is itself a generative reconstruction step.

Regeneration nonetheless leaves a specific, exploitable residue, and this is what keeps the §2.1 watermark's removability from being a clean attacker win. Regeneration outputs a resynthesized image, never the original bytes, so it fails the on-chain sha256 unconditionally. It also places the attacker in a dilemma on the image match engine. A faithful regeneration -> one that preserves the image well enough to retain resale value as the genuine work -> remains perceptually close enough that the image match engine still identifies the artifact as a copy of that work. An unfaithful regeneration that diverges far enough to break the match link is no longer perceptually the same work, and is therefore neither a saleable copy of it nor a credible forgery of that specific deed. The attacker cannot simultaneously keep the artifact identifiable as the work and escape match-engine linkage.

The honest summary: the §2.1 watermark is not removable by a casual actor and is removable by a determined actor with a diffusion model. The determined-actor capability is real and now commodity. But what removal yields is a laundering capability -> a clean-looking unauthorized copy with no extractable payload -> not an ownership-forgery capability. The deed is untouched: minting requires the mint-authority keypair, deed records are immutable after Solana finality, and a regenerated artifact is neither in those records nor byte-identical to them. This matches the conclusion the broader content-provenance industry has reached -> invisible watermarking is treated as one recoverable soft layer in a multi-layer stack, never as the trust anchor, with the cryptographic binding carrying the load.

### B.3 Forensic Deployment -> Where the Watermark Belongs

The watermark is an informational feature, not a security control. Its function is to identify which holder a leaked Copy originated from -> useful when a holder accidentally lets a Copy escape, since decoding supports operational follow-up. An accidental leak, however, is not an attack: it falls outside the threat model entirely. Against any adversary the watermark is bypassable (B.2), so it must carry no security or trust role. R65's guarantees rest on the on-chain deed and the content anchor; the watermark adds informational value for the accidental case and nothing more.

---

## APPENDIX C. AUTHENTICITY-LAYER SCENARIO ANALYSIS

The §1.5 verification architecture combines three content-binding layers on every circulating artifact: the §2.1 invisible watermark carrying the 10-char identity payload, the exact-hash anchor (the on-chain sha256 content hash, cHash), and the image match engine. This appendix isolates the contribution of each layer by examining two reduced configurations against the full three-layer baseline.

The image match engine is the mitigation capability that, given a candidate image, determines whether it corresponds to a registered Gallery work. R65 treats it as an abstract capability bound by a fixed security contract; the implementation (learned-deep embedding, keypoint matcher, or hosted equivalent) is a protocol detail specified in the Gallery Protocol (R62). The contract has three terms. First, the robustness envelope: the engine returns a match for an artifact altered only by JPEG re-encoding, modest resize, screenshot, or format conversion, and a non-match for an unrelated image, with crop and occlusion robustness left as an envelope decision for R62. Second, output semantics: the engine returns a graded similarity score rather than a binary answer, so a verdict requires a published threshold and the §1.5 verdict is multi-state by construction. Third, the trust term: §1.5 third-party verifiability rests on the exact-hash anchor, which any verifier recomputes independently without trusting Gallery. The match engine is a Gallery-operated robustness layer rather than an on-chain primitive; its algorithm and threshold are published and it is rebuildable from Gallery's owned corpus, so its verdicts are reproducible and auditable rather than a proprietary black box. The analysis below depends on the contract, not the implementation.

- **Scenario 1 -> exact-hash anchor + match engine, no watermark.** Verification reverts to content-derived matching: a suspect image is identified by sha256 comparison and match-engine lookup against Gallery's registered corpus, with no embedded payload to extract.
- **Scenario 2 -> exact-hash anchor + watermark, no match engine.** The §1.5 four-state verdict collapses to three states; the "Modified Gallery artifact" and "Forged" verdicts merge into one ambiguous state.

The table lists only the threats whose mitigation weakens in at least one scenario. Threats whose mitigations do not draw on the watermark or match-engine layers (§3.1, §3.2, §3.4-§3.12, §3.14, §3.15) are unaffected and omitted. §3.15 records one fewer attestation field under Scenario 2 but its signing-authority controls are unchanged.

| Threat | Baseline (watermark + exact-hash anchor + match engine) | Scenario 1 (exact-hash anchor + match engine, no watermark) | Scenario 2 (exact-hash anchor + watermark, no match engine) |
|---|---|---|---|
| §3.3 Unauthorized Reproduction and Deedless Resale | Public verification (match engine + on-chain anchor) resolves a candidate image to its registered edition and current deed holder, exposing a deedless copy; the watermark adds optional forensic attribution of a recovered copy | Minimal impact. The watermark is the optional layer; verification still exposes a deedless copy and resolves the deed holder. Only forensic per-holder attribution of a recovered copy is lost. Residual unchanged. | Weakened. The match engine is the primary control here; without it a re-encoded deedless copy no longer resolves by content lookup, and detection falls back to exact-hash, defeated by re-encoding, and the optional removable watermark. Exposing a deedless resale becomes materially harder. Residual rises. |
| §3.13 False Origin Claim | Watermark detector gives a fast binary "Gallery-derived?" answer; the exact-hash anchor and match engine close the watermark-forgery sub-case | Weakened marginally. The watermark fast-path is lost; verification reverts to match-engine lookup, which still disposes of a fabricated image by content non-match. §1.5 third-party self-service weakens slightly (hosted lookup versus an open extractor SDK). Residual stays Low. | Weakened. The watermark-forgery sub-case (the §3.16 amplification path) re-opens; the bare-assertion sub-case is still defeated by the watermark detector. Verification of forged-payload claims reverts to platform-attested investigation. Residual rises Low -> Medium. |
| §3.16 Payload-Forgery-with-Re-encode-Cover | The off-chain image match engine yields a four-state verdict; a forged payload on an unrelated image fails the match check and resolves to Forged | Not weakened -> eliminated. With no watermark there is no payload to forge; the attack class ceases to exist. | Severely weakened. The image match engine is the sole mitigation. The four-state verdict collapses to three; a forged artifact returns the ambiguous "Modified Gallery artifact" verdict with a re-encoding excuse. Detection remains possible via off-anchor content comparison but the independently verifiable §1.5 verdict is lost, reverting to platform-attested investigation. Residual rises Low -> High. |

The two layers are not symmetric in load-bearing weight. Scenario 1, removing the watermark, leaves every threat's residual band intact: §3.16 ceases to exist outright, §3.3 is affected only minimally, and §3.13 weakens marginally. The watermark's distinct contribution is crop-surviving per-holder attribution, a capability Gallery makes no platform promise to provide. Scenario 2, removing the match engine, moves residual bands: it breaks §3.16 (Low to High), degrades §3.13 (Low to Medium), and weakens §3.3, whose primary control it is. The image match engine is the load-bearing layer of the §1.5 verification anchor. If a layer must be removed, the watermark is the lower-cost removal; the image match engine is not.

Scenario 1 is a design counterfactual -> Gallery omits the watermark layer and the cHash stays valid on a genuine artifact -> not the state of an attacker-handled artifact. An attacker who strips the watermark from a circulating Copy does so by regeneration, which co-breaks the cHash; the realistic attacker-removed state is therefore match-engine-only, one surviving layer fewer than Scenario 1, and is analyzed in §3.16 and Appendix B.

**Visible versus invisible implementation.** The watermark layer can be built invisible (the §2.1 choice, a payload embedded below perception) or visible (a seal, edition mark, or overlay). The scenario conclusions above are invariant to that choice: visible or invisible, the watermark is a removable identifier layer, the exact-hash and match-engine analyses do not depend on it, and the load-bearing finding holds. Three results do differ. On removal, an invisible mark is stripped only by whole-image regeneration, which is costly, decoder-blind, and visually clean, and so feeds the §3.16 re-encoding-excuse ambiguity; a visible mark is stripped by cropping or inpainting, cheaper and localized, but the result is visibly retouched or recropped, so removal is more self-evidencing. On casual-leaker attribution, an invisible mark survives a leaker who does not know it is present, so the §3.3 per-holder decode works for the casual case; a visible mark is seen and trivially cropped, so per-holder attribution fails even casually. On provenance presentation, a visible mark also provides point-of-viewing provenance that travels with the file, which neither the invisible mark nor the backend deed does, though that benefit sits outside the verification-anchor scope this appendix analyzes.

---
