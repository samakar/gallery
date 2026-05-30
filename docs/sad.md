# Gallery System Architecture (SAD)

System architecture overview. The functional breakdown from the user perspective, the durability framing it nests inside, and the mapping to R71's deployable subsystems and the implementation modules. The three-function model and durability axis are shared with R62 §1.1; the architectural invariants that lock the function boundaries are R62 §1.2 (INV-1..INV-5, distinct from the constitution INV-01..INV-10 in CLAUDE.md). Authoritative MVP scope is R71.

## 1. Top-Level Functional Model

Gallery presents to the user as three functions, grouped by durability into a live Gateway and a permanent Registry.

| Function | What the user does | Durability group |
|---|---|---|
| Certification | prove identity / that the work is real; trust established and maintained | Gateway (live, platform-operated) |
| Commerce | buy / sell, and receive the served artifact | Gateway (live, platform-operated) |
| Registry | own it, and prove ownership | Registry (permanent, decentralized) |

- **Gateway = Certification + Commerce = Web2** (R62 §1.1). The live, platform-operated layer. Mutable and ephemeral: it runs on platform infrastructure (SQLite, local-FS, Cloudinary, Stripe, Magic) and does not survive platform shutdown.
- **Registry = Web3.** The permanent, decentralized layer that survives platform shutdown: the Solana deed (ownership record) with the Arweave Master as the bound, preserved asset. Every Web3 primitive consolidates here per the durability mapping -- Solana deed, Arweave Master, Magic-provisioned wallet, Crossmint, the on-chain `enc_final`, the post-cessation trustee key-release path.

User journey: verify in (Certification) -> transact (Commerce) -> hold ownership (Registry).

## 2. Functions

### 2.1 Certification -- the trust boundary
Admission-time verification of inbound identity, content, and consent, plus ongoing trust maintenance. Verification uses an external oracle where one exists, deterministic local validation where it does not, and signed attestation for consent.

| Concern | Mechanism | External oracle? |
|---|---|---|
| Identity | OAuth (Magic / Google / Apple), KYC (Stripe), creator allowlist (founder-verified YouTube), embedded-wallet provisioning (the wallet primitive itself is Registry-owned per INV-4) | yes -- IdP, Stripe, YouTube |
| Content | client-side technical quality gate (deterministic, no network per INV-09); MVP per R71 = founder manual review, Tier 0 (CSAM, NCII) + Tier 1 (adult, violence, hate, drugs) two-checkbox gate, with Tier 2 (AI authenticity, RoP, sole-copy) carried by the creator ESIGN warranty. Deferred to MMP: automated PhotoDNA / Thorn / Hive, plus authenticity / C2PA, uniqueness, malware -- the repo `cert/drm/` modules | MVP no content-ML oracle (founder manual); quality gate deterministic, no network (INV-09) |
| Consent | ESIGN clickwrap, four artifacts per INV-2, each preceding the entity it admits: CMA (-> creators row), MJA (-> owners row), Image Signing Affirmation (-> image-id assignment), per-image License Acceptance (-> deed mint) | no -- signed attestation |
| Trust maintenance | public Report intake, dispute handling, deed_state mutation to rights-disputed / void / burned (R62 §3.5.1) | exit side mirrors the CSAM -> NCMEC entry side |

Wallet note: the embedded Magic-provisioned Solana wallet is identity-bound and provisioning is *triggered* here at first auth, but its home is **Registry** per R62 INV-4 -- it is a Web3 primitive (mint recipient at Card 5, encryption target for the inner layer of `enc_final`, post-cessation unwrap key; also signs the Path-1 decryption challenge consumed by Commerce). Certification triggers provisioning; Registry owns the primitive. (Reversed from the earlier draft, which filed it under Certification.)

### 2.2 Commerce -- transact, fulfill, serve
The commercial transaction plus digital fulfillment / delivery of the artifact. Commerce subsumes fulfillment per INV-1, and owns all pixel modification / watermarking per INV-5 (Certification is pure analysis, no pixel edits).

- Transaction: listing, fixed price, Stripe Embedded Checkout, payment webhooks, 90 / 10 split. Buyer-triggered build per ADR-0001; monogram persisted as metadata per ADR-0002 (read inline by runImageOps for `image_gen.generateShareCopy`).
- Catalog / presentation: public image page, Collection, share flow, OG / Twitter Card render routing -- Express SSR of the public image page + React SPA (R71 §2.7).
- Image-page composition follows **R62 §4.3** as canonical (zones: hero + creator-presence block + framing chrome + conversion bar + below-the-fold; canonical CTA **"Own this"**; **"View deed"** secondary link; deed-content page at `/<image-id>/deed`; responsive behavior preserves visual-weight hierarchy). R71 §2.7 defers; R71 §3.4's older "Buy CTA" framing is stale.
- Owner privacy / Vault (R71 §2.6 / §3.8): `images.visibility` is private-by-default at deed mint; the owner's one-way Share flips it to public for their tenure; resale (MMP) resets to private. Render routing branches on (visibility, sold-status, viewer-is-owner).
- Variants (all built from the Original per INV-5): MVP ships the Listing preview and Thumbnail (at ingestion), the Share Copy (1080px personalized social variant, at purchase), and the encrypted on-Arweave Master (no deed-holder download at MVP). Keepsake Copy, deed-holder Master download, and the Limited / Unlimited edition tiers are deferred to MMP (the full five-variant model is R62 §2.2).
- Digital fulfillment: operational Original custody (AES-256-GCM, env-secret KEK, local-FS workhorse), variant build via Cloudinary, protected render, CDN delivery.
- The Arweave Master is built here (decrypt Original -> re-encrypt with the same DEK_image -> upload via ArDrive Turbo), but the resulting artifact lands in the Registry.

Fulfillment reading: Commerce = commerce + digital fulfillment, locked by INV-1 (the ~thirteen cross-boundary couplings make any transaction / fulfillment split unworkable). This closes the former OI-02.

### 2.3 Registry -- own and prove
The permanent, decentralized (Web3) record of ownership and the asset bound to it. Registry owns every primitive whose durability / uniqueness / post-cessation-recoverability requirements exceed a live tier: the deed, the Arweave Master, the image-ID (INV-3), and the Magic-provisioned wallet (INV-4).

- Registry entry = the Solana deed: ownership record, deed_state anchor, royalty plugin, enc_final (deed-bound unlock key), variant content-hash, Arweave URI pointer, license-acceptance pointer.
- Bound asset = the Arweave-stored encrypted Master Image (license-survival; post-cessation per-owner recovery per R62 §7.5). The Master is the asset the registry entry points to -- it is not nested inside the deed (INV-01: image is the asset, deed is the receipt; never invert).
- image-ID: the 5-char base-36 handle is Registry-owned per INV-3 -- generated by Certification at admission (Card 2), consumed by Commerce for naming / routing, but canonical alongside the deed and Arweave Master.
- deed_state (R62 §3.5.1): MVP mints every deed `sealed` (image in platform-mediated custody; deed-holder Master download deferred to MMP). Forward-compat states -- `opened` (Master extracted), `traded-in` (resale), and the takedown-driven `rights-disputed` / `void` / `burned` -- exist on the enum but only the takedown exits are reachable at MVP.
- Permanent and tamper-evident, NOT immutable: deed_state transitions under 3-of-5 multi-sig (INV-06, INV-10); the C2PA manifest is append-only (INV-08; C2PA deferred at MVP).

## 3. Two Axes (and how they nest)

| Axis | Question | Buckets |
|---|---|---|
| Functional (this doc; user-facing) | what does the user do? | Certification, Commerce, Registry |
| Durability (R62 §1.1) | does it survive platform shutdown? | Gateway / Web2 (no) vs Registry / Web3 (yes) |

They nest: Gateway = Certification + Commerce; Registry stands alone as the permanent layer. The implementation modules (§4) nest under the functions.

## 4. Reconciliation

### 4.1 R62 functions and architectural invariants

R62 §2 now IS the three-function model this doc uses -- Certification (§2.1), Commerce (§2.2), Registry (§2.3) -- so there is no four-subsystem remap. The boundaries are locked by R62 §1.2 (INV-1..INV-5):

| R62 invariant | Effect on this doc |
|---|---|
| INV-1 Commerce subsumes fulfillment | Variant production, operational custody, protected render, CDN delivery are Commerce (§2.2). Closes OI-02 |
| INV-2 ESIGN is Certification | CMA / MJA / ISA / License Acceptance all Certification (§2.1); each precedes the entity it admits. Closes OI-04 |
| INV-3 Image-ID is Registry-owned | image-ID home is Registry (§2.3), not cross-cutting; Certification generates, Commerce consumes |
| INV-4 Wallet is Registry-owned | Wallet home is Registry (§2.3), not Certification; provisioning is merely triggered at onboarding |
| INV-5 Commerce owns all image manipulation | All pixel edits / watermarking are Commerce (§2.2); Certification is pure analysis |

### 4.2 Implementation subsystems (CLAUDE.md) -> functional model

| Function | Implementation subsystems / services |
|---|---|
| Certification | identity (wallet provisioning triggered here), cert/drm (ingestion gates), esign, rights, takedown |
| Commerce | payments, storage (Original custody), Variant Build Service (Listing preview, Thumbnail, Share Copy via Cloudinary), Gallery Service (render routing + Express SSR, visibility gating), Access-Control Renderer |
| Registry | onchain, deed_state, wallets (Registry-owned per INV-4), image-ID generator (INV-3), Arweave Upload Service |
| Infra (substrate, below the functions) | observability, audit_log, email, secrets, jobs, DB |

Decision -- "drm" is under Certification: the ingestion gates live at `cert/drm/` (docs and src), a Certification module (content authentication, pure analysis per INV-5) -- NOT R62's old "DRM" variant production, which is Commerce fulfillment here. The module keeps the name `drm`, nested under `cert/` to make the Certification grouping physical. Wallets moved to Registry per INV-4: the `wallets` code is invoked during Certification onboarding to provision, but the keypair is a Registry primitive.

## 5. Open Issues

| ID | Issue |
|---|---|
| OI-02 | RESOLVED by INV-1 (Commerce subsumes fulfillment is now a locked invariant, not a reading) |
| OI-03 | Encrypted Original custody is filed under Commerce / fulfillment but is conceptually secure storage; label stretch, acceptable operationally |
| OI-04 | RESOLVED by INV-2 (ESIGN is Certification; the durable-but-centralized records are Gateway / Certification by invariant) |
| OI-05 | RESOLVED -- R62 §1.1 adopts "Commerce"; naming now consistent across both docs |
| OI-06 | Forensic attribution (watermark extract) is Certification trust-maintenance per R62 §2.1 (exit-side mirror of the entry gates); embedding is Commerce per INV-5. Deferred at MVP (spectrographic), revisit at MMP |
| OI-07 | constitution.md still unwritten; invariants live as highlights in CLAUDE.md |

## 6. Cross-References

| Doc | Purpose |
|---|---|
| CLAUDE.md Constitution Reference | constitution invariants (INV-01..INV-10) |
| R71 | authoritative MVP scope |
| R62 §1.1 | three-function model + durability axis (Gateway = Web2 / Registry = Web3) |
| R62 §1.2 | architectural invariants INV-1..INV-5 (lock the function boundaries) |
| R62 §2.1 / §2.2 / §2.3 | the three functions reconciled here (Certification / Commerce / Registry) |
| R62 §3.5.1 | deed state machine (sealed / opened custody axis + lifecycle axis) |
| R62 §4.7 | privacy architecture / Vault mode (visibility default-private, resale reset) |
| R62 §7.5 | license-survival / post-cessation recovery (Registry durability) |
| R62 §4.9 | takedown (Certification trust-maintenance exit side) |
| R71 §2.6 / §3.8 | owner privacy + Share flow; visibility state machine |
| R71 §3.1 | MVP deployable-subsystem mapping of the three functions |
| docs/cert/, docs/deferred/ | Certification content gates (active + deferred-to-MMP) |

---
*Last Updated: 05/27/26 15:45*
