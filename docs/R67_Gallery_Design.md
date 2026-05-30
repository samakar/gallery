# Gallery Design

---

## SUMMARY

R67 is the canonical Gallery design document. It consolidates the ownership-feeling foundation (§2), the identity framework (§3), the four-layer framework and ownership rights (§4), the design-decision rationale (§5), the legal-and-ownership posture (§6), and the historical-failure record (Appendix B) that constitute Gallery's design intent. Each design decision in §5 carries an inline Implementation tail pointing to the engineering specification that carries the implementation detail. R67 is the entry-point reference for product reviewers, technical due diligence, and partner-facing audiences.

R67 covers what design choices were made and the reasoning behind them. It does not document engineering specifications (interfaces, encryption schemas, storage mechanics, mint and transfer flows) or detailed market analysis (sizing, segmentation, AOV, GTM, growth modeling). Those concerns live in downstream specialty documents (R45 Portal Technical Spec, R65 Gallery Platform Security).

Each §5 subsection cites its analytical justification (drawn from §2, §3, §4, and §6) inline and closes with an Implementation tail naming the downstream specs (R45 Portal Technical Spec, R65 Gallery Platform Security, R42 Money Transfer Compliance Analysis, and R67 follow-on engineering specifications).

---

## 1. INTRODUCTION AND METHODOLOGY

### 1.1 Purpose and Audience

R67 is the canonical Gallery design document. It answers "why is Gallery shaped the way it is?" rather than "how is Gallery built?". The audiences are the product team, technical diligence, partner-facing reviewers, and seed and Series A diligence.

### 1.2 Scope

R67 covers the design-rationale layer of the Gallery product. The body comprises five load-bearing layers: ownership-feeling foundation (§2), identity framework (§3), four-layer framework and ownership rights (§4), design-decision rationale (§5), and legal-and-ownership posture (§6). §2, §3, §4, and §6 are the load-bearing analytical sections; reading §5 without them leaves rationale citations unmotivated. §7 is the conclusions section. Cross-industry empirical validation across four industries is in Appendix H. The body is first-principles; Appendix B is the historical-failure record and academic-diagnosis synthesis (case studies in Appendices C-D).

R67 is read alongside two adjacent specialty documents. R45 (Portal Technical Spec) carries engineering implementation and references R67 §5-§6 upstream. R65 (Gallery Platform Security) carries the security architecture for the §5.1-§5.2 access-control and per-buyer-differentiation decisions.

### 1.3 Out-of-Scope

R67 does not document engineering specifications (interfaces, encryption, storage, smart contracts, key management, APIs) -- those live in R45 and R65. R67 also does not document market analysis (sizing, segmentation, AOV, GTM, growth) -- those concerns are out of scope. Where R67 references engineering figures, it points to the specialty document carrying the primary analysis.

---

## 2. PSYCHOLOGICAL OWNERSHIP

This section establishes the ownership-feeling foundation on which the rest of the document rests. The behavioral basis is foundational because every architectural, operational, and competitive choice in an authenticated-creator-merchandise product flows from a specific reading of what motivates the buyer. The buyer is primarily an ownership-driven collector, secondarily a contextual seller; the resale market exists as a property-preservation mechanism rather than a profit-generation mechanism.

The seminal paper defining ownership feeling (i.e. psychological ownership) in the academic literature [pierce-kostova-dirks-2001] identifies the three routes (control, intimate knowledge, self-investment) through which ownership feelings develop toward any target. The paper originated in organizational behavior; the consumer-goods extension Gallery directly relies on [atasoy-morewedge-2018; morewedge-2021; park-2025] is the application layer built on PKD's foundation, demonstrating that the three routes operate on digital consumer goods and translate into specific design prescriptions.

PKD-via-extension is therefore the foundational architectural requirement for Gallery. Every design decision in §5 (access-controlled master, per-buyer differentiation, sealed/opened deed, public/private toggle, owner-credit attribution, deed-as-receipt) traces to one of the three routes; without satisfying all three, the digital-format ownership-feeling gap documented empirically in [atasoy-morewedge-2018] (~3:1 physical-vs-digital WTP for identical content) reasserts itself and the artifact loses its ownership-bearing character.

The other theories introduced in §2 are not foundational in the same sense; they supply preconditions, constraints, or downstream layers built on top of the PKD architectural foundation:

| Theory / Source | What It Establishes | Role in Gallery |
|---|---|---|
| [belk-1988; belk-1995; formanek-1991; pearce-1992; baekeland-1981] (§2.1) | Five-motivation framework, extended-self construct, sacralization of collections, three behavioral archetypes (Aggressive, Snob, True Connoisseur) | Descriptive validation -> the ownership-driven collector category exists at scale and is well-characterized; supplies archetype taxonomy for buyer-segment design |
| [hagtvedt-2023] (§2.3) | Genuine art framing induces self-transcendence; financial framing destroys the state | Constraint -> prohibits financial framing in marketing and UI; drives the six de-financialization design features in §6.6.3 |
| [atasoy-morewedge-2018] (§2.4) boundary conditions | Format-driven WTP gap disappears for rentals (operates only when ownership is expected); amplified by buyer identity-relevance | Targeting requirement -> Gallery focuses on identity-relevant buyer populations (creator fans), where the architectural payoff is largest |
| [spence-1973; belk-1988] (§2.5) | Costly signals are credible because cost calibrates affinity; possessions function as identity-signaling vehicles | Public-observability requirement -> drives the share-surface signaling architecture (§5.9); supplies the brand-premium economic basis underlying creator-merchandise demand |
| [toffler-1980; ritzer_jurgenson-2010; ashforth-2001] (§2.6) | Collectors hold Patron and Seller identities simultaneously, activated by context (micro-role-transition) | UX requirement -> frictionless persona switching in the resale flow; resale does not exit the Patron role |

The six subsections below carry the detailed development of each.

### 2.1 Foundational Collecting Psychology and Archetypes

**Psychology of Collecting: Motivational Framework**

Academic research establishes a consistent five-motivation framework for collecting [formanek-1991]: (1) extension of self -> acquiring knowledge, exercising control, expressing identity; (2) social relevance -> finding and sharing with like-minded others; (3) historical preservation -> maintaining the past into the future; (4) financial investment -> monetary returns; (5) acquisition drive -> thrill of discovery and possession. The common thread across all five is passion for the particular objects collected.

The "extended self" construct [belk-1988] holds that possessions are literally part of owner identity. Collections additionally undergo sacralization [belk-1995], where objects are stripped of utilitarian function and endowed with symbolic significance; collectors are simultaneously materialistic (in acquisition) and anti-materialistic (in symbolic register). Museum-studies literature [pearce-1992] expands motivational categories to include leisure, aesthetics, competition, risk, fantasy, community, prestige, domination, and sensual gratification.

**Collector Archetypes**

Three behavioral archetypes have been identified [baekeland-1981]. The Aggressive Collector competes through display and comparison and seeks external validation. The Snob Collector channels competition toward exclusivity, seeking rare items in narrow domains. The True Connoisseur collects on intrinsic aesthetic judgment rather than external trend or social approval. Survey evidence among online art buyers [artsy-2019] confirms these patterns empirically: 71% purchase to decorate (living-with-art dominant), 67% buy for daily inspiration, 78% cite aesthetics as the most important factor. Investment ranks distinctly lower as a primary driver -> 27% of collectors under $100,000 net worth cite it as major, compared to 52% above $10M. An eye-tracking study with neuroendocrinological measures [plosone-2022] dissociated aesthetic liking (unaffected by observers) from willingness-to-pay (significantly elevated by perceived expert observers), supporting the intrinsic-versus-extrinsic motivational distinction.

### 2.2 Pierce-Kostova-Dirks Ownership Routes

Five experiments comparing physical and digital versions of identical content [atasoy-morewedge-2018] demonstrate the empirical phenomenon Gallery's design responds to: participants paid roughly $3 for a physical souvenir print and $1 for a digital copy; the gap held across books, films, and three valuation measures, and persists after controlling for production cost, consumption utility, permanence, and resale value. The mediating variable is ownership feeling: physical goods better support the perceived-control actions (touching, holding, manipulating, displaying) that generate ownership feelings [pierce-kostova-dirks-2001], and the strength of ownership feeling predicts the valuation difference.

PKD identify three routes through which ownership feeling develops toward any target:

- **Control.** The ability to manipulate, edit, or decide how and where the image is used.
- **Intimate Knowledge.** Developing a deep association with the image through repeated exposure, learning its history, or understanding its details.
- **Self-Investment.** Contributing the owner's own time, energy, and identity, adding a personal touch to the artifact.

The design directive [morewedge-2021]: each route independently contributes to closing the format-driven valuation gap, with all three together maximally closing it. Tests of all three concurrently in metaverse avatars [park-2025] confirmed the additive prediction; prior gaming-literature studies confirmed each route individually for virtual items at sub-$100 price points.

### 2.3 Hagtvedt-Patrick Art-as-Art State and Financial-Framing Destruction

Experiencing art as art (rather than as decoration, marketing, or investment) induces self-transcendence [hagtvedt-2023]: a mental state that reduces self-focus and suppresses status-seeking. The effect holds only under genuine art framing and is destroyed when the object is framed as a financial instrument. The implication for any product targeting the art-as-art experience is that financial framing (floor prices, portfolio value, ROI) eliminates the psychological value structure that makes collectibles worth owning, consistent with the speculative-NFT category collapse.

### 2.4 Atasoy-Morewedge Identity-Relevance Moderator

Two boundary conditions on §2.2's mechanism [atasoy-morewedge-2018] are particularly important. First, the format gap disappears for rental goods where ownership is not expected, indicating the mechanism only operates when the consumer expects to own and keep the artifact. Second, identity-relevance amplifies the gap -> in the *Empire Strikes Back* experiment, physical preference appeared only among participants who considered Star Wars identity-relevant. The format effect is therefore strongest for ownership products purchased by identity-relevant buyer populations, and weakest for access-rights products purchased by buyers without identity affinity.

### 2.5 Spence Costly-Signaling

**Brand Premium and Costly Signaling**

Branded merchandise validates a substantial empirical baseline for non-functional value drivers operating alongside artifact-utility motivations. The branded-apparel economy (Nike, Champion, Lululemon, Supreme) generates billion-dollar revenues from buyers paying brand premiums of 5-10x manufacturing cost on products with functionally equivalent generic alternatives. Two literatures explain why: the extended-self construct [belk-1988] (possessions function as identity extensions, with brands as identity-signaling vehicles) and economic signaling theory [spence-1973] (costly signals are credible because the cost filters out participants whose underlying affinity does not justify it). A $50 hoodie signals more affinity than a free social-media follow because the cost calibrates the signal.

Creator merchandise operates within this framework specifically. Mainstream creator fans pay brand premiums on commodity apparel because the creator's identity is embedded in the product, the purchase is publicly observable, and the cost signals affinity strength to the creator's community. The category generates substantial annual revenue across thousands of creators despite competing with apparel brands on every functional dimension (fabric, price, prestige, distribution). The economic basis is brand-premium-as-identity-signal rather than artifact-utility.

The brand-premium dynamic operates on digital artifacts when identity-signaling and costly-signaling functions are preserved. Metaverse-avatar studies [park-2025] demonstrate digital items commanding brand premiums in avatar customization. Gaming-virtual-goods literature similarly documents brand premiums on cosmetic digital items with no functional advantage over alternatives. The branded-merch economy translates from physical to digital when the architecture supports public observability of the purchase and costly-signal cost calibration. For creator-issued authenticated digital artifacts, the creator is the brand, the deed is the merchandise, and the buyer pays for identity-signaling and community-positioning -- the same demand pattern that physical creator merchandise has already validated at scale, with form-factor translation as the incremental question.

### 2.6 Secondary Market Behavior: Prosumption and Identity Fluidity

Collector behavior is not unidirectional. Buyers regularly transition between Patron (collector who holds and curates) and Seller (collector who lists for resale) within the same identity, often within minutes of a market signal. The micro-role-transition framework [ashforth-2001] establishes that role-shifting does not require identity-shedding: a buyer does not cease being a Patron when listing an artifact for resale, and a buyer who lists does not commit to a permanent Seller identity. Both roles are held simultaneously, activated by contextual cues -> market price movement, liquidity needs, curation decisions, social-signaling opportunities.

This has two design implications for Gallery. First, prosumer theory [toffler-1980; ritzer_jurgenson-2010; ritzer-dean-jurgenson-2012; humphreys-grayson-2008] predicts that platforms supporting frictionless role-switching capture more transaction volume than platforms segmenting buyers and sellers into separate user classes. Gallery's single member-account model supports this: any account can both buy and list, with the per-deed public/private toggle (§5.5) letting the same member present as Patron on some deeds and as Seller on others without leaving the identity. Second, identity-fluidity research [reed-2012; bayuk-2010] establishes that visual and linguistic cues activate one identity over another at decision time. Gallery's de-financialized UI (§5.10) avoids financial-instrument framing that would prematurely activate Seller identity on every deed view; this lets Patron identity remain active even on deeds that may be subject to future resale, preserving the art-as-art register §2.3 depends on.

---

## 3. IDENTITY FRAMEWORK

Property rights are inherently exclusive. A right that anyone can exercise is a freedom, not a right; the property relation only exists when one determinate party can exercise the right to the exclusion of all others. Establishing this exclusivity requires answering both halves of the holder relation: who is the holder X (positive identification), and who constitutes the excluded set ¬X (negative identification, with ¬X uniformly barred from exercise). The framework that answers both halves is the Identity Framework. It is logically prior to the Schlager-Ostrom bundle (§4) -> until the Identity Framework is operative, no Ostrom right can vest, because the rights have no determinate subject to attach to. Once operative, the bundle of five exclusive rights vests in X and can be exercised, defended, and transferred against ¬X.

The framework operates at two layers (legal, technical) and across two functional dimensions (Authentication, Authorization). §3.1 documents the two-barrier matrix; §3.2 records the cross-industry comparative summary that anchors Gallery's master/copy distinction in established commercial practice. Empirical validation of the framework across the music, book, NFT, and limited-edition-photography industries is documented in Appendix H.

### 3.1 Two-Barrier Framework

Digital ownership requires solving two independent problems across two layers. Both problems must be solved; neither is sufficient alone.

| | Authentication (the recording problem) | Authorization (the enforcement problem) |
|---|---|---|
| **Legal Layer** | Copyright law (Title 17 U.S.C.) -> establishes exclusive rights over reproduction, distribution, and display (Section 106); defines who holds the copyright. ESIGN Act (15 U.S.C. Section 6001) -> grants legal validity to the creator's cryptographic signature binding creator identity to deed | DMCA (17 U.S.C. Section 1201) -> criminalizes circumvention of access controls (1201(a)) and copy controls (1201(b)); provides legal teeth behind technical measures |
| **Technical Layer** | Identity verification (YouTube OAuth, credit card, bank account), provenance metadata (XMP-embedded attribution), NFT deed linking verified creator to verified owner | Encryption (Arweave-stored Master Image), access control (gallery-gated authenticated viewing), copy control (glass-box display architecture degrading unauthorized reproduction) |

### 3.2 Cross-Industry Comparative Summary

This appendix compares the ownership and distribution models of three established creative industries with the Gallery protocol across four dimensions.

| Dimension | Music Industry | Book Industry | Movie Industry | Gallery |
|---|---|---|---|---|
| Creator Copyright and Royalty | Songwriter retains composition copyright. Mechanical royalty per copy sold (statutory rate). | Author retains copyright. Royalty per copy sold (contractual, typically 10-15%). | Individual creators typically assign rights as work-for-hire. Residuals are union-negotiated. | Creator retains copyright. Resale royalty enforced by smart contract. Gallery viewing fees provide ongoing gallery display revenue. |
| Master Vault | Label's physical or digital vault (corporate custody). Master can be lost or damaged. | No equivalent. Published text is identical to the original. | Production company holds the original negative/digital master. Corporate custody. | Permanent On-Demand Democratic Custody. Master encrypted on Arweave (immutable, permanent). Creator-governed. |
| Quality Gap | Compressed copies (MP3, stream) are lower quality than the master recording. | No quality gap. All formats contain identical text. | Compressed copies are lower quality. Gap diminishing with 4K streaming. | Gallery previews are below Master's full specifications. Full resolution accessible only by deed holder. |

The music industry is the strongest analogy because it uniquely combines creator copyright with per-transaction royalties, institutional master custody, and a structural quality gap between the original and distributed copies.

---

---

## 4. OWNERSHIP RIGHTS

### 4.1 Four-Layer Framework: Idea, Image, Storage, Substrate

Before the rights bundle can be analyzed, the entity those rights attach to must be defined. Hess and Ostrom (2003) [hess-ostrom-2003] propose a three-layer taxonomy of ideas, artifacts, and facilities for information common-pool resources, establishing the applicability of the Schlager-Ostrom framework to digital and information goods. For Gallery's analysis of authenticated visual-art ownership, Hess and Ostrom's "artifact" benefits from further decomposition because it packages two distinct concepts: the abstract original expression (the image, called "work" in copyright doctrine) and its particular physical or digital instantiation (the storage instance). The display surface where the image becomes visible light, which Hess and Ostrom roll into "facility" or treat as a usage attribute, also benefits from explicit naming because Gallery's product spans multiple substrate types (screen, paper, mug surface).

Gallery adopts a four-layer refinement built on the Hess-Ostrom foundation. The four layers define what is owned (the image), what is not owned (the idea), and how the image is preserved and rendered (storage and substrate).

| Layer | Definition | Gallery instance | Copyright status |
|---|---|---|---|
| Idea | Abstract concept, theme, premise, or general approach to a subject | "A photograph of urban architecture at sunrise"; "A landscape image of a national park" | Not protected (17 U.S.C. § 102(b)) |
| Image | Original expression of an idea, fixed in a tangible medium, sufficiently specific to constitute creative authorship; called "work" in copyright doctrine | A specific photograph by a specific creator with specific composition, framing, timing, and color rendering | Protected (17 U.S.C. § 102(a)) |
| Storage | Preservation medium holding the image's data, either digital (file, database) or chemical / physical (ink on paper, dye on mug) | Master Image on Arweave, Social Copy JPEG in cache, ink-on-paper print | Not separately protected; vessel for the image |
| Substrate | Display surface where the image's data is rendered into visible light | Screen (LCD, OLED), paper surface, projected wall, mug surface | Not separately protected; rendering surface |

The design-doc term throughout R67 for the second layer is "image." The copyright-doctrine term "work" is reserved for legal contexts: contractual surfaces (BMA, CMA, terms of service), ESIGN-relevant clauses, and §6 (Legal and Ownership Foundation). The two terms refer to the same entity at different registers.

**Layer boundaries.** The four layers are separated by three transitions, each meaningful for Gallery's product:

- *Idea / Image*: originality plus fixation. Below the threshold, content is in the public domain (the idea is free for anyone to use). Above the threshold, the specific expression is copyrightable. Two creators photographing the same subject produce two separate images of the same idea; each creator holds copyright over their specific image.
- *Image / Storage*: abstract expression versus particular instantiation. The image is storage-independent; a Master Image, a Social Copy, a Keepsake Copy, and an ink-on-paper print are all storage instances of the same image.
- *Storage / Substrate*: preservation versus display. Storage holds the image's data when not being viewed; substrate is where the data emits or reflects light to a viewer. Storage and substrate coincide in physical artifacts (a paper print: ink chemistry stores the data and the paper surface reflects light); in digital configurations they are usually separate (a file in storage drives a screen acting as substrate).

**Where the deed operates.** Gallery's deed certifies edition title at the image layer. The deed does not transfer the idea (no one can own an idea); does not transfer individual storage instances as the load-bearing right (storage instances are delivered as a consequence of the deed, not as the deed itself); and does not constrain substrate choice (the buyer may render the image on any surface they choose). The deed is property right in the image, with storage and substrate downstream.

This bounds Gallery's product cleanly. Gallery does not sell ideas: two creators producing different images of the same subject each retain their own copyright, each can issue editions through Gallery, and neither prevents the other from creating. Gallery does not sell storage instances as such: storage forms (Master Image, Social Copy, Keepsake Copy, print) are delivery mechanisms for the image; fidelity varies by variant but no storage form is "the image." Gallery does not constrain substrate: the buyer chooses where their owned image is rendered for perception.

**Mapping to Gallery's variant ladder.** The R62 §2.2 variant table is a list of storage forms for the same image at different fidelity levels, plus one storage-substrate bundle:

| Variant | Layer | Fidelity profile | Purpose |
|---|---|---|---|
| Master Image | Storage (digital, high-fidelity) | Full TIFF, 16-bit, ProPhoto or Adobe RGB | Print-grade source, archival; one-time delivery via seal-break (R62 §7.5) |
| Keepsake Copy | Storage (digital, mid-fidelity, creator-opt-in) | Smaller-than-Master JPEG, 8-bit sRGB, high quality at its scale | Small physical applications (mug, badge, small framed print) and high-quality phone wallpaper when creator has enabled the variant. Size is independent of the Master's print size: a creator selling 8x12 prints may still offer a 4x6 keepsake suitable for mug or badge |
| Social Copy | Storage (digital, share-fidelity, default for every image) | 1080px JPEG with monogram and URL text, Instagram-optimized | Social propagation, deed-page render, owner's universal sharing file |
| Print fulfillment | Storage + substrate (chemical, paper) | Ink chemistry on paper, paper surface | Authenticated physical artifact; one-time delivery via seal-break |

Each variant carries the same image; the difference is the storage instance, with print fulfillment additionally bundling the substrate. Every image has a Social Copy by default; Keepsake Copy is creator-opt-in. All copies are smaller in size and lower in quality than the Master, so the size-quality hierarchy is intuitively distinguishable by the end user without needing to consult the spec.

**Monogram and URL text on copies.** The Social Copy always carries the monogram and URL text (non-removable) because its primary function is social propagation with attribution-routing back to the deed page (§5.9). The Keepsake Copy carries the monogram and URL text by default; the creator may optionally configure the Keepsake Copy to make monogram-and-URL placement owner-discretionary, in which case the owner may suppress them at Card 6 personalization (e.g., for clean aesthetics on a mug or badge). The creator's setting is per-image and locked at deed mint. Per-deed monogram personalization mechanics (Default, Override, None) are documented in §5.5.

**Copyright-vocabulary mapping.** The §4.1 framework maps onto standard U.S. copyright terminology:

| §4.1 layer | Copyright term | Statutory anchor |
|---|---|---|
| Idea | Idea | 17 U.S.C. § 102(b) (excludes ideas, procedures, processes, systems from copyright) |
| Image | Work (specifically "pictorial work" for photographs under § 102(a)(5)) | 17 U.S.C. § 102(a) |
| Storage | Copy | 17 U.S.C. § 101 (definitions) |
| Substrate | Display surface (associated with the "public display" right) | 17 U.S.C. § 106(5) |

Contractual surfaces (BMA, CMA, terms of service, ESIGN-relevant clauses) and §6 (Legal and Ownership Foundation) use copyright's "work" terminology where legal precision matters. Design rationale, buyer-facing copy, and protocol documentation use "image" for the same entity.

**Forward references.** §5.8 (Why the Deed Is the Receipt and the Image Is the Artifact) operates at the image layer: the image is the asset, the deed is title to the image, and the Master Image is a storage instance of the image rather than the image itself. §6.3 (Copyright Statutory Framework and Compliance Posture) operates at the work and idea layers (legal terms): ideas remain free, the work is subject to the creator's copyright, and the deed is title to a numbered edition of the work, distinct from the underlying copyright the creator retains. R62 §2.2 (DRM variants) operates at the storage and substrate layers: the variant table enumerates storage forms of the same image, with print fulfillment additionally engaging the substrate layer.

### 4.2 Schlager-Ostrom Property Rights

The Identity Framework (§3) establishes the determinate singular holder X. The Schlager-Ostrom bundle is the set of five exclusive rights that vest in X once the Identity Framework is operative; without that precursor, the rights have no determinate subject and cannot vest. The §4.1 four-layer framework establishes the entity over which the rights operate: the image is what is owned, with storage and substrate as downstream choices.

Schlager and Ostrom (1992) [schlager-ostrom-1992] provide the canonical property-rights framework. Ostrom established the framework's applicability to digital resources [hess-ostrom-2003] [hess-ostrom-2007-knowledge] and to private property regimes [ostrom-hess-2007-private] -> Gallery applies it at the intersection. A right is "legal" when held de jure (statutorily recognized and enforced) rather than de facto; the bundle's overall legality is the conjunction of de jure status across each right held. The five rights define a five-position taxonomy: Owner holds all five; Proprietor lacks Alienation; Authorized Claimant lacks Exclusion and Alienation; Authorized User holds only Access and Withdrawal; Authorized Entrant holds Access only.

| Schlager-Ostrom right | Technical definition | Common word | Collectible context |
|---|---|---|---|
| Access | Right to enter and enjoy non-subtractive benefits | Keep | Own the picture and hold it in your collection |
| Withdrawal | Right to obtain resource units | View | View the picture as desired |
| Management | Right to regulate use and transform the resource | Customize | Decide how the picture is shown |
| Exclusion | Right to determine who has access | Block | Block others from seeing the picture; only you decide who has access |
| Alienation | Right to sell or lease management and exclusion rights | Sell | Sell the picture to another collector; they inherit the same rights |

The medium that records ownership -- paper deed, registry entry, possession, blockchain token -- determines transferability, verifiability, settlement speed, and friction, but does not change what ownership is. Ownership binds all third parties, not just contractual counterparties, and requires legal recognition rather than physical control.

**Two-level enforcement.** Each Schlager-Ostrom right is enforced at two levels:
- Statutory enforcement (Level 1): Copyright law, License doctrine, DMCA, UCC Article 12, ESIGN
- Gallery contracts (Level 2): Buyer Master Agreement (BMA), Creator Master Agreement (CMA)

Statutory law makes the rights enforceable; platform contracts allocate them between parties.

**Distinction from Ownership Feeling.** Ownership right (i.e. legal ownership) and ownership feeling are independent. Ownership feeling is the felt state of "this is mine," generated through the three Pierce, Kostova, and Dirks (2001) [pierce-kostova-dirks-2001] routes of control, intimate knowledge, and self-investment (§2.2). A fan can experience deep ownership feeling toward a creator's work without legal title; an investor can hold legal title without ownership feeling. Ownership right produces scarcity, transferability, and provenance; ownership feeling produces identity expression, status, attachment, and willingness to hold rather than flip. Neither entails the other.

**Securities Classification Implication.** The legal-plus-psychological combination reinforces the consumptive-use framing supporting the SEC compliance posture (§6.6). Legal title without psychological attachment looks like a security; legal title coupled with strong psychological ownership looks like a collectible.

| Ownership feeling | Ownership right | Product category |
|---|---|---|
| No | Yes | Security (speculative instrument) |
| Yes | No | Fandom (non-economic attachment) |
| Yes | Yes | Collectible |

**Deed as Digital-Native COA.** Gallery's deed is the digital-native equivalent of the Certificate of Authenticity in limited-edition photography (Appendix H.4). It records the same elements as the paper COA (artist, title, year, dimensions, medium, edition, technique, authentication statement) and adds three properties paper cannot provide: tamper-evidence through cryptographic signing (ESIGN-validated minting per §6.5); portability through the on-chain registry that persists independently of any operator; and consumption-state awareness through the sealed/opened distinction (§5.3). The framework synthesizes Schlager-Ostrom property rights with the limited-edition photography authentication precedent, producing an instrument recognizable both in property theory (Appendix A.1's Moringiello-Odinet evaluation) and established authentication-market practice.

**Creator-Side Rights (Optional Extension).** Hess and Ostrom (2007) [hess-ostrom-2007-knowledge] (pp. 52-53) note that electronic information resources "often have more than five types of rights" and append two context-dependent rights to the original bundle: the right to contribute to the content, and the right to remove one's artifacts from the resource. These rights apply to the creator-platform relationship in Gallery, not to the buyer-artifact relationship. The creator contributes works to the platform (contribution right) and may withdraw works from active circulation prior to mint (removal right). Once a deed is minted, the buyer's 5-rights bundle (Access through Alienation) is permanent and not subject to creator withdrawal. The two creator-side rights are noted here for framework completeness and are not load-bearing for the buyer-ownership analysis that drives the §5 design decisions.

### 4.3 Deed-Storage Mapping and Limited Editions

The §4.1 four-layer framework allows two deed-to-storage configurations at the image layer. Both configurations bind deeds to a single Master Image on Arweave; the only difference is how many deeds reference the same Master Image.

**1-of-1 (one deed, one Master Image).** Each image has exactly one deed, and the deed has exclusive title to the image. The Arweave-stored Master Image is referenced by one deed. The deed-holder may break the seal to download the Master Image; once broken, the deed is opened and platform-mediated resale is permanently disabled (§5.3). Print fulfillment via Gallery print partner is similarly one-time and triggers the seal-break. R71 MVP implements 1-of-1 only.

**Limited edition (N deeds, one Master Image).** Following the photography-industry convention of one negative yielding N numbered prints (Appendix H.4), a limited-edition image binds N deeds to a single Master Image stored on Arweave. Each deed represents a specific edition slot (1/N, 2/N, ..., N/N) and is independently transferable. Storage is shared at the Master Image layer; scarcity is enforced by the deed count, not by per-deed storage isolation. Each deed-holder independently has the right to:

- Receive a Social Copy with their edition number embedded in the monogram (e.g., "7/25")
- Receive a Keepsake Copy if creator opted in (§4.1), with their edition number embedded in the monogram
- Break the seal to access the Master Image (each deed-holder's seal-break is independent; the file persists on Arweave for the remaining deed-holders)
- Print via Gallery print partner once (physical seal-break for that deed; the print carries the edition number, e.g., "7/25")

Each deed transitions through its own sealed -> opened lifecycle. The Master Image on Arweave persists indefinitely; the per-deed scarcity is logical, not physical. Edition slots are allocated at sale time by default; the creator may reserve specific slots (e.g., for artist proofs or self-collection) at the configuration stage.

The mapping is many-to-one at the storage layer (N deeds -> 1 Master Image) and one-to-one at the edition-slot layer (each deed holds a unique slot). The convention mirrors limited-edition photography exactly: a single negative yields N authenticated, numbered prints; in Gallery, a single Master Image yields N authenticated, numbered deeds. R71 MVP implements 1-of-1 only; limited-edition support is MMP+ scope. The protocol-level deed-Master binding and edition-slot tracking are documented in R62 §2.1 and R62 §3.

---

## 5. DESIGN DECISIONS AND THEIR RATIONALE

This section synthesizes Gallery's twelve load-bearing design decisions and their analytical justification, drawing on the ownership-feeling foundation in §2, the identity framework in §3 (with cross-industry empirical validation in Appendix H), the economic rights of ownership in §4, the historical-failure record in Appendix B, and the legal-and-ownership posture in §6. Each decision answers a specific question of the form "why does Gallery do X rather than the conventional NFT-cohort alternative?" The conventional alternative is, in each case, the configuration that the 2021-2026 NFT cohort adopted and that the architectural-failure record (Appendix B.2, Appendix C) documents as load-bearing in the cohort's collapse.

Gallery's eight design requirements derive from two theoretical sources: the three ownership-feeling routes from Pierce, Kostova, and Dirks (2001) [pierce-kostova-dirks-2001] (§2.2), and the five property rights from Schlager and Ostrom (1992) [schlager-ostrom-1992] (§4). The Ostrom rights themselves vest only when the Identity Framework is operative (§3), so the derivation traceability runs Identity Framework (precursor) -> Schlager-Ostrom Bundle (the five rights that vest in the determinate holder) -> Design Requirements (operationalization at §5.1-§5.12). The subsections §5.1 through §5.12 develop each design decision in detail; the mapping from requirement to primary feature is summarized below. Appendix G evaluates the same eight requirements against established digital and physical alternatives, providing the competitive-completeness synthesis.

| # | Requirement | Primary Feature |
|---|---|---|
| 1 | PKD Route 1 -> Control (manipulate, edit, or decide how and where the artifact is used) | Access-controlled Master, share, personal copy save to device collection (§5.1, §5.2); public/private display toggle (§5.5) |
| 2 | PKD Route 2 -> Intimate Knowledge (deep association through repeated exposure, history, or details) | Provenance history, direct purchase from creator, saved image in device collection (§5.2); creator description (§5.6) |
| 3 | PKD Route 3 -> Self-Investment (time, energy, and identity contributed to the artifact) | Monogram (§5.9); owner-credit attribution (§5.6) |
| 4 | Schlager-Ostrom Access* -> Keep (right to hold ownership in collection) | Deed-as-receipt for the image-artifact (§5.8); permanent Arweave storage (§5.1); intake content compliance -> uniqueness enforcement, creator authentication, explicit-content-law screening at ingestion |
| 5 | Schlager-Ostrom Withdrawal* -> View (right to render and use the artifact) | Personal gallery page, save and share options (§5.2, §5.5) |
| 6 | Schlager-Ostrom Management* -> Customize (right to regulate display and use) | Monogram (§5.9); owner-credit attribution (§5.6) |
| 7 | Schlager-Ostrom Exclusion* -> Block (right to determine who has access) | Access-controlled Master with identity binding (§5.1, §6.2); public/private display toggle (§5.5) |
| 8 | Schlager-Ostrom Alienation* -> Sell (right to transfer to another collector) | Deed transfer, payment, fingerprint mechanics (§5.3) |

\* Ostrom property rights are legally formalized through a click-wrapped Buyer Master Agreement (BMA, R62 §3.4) and Creator Master Agreement (CMA) executed at purchase under ESIGN, allocating the bundle between creator and buyer within the statutory substrate per §4's two-level enforcement framework.

### 5.1 Why the Master Is Access-Controlled

The Master Image is encrypted at rest on Arweave and accessible only through a dual-wrap envelope where the deed holder controls one of the two keys. The conventional NFT alternative -- public IPFS hosting with the token as receipt -- leaves the file freely duplicable. Three rationales: PKD route 1 (control) per §2.2 requires that the owner be able to decide how and where the artifact is used, and access control on the Master is the architectural prerequisite, preventing freely-shared distribution from dissolving any individual buyer's use-rights; every cohort that hosted media publicly (autograph B.2-B.4, NFT App C, K-pop App D) failed to sustain ownership-motivated demand at scale, while surviving ownership-mode formats (vinyl, paperback) retain artifact control (App E); §3.1's two-barrier framework requires copy control and access control jointly, and access-controlled Master is the load-bearing piece NFT marketplaces lack (Appendix H.3).


**Implementation:** R45 (Portal Technical Spec); R65 (Gallery Platform Security); R42 (Money Transfer Compliance Analysis).

### 5.2 Why Each Served Copy Is Per-Buyer Differentiated

Every served copy delivered to a buyer carries per-buyer visible attribution that binds it to the buyer's deed -- the monogram and the deed URL text documented in §5.9. The conventional alternative is identical files served to every buyer, where one served copy is indistinguishable from any other. Per-buyer differentiation provides two properties: per-owner identification, so a circulating served copy resolves through its visible attribution to the deed and the owner it belongs to, supporting reverse-image monitoring and the DMCA evidentiary path; and §2.5 costly-signal support, the visible attribution functioning as authentication-of-instance so collectors can display ownership in a form non-owners cannot replicate.


**Implementation:** R45 (Portal Technical Spec); R65 (Gallery Platform Security).

### 5.3 Why Deed and Artifact Have Distinct Sealed/Opened States

The deed exists in two states: sealed (the buyer has not yet downloaded the decrypted Master Image) and opened (the buyer has exercised the Master-download right, marking irrevocable consumption). Personal-use rendering is delivered via per-buyer fingerprinted-and-monogrammed served copies that do not break the seal; the buyer also has the legal right to download the actual Master at any time as the owner, but doing so transitions the deed to opened state. Sealed-deed resale transfers the deed and future-copy rights through the platform; once opened, platform-mediated resale is permanently disabled because the platform can no longer attest that the Master Image has not left the buyer's hands. The conventional alternative treats all transfers identically. Three rationales: it preserves the collector's ability to flip a sealed acquisition without value loss (§2.6 secondary-market identity-fluidity); it prevents the resell-while-retaining-file failure mode that the autograph and NFT cohorts (App G, App C) could not architect around, since once the Master has left the platform's controlled envelope the platform cannot guarantee uniqueness to a future buyer; and it supports the §4 ownership-right construction by mapping sealed/opened onto the bundle-of-rights distinction between possessing-without-consuming and possessing-and-using.


**Implementation:** R45 (Portal Technical Spec); R67 follow-on smart-contract specification.

### 5.4 Why Royalty Respects Consumption State

The creator's resale royalty is enforced at the smart-contract level on every sealed-deed transfer, which under §5.3 is the only resaleable state. The conventional alternative is no enforcement (the Blur-led royalty-stripping trend NFT marketplaces partially recovered from in 2024-2025), or flat per-transfer royalty without architectural commitment. Two rationales: smart-contract enforcement makes the royalty trustless rather than reliant on marketplace policy, eliminating the marketplace race-to-the-bottom that royalty-stripping created in 2023-2024; and the sealed-deed-only resale architecture (§5.3) bounds creator exposure to speculative-flipping volume because the deed retires from circulation once consumed. Creators capture meaningful secondary value, but the secondary market itself is structurally constrained, consistent with §5.10 de-financialization and the App B.2 framing-failure diagnosis.


**Implementation:** R45 (Portal Technical Spec); R67 follow-on smart-contract specification.

### 5.5 Why Visibility Operates at Two Layers: Per-Deed Binary and Profile-Level Granular

Each deed holder controls a public/private toggle on the deed (binary). The toggle accommodates three buyer psychologies the §2 foundation distinguishes: the status-seeking socializer (Vomberg App B.1; costly-signal mechanism §2.5) for whom visible ownership is the use-value layer; the connoisseur (Baekeland archetype §2.1; intimate-knowledge route per Pierce-Kostova-Dirks §2.2) for whom ownership is internally consummatory; and the contextual-identity holder (Atasoy-Morewedge identity-relevance moderator §2.4; prosumption identity-fluidity §2.6) whose preference shifts with context. The conventional alternative -- permanent public-by-default (OpenSea / X-profile pattern) or permanent private holding (custodial-trust legacy) -- forces a commitment at acquisition the toggle defers. Public mode does not surface speculative signals per §5.10 de-financialization.

Identity expression operates at the profile level rather than per-deed. Each member's profile carries an identity-visibility setting applied uniformly to all the member's public deeds, with four steps mapping to established art-market lender-credit conventions: Full ("Courtesy of [Buyer], [Year]"), Region-only ("Private collection, [Country]"), Anonymous ("Private collection" or "Anonymous loan"), and Date-redacted (any prior step with acquisition dates suppressed from the public-facing provenance chain while preserved on-chain and in the holder's private view). The two layers answer different questions: per-deed = "is this visible at all?"; profile-level = "how do visible deeds present my identity?" The setting belongs at member-level because Spence's signal (§2.5) is opt-in for the signaler, and the signaler is the member rather than the individual work.

The profile-level setting governs the public deed-page rendering, which renders dynamically against the current setting. The visible monogram baked into Keepsake Copy and Social Copy image files is a separate per-deed decision the owner makes once at Card 6 personalization (R62 §2.2; R69 §2.4 Card 6) -- Default, Override, or None -- because the monogram is part of a single-version artifact that cannot be re-rendered post-personalization without violating the §2.2 single-version constraint. The Social Copy monogram is mandatory (Default or Override only, never None) because Social Copy's primary function is social propagation with attribution-routing back to the deed. The Keepsake Copy monogram is mandatory by default; the creator may optionally configure the Keepsake Copy to allow the owner to choose None (§4.1), enabling clean aesthetics for small physical applications like mug or badge prints.

A symmetric two-layer architecture applies on the creator side: per-work in-catalog / off-catalog (parallels per-deed) plus creator-profile catalog-disclosure granularity (year-only / +mint-date / +primary-price). CMA records creator-side defaults; BMA records buyer-side defaults; both are revisable from the respective profile pages at any time.


**Implementation:** R45 (Portal Technical Spec); R67 follow-on UI specification.

### 5.6 Why Attribution Uses Owner-Credit Conventions

Public-display attribution surfaces use owner-credit conventions: the deed displays as "Photograph by [Creator], [Year of Issuance], from the collection of [Owner], on display at [Gallery URL]." The wallet-address-and-token-ID convention used by NFT-marketplace surfaces is suppressed except in the deed-history audit trail accessible to the holder. The attribution convention has three load-bearing functions. First, register alignment with Hagtvedt-Patrick: the owner-credit form is the visual register the established art market uses for catalogue raisonné and exhibition-label conventions, which supports the art-as-art state and avoids triggering the financial-instrument framing that destroys it (§2.3). Second, identity-signal calibration with Spence costly-signaling: the owner-credit form names the owner in a register that signals discernment and curation rather than speculative position, producing the right kind of social signal (§2.5). Third, alignment with the deed-as-COA framework (§4): owner-credit attribution is the platform-native equivalent of the paper-COA-and-catalogue-raisonné record that the limited-edition photography authentication workflow (Appendix H.4) establishes as the recognized authentication form. The cost is divergence from crypto-native marketplace conventions, which is structurally desirable given Gallery's audience separation from crypto-native trading audiences (Appendix H.3, App C.4).

The deed page may also carry a creator-supplied description -> an optional free-text field providing artistic statement, subject context, or other curatorial-register text consistent with the catalogue-raisonné convention. The description supports the art-as-art register by giving the creator a curatorial-voice surface and supports the §2.2 PKD intimate-knowledge route by giving the buyer durable narrative context bound to the deed. Field-level specification (length limits, source attribution, required vs optional status) is documented in R62 §3.2.


**Implementation:** R45 (Portal Technical Spec); R67 follow-on UI specification.

### 5.7 Why Retail Tier and Verified Tier Are Separated

Buyers transact in two tiers. Retail Tier: cardholder-verified plus Google-account-verified purchases up to a per-account spending threshold, card-rail UX (Stripe, Apple Pay, Google Pay), USD pricing. Verified Tier: KYC at a higher level, higher-value purchases, larger-edition transactions, full-resolution Path 1 downloads. The conventional alternative is a single uniform tier (crypto-only or full-KYC). Two-tier responds to two buyer realities: the mass-market buyer (App B.1 Vomberg cohort; Gen Z and Gen Alpha collectors) for whom card-rail UX is the only acceptable rail and KYC-for-all imposes prohibitive friction; and the higher-value buyer engaged in jurisdictionally sensitive transactions (Article 12 controllable-electronic-record formality, AML thresholds) who cannot be served by card-rail-only. Tier separation reaches both populations with friction calibrated to the buyer's chosen engagement depth. Legal mapping: Retail operates within the App A.2 collectibles-marketplace framing; Verified operates within a fuller compliance perimeter.


**Implementation:** R45 (Portal Technical Spec); R42 (Money Transfer Compliance Analysis).

### 5.8 Why the Deed Is the Receipt and the Image Is the Artifact

This is the load-bearing inversion of App B.2 and the foundational design commitment from which the seven preceding decisions follow. In Gallery, the Master Image (the image) is the asset; the deed is the ownership-mechanism receipt that makes the image's ownership enforceable. The conventional alternative -- the token-as-artifact paradigm -- treats the on-chain token as the thing being sold, with the underlying media as differentiation metadata. The inversion is consequential: under token-as-artifact, public hosting is correct because the media is not the asset; under token-as-receipt-of-artifact, access control over the media is required because the media is the asset. The buyer purchases the image (the artifact); the deed is the receipt, not what is being sold. Every architectural commitment in §5.1-§5.7 is a consequence of treating the image as the asset and the deed as the receipt; the dispositional commitments in §5.9-§5.10 reinforce the same foundation at the display surface. App B documents the empirical historical failures (B.1, B.4) and the academic identification (B.5) that together establish the inversion as required, not optional.


**Implementation:** R45 (Portal Technical Spec); R65 (Gallery Platform Security); R67 follow-on smart-contract specification.

### 5.9 Why Monogram, Courtesy Line, and URL Text Are Persistent on Shares

Monogram, courtesy-line, and URL-text mechanics are the surface-level implementation of the costly-signal design commitment. When a buyer shares a Gallery deed-and-image to an external surface (social-media post, profile picture, content-creator post), the rendered share carries three persistent visual elements: a monogram (a small platform-native attribution mark identifying the deed as Gallery-authenticated, positioned lower-left), a courtesy line (a brief textual attribution naming the creator, in the owner-credit format documented in §5.6), and a URL text (e.g. `jpg1.me/abc1d`, where the slug is the image ID; positioned vertically along the lower-right edge, resolving to the deed page where the deed's full attribution chain and cost-calibration signal are verifiable). The three-element architecture is referenced from §2.5 as the costly-signal mechanism that converts deed-ownership into a visible-to-non-owners status signal. Four rationales motivate the persistent visibility. First, the costly-signal mechanism [spence-1973] requires that the signal be visible to the audience the signaler is signaling to; non-visible authentication does not function as a costly signal. Second, the courtesy-line creates a viral-loop attribution path that surfaces creator and gallery to the share recipient, supporting buyer-driven organic distribution. Third, the monogram functions as the platform-native authentication-of-instance mark, paralleling the museum-deaccession stamp or the gallery-watermark convention in print-distribution contexts. Fourth, the URL text routes the observer from the share surface back to the deed page where verifiable cost-calibration and provenance information complete §2.5's cost-calibration requirement -- the share-surface image alone cannot carry sufficient resolution for cost-signal verification, so the URL is the routing mechanism that closes the loop between social-graph visibility and deed-page verifiability. URL text is detected by iOS Live Text and Google Lens on long-tap, is human-readable for manual typing or verbal sharing, and requires no quiet-zone backing; Appendix I documents the rationale for URL text over a scannable QR code. When an owner downloads a Social Copy or Keepsake Copy variant of their image, the edition number is added to the monogram on the downloaded file, so the retained personal copy carries a visible, self-identifying tie to its specific numbered edition and deed. The buyer can suppress the visible-on-share courtesy line via the public/private toggle (§5.5).


**Implementation:** R45 (Portal Technical Spec); R67 follow-on share-rendering specification.

### 5.10 Why the UX Is De-Financialized

Six de-financialization design choices jointly preserve the art-as-art psychological state and prevent the financial-framing collapse that killed the 2021-2024 speculative-NFT cohort. The six choices operate across UI, marketing, contractual, and product-architecture layers:

- **Marketing-language prohibition.** Marketing copy and platform-facing communications avoid investment-framing language (floor price, ROI, portfolio value, appreciation potential, secondary-market opportunity). Creator-facing surfaces where income discussion is appropriate are walled off from buyer-facing surfaces.
- **UI de-financialization.** Buyer-facing UI surfaces do not display floor prices, portfolio P&L, percentage-change indicators, or speculative-resale signals. The deed history surfaces transfer events (date, parties, owner-credit form) without highlighting price movements as a central UI element.
- **Primary-market lock-up.** Resale of a deed is permitted but is structurally not the foreground product; the foreground product is acquisition of the artifact for ownership and display. The §5.3 sealed/opened deed distinction reinforces this by surfacing consumption rather than concealing it.
- **Click-wrap no-reliance.** The buyer-facing terms-of-service include a no-reliance clause acknowledging that the buyer is purchasing a collectible artifact for personal use and is not relying on appreciation potential as a basis for purchase. This is both a Howey-defense surface (§6.6.3) and a dispositional commitment.
- **Anti-financialization terms.** Platform terms prohibit derivative-financialization mechanisms (deed fractionalization, deed-as-collateral lending, deed-yield strategies, secondary-derivative markets) on the platform. The deed is single-purpose under the §5.7 terms.
- **Public/private toggle.** §5.5 already documents the toggle. Its de-financialization function is that public mode does not surface speculative-resale signals even when the deed is publicly visible -- the public surface is the owner-credit form, not the marketplace-listing form.

The six choices operate jointly. Removing any one weakens the framing perimeter: marketing language without UI alignment surfaces speculation through the back door; UI de-financialization without anti-financialization terms permits third-party derivative markets to recreate the speculation surface; and so on. The framing perimeter must be defended at all six layers to preserve the art-as-art register.

**Implementation:** R45 (Portal Technical Spec); R67 follow-on UI specification.

### 5.11 Intake Authenticity: Reputation Gate Plus ESIGN Attestation

Gallery's intake-authenticity architecture filters incoming content through two load-bearing layers: the §1.4 reputation gate on creator onboarding and ESIGN-bound creator attestation on each upload. The §1.4 reputation gate filters the creator population to those with reputation capital large enough that a fraud finding imposes career-ending forfeiture cost (named-creator reputation forfeiture runs into hundreds of thousands to millions of dollars per finding). ESIGN-bound creator attestation per Vermont 12 V.S.A. §1913 creates direct civil and criminal exposure on each upload. R65 Appendix A documents the composite intake gate sequencing these layers along with content-compliance checks (uniqueness, rights-resolution, malware, explicit-content screening).

C2PA (Coalition for Content Provenance and Authenticity) was considered as an additional intake-verification layer. C2PA is a tamper-resistant method to cryptographically sign image files at capture time and through editing chains, but its provenance signature is embedded in file metadata that is stripped by most major social platforms during re-hosting -- so the signature is easily removed precisely where Gallery's Copies are most likely to circulate. C2PA is therefore not load-bearing in Gallery's intake architecture. Appendix F documents the C2PA standard, regulatory drivers, and ecosystem status for reference.

External buyer-survey evidence supports authenticity as the dominant collectible-market concern and shows digital markets exhibiting the failure mode at materially higher rates than physical markets:

- Chubb Collector Wealth Report (2023, n=800 NA collectors) -> 87% cite art fraud as their top risk concern, edging out damage during transport (86%), natural deterioration, and environmental disasters [chubb-2023]. In physical collectibles, fraud beats every physical hazard as the dominant collector fear.
- Hiscox Online Art Trade Report (2017 ed., multi-year survey) -> 87% of hesitant online art buyers said a Certificate of Authenticity is essential to justify the purchase; the 2013 baseline edition found 80% citing provenance and authenticity as the main barrier to online art buying [hiscox-2017]. Authentication is not just a concern but operationally required to convert hesitant buyers.
- Art Basel and UBS Survey of Global Collecting (2025) -> collectors seeking direct creator authentication; HNWI studio visits rose to seven per year in 2024 (eight planned for 2025), with direct-from-artist purchases growing [artbasel-ubs-mcandrew-2026]. High-net-worth collectors are physically traveling to creator studios because authenticity verification is worth their time.
- PrivacyHQ NFT-owner survey (2022, n=1,008 US NFT owners) -> 90% reported experiencing an NFT scam; only 1 in 10 had not. Most common scam categories: NFT provider shutdown (44.8%), project disappearance (43.8%), fake marketplace (43.3%), fake giveaway (41.8%) [privacyhq-2022]. In digital markets, the fear of fraud documented by Chubb has converted into routine buyer experience.
- OpenSea internal admission (2022) -> 80% of NFTs minted through OpenSea's free creation tool were plagiarized works, fake collections, or spam, per the marketplace's own announcement [opensea-2022]. The largest NFT marketplace conceded that the supply side was overwhelmingly fraudulent.

The asymmetry is diagnostic: in physical collectibles, 87% of collectors *fear* fraud; in digital markets, 90% of buyers have *experienced* it, and the dominant marketplace concedes that 80% of new supply is fraudulent. Gallery's intake response to this gap is the composite intake gate documented in R65 Appendix A: the §1.4 reputation gate plus ESIGN attestation economically binds creator attestation at upload, supplemented by content-compliance checks. The surveys collectively underwrite the broader authentication architecture.

**Implementation:** R65 Appendix A (Capture-Source Comparison and Attack Economics; composite intake gate); R69 (Gallery MMP Specification upload flow).

---

### 5.12 Public Verifiability of Image Authenticity

**Requirement.** Image payload authenticity MUST be verifiable by a third party without requiring platform credentials, API access, or proprietary tooling.

**Rationale.** Gallery's authenticity guarantee depends on independent verification. If verification required platform cooperation, the platform itself becomes a trust dependency and the deed loses meaning as a third-party-verifiable ownership receipt.

**Implementation:** R62 §2.1 Certification specifies the verification mechanism that satisfies this requirement. R65 §1.5 and §3.13-§3.16 analyze platform-specific threats against that mechanism.

### 5.13 Permanence of Deed and Artifact

The artifact and the deed must remain accessible to the owner across platform shutdown. The conventional alternative -- platform-mediated access where artifact retrievability depends on Gallery's continued operation -- is the load-bearing NFT-cohort failure mode documented in Appendices C and D. Without permanence, any "permanent ownership" marketing claim is contractually fragile and legally exposed; the deed degrades to a contingent claim on platform survival rather than a durable property right.

**Rationale.** Permanence is the architectural commitment that makes Gallery's value proposition coherent. Four theoretical and legal anchors converge on it:

- **Schlager-Ostrom Keep (§4).** The right to hold ownership in collection requires the artifact remain retrievable over time, not just at acquisition. An owner whose artifact becomes inaccessible has lost the Keep right.
- **UCC Article 12 benefit-to-holder (§6.2).** A controllable electronic record requires the holder to have exclusive power to "avail itself of substantially all the benefit" from the asset linked to the record. An inaccessible artifact reduces the deed to a hollow CER.
- **Howey personal-consumption defense (§6.6).** The personal-consumption framing requires the deed grant durable real use of the artifact, not a contingent claim on platform survival; permanence is what makes the framing substantively true.
- **BMA / CMA contractual commitments.** Gallery's promises in the click-wrap contracts about license-survival require architectural backing, not platform-mediated guarantees that evaporate at cessation.

**Implementation.** R62 §2.2 stores the encrypted Master on Arweave under permanent-storage economics, separate from the deed on Solana (transferable on-chain receipt). R62 §3.4 license-survival specifies the dual-wrap envelope -> the buyer-wallet wrap of the per-image DEK on the deed lets the owner decrypt the Arweave bytes locally without any Gallery endpoint, API, or operational service. Permanence is therefore satisfied as long as the owner retains their wallet, regardless of Gallery's operational state.

**MMP-phased trustlessness strengthening.** R72 specifies an architectural strengthening that closes the residual wallet-loss-plus-platform-loss conjunction case -> a third DEK wrap gated by a platform-cessation oracle, decryptable post-cessation via threshold cryptography, with auto-publish to Arweave. Trustlessness is positioned for MMP rollout rather than MVP because (a) MVP customer-loss exposure is bounded such that contractual wallet-custody clauses absorb the self-custody risk per industry norm (Ledger, MetaMask, Magic), and (b) trustlessness serves business and institutional buyers who value compliance and audit primitives; it is a B2B-tier feature rather than a baseline product requirement. R72 §3.5 specifies MVP-era deed backfill at MMP rollout.

---

## 6. LEGAL AND OWNERSHIP FOUNDATION

This section establishes Gallery's legal foundation. The statutory substrate operates on both halves of the Identity Framework (§3): Copyright Title 17 and ESIGN provide the legal-layer machinery for the positive half (Authentication, naming the holder X), while DMCA §1201 provides the legal-layer machinery for the negative half (Authorization, barring ¬X from exercise). The body covers Article 12 identity binding (§6.2), the copyright/DMCA/ESIGN statutory triad (§6.3-§6.5), securities compliance (§6.6) with required-feature MVP (§6.7), FTC franchise compliance (§6.8), authorship doctrine for AI-generated and derivative works (§6.9), right of publicity (§6.10), content-moderation statutory floor (§6.11), and RUFADAA inheritance posture (§6.12). Retrospective property-theory and broker-characterization evaluations are documented in Appendix A. The limited-edition photography authentication workflow that anchors Gallery's deed-as-COA framework is documented in Appendix H.4.

**Three-layer legal structure of the image bundle.** The statutes in §6 operate in three distinct relationships to the buyer's Ostrom bundle. The first layer enforces the owner's rights; the second and third layers concern the image's legal-subject status and operate independently of owner-rights enforcement.

| Layer | Function | Laws | §6 location |
|---|---|---|---|
| 1. Owner rights | Enforce the buyer's five-right bundle against challengers | Copyright §106, §202, §106(2); DMCA §1201(a) and (b); UCC Article 12; ESIGN; license doctrine | §6.2-§6.5 |
| 2. Artifact legitimacy | Gate at ingestion: determine whether the image qualifies as legal subject matter | CSAM (18 U.S.C. §§2251, 2252, 2252A, 2258A, 1466A); NCII / Take It Down Act; right-of-publicity consent gate | §6.10, §6.11 |
| 3. Third-party rights | Persist alongside the bundle: depicted-person and heir rights that constrain Withdrawal and Alienation when commercial use of likeness is implicated | Right of publicity (incl. post-mortem statutes: CA, TN, NY); Lanham Act §43(a) false endorsement; editorial-use First Amendment doctrine | §6.10 |

If the image fails Layer 2 (artifact legitimacy), no bundle vests; the deed cannot be minted. Layer 3 (third-party rights) persists for the depicted person regardless of deed holder and limits how the buyer exercises Withdrawal (display) and Alienation (resale) without consent or editorial-use justification.

Other frameworks documented in §6 -> Howey (§6.6), Legal MVP (§6.7), FTC Franchise Rule (§6.8), authorship doctrine (§6.9), DMCA safe harbor (§6.4), Section 230 (§6.11), RUFADAA (§6.12) -> operate at the platform-business or platform-immunity level and do not enforce or constrain the bundle directly.

### 6.2 Article 12 Identity Binding Rationale

The Uniform Commercial Code's 2022 Article 12 amendments [ulc-2022] introduced the controllable-electronic-record (CER) construct as the legal vehicle for tokenized property rights. Article 12 conditions CER property treatment on a three-part control test: (1) power to enjoy substantially all benefits of the record, (2) exclusive power to prevent others from enjoying those benefits, (3) exclusive power to transfer control. Gallery's deed protocol satisfies each: blockchain custody confers exclusive private-key-based control to the deed holder (1, 2); the smart contract is the exclusive transfer mechanism (3). Gallery's authentication stack (creator signature, IDV-bound buyer identity, immutable ownership ledger) supplies the additional identifiability requirement that Article 12 imposes -> the controlling party must be readily identifiable by name, cryptographic key, or account number.

Identity binding to the deed is the operational predicate for the Schlager-Ostrom Exclusion right (§4). A wallet-only deed (the standard NFT-cohort configuration) reduces to a pseudonymous instrument: the holder cannot be located for service of process, verified for chain-of-title disputes, or distinguished from a thief in possession. Identity binding is the legal-layer counterpart to access control on the artifact (§5.1); together they convert the deed-and-Master pair into an instrument supporting the full bundle of ownership incidents. The two-tier identity binding (Retail and Verified, §5.7) calibrates verification depth to legal stakes -> Retail-tier purchases below the per-account threshold operate within the de minimis collectibles-marketplace framing (App A.2) where cardholder-plus-Google identity is sufficient; Verified-tier purchases operate within a fuller compliance perimeter where KYC supports AML, broker-reporting, and Article 12 cross-jurisdictional enforcement.

**State enactment.** Article 12 takes effect through state enactment rather than federal preemption. As of early 2026, more than thirty states plus DC have enacted, including Minnesota (effective August 2024), Washington (effective January 1, 2024), California, and New York (signed December 5, 2025; effective June 3, 2026 under S.1840-A/A.3307-A). New York matters disproportionately because it is the dominant choice-of-law jurisdiction for commercial and financial contracts. For buyers in enacting states, the deed bundle (possess, use, exclude, transfer, derive resale royalties) is statutorily recognized as personal property with traditional-chattel priority and good-faith-purchaser protections. For buyers in non-enacting states, the older general-intangible framework applies (workable but thinner third-party protection). Gallery's terms designate an enacting state (Delaware, Wyoming, or New York post-June 2026) as governing law -> Article 12's choice-of-law provisions explicitly permit this, extending statutory recognition regardless of buyer state of residence. A formal Article 12 compliance opinion from qualified property-law counsel should be obtained prior to launch, paralleling the ESIGN opinion noted in §6.5.

### 6.3 Copyright -> Statutory Framework and Compliance Posture

Copyright law (Title 17 U.S.C.) provides the legal foundation for creative ownership but does not solve the digital enforcement problem. The statute distinguishes the **work** (intangible creative expression) from **copies** (material objects in which it is fixed), treating all copies as legally equivalent -> no "master" or "original" has superior status (§101). **Copyright ownership** (§106) grants exclusive rights over reproduction, distribution, and display; **object ownership** (§202) is independent possession of a physical copy. Copyright defines who has rights but provides no enforcement infrastructure for digital goods. The law prohibits copying; physics allows it.

**Compliance posture.** The creator retains copyright (17 U.S.C. §106) in all cases; no copyright transfer occurs. The Master Image sale transfers object ownership (NFT deed) while copyright remains with the creator, consistent with §202's separation of material object from copyright ownership. The Exclusive License grants the owner limited rights (personal use, gallery display, resale) under the creator's copyright, executed through a valid online contract. The per-image License Acceptance must also state transparently what is permitted for the downloaded copy variants (Social Copy and, where creator-enabled, Keepsake Copy) after the owner sells: the license travels with the deed, so the former owner retains any downloaded copy variant only as a personal memento and holds no continuing license to redistribute it, resell it, or use it commercially. Making the post-sale position explicit sets expectations on both sides and forecloses disputes over the retained file. The engineering layer (encryption, provenance metadata) enforces these boundaries technically.

### 6.4 DMCA -> Statutory Framework and Compliance Posture

The Digital Millennium Copyright Act (DMCA, 17 U.S.C. §1201, October 1998) extends copyright into the digital environment through two technological-protection-measure categories: **access controls** (§1201(a): passwords, encryption, authentication preventing unauthorized access) and **copy controls** (§1201(b): measures preventing unauthorized reproduction or display once access is granted). The DMCA's two categories map directly to the two enforcement barriers identified in §3.1: access controls gate who can reach the content (Spotify login, Kindle device registration, the protocol's gallery authentication); copy controls restrict duplication once access is granted (DRM, CD copy protection, Kindle export restrictions). Designed for a centralized-distribution era, copy control alone proved insufficient when Napster decentralized distribution.

**Compliance posture.** The platform qualifies for DMCA safe harbor (17 U.S.C. §512) by maintaining four requirements: a designated DMCA agent registered with the U.S. Copyright Office, a notice-and-takedown procedure, a counter-notification process, and a repeat-infringer policy terminating accounts of serial violators. The architecture reduces infringement risk beyond typical hosting platforms: creator identity is verified (YouTube OAuth + KYC), content uniqueness is enforced algorithmically at ingestion, and on-chain provenance creates an auditable attribution chain for every Master Image.

### 6.5 ESIGN -> Statutory Framework and Compliance Posture

The Electronic Signatures in Global and National Commerce Act (ESIGN, 15 U.S.C. §§7001-7031, June 2000) establishes that electronic signatures and electronic records carry the same legal validity as handwritten signatures and paper documents. Under §6006(5), an "electronic signature" is any "electronic sound, symbol, or process, attached to or logically associated with a contract or other record and executed or adopted by a person with the intent to sign the record." ESIGN is technology-neutral: a typed name, click event, biometric capture, or any other electronic action evidencing intent to sign satisfies the statute. The legal validity of an e-signature does not depend on any specific cryptographic technology. ESIGN does not address identity (handled by three-layer identity verification before signing), permanence (handled by Arweave immutable storage and Solana ledger immutability), or unauthorized copying (handled by DMCA, §6.4).

Three Gallery signature surfaces fall under ESIGN, each on the same legal foundation as standard e-commerce click-wrap and digital-transaction precedent:

1. **Click-wrap acceptance** of the Creator Member Agreement, Buyer Master Agreement, and Sole Copy Agreement, executed at onboarding and per-purchase. The signature is the click event; the record is the agreement text. Established under *Feldman v. Google* (2007) and decades of e-commerce precedent.
2. **Image signing-event** at upload, executed by the creator on each Master Image. The signature is the explicit per-upload affirmation ("I sign this Master as my own work") captured as a click event distinct from "Submit"; the record is the Master Image identified by content hash. This is the digital analog of the artist's hand-mark on a physical work and the foundation of the consumer-facing "creator-signed" claim.
3. **Deed-issuance transaction** at purchase, executed through the Crossmint API. The signature is the cryptographic transaction signature; the record is the on-chain deed-issuance entry.

Each surface is electronic, logically associated with a distinct record (contract, image, deed), and executed with creator or buyer intent to sign that record.

**Compliance posture (image signing-event).** The per-upload signing affirmation constitutes a valid electronic signature on the image as authored work, on the same legal foundation as standard click-wrap e-signature precedent.

| ESIGN Element | Statutory Requirement | Protocol Implementation |
|---|---|---|
| Intent to sign | Signer intends to authenticate the work as their own | Per-upload affirmation ("I sign this Master as my own work") with the creator's verified name and signing date displayed; click event captured separately from the upload Submit action |
| Consent | Parties consent to electronic transactions | CMA accepted at onboarding; Terms of Service at registration |
| Association | Signature logically associated with record | Signing-event log binds creator identity, Master Image content hash (R62 §2.1), timestamp, IP, browser fingerprint, and session token to the specific Master Image |
| Record retention | Signed record retained and reproducible | Signing-event log retained in the platform's records system on the same retention posture as click-wrap acceptances |

**Compliance posture (deed-issuance transaction).** The deed-issuance process constitutes a valid electronic signature under ESIGN.

| ESIGN Element | Statutory Requirement | Protocol Implementation |
|---|---|---|
| Intent to sign | Signer intends to authenticate | Multi-step confirmation UX with file preview, metadata review, explicit issuance confirmation |
| Consent | Parties consent to electronic transactions | Terms of Service accepted at registration |
| Association | Signature logically associated with record | Wallet private key signs the specific Solana transaction, producing a hash linked to the deed |
| Record retention | Signed record retained and reproducible | Solana blockchain provides permanent, immutable, independently verifiable retention |

**Image signature role: attestation, not memorabilia.** Gallery's image signing-event is an attestation signature: the creator's affirmation of authorship of the Master, captured in the metadata and provenance layer (signing-event log, deed page disclosure). It is the digital analog of the painter's signature on canvas, the photographer's signature on a print, or the sculptor's stamp on a bronze edition: an authorship claim associated with the work without altering the artistic content of the work itself. The displayed image (Path 1 owner view, Path 2 public render) is not visually modified by the signature; the signature is surfaced alongside the image on the deed page, never overlayed as a visible mark on the image content.

This is structurally distinct from the memorabilia signature pattern, in which the signature is an additional artifact composited into the image as a visible mark and the signature itself is the value driver on an otherwise generic artifact (signed sports memorabilia, signed celebrity photos). Signimage (R68) implements the memorabilia pattern as a sibling product on the same Gallery infrastructure: the celebrity's signature is captured biometrically and merged into the image in the pixel domain, producing a signed composite where the signature is part of the displayed artifact. Gallery's attestation signature and Signimage's memorabilia signature use the same e-signature mechanism legally (ESIGN-compliant click event with intent + association + retention) but occupy different signature-artifact roles: Gallery's signature attests to authorship of an existing self-authored work; Signimage's signature creates a new composite work in which the visible signature is part of the artifact.

The categorical distinction governs comparable-market positioning. Gallery's comparable market is signed limited-edition photography, signed prints, and signed contemporary art -- markets where the attestation signature supports authentication without driving the artifact's primary value (the artistic merit of the work is the value driver). Signimage's comparable market is signed memorabilia -- markets where the signature is the value driver on an otherwise generic artifact. The same architecture supports both products with no compromise to either: Gallery preserves the art-as-art posture that R67 §6.4 and the §6.6 Howey defenses depend on, while Signimage occupies the memorabilia category cleanly.

**Phase 2 enhancement: on-chain creator attestation registry.** The creator's wallet pubkey is necessarily public (it appears in every deed's Metaplex `creators` array; on-chain analysis correlates a creator's wallet across their catalog without platform involvement; a creator selling images publicly cannot maintain wallet anonymity in practice). Publishing a wallet-to-name binding therefore carries zero privacy cost. A Phase 2 on-chain creator attestation registry -- a Solana program storing entries `{creator_wallet, verified_name, channel_handle, verified_at, platform_attestation_signature, kyc_evidence_hash}` -- would put the wallet-to-name binding on-chain with standardized rendering by wallet explorers and Solana-aware tools, surviving platform shutdown by program persistence rather than requiring a Gallery-aware viewer. Phase 2 scope deferred from MVP (R69 ships with the platform UI plus COA combination, which covers active-platform operation); the registry strengthens shutdown survivability and removes the buyer's dependency on platform UI for creator identity. When implemented, it slots into R62 §3.1 as a verification layer alongside KYC and verified creator profile.

**Customer-facing claim.** Public surfaces (deed page, marketing copy, R66 PMF positioning) may state that each Master is "creator-signed" -- as an attestation signature in the fine-art tradition, not as memorabilia value-creation -- with the deed page surfacing the signing-event timestamp. Legal and regulatory surfaces should specify the basis: "creator attestation electronic signature on the Master Image at upload, satisfying 15 U.S.C. §7006(5), with the on-chain content-hash anchor as the load-bearing artifact-level binding."

A formal ESIGN compliance opinion from qualified technology counsel should be obtained prior to launch, covering the click-wrap, image signing-event, and deed-issuance transaction signature surfaces.

### 6.6 Securities Compliance -> Howey Four-Prong Analysis

Under *SEC v. W.J. Howey Co.*, 328 U.S. 293 (1946), a transaction is a security only if all four prongs are simultaneously satisfied: (1) investment of money, (2) common enterprise, (3) reasonable expectation of profits, (4) derived primarily from the efforts of others. Defeating any one prong avoids classification. Gallery's design defeats all four.

**Prong 1 -> Investment of Money. Defeated.** *Forman*, 421 U.S. 837 (1975), and *Daniel*, 439 U.S. 551 (1979), establish that consumption purpose extinguishes investment-of-money characterization even when payment is exchanged. Master Image purchases deliver consumption utility at sale -> encrypted high-resolution original, public gallery display rights, cryptographic creator-origin authentication, and (where opted in) reproduction licensing -> structurally identical to a signed photograph, gallery painting, or record-store album. The Fuse No-Action Letter (Nov 2025) recognizes the same principle for tokens delivering consumer utility at purchase.

**Prong 2 -> Common Enterprise. Defeated.** Horizontal commonality is absent: every Master is a one-of-one with no pooled fund, shared treasury, or pro-rata returns. Vertical commonality is no stronger than baseline collectibles markets the SEC has historically declined to regulate -> physical autographs, living-artist paintings, baseball cards, signed first editions all track creator/subject reputation without securities classification; Heritage, Sotheby's, Christie's, and Goldin operate without securities-exchange registration.

**Prong 3 -> Expectation of Profits. Defeated.** Buyer motivations documented in §2 (collecting psychology, fan connection, beneficence, sacralization, gallery display) dominate; financial appreciation is incidental. Six protocol-enforced safeguards suppress profit-expectation framing: (1) **marketing-language prohibition** -> Terms of Service ban "investment," "ROI," "yield," "appreciation," "return" in platform and creator promotional copy, violation triggers takedown; (2) **UI de-financialization** -> no price charts, floor-price aggregators, or portfolio analytics; resale history shows provenance not profit; (3) **primary-market 90-day lock-up** suppressing flip-incentive when investment framing is most plausible; (4) **click-wrap no-reliance** -> buyer acknowledges personal-enjoyment intent and absence of value representation, preserved in deed metadata; (5) **fractionalization prohibition** forecloses the single mechanism most likely to convert collectible into securities-like instrument; (6) **royalty direction** -> resale royalty flows reseller -> creator, never to buyer (parallel to CA Resale Royalty Act and EU droit de suite, neither of which converts artworks into securities).

**Prong 4 -> Efforts of Others. Defeated.** Platform efforts are infrastructure (minting, custody, authentication, gallery display, transaction processing) -> the same functions every gallery, auction house, and marketplace performs without securities classification. Creator efforts are creative production with the dependency every living-artist collectible market exhibits. Buyer efforts dominate post-purchase outcome: resale timing, listing price, framing, and platform choice are buyer-controlled.

**Counter-arguments and enforcement record.**

| SEC counter-argument | Rebuttal |
|---|---|
| Royalty stream creates ongoing economic relationship | Royalty flows reseller -> creator, not buyer; identical to CA Resale Royalty Act / EU droit de suite |
| Network effects benefit all holders | Same diffuse benefit as eBay, Heritage, OpenSea -> none classified as securities exchanges |
| Creator promotion drives buyer profit expectation | Generalized creator dependency is collectibles-market baseline, not the *predominant* dependence Howey requires |
| Resale infrastructure resembles exchange price discovery | Floor-price visibility suppressed by design; architecture is the inverse of an order book |

SEC enforcement turns on investment marketing, not NFT mechanics. **Stoner Cats** (Sept 2023, $1M settlement) and **Impact Theory** (Aug 2023, $6.1M) involved explicit appreciation-tied marketing and treasury-growth promises -> Gallery's marketing prohibition and royalty-to-creator architecture forecloses both factors. **OpenSea Wells Notice** (Aug 2024, withdrawn Feb 2025) and **Yuga Labs investigation** (closed Sept 2024) signal SEC reluctance to treat NFT marketplaces as securities venues absent investment-marketing facts. Master Image transactions are not investment contracts. Token-level Howey analysis for the DAO governance/utility token is documented in R12 §2; full SEC NFT enforcement record is cataloged in R12 §3.3-§4.4.

### 6.7 Legal MVP -> Required Product Features for Securities Compliance

The following features are structural requirements for legal compliance, not optional product enhancements. Without any one of them, the platform's legal architecture is incomplete and exposes transactions to regulatory risk. All three must ship at launch.

| Required Feature | Legal Function | Without Feature |
|---|---|---|
| Gallery app (public display, viewing fees, glass-box copy protection) | Defeats Howey Prong 3: display and viewing fees create measurable consumption utility independent of resale, establishing the Master Image as a consumption product rather than a passive holding; glass-box architecture provides authorization control over access | Only economic path is resale at higher price -> profit expectation alive; replicates NFT market's failed product structure |
| Reproduction licensing (Merchandiser persona, Section 5) | Defeats Howey Prong 4: enables independent commercial effort by the owner (sourcing production, managing retail, setting pricing, handling fulfillment) with zero platform involvement in revenue generation | No independent owner effort -> Master Image is passive asset dependent on creator fame and platform infrastructure; "efforts of others" standard satisfied |
| ESIGN-compliant contract architecture (Section 3.4, Section 5.3) | Makes the entire ownership architecture legally binding: validates CMA/BMA as enforceable electronic contracts, gives Purchase Receipts evidentiary weight, establishes blockchain records as admissible proof of ownership | Exclusive License is not a valid electronic contract -> ownership rights unenforceable; copyright warranty non-binding; blockchain supremacy clause has no contractual force |

### 6.8 FTC Franchise Compliance

**The Franchise Classification Risk.** The FTC Franchise Rule (16 CFR 436) defines a franchise as requiring: (1) trademark association, (2) significant operational control, and (3) required payment of $500+ to the franchisor within six months. The platform's relationship with Merchandisers is structured as IP licensing, not business format licensing.

| Dimension | Business Format Franchise | Creator DAO Distribution License |
|---|---|---|
| Trademark requirement | Must operate under franchisor's brand | Owner operates under own identity |
| Operational control | Franchisor prescribes business methods | Owner has full retail autonomy |
| Required payment | Upfront fee to franchisor | Payment to creator (IP licensor), not platform |
| Business system | Comprehensive methods prescribed | No business system prescribed |
| Precedent | McDonald's, Subway | Record label licensing from songwriter |

### 6.9 Authorship Doctrine -> AI-Generated Works and Resale-Right Implications

U.S. copyright requires human authorship (17 U.S.C. §102(a); U.S. Copyright Office Compendium §313.2). *Thaler v. Perlmutter*, 687 F. Supp. 3d 140 (D.D.C. 2023), aff'd 130 F.4th 379 (D.C. Cir. 2025), holds that AI-generated work without human authorship cannot be registered. The test is creative control, not whether a human prompted the AI -> AI-assisted human work with substantive creative control retains copyright; AI-autonomous output from a bare prompt does not.

**Five resale-right tiers** (declared at mint per R62 §6.4 / §7.1.7; protocol mechanics in R62 §3.3):

- **Captured and Hand-produced Masters** -> full copyright; deed conveys object ownership plus Exclusive License under §6.3.
- **AI-generated Masters below the Thaler threshold** -> no underlying copyright; deed conveys exclusive object-instance ownership backed by Gallery's DRM (R62 §4.10), on-chain provenance, and contractual access control. Platform-instance scarcity is independent of copyright. Third-party copyright-infringement remedies are unavailable, but platform-DMCA remedies protect the authenticated instance.
- **Derivative works on public-domain source** -> editing contribution acquires copyright if "more than a trivial variation" (17 U.S.C. §§101, 103; *Bridgeman v. Corel*, 36 F. Supp. 2d 191 (S.D.N.Y. 1999); *Batlin v. Snyder*, 536 F.2d 486 (2d Cir. 1976)). Deed's Exclusive License covers editing-copyright rights; underlying public-domain status undisturbed. The editing contribution is disclosed on the deed page.
- **Public-domain pure originals** -> expired-copyright works, U.S. government works (17 U.S.C. §105), CC0-dedicated works, or other works where copyright does not subsist and the creator contributes no original editing. No underlying copyright and no editing copyright; deed conveys exclusive object-instance ownership under the same DRM-plus-provenance architecture as the AI-generated tier. Resale value derives from authenticated-instance scarcity. To prevent catalog dilution from bulk public-domain reproduction (a single creator could otherwise mint an entire museum open-access collection), the platform imposes a per-creator velocity limit at the ingestion gate, calibrated administratively and raised case-by-case for legitimate curation projects (digitized archive series, scholarly editions).
- **Third-party licensed Masters** -> creator does not hold copyright but holds a license sufficient to authorize platform-mediated distribution (CC-BY, CC-BY-SA, paid stock licenses from platform-recognized providers, custom licenses). Deed conveys exclusive object-instance ownership under the same DRM-plus-provenance architecture; the license document is hash-bound to the deed at ingestion. Downstream resale capability is subject to license-scope inheritance: CC-BY imposes attribution on each successive holder; a paid stock license that prohibits sublicensing constrains resale to platform-mediated transfers within the license scope. Creators are responsible for selecting input licenses compatible with platform-mediated distribution.

**Compliance posture is disclosure-based, not exclusion-based.** For tiers without underlying copyright, the deed page surfaces the underlying rights status (public-domain basis, AI-generation declaration, third-party license terms), instance-level exclusivity, and resale-value derivation from authenticated-instance scarcity. Buyer acknowledges pre-purchase via click-wrap. R62 §3.3's tier-handling table specifies the protocol mechanics (disclosures, velocity limits, license-document hash-binding, license-scope inheritance) that operationalize this posture; the same exclusivity structure applies across all tiers, with different underlying-rights disclosures per tier.

### 6.10 Right of Publicity -> State Tort Exposure and Editorial-Use Boundary

Right of publicity protects commercial use of name, likeness, voice, signature, and identifying attributes. The doctrine is primarily state law: NY §§50-51 and CA §3344 ($750/use floor + attorney's fees) provide statutory causes of action, with CA common-law extension under Restatement (Third) of Unfair Competition §46. Roughly half of U.S. states recognize the right by statute, the rest by common law. Tennessee's ELVIS Act (2024) extended protection to AI-generated likeness and voice; follow-on legislation has emerged in IL, CA, NY. Federal overlay: Lanham Act §43(a) (15 U.S.C. §1125(a)) for false endorsement; Take It Down Act (2025) for NCII including synthetic NCII; Section 230 does not preempt state right-of-publicity claims under the Ninth Circuit IP carve-out.

**Three resolution paths** when a Master depicts an identifiable real person (Master Image sale is unambiguously commercial use):
- **Consent** -> depicted person executes a model release, uploaded at mint, hash-bound to deed, surfaced on the deed page as proof of clearance.
- **Editorial-use exemption** -> First Amendment defense for newsworthy content and public-figure-in-public-place depictions (*Hoepker v. Kruger*, 200 F. Supp. 2d 340 (S.D.N.Y. 2002)); narrow when applied to commercial sale of the depicting work, most reliable for journalistic photography, least reliable for stylized commercial depictions of public figures sold as collectible art.
- **Creator-as-subject** -> resolved automatically by face-match to the three-layer identity chain (R62 §3.1).

Synthetic likeness carries the same right-of-publicity exposure as photographic depictions per the ELVIS Act; non-consensual synthetic intimate imagery additionally triggers Take It Down Act and state-NCII liability with criminal exposure in some jurisdictions. Same three-path resolution applies, plus explicit synthetic disclosure on the deed (R62 §6.4).

**Compliance posture.** Ingestion-gating per R62 §6.5 -> face recognition against a public-figure index and broader identifiable-person population; matches gate the upload until one resolution path is satisfied. Consent documentation retained as deed metadata, produced on subpoena or DMCA-style demand. Strict gating is non-optional -> creator authentication makes the creator personally liable for false consent, and platform exposure is joint and several under Lanham §43(a) and state statutes (CA §3344(a) imposes joint liability on platforms with constructive knowledge). For post-mint takedown, R62 §4.12 specifies the pathway: deed transitions through rights-disputed to void per the §5.11 deed state machine, with buyer refund from creator reserve and creator-account graduated penalties per R62 §6.5.

### 6.11 Content Moderation Statutory Floor -> CSAM, NCII, and Payment-Rail Compliance

The platform operates within a multi-layer content-moderation legal floor mandating ingestion-time screening and reporting infrastructure beyond Section 230 and DMCA contemplation.

**Statutory framework.** *CSAM:* 18 U.S.C. §§2251 (production), 2252 (distribution and possession), and 2252A (extended distribution and access) impose strict federal criminal liability. §2258A imposes mandatory NCMEC CyberTipline reporting within 60 days of actual knowledge (fines up to $300,000 per violation); §2258B provides good-faith provider immunity; Section 230 expressly does not preempt federal criminal law (47 U.S.C. §230(e)(1)). *NCII:* The federal Take It Down Act (2025) creates a notice-and-takedown obligation for NCII including synthetic NCII, with statutory damages and criminal penalties; 49 states have NCII statutes (CA Civil Code §1708.86 and NY Civil Rights Law §52-b are leading civil causes). *AI-generated CSAM:* The PROTECT Act (18 U.S.C. §1466A) covers obscene visual representations of children and has been applied to AI-CSAM; state statutes (LA Act 457 (2024) and follow-ons) criminalize AI-CSAM regardless of whether the depicted child is real or synthetic. *Payment-rail compliance:* Visa, Mastercard, Stripe, and PayPal categorically prohibit CSAM and NCII; adult-content categories require specialized processors (CCBill, Verotel, Segpay-class). G-rated default-tier content is a hard requirement of the primary payment rail.

**Hard-floor requirements** (no exceptions, no tier-graduation):
- **PhotoDNA / NCMEC hash-matching at ingestion** -> every Master hash-matched against the NCMEC known-CSAM index; matches trigger hard-rejection, creator suspension, and §2258A report within 60 days.
- **AI-CSAM classifier** (Thorn Safer-class) -> screens synthetic CSAM patterns absent from PhotoDNA, same hard-rejection-and-report path.
- **NCII screening** in the ingestion classifier set with hard rejection on detection (combines R62 §6.4 deepfake-of-real-person check with NCII-specific classifier).

**Tier-graduated adult content** beyond the hard floor:

| Classification | Definition | Default tier | Adult tier (forward-looking) |
|---|---|---|---|
| G | No nudity, no suggestive content | Permitted | Permitted |
| Suggestive (Racy) | Implied or partial nudity, suggestive poses, art-context nudity | Restricted to art-tagged listings; not in general discovery | Permitted |
| Adult (NSFW) | Explicit adult content above Miller-test obscenity floor | Rejected | Permitted with adult-content processor and age-verified buyer |
| Prohibited | CSAM (real or AI), NCII (real or AI), exploitation, non-consensual | Rejected with §2258A report (CSAM) or Take It Down takedown (NCII) | Rejected with same procedure |

The G-rated default enables Stripe Connect primary processing (R62 §2.4) and discoverability surfaces without trigger-level classifications. Adult tier is forward-looking and would require parallel infrastructure (separate MCC merchant accounts, age verification, segregated discovery); not part of the launch product.

**Section 230 limits.** Immunity does not extend to: federal criminal law (§230(e)(1)) including CSAM; federal IP (§230(e)(2)) including right-of-publicity under the Ninth Circuit IP carve-out; FOSTA-SESTA sex-trafficking exception (§230(e)(5)); state NCII causes of action under the same carve-out reading. Gallery's moderation is therefore mandatory ingestion-screening to avoid liability §230 does not absorb, not voluntary moderation. R62 §6.6 specifies the technical stack: PhotoDNA/NCMEC hash matching (Tier 0, non-skippable), Thorn Safer AI-CSAM classifier (Tier 1), NCII classifier (Tier 1), then Hive / Google SafeSearch / Amazon Rekognition-class adult-content classifier producing the {G, Suggestive, Adult, Prohibited} classification. Hard-floor layers run synchronously and gate the upload; classifier output is recorded in deed metadata. Post-mint: CSAM detection triggers immediate burned-state transition per R62 §4.10 with §2258A reporting and law-enforcement referral; NCII follows the Take It Down Act 48-hour pathway with rights-disputed-to-void transition (R62 §4.12).

### 6.12 Buyer Wallet Control -> RUFADAA Compliance Posture and Inheritance Architecture

Gallery's license-survival (R62 §3.4) is structural rather than platform-mediated: the buyer holds the deed in a Magic-provisioned Solana wallet under exclusive buyer authentication; the platform never holds the private key. The trade-off is platform-shutdown protection (the platform cannot recall, freeze, or transfer the deed without buyer-signed authorization) at the cost of platform-mediated inheritance procedures. The pattern follows self-custody (Ledger, Trezor, Magic) rather than custodial exchanges (FTX 2022). R65 §3.6-§4.7 documents the platform-shutdown threat surface; R65 §3.12 the inheritance-without-planning surface.

**Statutory framework.** RUFADAA (2015; 49 states plus DC) establishes a three-tier fiduciary-access priority: Tier 1 in-product beneficiary designation, Tier 2 will or trust, Tier 3 Terms of Service. The Stored Communications Act (18 U.S.C. §2701 et seq.) provides fiduciary-disclosure good-faith immunity (RUFADAA §16). State probate codes govern substantive transfer (CA Probate §§871-875; NY EPTL §13-A). Federal estate tax (26 U.S.C. §§2031-2046) treats deeds as gross-estate assets at fair market value on date of death. Copyright transfer for creator-deceased works follows 17 U.S.C. §201(d).

**Compliance posture.** Gallery operates as a RUFADAA "custodian" bounded by what the platform structurally controls. Platform commitments: disclose deed records to verified executors on receipt of death certificate, letters testamentary, and executor identity verification (RUFADAA §16 / SCA immunity); action probate court orders within platform reach; re-encrypt the deed-bound decryption key to the heir's wallet on verified on-chain transfer. Platform structurally cannot recover the deceased's wallet private key (Magic recovery is between buyer and Magic), force on-chain transfer without buyer-signed authorization, or decrypt the Master without the wallet's private key. Tier 1 (in-product beneficiary) is not offered at launch; Tier 3 (ToS) controls via the BMA inheritance-and-wallet-control clause.

**Buyer responsibilities** (all three required for the deed to pass to heirs):

| Layer | Buyer responsibility |
|---|---|
| Legal | Designate digital-asset heirs in will or trust; specify heir's wallet address; designate a digital executor per state probate code |
| Technical (Magic wallet) | Configure wallet recovery so heir or executor can access the authentication channel; designate a Magic guardian if available; document the recovery path |
| On-chain | Heir wallet address documented in estate-planning materials; if no existing Solana wallet, include wallet-creation and deed-transfer instructions |

**Platform account-side mechanisms** (architecture in R62 §4.13):

- *Wallet-based identity* -> wallet is the canonical ownership identifier; profile is a presentation layer.
- *Deceased-account freeze* -> on verified death notification, the profile suspends login, marketplace listing, vault-toggle changes, and royalty-diversion; wallet on-chain capabilities are preserved.
- *Executor disclosure* -> deed metadata, ownership history, transactions, KYC artifacts, and tax-relevant records disclosed under RUFADAA §16 immunity; no key recovery or impersonation-grade access.
- *Tax and estate-valuation records* -> purchase history, deed valuations, and 1099-K records retained per IRS requirements (typically 7 years) plus legal holds.
- *Heir account creation* -> heir creates a new profile with own KYC, Stripe Connect account, and BMA acknowledgment; deceased's profile is archived; UI discourages the heir-uses-deceased's-wallet path.

Account-side actions are platform-mediated; ownership-side actions are wallet-mediated; the two layers do not share authority.

### 6.13 Privacy Compliance -> GDPR, CCPA, and US State Privacy Laws

Gallery operates as a global platform with EU and US participation, triggering compliance under GDPR (EU/UK), CCPA/CPRA (California), and the multi-state US framework now active across Colorado, Connecticut, Virginia, Texas, Utah, Oregon, Montana, Tennessee, Indiana, Iowa, Delaware, New Jersey, New Hampshire, and Minnesota. Section 5 of the FTC Act and 50-state breach-notification laws apply regardless of revenue thresholds. The R62 §2 protocol architecture is design-compliant; the operational layer remains to be built before EU launch.

**Privacy-by-design alignment.** R62 §2 implements GDPR Article 25 privacy-by-default at the architectural layer:

| R62 mechanism | Privacy function |
|---|---|
| §2.1 off-chain access-controlled PII database | Erasable on subject request; segregated from chain state |
| §2.1 KYC tiering (no formal KYC at consumer tier) | Article 9 sensitive-data minimization |
| §2.2 DRM master encryption | Privacy-by-default for the underlying asset |

**On-chain mint vs. right to erasure.** GDPR Article 17 erasure is technically incompatible with chain immutability. The architecture resolves this correctly: PII stays off-chain (erasable), and on-chain state holds only pseudonymous wallet addresses. When the off-chain binding is deleted, the on-chain pseudonym is anonymized for practical purposes.

**Deed-link identity-binding exposure.** Sharing a deed link transmits the linking party's wallet-to-identity binding to the recipient, who can then independently query Solana for the complete on-chain activity of that wallet. The exposure is structurally different from email-to-real-name binding because blockchain transparency turns a single legitimate disclosure into global queryability of all historical and future wallet activity through that wallet. Under CJEU *Breyer v. Germany* doctrine, on-chain pseudonyms remain personal data while re-identification is reasonably possible; a third party retaining a binding received from a previously-shared deed link can re-identify on-chain activity even after Article 17 erasure of the platform's off-chain binding, since erasure cannot claw back what has already been published. The exposure is asymmetric by design. Creator-side: the verified-creator wallet-identity binding is the value proposition, disclosed in the CMA at onboarding under Article 6(1)(b) contractual necessity. Buyer-side: the wallet-identity binding is private by default in the platform database; public exposure occurs only when the buyer sets identity-visibility to Full per §6.2 catalogue-raisonné semantics. The four-step identity-visibility ladder (Full / Region-only / Anonymous / Date-redacted) is the buyer-controlled disclosure mechanism.

**Deed-link exposure mitigations.** Three operational requirements follow from the exposure analysis: (1) default identity-visibility must be privacy-protective (Article 25 privacy-by-default) -> Anonymous or Region-only, not Full, with the default specified in R69; (2) just-in-time disclosure when the buyer toggles to Full -> inline notice that the wallet's complete on-chain activity becomes attributable to the displayed name on the deed and cannot be retracted from third parties who view the deed before the setting reverts; (3) BMA disclosure clause acknowledging that buyer-set Full visibility publishes a wallet-to-identity binding that cannot be erased from third-party retention, with parallel CMA disclosure on the creator side. Residual risk: parties who legitimately received the binding before erasure retain it indefinitely. This is the same residual risk any web publication has under GDPR; the architecture cannot eliminate it because no architecture can.

**Processing activities requiring lawful basis and Privacy Notice disclosure.** Four flows: (1) KYC data at Verified tier -> contractual necessity plus Article 9 sensitive-category handling; (2) wallet addresses bound to verified identity -> qualify as personal data once bound (CJEU); (3) outbound DMCA infringement-response service -> documented Legitimate Interests Assessment; (4) third-party analytics (PostHog, Segment, Branch.io class) -> Article 28 Data Processing Agreements. COPPA is out of scope by 18+ buyer policy.

**Operational artifacts open for MVP.** Privacy Notice covering all flows above; consent management UX for EU and California; DPAs with each vendor (Stripe, Zero Hash, Crossmint, Magic, Cloudinary, PostHog/Segment/Branch, Amazon SES, Arweave gateway); Article 27 EU representative arrangement (or Article 27(2) exception determination); 72-hour breach response runbook under Article 33; DPIA under Article 35 for KYC processing; data-mapping document; SAR procedure; Standard Contractual Clauses for non-EEA transfers; ROPA under Article 30. Privacy attorney engagement is on critical path before EU go-live. Penalty exposure under GDPR is the higher of 4% global annual turnover or €20M.

**Implementation:** R43 (MVP Requirements); R45 (Portal Technical Spec).

## 7. CONCLUSIONS

Gallery's load-bearing design commitment is the paradigm inversion: the image is the asset; the deed is the ownership-mechanism receipt that makes ownership enforceable. The eight design decisions in §5 follow from this commitment, each addressing a specific failure mode prior token-as-artifact cohorts could not architect around. The historical-failure record across the autograph, NFT, and K-pop cohorts and the academic diagnosis from legal-IP and consumer-research literature (Appendix B) jointly validate that the inversion is required, not optional.

Empirical evidence is two-sided. Established digital-collectibles markets (NFT collectibles, CS skins, aftermarket domains) demonstrate multi-billion-dollar demand for digitally-owned artifacts when the architecture satisfies the segment-required property set. The 2021-2025 autograph cohort, with comprehensive architectural-completeness shortfall, produced near-zero sustained engagement despite $205M deployed. The load-bearing variable distinguishing markets that form from markets that fail is architectural completeness; R67 specifies that architecture for Gallery.

---

## APPENDIX A: LEGAL FRAMEWORK EVALUATIONS

This appendix collects two retrospective legal-framework evaluations of Gallery's design. A.1 evaluates Gallery against Moringiello and Odinet's (2022) property-theory test for legitimate tokenization. A.2 evaluates Gallery's characterization under §6045 digital-asset broker reporting (Treasury T.D. 10000). Both frameworks were developed independently of Gallery and were not design inputs; both evaluations retroactively record alignment, deliberate contradictions, and residual gaps. Body §6 (Legal and Ownership Foundation) carries the primary statutory analysis; this appendix carries the framework diagnostics cross-referenced from §5.7 (Retail Tier vs. Verified Tier separation) and §6.2 (Article 12 identity binding).

### A.1 Property-Theory Evaluation -> Moringiello-Odinet Frameworks

#### A.1.1 Purpose

Moringiello and Odinet (2022), *The Property Law of Tokens*, 74 Fla. L. Rev. 607, diagnoses conventional NFTs as non-tethering and catalogs the legal frameworks that constitute true tokenization. Gallery was designed independently of this paper. This appendix retroactively evaluates Gallery against each framework, recording alignment, deliberate contradictions, and residual gaps.

#### A.1.2 Two-Part Tethering Test (Part II.A)

A token is tethering if (1) it embodies property rights in a reference asset and (2) the transfer system for the token is the method by which rights in the underlying asset transfer.

| Condition | Gallery Mechanism | Status |
|---|---|---|
| Embodies rights in reference asset | NFT deed bound to Exclusive License; terms in on-chain metadata; Gallery sells the license, not a pointer to a public file | Satisfied |
| Transfer system transfers the rights | On-chain deed transfer triggers automatic license migration and key re-encryption to the new owner | Satisfied |

#### A.1.3 Bedrock Legal-Tokenization Exemplars (Part I.A)

| Exemplar | Gallery Analog | Alignment |
|---|---|---|
| Negotiable instruments (Article 3) | NFT deed reifies the license; possession via on-chain delivery + Magic MPC signing | Partial. Good-faith-purchaser protection rests on Article 12 take-free (A.1.6), not Article 3 HDC. |
| Securities (Article 8) | Blind purchase + deferred delivery (R13) keep Gallery outside Article 8 | Contradictory by design. Howey defeat is a feature. |
| Deeds of real property | CMA/BMA hashed on-chain; deed recorded on Solana; block order sets priority; ESIGN click-wrap = writing | Satisfied by analogy |
| Bills of lading (Article 7) | Encrypted Arweave custody releases decryption key only to current holder's key | Satisfied. Key-wrap = carrier-to-holder. |
| Certificates of title, bailment tickets | Masters do not migrate across jurisdictions; display/download gated by wallet proof | NA / Satisfied by analogy |

#### A.1.4 Property Theory Lenses (Part II.C)

| Theory | Gallery's Position | Status |
|---|---|---|
| Exclusionary rights | Encryption + glass-box display + copyright remedies | Satisfied on legal-use axis; imperfect on perceptual-copy axis (accepted residual) |
| Progressive property | Foundation 501(c)(3), Digital State Museum, COOP cooperative elements | Satisfied |

#### A.1.5 Transaction Law and Policy (Parts III.A, III.B)

| Framework | Gallery's Position | Status |
|---|---|---|
| Sale doctrine | BMA explicitly defines personal use, gallery display, resale; copyright retained by creator | Satisfied |
| Secured credit (Article 9) | Out of scope for v1; future lending can use Article 9 + Article 12 control | Deferred |
| UDAP / UDAAP prescription | On-chain versioned BMA; explicit license scope; Delaware law + AAA arbitration | Satisfied |

#### A.1.6 UCC Article 12 (2022 Post-Paper Amendments)

Article 12 is the ALI/ULC response the paper anticipated. Enacted in 33+ states per R58.

| Concept | Gallery Alignment |
|---|---|
| Controllable Electronic Record | NFT deed on Solana qualifies |
| Control | Magic MPC private-key authority satisfies the Article 12 control test |
| Qualifying-purchaser take-free | Good-faith purchasers take free of prior claims |
| Rights tethered by contract | Exclusive License is contractually tethered per §12-104(b) |

**Gap:** Non-uniform state enactment, no international analog. Cross-jurisdictional enforcement is a residual gap.

#### A.1.7 Conclusions

Gallery satisfies the diagnostic criteria Moringiello-Odinet catalog for legitimate tokenization (A.1.2-A.1.6). One deliberate contradiction (rejection of the securities pattern) is intentional. Two residual gaps (imperfect perceptual exclusion, non-uniform Article 12 coverage) are managed rather than solved.

Gallery and the paper's proposed regime are complementary, not redundant. The difference is jurisdictional, not functional. Gallery already occupies all four control-type slots (Preventative, Detective, Corrective, Recovery) for parties that signed the CMA or BMA: protocol-layer controls (encryption, glass-box display, on-chain license metadata, BMA hash versioning, audit trail) handle Preventative and Detective; CMA and BMA remedies (graduated penalties, injunctive relief, actual damages, license termination, Delaware law, binding AAA arbitration) handle Corrective and Recovery for signers.

What Gallery's contracts cannot reach is conduct by non-signers: deceptive competitor platforms, counterfeit issuers impersonating Gallery, third-party marketplaces listing stolen deeds, and low-value buyer classes whose individual arbitration cost exceeds damages. The paper's regime supplements Gallery here. UDAP and UDAAP reach non-contracted platforms. State AG actions and class litigation aggregate small-dollar claims. UCC Article 12 adjudicates priority against claimants who never joined the BMA. Gallery's contracts bind signers; the paper's regime disciplines non-signers.

Gallery does not require the paper's regime to function, but benefits from it. Where Article 12 is enacted, it statutorily reinforces the architectural tethering. Where UDAP enforcement is active, it polices competitors who reject Gallery-style disclosure. The architecture is self-sufficient for its own buyers; the legal regime supplies industry-wide hygiene that no single platform can provide.

### A.2 §6045 Broker Status Analysis

#### A.2.1 Question Framing

Treasury's final regulations on digital-asset broker reporting (T.D. 10000, July 2024) [treasury-2024] define a broker as a party that effectuates sales of digital assets for customers in the ordinary course of a trade or business. Centralized custodial brokers must file Form 1099-DA reporting gross proceeds (effective January 1, 2025) and basis (effective January 1, 2026). The DeFi-broker rule was rescinded by Congressional Review Act in early 2025; the custodial-broker rule remains in force.

Gallery's transaction architecture transfers NFT deeds across Solana on every sale, custody is mediated by Magic MPC, and Operator LLC operates the customer-facing platform. On a strict reading these facts trigger §6045. The question is whether Gallery is properly characterized as a digital-asset broker (Reading A, formalist) or as a fine-art marketplace whose sales happen to be recorded on-chain (Reading B, substance-over-form).

#### A.2.2 The Two Readings of §6045

**Reading A (formalist).** The on-chain transfer of an NFT deed is itself a digital-asset transfer under §6045(g)(3)(D). Operator effectuates the sale and meets the broker definition. Reporting follows: Form 1099-DA, payee TIN solicitation (W-9/W-8), transfer statements on off-platform deed movement, and recipient statements by January 31. This is the posture OpenSea, Rarible, and other DeFi-native NFT marketplaces adopted once the final rule landed.

**Reading B (substance-over-form).** What Gallery sells is the digital autograph (the artifact). The NFT is the deed -> the title-recording mechanism, not the asset itself. On the substance-over-form principle, §6045 attaches to the underlying-asset characterization. Real-estate brokers do not file digital-asset reporting because deeds are recorded electronically; stockbrokers report the sale of shares, not the sale of certificates. By analogy, a fine-art marketplace whose title is recorded on a blockchain remains a fine-art marketplace. Reporting follows §6050W (Form 1099-K) for fiat gross proceeds; §6045 does not attach.

#### A.2.3 Default Position: Gallery as Collectibles Marketplace

The default position is Reading B: Gallery is a §408(m) collectibles marketplace that uses an on-chain title registry. Three premises support this default.

First, the artifact and the deed are architecturally distinct. The Master Image is stored on Arweave under permanent-storage economics; the deed is recorded on Solana under transferable-control mechanics. The two layers are not the same object, are not stored in the same place, and serve different functions. This is a structural fact, not a marketing framing.

Second, the buyer's psychological and economic experience is artifact-centric, not deed-centric. Buyers acquire personalized creator-recognized digital autographs for identity expression, status, and hold-premium reasons. They do not acquire a tradeable digital token for its financial properties. The deed is the proof mechanism, not the consumed object.

Third, the IRS itself has endorsed look-through analysis on the buyer side. Notice 2023-27 [irs-2023] classifies an NFT as a §408(m) collectible if the underlying associated right is a collectible. R40 §4.4 already relies on this look-through to apply the 28% LTCG cap on Master Image resale gains. The same look-through that supports collectible classification on the buyer side supports collectibles-marketplace classification on the platform side.

#### A.2.4 Architectural Basis for the Default Position

Gallery's architecture distinguishes it from generic NFT marketplaces in ways that matter for §6045 characterization.

| Feature | Gallery | Generic NFT marketplace |
|---|---|---|
| Artifact storage | Permanent on Arweave; separate from deed | NFT metadata IS the artifact |
| Authentication | 3-layer creator authentication | Self-attested |
| Buyer identity | KYC-bound Magic wallet (R43) | Pseudonymous |
| Personalization | Inscribed autograph mechanics | Self-referential image |
| Hold-flip ratio | Hold-dominant by design (§6.6.3) | Flip-dominant in practice |
| Marketing language | Investment framing prohibited (§6.6.3 #1) | Often emphasizes resale value |
| Fractionalization | Prohibited (§6.6.3 #5) | Common |

The cumulative effect is that Gallery's architectural facts match the fine-art-marketplace pattern, not the digital-asset-trading pattern. The deed is functionally a certificate of authenticity with on-chain enforcement, not a tradable security analog.

#### A.2.5 Industry Precedent

Every fine-art institution that has engaged with NFTs at material scale has treated them as art with on-chain title records, not as standalone digital-asset trading instruments.

| Institution | Posture | Signal |
|---|---|---|
| Christie's | Beeple sale (March 2021, $69.3M) -> Christie's 3.0 (2022) -> standalone digital-art department closed September 2025; NFTs absorbed into mainstream contemporary sales [coindesk-2025] | Integration into art-sale framework, not divergence |
| Sotheby's | "Natively Digital" curated sale (April 2021) and subsequent on-chain auctions | Auction-house framing |
| Pace Gallery | Pace Verso (2021); NFT works by Koons, teamLab, Donovan, Hollowell, Random International; Pace Verso / Art Blocks partnership 2022 [paceverso-2022] | NFTs as art issued by leading contemporary artists |
| Fine Art Ledger | Explicit "Art Title Tokens" framing: NFTs as ownership records in underlying assets [fineartledger-nodate] | Deed-vs-artifact distinction directly |
| Pre-bubble lineage | McCoy / Dash monegraphs (Rhizome Seven on Seven, May 2014); Ascribe (2014) [outland-2022] | Crypto-token-as-COA framing predates the speculative bubble |

The crypto-token-as-COA framing is the older and more durable interpretation; the asset-substitute framing was the speculative-cycle artifact.

#### A.2.6 IRS Look-Through Endorsement

IRS Notice 2023-27 [irs-2023] adopts the look-through principle explicitly. An NFT is a §408(m) collectible if the associated right or asset is a collectible (work of art, antique, gem, etc.). The tax character of the NFT follows the underlying right, not the token itself. R40 §4.4 already invokes this notice to apply the 28% LTCG cap to Master Image resale.

Treasury did not coordinate Notice 2023-27 with the §6045 broker rules in T.D. 10000. The unintended-coordination gap is precisely the opening Reading B exploits: if the NFT is a collectible by look-through under one IRS pronouncement, the marketplace selling it is a collectibles marketplace by look-through, not a digital-asset broker. The arguments are structurally identical; what is settled on the buyer side is reasonable to assert on the platform side.

#### A.2.7 Regulations That Apply Under the Default Position

Under Reading B, Gallery is a fine-art / §408(m) collectibles marketplace operating with on-chain title records. The applicable regulatory framework is:

| Regulation | Application | Status |
|---|---|---|
| §6050W / Form 1099-K | Third-party settlement organization filing on creators' fiat gross proceeds | Covered (R43) via Stripe Connect |
| §408(m) collectibles tax (28% LTCG cap) | Buyer-side gain recognition on resale | Covered (R40 §4.4); buyer obligation, not platform filing |
| §6050I / Form 8300 | Cash-equivalent transactions over $10K including digital-asset receipts in trade or business | Stripe handles fiat side; secondary-market deed-for-deed swaps over $10K need attention |
| State sales tax on digital goods | ~30 states tax digital artwork; PA flagged NFT exposure (R40 §4.2.8) | Stripe Tax can collect/remit per-state; economic-nexus analysis required |
| FTC Act §5 (UDAP) | Marketing-language prohibition, accurate disclosures | Covered (R58 §8.2; §6.6.3) |
| UCC Article 12 | Property recognition of deed; control test compliance | Covered |
| Federal copyright (17 U.S.C. §202) | License separated from chattel; preserved with Master | Covered |
| DMCA §512(c) safe harbor | Platform safe-harbor protection for user-uploaded Masters | Gap -> requires DMCA agent registration with US Copyright Office |
| OFAC sanctions | Geo-blocking, sanctions screening | Covered (R43; Stripe/Zero Hash pass-through) |
| GDPR/CCPA privacy | Personal-data handling, DSAR workflow | Covered (R43; Enzuzo CMP) |
| ADA Title III / WCAG 2.1 AA | Accessibility compliance for commercial websites | Gap -> requires WCAG 2.1 AA audit on R45 portal |
| Right of publicity (state) | Posthumous likeness rights vary by state | Partial (operational); legal layer requires state-by-state analysis |
| State virtual-currency / MTL regimes | CA DFAL, NY BitLicense, LA, IL, NJ | Covered (R58); Operator does not require licenses, fiat-crypto bridge is licensed via Stripe/Zero Hash |
| FinCEN MSB | Money-services-business framework | Covered (R42); pass-through model |

The key non-applications under Reading B: Form 1099-DA filings, payee TIN solicitation specifically for digital-asset broker reporting, and §6045 transfer statements on off-platform deed movement. These are the obligations that disappear if the substance-over-form characterization is accepted.

#### A.2.8 Regulations That Apply Under the Alternative Position

If Reading A (formalist) is ultimately the controlling characterization, the following obligations attach in addition to the Reading B set:

| Regulation | Application | Effective date |
|---|---|---|
| §6045 / Form 1099-DA gross proceeds | Custodial broker filing for digital-asset sales | January 1, 2025 |
| §6045 / Form 1099-DA basis | Basis reporting on covered transactions | January 1, 2026 |
| W-9 / W-8BEN solicitation | Required from sellers at onboarding | January 1, 2025 |
| Form 1042-S | Non-resident alien sellers | Annual |
| Transfer statements | Customers move deeds off-platform to other custodial brokers | On occurrence |
| Recipient statements | To sellers by January 31 of following year | Annual |

The §6721 / §6722 penalties for failures scale per form and increase substantially under intentional-disregard findings. The downside of being wrong on Reading B is direct and quantifiable.

#### A.2.9 Risk Profile and Mitigations

Reading B is novel. No published IRS letter ruling, no Tax Court case, and no public reporting position from a major fine-art platform has tested the §6045 question for an NFT-using collectibles marketplace. Christie's, Sotheby's, and Pace are large enough to absorb audit risk privately and have not made their reporting positions public. The IRS could challenge Reading B on audit, with §6721/§6722 penalty exposure as the consequence.

Three mitigations reduce residual risk to a manageable level:

1. **Substantial-authority memo.** Outside counsel produces a §6662 substantial-authority memo at MVP launch documenting the Reading B position, the Notice 2023-27 look-through basis, and the institutional precedent set by Christie's, Sotheby's, Pace, and FAL. Substantial authority defeats accuracy-related penalties even if the IRS prevails on the merits.
2. **Private letter ruling (PLR) request.** Operator submits a PLR request once transaction volume justifies the cost (~$28K user fee plus counsel time, six-to-twelve-month turnaround). A favorable PLR provides binding certainty for Gallery; an unfavorable PLR signals a need to switch to Reading A reporting before substantial penalties accrue.
3. **Parallel data capture.** Gallery instruments the data pipeline to capture all information that 1099-DA filings would require (payee TIN, gross proceeds, basis, transfer events) without filing. Capturing the data is operationally inexpensive; the filing decision can be made later. If Reading B is rejected mid-cycle, the historical data supports late filing with reasonable-cause relief.

#### A.2.10 Recommended Path

The default position for Gallery is Reading B: collectibles marketplace, no Form 1099-DA filings, full Form 1099-K compliance for fiat-side creator gross proceeds, and §6050I attention for secondary-market deed-for-deed transactions over $10K equivalent. The path to defensibility runs in three phases: at MVP launch, file the substantial-authority memo and instrument parallel data capture (A.2.9 #1, #3); after first-year operations and once volume justifies the cost, file the PLR request (A.2.9 #2); if the PLR is unfavorable or pending past the first-filing deadline, switch to Reading A using captured data and seek reasonable-cause relief on prior periods.

Christie's September 2025 absorption of its standalone digital-art department into mainstream contemporary art sales is the clearest market signal that the institutional-art world has rejected the "NFT as separate digital-asset class" framing in favor of "art with on-chain title." Gallery should follow the same trajectory from day one.

---

## APPENDIX B: HISTORICAL FAILURES AND LESSONS LEARNED

Three failure cohorts inform Gallery's design: the celebrity-tier digital autograph cohort 2021-2026 (case study in R68 Appendix A), the broader NFT creator-platform cohort 2021-2026 (Appendix C), and the K-pop digital photocard cohort 2021-2025 (Appendix D). Across the three cohorts, the failure pattern is uniform: cryptographic ownership recording was attempted while the underlying media artifact remained publicly hosted and freely duplicable. The cohorts differ in buyer psychology (signature-as-presence-trace, image-as-art, photocard-as-fan-artifact) and in capitalization, but converge on the same architectural shortfall. This appendix carries the cross-cohort empirical layer (B.1) and the two synthesis lessons (B.2 paradigm; B.3 jobs-to-be-done); per-cohort case studies are documented in Appendices C and D, with the autograph cohort case study in R68 Appendix A and cross-industry P-K-D validation in Appendix E. The body of R67 is structured around first-principles design rationale; this appendix supplies empirical validation that the first-principles reasoning is correct.

### B.1 Empirical NFT Buyer Segmentation: Vomberg Post-Bubble Cohort and K-Pop Parallel

Vomberg and von Gegerfelt's 2025 latent-class segmentation of 703 post-bubble NFT buyers [vomberg-2025] supplies direct empirical support for the buyer-psychology assumption Gallery's product depends on. The post-bubble cohort is 77% ownership-motivated rather than speculative, with three ownership-motivated segments showing high persistence: utility-driven buyers (35%) who value the NFT's function (gaming asset, access token, in-game scarcity); tech-savvy investors (29%) who value the on-chain record (transferability 4.14, transaction history 4.08, proof-of-ownership-as-blockchain-mechanism 4.31, all highest in the cohort); and status-seeking socializers (13%) who value visible ownership as social signal (highest community engagement, highest net WOM at 3.51, highest referral count at 10.59). The status-seeking socializer segment directly validates the costly-signal mechanism Gallery's monogram-on-share architecture per §2.5 is built to serve. Methodological caveats: the sample is recruitment-restricted (Prolific panelists with self-screened past NFT experience plus an active-Discord 12% sub-sample with Doctors Without Borders charity-donation incentive), English-language only, and the authors disclaim cross-sectional representativeness. The K-pop case (Appendix D) provides parallel validation in a structurally distinct buyer population that explicitly rejected crypto-native architecture, supporting the underlying psychological assumption while isolating architecture as the load-bearing variable. Convergent evidence across crypto-engaged, fine-art, autograph-collector, photography-buyer, and creator-merchandise populations is much stronger than any single study; the assumption Gallery's product depends on is robust to single-source disconfirmation. Appendix C.5 documents the Vomberg study in detail; Appendix D documents the K-pop parallel.

### B.2 Token-as-Artifact vs. Token-as-Receipt-of-Artifact Paradigm

The unifying lesson across the three cohorts is paradigmatic. The autograph cohort, the NFT creator-platform cohort, and the K-pop cohort all operated within the token-as-artifact paradigm: the on-chain token (the receipt) is treated as the thing being sold, with the underlying media file (the artifact) freely hosted on public IPFS or open URLs. This paradigm produced a coherent product within the cypherpunk-engineering frame -- ledger-recorded ownership is sufficient to establish ownership when the buyer's ownership target is the token itself -- but failed when the buyer's ownership target is the artifact: the image, the photocard, the autograph. Gallery operates within the token-as-receipt-of-artifact paradigm: the media file is the artifact, the on-chain token is the receipt, and architectural commitments (encrypted master with dual-wrap envelope; per-buyer visible attribution on every served copy; sealed/opened deed states with smart-contract-enforced consumption commitment; access control sustained through resale) preserve the artifact-vs-receipt distinction operationally. The paradigm shift is the load-bearing design commitment in R67; every section of the body -- identity framework (§3), economic rights of ownership (§4), design decisions (§5), legal-and-ownership foundation (§6), and cross-industry empirical validation (Appendix H) -- presumes the inversion. The historical-failure record (Appendices C and D, plus the autograph cohort case study in R68 Appendix A) is the empirical validation that the inversion is required, not optional: every well-funded prior attempt within the token-as-artifact paradigm has terminated, pivoted, or stalled. The January 2026 mass closure event [theblock-2026] -- Foundation, MakersPlace, X2Y2, and Nifty Gateway announcing shutdowns within days of each other, capping the cohort's collapse from $50B+ peak trading volume in 2022 to $5.5B in 2025 -- is the sharpest empirical confirmation that the failure is general, not vendor-specific. The underlying mechanism is that the token-as-artifact paradigm cannot deliver ownership experience or ownership rights to the buyer when the buyer's ownership target is something other than the token: the buyer's actual target is the image, which is where ownership experience (display, share, frame, render) and ownership rights (the Schlager-Ostrom bundle articulated in §4) both attach. A paradigm that locates ownership in the token while leaving the image freely duplicable severs the experience-and-rights bundle from the receipt, and no business-model variation -- curation depth, fiat onramps, artist outreach, premium positioning -- rescues the architecture once that severance is in place.

The bifurcation of the surviving NFT market is itself confirmation. The segments that persisted through 2025-2026 -- in-game items in blockchain-native games, domain names like ENS, utility and access tokens, DeFi positions, FIFA Right-to-Buy ticket priority NFTs, and physical-collectible-backed NFTs (Courtyard) -- are precisely those where the on-chain token actually is the experiential and rights-bearing artifact in a specific environment: the token IS the equippable item, the namespace right, the gated permission, the financial interest, the priority claim, or the redeemable physical-asset receipt. In these cases token-as-artifact is the correct paradigm because the token is the thing the buyer wants to own; there is no external referent the buyer is severed from. The segment that collapsed almost entirely is precisely the one where the token sat in front of a separate, externally-located image artifact: pure art NFT trading volume fell from $2.9B in 2021 to $23.8M in Q1 2025 [dappradar-art-collapse-2025], a 99% reduction representing the cleanest natural-experiment evidence that the token-as-receipt-for-image paradigm cannot sustain. The surviving cases therefore validate Gallery's paradigm test: token-as-artifact works when the token IS the thing the buyer wants to own; token-as-receipt-of-artifact is required when the token sits in front of a different artifact the buyer wants.

### B.3 Jobs-to-be-Done Framing and the Form-Factor Preference Fallacy

The second unifying lesson concerns how buyer feedback from the failed cohorts should be read. A specific interpretation failure mode in collector-market buyer feedback is reading form-factor articulations as form-factor preferences. When buyers in a market with an established physical solution articulate rejection of a digital alternative as "we prefer physical," the articulation is in the vocabulary of the existing solution because the failed alternative did not deliver the underlying jobs. The mechanical properties physical artifacts deliver -- control over the artifact, curated-display surface, identity-signal to the relevant community, scarcity tied to the artifact itself, and non-financial framing -- can each be delivered by digital architectures that meet the requirement directly. The K-pop digital photocard cohort (2021-2025) is the most diagnostic available natural experiment for this distinction: a $500M+ annual physical market for authenticated photo collectibles within a single fan economy [koreaexperience-photocards-2026], paired with a 2021-cohort digital attempt that failed each mechanical-job requirement and was rejected by fans as "we prefer physical" [bitget-hybe-binary-2025] [glittermag-kpop-nft-2021]. The implication for Gallery's design is that the relevant question is not "do buyers prefer physical or digital" but "does the architecture deliver the five jobs the physical version delivers"; whichever architecture meets the requirements is the one buyers engage with.

### B.4 Deliberate Paradigm Redefinition by the NFT Cohort

The token-as-artifact paradigm distinguished in B.2 was not an architectural accident -- the NFT cohort and its proponents deliberately tried to relocate the buyer's ownership intuition from the image to the token, and were explicitly aware of the conflict with traditional ownership psychology. Three lines of evidence establish this.

First, the cohort coined "right-clicker mentality" as a slur targeting buyers whose ownership intuition remained image-anchored [wikipedia-2026b]. The term's existence is direct evidence that proponents recognized the paradigm conflict and treated the image-anchored intuition as an obstacle to be overcome through social pressure rather than as a constraint to be honored architecturally.

Second, prominent NFT proponents articulated the paradigm-redefinition thesis explicitly. Reddit co-founder Alexis Ohanian, when his purchased Bored Ape was right-click-saved by a critic, responded that copying made the image more valuable, citing the Mona Lisa as analogue [slate-nft-2021]. The argument explicitly separates ownership (token-record) from artifact-control (exclusive access), and asserts the new framing as superior to the traditional ownership-implies-exclusion intuition. A Vice-quoted collector in the same period framed NFT value purely in status terms, decoupling ownership from artifact-control entirely [wikipedia-2026b].

Third, the cohort enforced the new paradigm through community norms when buyer ownership intuition resisted. NFT communities used "dogpiling" against impostors who used purchased NFT images as profile pictures without owning the underlying token, alongside performative defense of the new ownership norm [slate-nft-2021]. Adjacent projects added supplementary provenance-display layers because the NFT alone did not naturally communicate ownership to a casual viewer. Each pattern is symptomatic of a paradigm shift that did not take naturally and required ongoing social maintenance.

The empirical outcome is the load-bearing evidence that the paradigm shift failed at scale: by September 2023, over 95% of NFT collections had zero monetary value [wikipedia-2026b]. The market reverted to image-anchored ownership intuition once speculative momentum exhausted, validating B.2's architectural framing and exposing the cohort's paradigm-change project as a frontal attack on robust ownership psychology rather than a sustainable design choice. Gallery's image-as-asset / deed-as-receipt thesis (§5.8) is the inverse: it works with the buyer's natural ownership intuition rather than against it, anchoring ownership where the buyer's psychology naturally rests (the image) and using the deed as the legal-receipt instrument that human commerce already understands.

### B.5 Academic Identification of the Paradigm Mismatch and the Diagnosis-to-Architecture Gap

The paradigm-mismatch diagnosis articulated architecturally in B.2 and demonstrated empirically in B.4 has independent academic identification in legal and consumer-research literature. The diagnosis exists; what is absent is its translation from academic recognition to industry architectural change. This section documents the academic position and proposes structural reasons for the diagnosis-to-architecture gap.

**Academic position 1: Legal-IP scholars identified the token-vs-artifact distinction as early as 2021.** Guadamuz [guadamuz-2021], in "The Treachery of Images: Non-fungible Tokens and Copyright" (Journal of Intellectual Property Law & Practice), articulated the paradigm distinction four years before Gallery: the NFT is not the work itself but a signed receipt of the work, and ownership of the token is distinct from ownership of the underlying creative asset. The article title invokes Magritte's "Ceci n'est pas une pipe" -- the paradigm-mismatch claim itself, rendered as legal-IP analysis. Guadamuz further notes considerable misunderstanding among NFT participants about both the technical nature of NFTs and the rights they convey, directly diagnosing the buyer-confusion that the right-clicker debates documented in B.4.

**Academic position 2: NYU Law identified the failed-promise architecture in 2023.** Chuvaieva [chuvaieva-2023], in "Non-Fungible Tokens and Failed Promises of Simple Virtual Ownership" (NYU Journal of Intellectual Property and Entertainment Law), articulates the diagnosis in operational terms: NFTs make transfers easy without making digital ownership easy, so users seeking transfer-ease got the product they wanted while users seeking real digital ownership were disappointed. The paper observes that the token is unique while the linked image is not, and concludes that NFT uniqueness functions psychologically rather than as actual ownership of the underlying asset. This is the explicit diagnosis that the cohort succeeded at the wrong job (transfer-mechanism efficiency) and failed at the right job (image ownership).

**Academic position 3: Consumer research extended the ownership-feeling framework to NFTs.** Journal of Consumer Research articles in 2023-2024 have applied the Atasoy-Morewedge digital-vs-physical ownership-feeling framework directly to NFT pricing dynamics, confirming that the same ownership-feeling routes R67 §2.4 uses are operative in NFT buyer behavior. The consumer-research framing produces academic explanations for NFT pricing variance and adoption barriers but stops at descriptive analysis rather than extending to architectural prescription.

**The diagnosis-to-architecture gap.** Despite three independent academic identifications spanning legal, IP-rights, and consumer-research literatures, the NFT industry has not pivoted toward image-anchored architecture. Three structural reasons explain this gap.

First, the diagnosis is published in legal and consumer-research journals, not engineering literature. Guadamuz writes for IP lawyers and policymakers; Chuvaieva for IP-and-entertainment-law scholars; Hofstetter and similar for marketing researchers. The technologist and builder communities that design NFT platforms do not regularly read these venues, and the diagnoses do not appear in IEEE, ACM, or blockchain-whitepaper venues that builders consult. Knowledge is siloed by discipline.

Second, the diagnosis is descriptive, not prescriptive. Each paper identifies what is wrong (the token is not the image; ownership is not transferred; ownership-feeling routes are unavailable for the artifact) but does not specify what an architecture aligned with image-anchored ownership would look like. The papers stop at diagnosis; they do not prescribe sealed-and-opened deeds, per-buyer fingerprinting, encrypted Master Images, owner-credit attribution, or any other architectural element. A builder reading these papers learns that the existing approach is flawed but is not given a constructive alternative.

Third, the industry's incentive structure reinforces paradigm commitment. NFT platforms, marketplaces, and project teams have invested capital, staff, and brand equity in the existing architecture. Acknowledging paradigm-level error at the architectural layer would require writing off this investment. The cohort's incentive is to bolt utility on top of the existing architecture (gaming, IRL events, brand partnerships, membership perks) that preserves the architectural commitment, not to rebuild from paradigm-corrected first principles. The post-collapse pivots documented in industry post-mortems are uniformly utility-overlay pivots, not architecture-replacement pivots, and this is the predictable response of a cohort with sunk costs facing a paradigm-level critique.

**Implication for R67's contribution.** Gallery's contribution is not the identification of the paradigm mismatch -- legal academia identified it in 2021 [guadamuz-2021] and 2023 [chuvaieva-2023], and consumer research has applied the ownership-feeling framework in parallel. Gallery's contribution is the constructive bridge from the academic diagnosis to engineering architecture: take the Guadamuz, Chuvaieva, and Atasoy-Morewedge findings as engineering input, and derive sealed-and-opened deed states (§5.3), per-buyer fingerprinting (§5.2), encrypted Master with controlled access (§5.1), owner-credit attribution (§5.6), and the rest of §5 from paradigm-corrected first principles. R67's value is operating in the construction gap that academia identified but did not bridge. B.2 supplies the architecture-level diagnosis; B.3 supplies the buyer-articulation-level diagnosis; B.4 supplies the intentionality-and-failure diagnosis; B.5 supplies the academic-identification-and-translation-gap diagnosis. Together the four lessons exhaust the historical-failure layer of Appendix B.

---

## APPENDIX C: NFT-COHORT LEARNING TRAJECTORY 2021-2026

This appendix documents the multi-phase trajectory across the NFT creator cohort: the design-requirement frame at launch, lessons learned post-2022 collapse, partial fixes implemented across the surviving cohort, and structural reasons the architectural fix has not been adopted at incumbent platforms. Synthesis Appendix B carries the cross-cohort lessons; this appendix carries the cohort-specific evidence.

### C.1 Phase-by-Phase Trajectory

**Phase 1 (2021-2022): Cypherpunk-engineering frame.** The 2021 cohort launched from cryptographic-engineering-first principles inherited from the cypherpunk tradition (Hughes 1993; May 1992 per Appendix H.3). Standard NFT mechanics produced public IPFS hosting with no access control, full investment-resale framing in marketing and UI, and floor-price valuation displays. Buyer psychology was not on the design surface because the engineering frame treated ownership as a technical rather than psychological property.

**Phase 2 (2022-2023): First lessons.** The 2022 floor-price collapse (NFT trading volume declined 93% from peak [dappradar-2025]) forced founders to recognize that ledger-recorded ownership did not produce sustained demand. Initial responses were product-feature-additive (better creator-onboarding tools, platform-curated drops, token-gated experiences); they addressed surface pain points without reframing fundamental design requirements.

**Phase 3 (2023-2024): Framing pivots.** Sound.xyz, Zora, and Mirror reduced investment-framing in marketing and shifted toward creator-economy language. These pivots represent partial learning of the dispositional failure mode -- founders began recognizing that financial framing destroys the art-as-art experience per Hagtvedt-Patrick (2023) [hagtvedt-2023] documented in §2.3.

**Phase 4 (2024-2025): Receipt-level architectural improvements.** Smart-contract resale-royalty enforcement (against the 2022-2024 royalty-stripping trend exemplified by Blur and optional-royalty OpenSea), edition-cap enforcement, and improved provenance metadata. These remain at the receipt level; the underlying media file stays publicly hosted on IPFS without access control, leaving the artifact-vs-receipt gap unaddressed.

**Phase 5 (current 2026): Half-fixed state.** The surviving cohort (Manifold, late-Zora, Mirror, Sound.xyz post-pivot, Catalog) operates with the dispositional fix mostly addressed (marketing-language pivots) and the architectural fix not addressed (IPFS-public-access pattern remains universal).

### C.2 Structural Reasons Incumbents Have Not Closed the Architectural Gap

Closing the gap requires inverting from token-as-artifact to token-as-receipt-of-artifact (per B.2). The inversion is a paradigm change in design thinking, not a feature change; founders who have built token-as-artifact products for 4+ years have invested intellectually and reputationally in the paradigm. Three downstream consequences follow from the paradigm and make retrofit costly even when founders intellectually accept the inversion:

- **Cypherpunk priors.** IPFS-public-access is a deliberate architectural commitment to censorship resistance, decentralized hosting, and no platform-mediated access. Implementing artifact-level access control re-introduces a centralized gatekeeper through key-management infrastructure, which feels like a betrayal of original architectural principles.
- **Non-cypherpunk technical scope.** Dual-wrap envelope key management, the sealed/opened deed-state distinction with smart-contract enforcement, and royalty-respecting consumption state are not standard NFT mechanics; they require new technical surfaces and engineering investment outside other product priorities.
- **User-base inertia.** Existing collectors have built psychological models around publicly-displayable media files. Switching to artifact-level control changes the buyer experience in ways that confuse existing collectors, creating switching-cost barriers even when founders recognize the architectural fix is needed.

Each follows from the paradigm: in the token-as-artifact paradigm, public hosting is correct, the additional mechanisms are unnecessary, and collectors are correctly socialized.

### C.3 Retrofit Breakage Modes for Incumbents

The retrofit-breakage modes below are cascading consequences of the paradigm-inversion barrier: each reflects what happens when token-as-artifact infrastructure is asked to support token-as-receipt-of-artifact behavior.

- **Public-display economy collapse.** Existing collectors derive social value from publicly-displayable media on OpenSea, X profile pictures, Farcaster showcases, and Discord NFT-gated channels. Adding artifact-level access control means non-owners only see watermarked previews, destroying the public-display value-proposition existing collectors paid for. Legacy collectors experience this as a unilateral product downgrade.
- **Aggregator and wallet integration breakage.** Standard wallet UIs (MetaMask, Phantom) and secondary marketplaces (OpenSea, Blur, Magic Eden) display NFT thumbnails by reading public IPFS metadata; access-controlled NFTs render as broken thumbnails. The "list anywhere, sell anywhere, see in any wallet" expectation breaks unless aggregators implement special handling, which they have limited commercial incentive to do for a single platform.
- **Hybrid-architecture confusion.** Past mints retain public IPFS hosting; new mints have access-controlled hosting. The platform now operates two product categories simultaneously, with collectors uncertain whether old NFTs are second-class artifacts and which prices reflect which category. Floor-price discontinuity disrupts legacy collections.
- **Brand-identity reversal.** Cypherpunk-aligned platforms have built brand identity around openness and decentralization. Implementing centralized media-access gating forces a brand-narrative reversal that confuses existing community members and triggers community backlash. Community-sentiment damage is hard to reverse. Creator-contract complications (committed resale-royalty enforcement and visibility behavior) compound the reversal cost.

The realistic incumbent response is therefore parallel-product launch -- a separate product line with the new architecture alongside the old. This isolates breakage but creates four new problems: doubled operational surface across two product lines; cannibalization risk where creators migrate to the new line, leaving the old line with declining inventory; loss of legacy advantage because the new line essentially competes with new entrants on equal terms; and 12-24 months of execution time before the new product reaches market.

### C.4 NFT Marketplace Benchmarking

This subsection benchmarks Gallery against currently operating NFT marketplaces on dimensions that distinguish marketplace surfaces from architectural commitments, identifying which absent capabilities reflect different markets versus the architectural failures documented in §C.1-§C.3.

#### C.4.1 Operator Selection

Eight currently-operating platforms covering the major archetypes (general-purpose, professional-trading, art-curated, creator-economy, vertical-specific), plus Momentica (LEVVELS) as a recently-shuttered Phase 6 representative included for its load-bearing failure architecture. Other defunct platforms (Quantum Art, Async Art, ink.id, SelfieSign per B.3 and B.4, Nifty Gateway in its quiet 2024 state) are excluded; the analytical focus is on what a buyer or creator could transact on as of 2026 plus the closed-platform Phase 6 configuration Momentica represents.

| Platform | Archetype | Primary chain | Position in 2026 |
|---|---|---|---|
| OpenSea | General-purpose | Ethereum (multi-chain) | Largest by volume; broad catalog |
| Blur | Professional trading | Ethereum | Royalty-stripping origin; pro-trader UI |
| Magic Eden | General-purpose | Solana, ETH, BTC ordinals | Gaming and Solana strength |
| Foundation | Curated art | Ethereum | Single-edition fine art; curated drops |
| Manifold | Creator tools | Ethereum | Creator-deployed contracts; tools-not-marketplace |
| Zora | Creator-economy | Base / Farcaster | Mint-everything ethos; Farcaster-native |
| Sound.xyz | Music | Ethereum | Music NFTs; creator-economy framed |
| NBA Top Shot | Sports collectibles | Flow (custodial) | Phase 6 closed-platform; >95% volume decline from 2021 peak; centralized fiat-rail precedent |
| Momentica (LEVVELS) | K-pop digital collectibles | Levvels Blockchain on Luniverse (private, custodial) | Shuttered March 2025; closed-platform Phase 6 representative; case study in App D |

#### C.4.2 What NFT Marketplaces Have That Gallery Lacks

Eight categorical capabilities, most by design choice given Gallery's positioning for the mainstream image-as-artifact market rather than the crypto-native token-as-artifact market: crypto-native UX (wallet-first onboarding, ETH/SOL prices, gas-fee transparency, MetaMask/Phantom integration); permissionless listing (anyone can mint and list without gatekeeping); DeFi composability (NFTfi/BendDAO collateral, Tessera fractionalization, derivative markets, yield strategies); pseudonymity (wallet-address-only buyer identity); global access without payment-rail friction (crypto's globally-accessible-by-default property serves regions with poor card infrastructure); speculation and trading infrastructure (real-time order books, sniper protection, bulk listing tools, professional trader interfaces -- Blur is essentially a Bloomberg terminal for NFTs); token-as-utility (Discord gating, airdrops, governance rights, IRL-event access, future-mint allowlists, downstream-product licenses such as BAYC's "Made by Apes," gaming-asset functions); crypto-native social-status signaling (PFPs that signal cohort membership, e.g., Bored Ape).

For each, the friction Gallery introduces is either accessibility for a different audience (mainstream vs. crypto-native) or a deliberate scope decision (image-as-artifact vs. token-as-utility), not a capability gap. Crypto-native buyers, pseudonymity-preferring buyers, DeFi-composability use cases, and trading-platform users are real markets that NFT marketplaces serve adequately; Gallery is not designed for them.

#### C.4.3 What Gallery Has That NFT Marketplaces Lack

Five capabilities, all architectural rather than marketplace-surface; these are the load-bearing differentiators that produce the artifact-vs-receipt fix documented in §C.2:

- **Encrypted master with deed-gated access.** Full-resolution image is encrypted at rest, accessible only via the dual-wrap envelope keyed to the deed. No NFT marketplace controls master access; all use IPFS-public hosting with the media file freely retrievable.
- **Per-buyer served-copy attribution.** Each served copy carries per-buyer visible attribution (monogram and deed URL per §5.9), so a circulating copy resolves to the deed and the owner it belongs to.
- **Sealed/opened deed state enforcement.** Platform-mediated resale is preserved as long as the deed remains sealed (Master Image not yet downloaded by the buyer); once the buyer exercises the Master-download right, the deed becomes opened and platform resale is permanently disabled because uniqueness can no longer be attested. This solves the resell-while-keeping-file behavior pattern. No NFT marketplace addresses this.
- **Article 12 identity binding at retail tier without KYC friction.** Card cardholder verification and Google account establish retail-tier identity binding sufficient for COA issuance and title-transfer chain (per §2.2). Either pseudonymous (open marketplaces) or fiat-tier KYC required only at deposit/withdrawal (NBA Top Shot) elsewhere.
- **Card-rail retail UX.** Stripe + Apple Pay + Google Pay, USD pricing, no wallet creation required. First purchase under 30 seconds. NBA Top Shot and Momentica are the closest precedents but both operate as closed-ecosystem proprietary chains; Gallery is the first card-rail retail UX with on-chain provenance and architectural artifact control.

#### C.4.4 Market-Segment Implication

Gallery is not categorically superior to NFT marketplaces across all use cases. It is superior for the image-as-artifact use case that NFT marketplaces failed to serve. The other use cases -- token-as-utility, DeFi-composable assets, pseudonymous trading, crypto-native cultural signaling -- are real markets that NFT marketplaces serve adequately, and Gallery is not designed for them. OpenSea and Blur will continue to have business in those markets; Gallery is taking the slice they could not deliver, not displacing them across the board.

For the specific slice Gallery is taking -- image-as-artifact, where the buyer's identity attaches to the image rather than the token, where they want a real authenticated copy, where the image is the social marker -- Gallery is architecturally distinct from every existing NFT marketplace. To compete on Gallery's territory, an NFT marketplace would have to architecturally rebuild: give up pseudonymity, add KYC, add encrypted-master infrastructure, add card-rail retail UX, abandon crypto-native cultural positioning. That is not a feature pivot; it is a different product. Gallery's first-mover position is on those architectural commitments, not on the marketplace surface.

### C.5 Empirical NFT Buyer Segmentation: Vomberg & von Gegerfelt 2025

#### C.5.1 Study Overview and Headline Finding

Vomberg and von Gegerfelt (2025) [vomberg-2025] published the first latent-class segmentation study of NFT buyers in International Journal of Research in Marketing. Sampling 703 self-identified NFT buyers via Prolific (n=620) and 17 Discord NFT communities (n=83), the study identifies five segments using latent class analysis on four buying motives (collection, social status, utilization, profit):

| Segment | Share | Primary motive | Top NFT category |
|---|---|---|---|
| Curious speculators | 18% | Profit (resale) | Art (44%) |
| Cautious investors | 5% | Profit + collection | Art (33%) |
| Utility-driven buyers | 35% | Functional utility | Art / gaming (21% each) |
| Tech-savvy investors | 29% | Tech + investment | Art (22%), gaming (18%) |
| Status-seeking socializers | 13% | Status display | Diversified |

The headline finding contradicts the conventional framing of the NFT market as predominantly speculative. Investment-motivated segments (curious speculators + cautious investors) total 23%; ownership-motivated segments (utility-driven + tech-savvy + status-seeking) total 77%.

#### C.5.2 Recruitment-Source Variance

The dual-sample structure reveals that the headline 23%/77% split is dominated by recruitment-source weighting rather than reflecting underlying market composition. The authors compare segment composition by source (Vomberg et al. §6.1):

| Segment | Prolific (n=620) | Discord communities (n=83) |
|---|---|---|
| Curious speculators | 20% | 2% |
| Utility-driven buyers | 31% | 61% |

Speculator share varies by an order of magnitude across the two recruitment sources. The aggregate 23% figure is a weighted average pulled close to the Prolific percentage because Prolific is 88% of the sample. If sampling weighted toward active community participation, the speculator share collapses toward 2%; if sampling targeted active speculators on crypto-trading platforms during peak activity, it would have inverted.

#### C.5.3 Methodological Caveats

Five filters bias the sample toward ownership-motivated respondents: (1) post-bubble timing -- survey fielded late 2022 / early 2023, after the early 2022 peak, mid-2022 floor-price collapses, and November 2022 FTX collapse, with substantial speculator exit already complete (the authors note in Vomberg et al. §5.1.1 that curious speculators "appear[] to have been drawn in by the NFT hype, but as the hype fades, they are withdrawing"); (2) self-screening on Prolific for past NFT experience, filtering out speculators who bought once, lost money, and disengaged; (3) active Discord community membership for the 12% sub-sample, systematically excluding pure speculators who exited those communities post-crash; (4) charity-donation incentive (Doctors Without Borders) appealing disproportionately to ownership-motivated, ethically-aligned respondents; (5) English-language only, excluding substantial Asian-market activity (Japan, Korea) where utility-driven gaming and avatar NFTs had different demand structure. The authors disclaim cross-sectional representativeness in Vomberg et al. §6.1: their sample is "representative of current NFT buyers" but "does not represent the cross-section of society"; they note NFT buyers are "often male, relatively young, and tech-savvy" and call for replication once the market matures.

#### C.5.4 Decomposition: What "Ownership-Motivated" Actually Means

The 77% ownership-motivated share is dominated by token-functional ownership rather than image-as-art appreciation. Utility-driven buyers (35%) value the NFT's function (gaming asset that equips a character, access token that gates a community, in-game scarcity); the image is incidental and could be replaced with a serial number with little change in motivation. Tech-savvy investors (29%) value the on-chain record (transferability 4.14, transaction history 4.08, proof-of-ownership-as-blockchain-mechanism 4.31, all highest in the cohort); the ownership target is the token as financial-and-technological artifact. Status-seeking socializers (13%) value visible ownership as social signal, with the image mattering as a display surface for status (PFPs and fashion NFTs over-index here) rather than as art appreciated for its own sake.

The four buying motives the study measures (collection, social status, utilization, profit) do not isolate intrinsic appreciation of the visual work; the collection motive captures collector self-identification, possession-pleasure, and completion-desire (general collector psychology, not aesthetic appreciation of specific images). A counter-intuitive finding follows: art-NFT concentration is highest in the speculation-motivated segments (44% for curious speculators, 33% for cautious investors) and lowest in the ownership-motivated segments (20-22%). Art-NFT was the most-flipped category during the bubble because it had the most legible scarcity narrative and the most price-discoverable secondary market; buyers oriented toward image-as-art were the smallest contingent within art-NFT activity, while the dominant cohort was buyers oriented toward art-NFT-as-financial-instrument.

#### C.5.5 Implication for Gallery's Market Thesis

The Vomberg study validates the buyer psychology Gallery's product depends on: the post-bubble surviving NFT cohort is 77% ownership-motivated, with all three ownership-motivated segments showing high persistence (continued purchasing, growing portfolios, active community engagement, substantial word-of-mouth). The status-seeking socializer segment in particular (13% of the cohort, highest community engagement, highest net WOM at 3.51, highest referral count at 10.59) directly validates the costly-signal mechanism Gallery's monogram-on-share architecture per §2.5 is built to serve.

The cohort is structurally adjacent to Gallery's target audience but does not match it directly. NFT engagement required crypto-engagement to access (wallets, gas fees, chain selection, crypto-cultural fluency), filtering the buyer population to crypto-tolerant subsets. Gallery's product is designed not to require crypto-engagement (card-rail retail UX, Google sign-in, USD pricing, owner-credit aesthetic, social-media-native distribution per §2.3). The audience that can engage with Gallery is therefore structurally larger than -- and structurally different from -- the audience that engaged with NFTs. The K-pop cohort (App D) provides parallel validation in a non-crypto buyer population that explicitly rejected crypto-native architecture, isolating architecture as the load-bearing variable. What remains for empirical validation is execution-detail (whether Gallery's specific configuration -- owner-credit monogram, deed-as-COA, sealed/opened resale enforcement, image-as-artifact framing, card-rail UX -- converts mainstream-creator-audience interest into purchases at meaningful rates), addressed by the falsification framework pilots; foundational assumption testing is settled by convergent evidence across crypto-engaged, fine-art, autograph-collector, photography-buyer, and creator-merchandise populations.

### C.6 Implication for Gallery's Competitive Position

Gallery's design comes from outside the cypherpunk lineage. The architecture was derived from ownership-feeling requirements (Pierce, Kostova, and Dirks (2001) [pierce-kostova-dirks-2001] routes, Hagtvedt and Patrick (2023) [hagtvedt-2023] framing condition, Atasoy and Morewedge (2018) [atasoy-morewedge-2018] ownership boundary) rather than from crypto-architectural priors. This produces three structural differences from the surviving cohort:

- **Both fixes from day one.** The dispositional fix (six de-financialization design features per §6.6.3) and the architectural fix (per-buyer fingerprinting, dual-wrap envelope, sealed/opened deed distinction, App B and Gallery's architectural mechanisms) are core protocol architecture, not bolt-ons added after observing market failure.
- **No legacy user base to migrate.** Gallery is built for mainstream creator-fan buyers without prior NFT-collecting expectations to overwrite. The user-base inertia and retrofit-breakage constraints that incumbents face do not apply.
- **No cypherpunk priors to overcome.** The architectural decision to gate artifact access through Gallery's backend was a design requirement derived from ownership-feeling theory, not a compromise against cypherpunk principles.

The competitive moat is time-bounded but meaningful. Three calibrations on durability:

- **Strong for 12-24 months against direct cypherpunk-rooted incumbent retrofits.** Surviving cypherpunk-rooted platforms (Manifold, Zora, Mirror, Sound.xyz, Catalog) face the H.2 priors plus the H.3 retrofit-breakage costs and are unlikely to attempt direct retrofit within a 12-24 month window.
- **Moderate for 24-36 months against incumbent parallel-product launches.** Sufficiently motivated incumbents can launch separate product lines with the new architecture, but parallel launches face their own four problems (operational doubling, cannibalization, lost legacy advantage, 12-24 month execution time). The execution time provides Gallery additional headroom to entrench.
- **Lower thereafter against well-resourced new entrants without cypherpunk priors.** Mainstream tech companies, traditional media platforms, sports leagues at scale, and centralized-infrastructure NFT platforms (e.g., Dapper Labs-style architecture) could implement artifact-level control without cypherpunk-priors friction. The moat against these competitors is execution-speed-based rather than structural.

The window is sufficient for Gallery to establish the category, demonstrate adoption, build network effects on both creator and buyer sides, accumulate creator relationships, and entrench buyer behavior. The category-establishment achievements during the structural-moat window become the durable competitive advantages once the structural moat erodes -- network effects, creator-relationship lock-in, and accumulated buyer collections are not architectural properties an incumbent can replicate by adding artifact-level control to their product.

### C.7 FAANG-Tier Social Platform Wave-Riding Cohort

Three FAANG-tier social platforms launched NFT-display or NFT-trading features within a seven-month window during the 2022 NFT peak. All three subsequently shut down their NFT infrastructure within four years. The cohort is structurally distinct from the cypherpunk-native trajectory of §C.1-§C.5 -> these operators are not crypto-native founders learning across phases, but mainstream social platforms bolting NFT features onto existing profile-and-display surfaces without committing to an architectural ownership specification.

| Operator | Feature | Launch | Shutdown | Duration | Architecture |
|---|---|---|---|---|---|
| Meta (Facebook + Instagram) | "Digital Collectibles" -> NFT display and Polygon minting | May 2022 | March 2023 [techcrunch-meta-nft-2023] | ~10 months | Display + creator minting in 100 countries; tied to metaverse-avatar vision |
| Twitter / X | Hexagon NFT profile pictures (Twitter Blue / X Premium) | January 2022 | January 2024 [techcrunch-x-nft-2024] | ~2 years | Display only via crypto-wallet linkage; ERC-721/1155 read |
| Reddit | Collectible Avatars on Polygon (in-app "Vault" wallet) | July 2022 | November 2025 (shop) / January 2026 (Vault) [cointelegraph-reddit-leader-2025; cryptobriefing-reddit-2025] | ~3.5 years | Display + custodial trade; over 33.5M total avatar holders at peak |

**Common architectural pattern.** Each integration treated the NFT as an account-decoration or social-signaling feature, not as a vehicle for delivering ownership of an image artifact. None implemented access-controlled storage, sealed/opened deed states, per-buyer artifact differentiation, or any of the §5 architectural commitments. Reddit's "Vault" custodial wallet is the closest any FAANG-tier attempt came to platform-mediated artifact custody, but the underlying avatar images themselves remained freely viewable on public IPFS; the Vault custodied the token, not the image.

**Reddit's onboarding scale and shutdown trajectory.** Reddit's Collectible Avatars onboarded over 33.5 million holders on Polygon, by far the broadest reach of any FAANG-tier attempt and one of the largest mainstream NFT user bases overall. Despite this scale, secondary monthly sales collapsed to roughly $100,000 by late 2024 [cointelegraph-reddit-leader-2025], and Reddit announced staged sunset in 2025-2026 -> avatar shop closure November 11, 2025, then Vault wallet termination January 1, 2026 [cryptobriefing-reddit-2025]. Scale onboarding without architectural ownership delivery did not produce sustained demand.

**Implication for the diagnosis-to-architecture gap (per §B.5).** The FAANG cohort had unconstrained engineering capacity, billions in capital, hundreds of millions of users, and direct integration access to display surfaces buyers already used. None of these resources were applied to the architectural ownership problem because the problem was not on the design surface. Each operator saw a trending category, ran a feature flag for it on top of an existing token-as-decoration paradigm, and shut it off when speculative momentum cooled and corporate priorities reset. The cohort is the strongest available evidence that resource availability is not the binding constraint -> architectural ownership requires a requirements specification derived from Pierce-Kostova-Dirks routes (§2.2) and the Schlager-Ostrom bundle (§4) that FAANG-tier engineering organizations did not produce because the specification gap is discipline-located, not capacity-located. The cohort reinforces §C.6's competitive-position calibration -> well-resourced incumbent retrofits face the same paradigm-inversion barrier as cypherpunk-rooted incumbents, with the added barrier that a new product line at FAANG scale requires multi-quarter executive prioritization that NFT features at these operators have already failed to retain.

---

## APPENDIX D: K-POP PHOTOCARD COHORT CASE STUDY

This appendix documents the K-pop digital photocard cohort 2021-2025 as a natural-experiment validation of Gallery's architectural and dispositional design choices. The K-pop fan economy provides the strongest available evidence that authenticated digital photo collectibles command demand at $500M+ annual scale within a single fan economy, while documenting that 2021-cohort architecture cannot capture that demand. The same buyer population, the same product category, the same per-edition price tier, and the same fan-cultural framing produced a $500M+ physical photocard market and a roughly $350-revenue digital attempt: the variable that changed was architecture. The case is referenced from synthesis Appendix B.

The K-pop fan economy is the strongest available natural experiment for authenticated digital photo collectibles because demand is documented at scale, multiple major incumbents attempted digital-format products, and the failure pattern is observable and diagnosable against the architectural framework.

### D.1 Demand Validation

 The physical K-pop photocard secondary market reached $500M+ annually by 2026 [koreaexperience-photocards-2026], operating as a parallel collectibles economy distinct from primary album sales. Combined K-pop merchandise revenue across the major agencies (HYBE, JYP, SM, YG) approached ₩1T projected for 2025 [asianews-kpop-merch-2025]. Photocard scarcity is engineered through 15-20 retailer-exclusive variants per album release, with rare broadcast cards trading $300-$800 in secondary markets [koreaexperience-photocards-2026]. The buyer behavior is explicit: ownership-driven, identity-driven, scarcity-sensitive, persistent (collections grow over years), and operates within a fan-cultural framing rather than a financial-asset framing.

### D.2 2021 Architecture Attempt

 The K-pop industry attempted a digital-format expansion of this market starting in 2021. HYBE invested over $400M in Dunamu (Korea's largest crypto exchange) and announced an NFT joint venture; JYP signed a parallel JV with Dunamu; SM and YG announced separate NFT initiatives; the group A.C.E launched the first tokenized K-pop collectibles on the WAX blockchain [forkast-kpop-nft-2021]. The strategic intent was to bring K-pop fandom's documented willingness-to-pay-for-photo-collectibles into the digital format.

### D.3 2024-2025 Failure Outcome

 HYBE's Binary Korea (the operating entity for the photocard NFT product, branded Momentica) generated approximately $350 in 2024 revenue against a $3.2M operating loss; the platform was shut down on March 27, 2025, and HYBE pivoted back to physical merchandise and artist-management focus [bitget-hybe-binary-2025]. The other major-agency NFT initiatives produced similar outcomes: minimal sustained engagement, no recurring purchasing, and product retirement. Fan reception was openly hostile, articulated as "we prefer physical," with public boycott campaigns against BTS-branded NFT releases [nme-bts-nft-boycott-2021] [glittermag-kpop-nft-2021].

### D.4 Failure-Mode Diagnosis

 The K-pop NFT cohort failed each of the architectural tests specifies:

- *Token-as-artifact paradigm.* Photocards were minted as NFTs with publicly-accessible IPFS image URLs. Buyers received tokens whose images were freely viewable and savable by anyone. The architecture failed the artifact-level control test (see App B): the buyer's ownership was registered at the token level, not at the image level.
- *Financial framing.* The platforms presented secondary-market prices, floor values, and resale-as-investment positioning prominently. Per Hagtvedt and Patrick (2023) [hagtvedt-2023] documented in §2.3, financial framing destroys the art-as-art psychological state. K-pop fans engaging with photocards do so within a fan-cultural register; the financial framing was dispositionally incompatible with the buyer state the existing market depends on.
- *Scarcity attached to receipt, not artifact.* The physical photocard market's scarcity is mechanically real -- the printed card itself is the limited object. The 2021-cohort NFT architecture attached scarcity to the receipt while the artifact (image) was infinite-copyable. The receipt's edition number was numerically scarce; the thing the buyer actually wanted to collect was not.

### D.5 Jobs-to-be-Done Reframing

 Fan rejection articulated as "we prefer physical" should not be read as a form-factor preference. The job the physical photocard performs has five mechanical components: control over the artifact, display in a personally-curated context, identity-signal to the fan community, scarcity tied to the artifact itself, and non-financial framing of the collecting act. Physical photocards happen to deliver these requirements through their physical properties. The 2021-cohort NFTs failed each requirement. There was no artifact-level control because IPFS hosting was public; no curated display surface because the platform's gallery view did not function as a personal display; weak identity-signal because the receipt was not visible as ownership in the fan-community channels where signaling occurs; no artifact-level scarcity because only the receipt was scarce; and explicit financial framing through floor prices and resale UI. Fans articulated their unmet need in the vocabulary of the existing solution because the failed alternative did not give them a vocabulary for the underlying jobs. The "we prefer physical" articulation is structurally identical to "we prefer vinyl invoices over MP3 invoices" -- the form-factor word is a stand-in for the bundle of mechanical properties the form-factor delivers.

### D.6 Implication for Gallery

 The K-pop case validates demand for authenticated digital photo collectibles at $500M+ annual scale within a single fan economy, while documenting that 2021-cohort architecture cannot capture that demand. Gallery's architecture addresses each documented K-pop NFT failure mode. Encrypted master with envelope-key access control delivers artifact-level control; per-buyer attribution on every served copy delivers artifact-level differentiation; sealed and opened deed states with consumption-state-aware royalties preserve collector psychology; the public/private display toggle delivers a curated-display surface (§6.6.3); the six de-financialization design features per align the framing with the art-as-art register; and owner-credit monogram attribution delivers a community-visible identity-signal. Each feature exists because the underlying buyer-job analysis required it; the K-pop case is post-hoc evidence that architectures missing these features fail at the documented buyer population.

The K-pop case is the strongest available natural-experiment evidence that architectural and dispositional design choices are load-bearing rather than incremental. The same buyer population, the same product category (authenticated photo collectibles), the same per-edition price tier, and the same fan-cultural framing produced a $500M+ physical market and a $350-revenue digital attempt. The variable that changed was architecture. The result is the strongest single piece of evidence for Gallery's central architectural thesis.

---

## APPENDIX E: MUSIC AND BOOK FORMAT MARKETS - P-K-D CROSS-INDUSTRY VALIDATION

The Pierce, Kostova, and Dirks (2001) [pierce-kostova-dirks-2001] three-route framework applied in §2.2 and has cross-industry validation in mature consumer-content markets. Format products that satisfy the three routes sustain ownership-bearing markets; format products that fail the routes either collapse or pivot to access-only positioning. Music and books -- two industries with parallel digital-transition histories -- demonstrate the pattern.

### E.1 Music Format Markets

| Pierce et al. Route | iTunes Downloads (2003-2019) | Streaming (Spotify, Apple Music) | Vinyl |
|---|---|---|---|
| Control | Failed -> file mediated by iTunes app; ecosystem-locked | None claimed -> access-only product | Strong -> independent of any platform; play, lend, gift, sell |
| Intimate knowledge | Failed -> file indistinguishable from any other MP3 | None -> queue and play | Strong -> cover art, sleeve, side selection, aging artifact |
| Self-investment | Failed -> auto-organized library; minimal curation surface | Moderate -> playlists, "Wrapped" recap | Strong -> shelf curation, organization, care |
| Identity-relevance moderator | Weak -> no display surface; library private | Moderate -> public playlists, social sharing | Strong -> shelf visible to all guests; identity signal |
| Market outcome | Collapsed -> store discontinued 2019 [riaa-2024] | Dominant -> ~84% US recorded music revenue [riaa-2024] | Resurgent -> $1.4B+ US revenue 2024; multi-year sustained growth [riaa-2024] |

iTunes Downloads claimed ownership but failed all three routes. Streaming honestly pivoted to access-only positioning and dominated. Vinyl satisfies all three routes plus the identity-relevance moderator and sustains the ownership-mode market.

### E.2 Book Format Markets

| Pierce et al. Route | Kindle Ebook Purchase | Library Borrowing | Paperback / Hardcover |
|---|---|---|---|
| Control | Failed -> Amazon-ecosystem-locked; remote-deletion precedent (2009 Orwell incident) | None claimed -> access-only, time-limited | Strong -> independent ownership; lend, gift, resell, mark up |
| Intimate knowledge | Weak -> text rendering only, no physical form factor | Moderate -> physical book held during loan | Strong -> covers, page wear, marginalia, smell, weight |
| Self-investment | Limited -> highlights and notes (Amazon-cloud-stored) | None -> returned to library | Strong -> shelf curation, marginalia, gifting, lending across years |
| Identity-relevance moderator | Weak -> no display surface; reading list private | Weak -> no display | Strong -> bookshelf visible to all guests; signals taste |
| Market outcome | Plateau -> roughly one-third of US trade-book revenue; flat growth [aap-2024] | Stable -> community-resource role | Dominant -> print formats remain majority of US trade-book revenue [aap-2024] |

Kindle ebooks face the same architectural failures as iTunes Downloads on routes 1 and 2, with partial route-3 satisfaction undermined by Amazon-cloud ownership of the buyer's annotations. Library borrowing makes no ownership claim and serves the access role analogous to streaming. Paperback and hardcover satisfy all three routes plus the identity-relevance moderator and remain the dominant ownership-mode product.

### E.3 Cross-Industry Pattern

The two industries reveal a three-position taxonomy for digital content markets, sharpened by the artifact-vs-receipt distinction (control over the target artifact, not over the receipt of purchase):

- **Access-mode product**: makes no ownership claim, optimizes for streaming or borrowing, succeeds when access economics are favorable. Examples: Spotify, library digital services, Patreon subscription bundles.
- **Hollow-ownership product**: claims ownership but fails the Pierce et al. routes on the target artifact; control extends to the receipt (download, token, license) but not to the artifact itself, which remains publicly accessible or platform-mediated. Collapses or plateaus. Examples: iTunes Downloads, Kindle ebooks, the 2021-2024 celebrity-tier NFT autograph cohort, the surviving crypto-native NFT creator cohort (see App B).
- **Architectural-ownership product**: delivers ownership through Pierce et al. route satisfaction with control extending to the target artifact (not just the receipt); sustains ownership-mode markets at meaningful scale. Examples: vinyl, paperback and hardcover books, Gallery.

Gallery occupies the architectural-ownership position in the digital creator-collectibles category. Subscription bundles correctly occupy the access-mode position ; both NFT creator cohorts (celebrity-tier dead and crypto-native surviving) represent the hollow-ownership position (see App B). The cross-industry pattern is the strongest available evidence that digital ownership architecture, not the digital format itself, determines whether ownership feeling develops.

## APPENDIX F: C2PA - CONSIDERED AND NOT ADOPTED

This appendix records why C2PA was considered and not adopted as a load-bearing layer in Gallery's architecture. The reader is assumed familiar with C2PA as the cryptographic content-provenance standard. R65 Appendix A documents C2PA's technical limitations at the verifier layer (authentication-vs-validation gap, CA infrastructure gaps, signer-authorization gap); this appendix focuses on the R67 design-rationale layer and does not repeat R65's technical analysis.

**Deciding factor: strippability.** The provenance signature is embedded in file metadata that most major social platforms remove during re-hosting. Behavior splits cleanly:

| Behavior | Platforms |
|---|---|
| Preserves and displays | LinkedIn, TikTok, Cloudflare CDN |
| Reads-and-strips | Meta (Instagram, Facebook, Threads), YouTube, X |

A 2018 Imatag study found 80% of images uploaded to websites had metadata stripped; in 2026 that figure is effectively 100% on the read-and-strip platforms. Gallery's Copies are most likely to circulate on the read-and-strip side, where the signature disappears. A provenance signature that does not survive the dominant circulation path cannot serve as load-bearing. C2PA 2.0's "Durable Content Credentials" combine metadata + invisible watermarking + perceptual fingerprinting to survive stripping, but durable credentials are an additional layer not yet universal across implementations, and Gallery's in-pixel URL text and on-chain content-hash anchor already provide stripping-resistant provenance independently of the C2PA stack.

**Public engagement is low.** Even on the preserve-and-display platforms, click-through on the CR badge is low. The standard's existence does not by itself change consumer behavior, which weakens any buyer-recognition argument for adopting C2PA as marketing-visible provenance.

**Regulatory posture.** Gallery is not a covered entity under the EU AI Act Article 50 (regulates GenAI providers), California SB 942 (regulates covered GenAI providers above 1M California users), or AB 853's tiered amendments. Gallery is a marketplace for authentic photographs, not a GenAI system. AB 853's 2028 capture-device tier will require California-sold cameras to offer opt-in capture-time disclosure, accelerating the C2PA-capable hardware ecosystem but creating no obligation on Gallery directly. Gallery's ingestion-time AI-disclosure architecture (R62 §6.4) aligns with the regulatory direction of travel without depending on C2PA.

**Gallery's load-bearing authentication architecture, for contrast.** The on-chain content-hash anchor (R65 §1.5) provides the cryptographically verifiable artifact-level binding independent of file metadata. The URL text embedded in the lower-right of the secured image survives social-platform re-hosting and metadata stripping. The §1.4 reputation gate plus ESIGN-bound creator attestation provides legal binding on creator identity. None of these primitives depend on C2PA.

**Forward review.** If C2PA achieves consumer salience, durable-credentials adoption universalizes across major social platforms, or a compliance trigger emerges, the architecture can be revisited. The deed and verification primitives are independent of C2PA; a future C2PA layer can be added without architectural disruption.

---

## APPENDIX G: COMPETITIVE COMPARISON AGAINST §5 REQUIREMENTS

This appendix compares Gallery against established digital and physical formats for owning collectible images made by others -- the buyer-of-creator-work use case Gallery serves. User-generated content storage (cloud-stored personal photos) is excluded because the user is also the creator, which structurally changes the PKD analysis and is outside Gallery's competitive scope. The comparison is across the eight §5 requirements (three PKD routes plus five Schlager-Ostrom rights). Legal-contract enforceability and creator-authentication considerations are folded into the cell evaluations rather than treated as separate dimensions.

The eight requirements measure architectural completeness of the ownership-feelings-and-rights bundle. Form-factor preference (physical vs digital) is orthogonal -> a buyer who wants a framed wall print will choose a limited-edition signed print regardless of any digital format's architecture. Gallery's competitive scope is the digital category, where every alternative is architecturally incomplete on at least two requirements.

Each cell records: 2 (fully delivered), 1 (partially delivered, see footnote), 0 (not delivered). Total is out of 16.

| Format | Control | Intimate Knowl. | Self-Inv. | Keep | View | Customize | Block | Sell | Total |
|---|---|---|---|---|---|---|---|---|---|
| Digital download (Gumroad, Etsy, Unsplash, artist website) | 1¹² | 1³ | 0 | 2 | 2 | 0 | 0⁹ | 0¹⁰ | 6 |
| Stock-photo license (Getty, Shutterstock, Adobe Stock) | 1¹´¹² | 1³ | 0 | 2 | 2 | 2¹ | 0 | 0² | 8 |
| NFT marketplace (OpenSea-class, post-2021) | 0⁴ | 2⁵ | 0⁶ | 1¹¹ | 2 | 0⁷ | 0⁴ | 2 | 7 |
| Phase 6 closed-platform NFT, operating (NBA Top Shot, Sorare) | 0⁴ | 2⁵ | 0⁶ | 1¹¹ | 1¹³ | 0⁷ | 1¹⁴ | 1¹⁵ | 6 |
| Phase 6 closed-platform NFT, post-shutdown (Momentica, March 2025) | 0⁴ | 1¹⁶ | 0⁶ | 0¹⁶ | 0¹⁶ | 0⁷ | 0¹⁶ | 0¹⁶ | 1 |
| Failed digital autograph (Autograph.io, ink.id, SelfieSign) | 0⁴ | 2 | 0 | 1¹¹ | 2 | 0 | 0⁴ | 1⁸ | 6 |
| Sedition (Web2 B2C consumer model)¹⁷ | 0¹⁸ | 2⁵´¹⁹ | 0²⁰ | 1²¹ | 1²² | 0²⁰ | 1¹⁴ | 0²³ | 5 |
| Physical print (unsigned) | 1¹² | 1³ | 2 | 2 | 2 | 2 | 1¹² | 1¹² | 12 |
| Limited-edition signed print (with paper COA) | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 16 |
| K-pop physical photocard | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 16 |
| **Gallery** | **2** | **2** | **2** | **2** | **2** | **2** | **2** | **2** | **16** |

**Footnotes:**

1. Bounded by license terms (commercial vs editorial use, geographic and temporal scope).
2. Stock license non-transferable; cannot be resold to another buyer.
3. Buyer-side familiarity through repeated exposure and personal records (purchase receipt, device metadata); no architectural creator-issued provenance chain bound to the artifact.
4. Image hosted publicly (IPFS or CDN); no architectural mechanism to control access at the artifact level.
5. On-chain transaction history provides provenance; image-level history absent because the image is public.
6. Set-as-PFP and wallet-display surfaces exist but no platform-mediated customization at the artifact level.
7. Wallet-side display only; no creator-mediated customization of the underlying image.
8. Some platforms permitted resale, but absent liquid secondary market limited practical alienation.
9. File is freely replicable post-download; no enforcement mechanism prevents others from holding identical copies.
10. Technically transferable, but no architectural scarcity or provenance to support secondary-market value.
11. Token persists on-chain but image storage relies on third-party IPFS pinning or centralized infrastructure without architectural permanence guarantee; many post-launch images have gone offline.
12. Artifact-class lacks enforced scarcity -> identical copies are freely available to others (retail purchase, file download, or non-exclusive license); control extends to the buyer's specific copy but not to the artifact-class.
13. Platform-mediated display only; not universally accessible like public-IPFS hosting; rendering depends on platform continuation.
14. Custodial display restricts non-buyer access at the platform surface; image and likeness rights remain with the issuer; partial Block at platform level only.
15. Platform-mediated resale marketplace only; cannot transfer to non-platform parties; liquidity contingent on platform continuation.
16. Rights evaporated when LEVVELS shut down Momentica March 27, 2025 [bitget-hybe-binary-2025]; chain data persists in principle but operational rights do not.
17. Sedition Limited (London, founded 2011) [sedition-itsliquid-interview-2025]. Web2 B2C licensed-edition platform with custodial Vault, artist-signed Certificates of Authenticity, and internal "Trade" secondary marketplace. Operator pivoted twice since launch -> added Web3 B2C in the late 2010s (optional NFT conversion that destroys the COA per Clause 1 of [sedition-terms-2025] and forces secondary sales onto external marketplaces); then pivoted to Web2 B2B in 2024-2026 (LG Gallery+ subscription curation, hospitality and real estate display licensing) [twice-lg-gallery-sedition-2026]. Unit sold across all three phases is a usage license to display, never a transferable ownership artifact -> only the Web2 B2C consumer model is comparable to the buyer-of-creator-work use case in this appendix.
18. Control = 0: Edition sizes 30 to 10,000 dilute artifact-class scarcity; Vault custody is platform-mediated, not architectural; no enforcement against the artist or platform issuing equivalent licenses on other surfaces.
19. Intimate Knowledge = 2: COA exists and is artist-signed while operating but is destroyed if the Collector converts the Edition to NFT (Clause 1 of [sedition-terms-2025]) -> centralized authentication and on-chain durability are mutually exclusive within the Sedition model.
20. Self-Investment = 0 and Customize = 0: No buyer-side annotation, no customization, no creator-mediated personal investment at the artifact level; passive display only.
21. Keep = 1: Centralized Vault custody plus 180-day inactivity lapse rule (Clause 7 of [sedition-terms-2025]) -> non-active accounts forfeit Vault contents; account deletion erases Vault access for all non-NFT-converted Editions.
22. View = 1: Platform-mediated display on Sedition-controlled apps (iOS, iPad, Samsung Smart TV, Allshare); explicit "private display only" restriction (Clause 15 Usage Rights of [sedition-terms-2025]) -> commercial or public display requires a separate license; rendering depends on platform continuation.
23. Sell = 0: Resale conditional on Sedition's discretion -> activates only when the edition sells out or the artist withdraws the work (Clause 15 of [sedition-terms-2025]). Trade proceeds paid exclusively in non-redeemable closed-loop Sedition Credits (Clause 26 of [sedition-terms-2025]); Credits forfeit on account deletion or 180-day lapse. Functionally no economic alienation in cash or cryptocurrency.

**Pattern.** Digital download (6) -- the conventional baseline -- delivers Keep, View, and partial Control/Intimate Knowledge but lacks scarcity-enforced Control, Self-Investment, Customize, Block, and Sell. Sedition's Web2 B2C consumer model (5) sits below this baseline -> rights restrictions and closed-loop Credit-only resale strip Sell and tighten Keep beyond what plain digital download imposes, demonstrating that adding centralized custody and artist-signed authentication infrastructure without architectural ownership delivery can produce a worse buyer position than the unsigned digital file. NFT marketplaces (7) and the failed digital autograph cohort (6) deliver full authentication-backed provenance but lose Control, Block, image-level Customize/Self-Investment (their wrapper-level mechanisms operate on the deed-token, not the image), and architectural Keep (image storage relies on fragile third-party infrastructure) -- the load-bearing failure cluster preventing commercial-scale adoption. Phase 6 closed-platform NFT variants (NBA Top Shot, Sorare, Momentica) score below open-IPFS NFT marketplaces while operating (6 vs 7), demonstrating that within-paradigm evolution toward closed-platform artifact-control is net-negative: each mechanism delivering partial Block (custodial display, screen-capture blocking) trades off View and Sell from full to partial, with no improvement on Control, Self-Investment, or Customize. Post-shutdown Momentica (1) demonstrates the platform-conditionality risk that physical formats and open-IPFS NFTs do not carry; limited-edition signed prints and K-pop physical photocards have no equivalent operator-dependency exposure. Stock licenses (8) deliver license-bounded use rights but lack architectural provenance, alienation, and platform-mediated customization. Physical print without authentication (12) recovers Self-Investment, Keep, View, and Customize through physical possession but loses scarcity-enforced Control, Block, and Sell at the artifact-class level alongside creator-issued Intimate Knowledge. Physical formats with creator authentication and enforced scarcity (16) deliver the full bundle. Gallery (16) is the only digital format delivering all eight requirements through architectural integration of access-controlled Master on permanent Arweave storage (§5.1), one-of-one Master Image enforcing scarcity, deed-as-COA (§4, §5.8), and BMA/CMA click-wrap contracts (R62 §3.4) that make the Ostrom rights legally enforceable. Gallery's score ties with the best physical formats and confirms architectural parity rather than superiority -> the digital-vs-physical choice remains a form-factor preference for the buyer.

---

## APPENDIX H: CROSS-INDUSTRY EMPIRICAL VALIDATION

This appendix records the empirical validation of the Identity Framework (§3) across four industries with parallel digital-transition histories. Each industry provides a natural experiment in which the framework's two barriers (Authentication and Authorization, at legal and technical layers) either held or collapsed, and the resulting market behavior (enforcement persistence vs. piracy collapse) tracks the framework's predictions. I.1 covers the music industry's six-phase trajectory through vinyl, cassette, CD, MP3, Napster, and streaming. I.2 covers book publishing's parallel trajectory through paperback, PDF, shadow libraries, and Kindle. I.3 covers the graphic-art and NFT-era trajectory and the cohort's 2021-2024 collapse. I.4 documents the limited-edition photography authentication workflow that anchors Gallery's deed-as-COA framework.

### H.1 Music Industry Trajectory

The music industry faced the same challenge and solved it across four successive phases. The industry created the master/copy distinction as a business practice. Copyright law treats all copies equally (17 U.S.C. Section 101), but the industry established a commercial hierarchy separating three concepts: the composition (the underlying creative work), the master recording (the original high-fidelity production file), and the distributed copies (CDs, vinyl, cassettes). The term "master recording" does not appear in copyright law; it is an industry term enforced through contract law, not statute.

The history reveals a structural principle: ownership is enforceable when the rights holder controls both factors -> **copy control** (cost and infrastructure required to duplicate) and **access control** (channel through which copies reach consumers, including discovery and access). When both factors escape the rights holder's control simultaneously, enforcement collapses. Neither control needs to be absolute; enforcement requires making unauthorized copying and access impractical for the normal user. A sophisticated attacker can record a music stream or screen-capture a gallery display, but the effort exceeds what a typical consumer will undertake, which is sufficient to sustain a functioning market. Quality gaps between master and copy are not an independent barrier; they are incidental byproducts of reproduction technology that vanish when reproduction becomes easy (vinyl noise floor, tape hiss, and print limitations all disappeared with digital formats). Deliberate quality differentiation (watermarks, previews) functions as access control gating, not a separate enforcement variable.

| Phase | Copy Control | Access Control | Piracy Risk |
|---|---|---|---|
| **1. Vinyl** | High. Pressing requires industrial plant; format conversion from master tape to lacquer to stamper to PVC is lossy and one-directional. | High. Retail logistics concentrated in few distributors. | 0/2 |
| **2. Cassette** | Medium. Home taping possible but lossy; quality degradation is a byproduct of reproduction technology, not an independent barrier. | High. Physical distribution still required. | 0.5/2 |
| **3. CD** | Medium. CD burners emerge but require hardware investment. | High. Retail channels still concentrated. | 0.5/2 |
| **4. MP3** | Low. Zero-cost file duplication; perfect digital copies. | High. Centralized channels (iTunes, label sites) preserve chokepoints. | 1/2 |
| **5. Napster** | Low. Zero-cost at massive scale. | Low. P2P decentralized distribution; no intermediary required for discovery or access. | 2/2 |
| **6. Streaming** | High. No copy produced; platform streams from master. | High. Encrypted, platform-gated delivery; access requires authentication; content not discoverable outside platform (Spotify, Apple Music, Tidal). | 0/2 |

**Three Models for Solving the Copy Problem.** The music industry's trajectory is one instance of a broader pattern. Three distinct industries have solved the digital copy problem through different barrier combinations. *Music streaming* controls both copy and access -> no copy is produced, and all access flows through encrypted platform gatekeepers. *Stock photography* (Shutterstock, Getty Images) controls access -> watermarked previews gate discovery, full-resolution files require authenticated purchase, and aggressive legal enforcement deters unauthorized use. *Physical merchandise* controls copy -> manufacturing infrastructure requirements make unauthorized copying economically impractical.

#### 7.2.A Music Industry Mapping to Platform Mechanics

**B.1 Why the Music Industry Precedent Matters**

The music business has spent the last 100 years perfecting the exact economic split this platform is building. The Decentralized Master Licensing engine takes the music industry's proven legal framework, automates it with smart contracts and Stripe Connect payment splitting, and applies it to all digital content.

**B.2 Mapping the Music Industry to Platform Mechanics**

**A. The "Master" (The Core Asset).** In the music industry, a record label owns the Master Recording: the original, high-fidelity studio file. On the platform, the supporter (Master Owner) buys the Master Image: the exclusive, high-resolution original digital asset. In both cases, the Master is the one-of-one original from which all value derives.

**B. The "Exclusive License" (The Right to Own and Display).** In the music industry, the label acquires exclusive rights to the master recording. On the platform, the Master Owner acquires the Exclusive License granting personal use, gallery display, and resale rights. The license is bundled with the Master Image purchase; no separate agreement is required.

**C. The "Royalty" (The Creator's Ongoing Revenue).** In the music industry, every time a song is streamed or sold, a royalty routes back to the songwriter. On the platform, every time the Master is viewed in the gallery or resold on the secondary market, revenue routes to the creator through smart contracts and Stripe Connect.

**B.3 The Two-Role Economic Structure**

| Role | Music Industry | Creator DAO Platform |
|---|---|---|
| Creator (IP Owner) | Songwriter/Composer | YouTuber, digital artist, content creator |
| Master Owner | Record Label / Collector | Supporter who purchases the Master Image |
| Revenue to Creator | Mechanical royalty per copy / streaming | Gallery viewing fees + resale royalty |
| Revenue to Master Owner | Label profit from distribution / collector appreciation | Gallery viewing fee share + resale proceeds |
| Platform Role | Distribution infrastructure (iTunes, Spotify) | Ownership + gallery infrastructure (Solana, Stripe, Arweave) |

### H.2 Book Publishing Cross-Industry Validation

The same two-barrier framework applies to book publishing, confirming that the enforcement principle is structural rather than industry-specific. The publishing industry followed a parallel trajectory: physical formats maintained both controls, digitization eroded them progressively, and platform-mediated access restored enforcement. Amazon's Kindle ecosystem now dominates the digital book market with approximately 68% market share (rising to 83% including Kindle Unlimited), mirroring streaming's re-concentration of distribution in music. LibGen and Z-Library function as the book industry's equivalent of Napster, with LibGen alone hosting over 2.4 million non-fiction books and 2.2 million fiction books as of 2024.

| Phase | Copy Control | Access Control | Piracy Risk |
|---|---|---|---|
| **1. Paperback** | High. Printing presses, binding equipment, and paper stock required industrial capital. | High. Warehouse, retail, and shipping logistics concentrated in few publishers/distributors. | 0/2 |
| **2. PDF** | Low. Zero-cost file duplication. | Medium. Early distribution via email, forums, and websites; partially centralized and traceable. | 1.5/2 |
| **3. LibGen/Z-Library** | Low. Zero-cost at massive scale; shadow libraries host millions of titles. | Low. Decentralized mirrors, P2P torrents, and offshore hosting place distribution beyond enforcement reach. | 2/2 |
| **4. Kindle/E-Reader** | High. No copy produced; platform delivers encrypted content to registered devices. | High. Encrypted, platform-gated delivery; access requires authentication; re-concentrated through Amazon (68% market share), Apple Books, and Kobo. | 0/2 |

The book industry's resolution confirms the structural principle: when both controls collapse (LibGen era, 2/2), piracy becomes uncontrollable. Recovery requires re-establishing at least one. Kindle restored both by delivering encrypted content through a centralized platform that restricts copying and concentrates access.

### H.3 Graphic Art / NFT Era Cross-Industry Validation

The NFT ecosystem was designed by cryptographers and systems engineers rooted in the cypherpunk tradition (Hughes, 1993; May, 1992) -> a community with deep expertise in mathematics and distributed systems but without grounding in social science or legal philosophy. They assumed that recording ownership on an immutable ledger was sufficient to establish it, rejecting the centralized custody mechanisms (gatekeeping, access control, institutional enforcement) that every successful ownership system requires. This ideological rejection threw out the ownership infrastructure along with the rent extraction. The two-barrier framework (§3.1) quantifies the result:

| Phase | Copy Control | Access Control | Piracy Risk |
|---|---|---|---|
| **1. Graphic Art (Physical)** | High. Reproduction requires professional scanning, color matching, and printing equipment. | High. Gallery and auction house system concentrates sales through authenticated intermediaries. | 0/2 |
| **2. Digital Image** | Low. Zero-cost file duplication (right-click save). | Medium. Files stored locally on creator's device or studio network; limited public access points. | 1.5/2 |
| **3. Internet** | Low. Same zero-cost duplication. | Low. Public posting on websites, social media, and marketplaces eliminates access control; files freely downloadable worldwide. | 2/2 |
| **4. Stock Photography (Shutterstock, Getty)** | Low. Purchased full-resolution file is freely copiable. | Medium. Watermarked previews gate discovery; full files require authenticated purchase but can be redistributed unofficially via email, messaging, or file sharing. | 1.5/2 |
| **5. NFT Era (2021-2024)** | Low. Zero-cost duplication unchanged; NFT adds a receipt but does not restrict copying. | Low. Files hosted on public IPFS or open URLs; no access gating, no platform-controlled delivery. | 2/2 |

The Creator DAO Gallery's position in this framework is 0.5/2 piracy risk.

Phase 5 is identical to Phase 3: the NFT added a ledger entry but changed no enforcement control. Phase 4 (stock photography) demonstrated that access control alone could partially solve the problem, but NFTs rejected even that. Art NFT trading volume fell 93% from $2.9B (2021) to $197M (2024, DappRadar), active traders declined 96%, and approximately 96% of collections were declared dead by 2024. The failure had three compounding dimensions:

**Enforcement failure.** The blockchain receipt did not restrict duplication (copy control unchanged) or gate access (access control unchanged). Property rights require legal instruments, identity verification, and institutional enforcement -> not just immutable records.

**Provenance failure.** NFTs had no embedded attribution linking artifacts to creators and no identity verification of minters. Anyone could mint anything as anyone, enabling widespread fraud that destroyed buyer trust.

**Framing failure.** The behavioral psychology literature (R67 §2.3) shows that experiencing art as art induces self-transcendence that suppresses status-seeking (Hagtvedt and Patrick, 2023), but this effect is destroyed when art is framed as a financial instrument. The speculative framing of NFTs (floor prices, portfolio value, ROI calculations) eliminated the psychological value that makes art worth owning.

### H.4 Limited-Edition Photography Authentication Workflow

The contemporary authenticated-photograph market operates on a standardized authentication workflow shared across fine-art photography, vintage press, sports originals, archival institutional, historical estate, and limited-edition contemporary segments. Its load-bearing property is source-format invariance -> the same authentication mechanism operates across digital and film sources because the artifact (the image) is preserved.

The workflow has six elements: edition commitment (photographer commits to a fixed edition size at issuance, exceeded only by breach with reputational consequences); print signing and numbering (each print hand-signed in margin and numbered N/K); Certificate of Authenticity (paper document recording artist, title, year, dimensions, medium, edition, technique, authentication statement); registry or catalogue raisonné (photographer or estate maintains an authoritative ownership record); provenance chain (documented ownership history with COA as starting point); edition discipline enforcement (gallery contracts, dealer-network reputation, consumer-protection statutes in CA and NY on limited-edition art sales).

Gallery's digital authentication chain is the digital-native translation of this workflow: smart-contract edition commitment with supply-constrained Master Images (per §5.1); ESIGN-validated cryptographic signing at mint with on-chain edition record (per §6.5); the deed itself as COA (per §4, §5.8); on-chain registry persisting independently of any operator; deed-history provenance chain; smart-contract-enforced supply caps. The market did not contest the digital-source transition because the artifact (the image) is preserved. Gallery extends the same authentication chain to digital-native distribution where no operational marketplace currently exists. Market scale, segment composition, and creator-side beachhead analysis are documented in R66 §5.


---

## APPENDIX I: WHY URL TEXT BEATS QR CODE FOR GALLERY'S PURPOSE

Gallery's secured-image artifact carries a deed-lookup mark in the lower-right corner. The mark is a text URL (e.g. `jpg1.me/abc1d`, where the slug after the slash is the image ID) rather than a scannable QR code. The image ID is **base-36 lowercase alphanumeric** (digits 0-9 plus letters a-z), 5 characters at launch (60M-address capacity), forward-compatible with longer slugs as the catalog grows (existing 5-char IDs remain valid when 6-char IDs are allocated). The rationale for URL text over QR:

**Aesthetic register.** Fine-art photography prints carry the artist's signature and edition number in the margin as small text. A QR code is a black-and-white optical matrix that reads as tech product or ticket stub, not fine-art print. Text URL inherits the photographic-print register Gallery's market expects.

**No quiet-zone requirement.** A scannable QR mandates a 4-module quiet zone of high-contrast (typically white) backing on all four sides. This forces either a footer band on the image or a visible white box behind the QR. Both intrude on the image composition. Text URL has no such requirement and can be styled (thin stroke, drop shadow, contrasting color) to read against any image background. Gallery's full-bleed Copy design depends on this property.

**OS detection parity.** iOS Live Text (iOS 15+, 2021) and Google Lens detect text URLs in images at the underlying-pixel layer and surface them as tappable links on long-tap. The detection works on saved images in Photos, on screenshots, and via camera-pointed-at-screen. For a 13-character URL like `jpg1.me/abc1d` rendered at 14-18 px font height, Live Text and Lens detect the link reliably. Functionally equivalent to QR for the long-tap UX; superior on devices without third-party QR scanners.

**Footprint.** A scannable Micro QR at 76-100 px occupies 5,000-10,000 px² of opaque matrix. A 13-character URL at 14 px font occupies ~1,400 px² of single-line text. The URL is 75-85% smaller in visible footprint at equivalent detection reliability.

**Manual fallback and brand reinforcement.** A QR code is unreadable to humans; users without a scanner or with detection failure have no recourse. A text URL is always readable -- users can type it manually, copy it from a screenshot, or share it verbally ("jpg1.me slash a-b-c-1-d"). Every share also displays the URL as a brand impression with each view; a QR code displays no brand information.

**Encoded-payload tradeoff.** QR can encode parameters beyond a URL (tracking tokens, deep-link payloads, session identifiers). Gallery's deed lookup does not need this -- the URL alone routes to the deed page where any additional data lives. QR's encoding flexibility is unused.

**Compression resilience.** QR carries Reed-Solomon error correction that survives partial occlusion and lossy compression at higher per-module fidelity than text OCR. This is the dimension on which QR remains nominally superior. For Gallery's controlled-output Copy, where the platform owns the rendering pipeline and re-compression damage is bounded, the advantage does not bind.

**Conclusion.** For Gallery's specific configuration -- fine-art photography, full-bleed Copy artifacts, modern mobile audience, short deed URL, brand reinforcement valued -- URL text beats QR on aesthetic, footprint, manual fallback, and brand reinforcement at no cost to OS-detection reliability. The single dimension on which QR remains nominally superior (universal scanner support including pre-Live-Text devices) is bounded by mobile-OS adoption of Live Text across iOS 15+ and recent Android, which covers Gallery's target audience comprehensively.

---

## APPENDIX J: INVISIBLE FORENSIC WATERMARK (DEFERRED OPTIONAL FEATURE)

An invisible forensic watermark embeds a machine-readable identity payload below the threshold of human perception, recoverable by a decoder. On a Gallery served copy the payload would name the deed, the variant, the edition, and the owner ordinal, giving crop-surviving per-owner attribution -- a leaked or fragmented copy could be decoded back to the owner whose copy it was, surviving re-encoding, resizing, and partial cropping.

Gallery's current design does not include the invisible forensic watermark. Per-buyer differentiation and authentication-of-instance are delivered by the visible attribution layer -- the monogram and URL text documented in §5.2 and §5.9 -- and the load-bearing verification anchor is the on-chain content-hash anchor and the image match engine, neither of which depends on a watermark. R65 evaluates the invisible watermark as the optional, non-load-bearing layer of the verification stack: removing it leaves every documented security threat's residual band intact, because the watermark is forgeable by construction and removable by a determined adversary, and its one distinct contribution is forensic attribution of accidental, non-adversarial leaks, which falls outside the threat model.

The invisible forensic watermark is recorded here as an optional feature for future consideration. It could be layered onto served-copy composition at a later stage, alongside the visible attribution and without disturbing the verification anchor or any other design decision, should crop-surviving per-owner leak attribution become a priority. Its absence from the current design is deliberate and carries no security cost.

---

## REFERENCES

R67 cites internal documents and external sources documenting the Gallery's design rationale, ownership-feeling foundation, legal-and-ownership posture, historical-failure record, and cross-industry precedent. External sources are cataloged in **Reference.txt** (canonical), with inline `[slug]` citations throughout R67 body text and appendices. Internal cross-references to other R-series documents are listed under Cross-Document Dependencies.

**Analysis Code:**

No analysis code is required for the current R67 sections. Code supporting downstream specialty documents (revenue forecasting, growth modeling, market sizing, simulation) lives in those documents.

**Cross-Document Dependencies:**

- **R42 (Money Transfer Compliance Analysis):** Compliance perimeter for the Verified Tier and §6045 broker characterization (Appendix A.2).
- **R45 (Portal Technical Spec):** Engineering-implementation specification corresponding to the design decisions in §5.
- **R65 (Gallery Platform Security):** Security-architecture specification corresponding to access-control and per-buyer-differentiation design decisions in §5.1-§5.2.

---

*Last Updated: 05/26/26*
