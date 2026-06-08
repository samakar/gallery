# Trustless Archive Protocol

## SUMMARY

R62's nested-envelope architecture wraps each per-image `DEK_image` under a platform-wide envelope key `platform_DEK` and stores the wrap in deed metadata. During Gallery's life, the platform holds `platform_DEK` privately and mediates every Master access, which makes seal-break cryptographically enforced but leaves the archive trust-bound to Gallery's continued operation.

R72 specifies a platform-wide deadman switch that publishes `platform_DEK` automatically when Gallery stops sending its liveness signal. A Solana Anchor program holds the liveness state with monthly heartbeats and a permissionless `latch_dead` instruction. A threshold-encrypted backup of `platform_DEK` is held by two independent threshold networks under a cessation ACC; once `is_dead` latches after 365 days of silence, anyone can decrypt the backup via either vendor and publish the plaintext to Arweave. The publication is a single platform-wide event, not per-deed, because one key serves the entire archive.

Once `platform_DEK` is public, every deed's wrapped `DEK_image` becomes universally unwrappable and every Master on Arweave becomes universally decryptable. The deed continues to record provenance, ownership history, and license terms; the bytes themselves transition from access-controlled to public at cessation. Verification (§§2.8-2.10) spans byte-identity (sha256 recompute against published Masters post-cessation), identity (creator wallet-signature via SNS, `gallery.sol` mint binding), and provenance (Solana transfer history). The bounty PDA pays ~$100 in SOL for the single publication event; Anchor upgrade authority is renounced at MMP. All trust assumptions are limited to Solana consensus, Arweave permanence, standard cryptography, and a bounded post-cessation threshold-network window.

---

## 1. BACKGROUND

R67 §6.12 and §316 position the archive system as requiring trustlessness at MMP rollout. A trustless archive means the deed-and-artifact bytes remain accessible and verifiable using only public consensus, permanent storage, and standard cryptography, without trusting Gallery, its successor entities, or any single third-party vendor. R67 frames this as a B2B-tier feature that institutional and business buyers value for compliance and audit primitives.

R62's updated nested-envelope architecture (§2.2 Master storage, §7.4 Storage Model) wraps each per-image `DEK_image` under a platform-wide `platform_DEK` and holds `platform_DEK` privately during Gallery's operational life. The architecture cryptographically enforces seal-break by routing every Master access through platform-mediated unwrap, but it is not trustless because accessibility depends on Gallery as the sole custodian of `platform_DEK`. There is no on-chain primitive that releases `platform_DEK` if Gallery ceases.

**Objective:** specify a deadman switch that publishes `platform_DEK` automatically and trustlessly when Gallery stops operating. The mechanism must rest only on Solana consensus, Arweave permanence, standard cryptographic primitives, and a bounded post-cessation threshold-network window. It must operate at the platform layer (one publication, universal effect) rather than the per-image layer.

---

## 2. ANALYSIS

### 2.1 Deadman Switch atop R62's Nested-Envelope Architecture

**Problem.** Even with R62's updated nested encryption (`DEK_image` wrapped under platform-wide `platform_DEK`, with the wrap stored in deed metadata), accessibility during Gallery's life depends on Gallery holding `platform_DEK` privately. There is no on-chain mechanism that releases `platform_DEK` if Gallery ceases. The archive's universal-access property requires a primitive that publishes `platform_DEK` automatically and trustlessly when the platform stops operating.

**Solution.** R72 specifies a platform-wide deadman switch that publishes `platform_DEK` once when Gallery fails to send its liveness signal for the cessation window. The deadman switch operates at the platform layer, not the per-image layer, because `platform_DEK` is platform-wide. After publication, every deed's `wrap(DEK_image, platform_DEK)` becomes universally unwrappable; every Master on Arweave becomes universally decryptable. The deed continues to record provenance, ownership history, and license terms on Solana; the bytes themselves transition from access-controlled to public at cessation.

Six components, all operating at the platform layer:

| Component | Purpose | Per-image? |
|---|---|---|
| Solana platform-liveness Anchor program (§2.2) | On-chain heartbeat + latch_dead + is_dead flag | No |
| Threshold-encrypted backup of `platform_DEK` (§2.3) | Dual-vendor threshold-network custody of `platform_DEK` with cessation ACC | No (one backup, platform-wide) |
| Cessation timer and publication flow (§2.5) | Single-event publication of `platform_DEK` to Arweave post-latch | No (one publication, universal effect) |
| Recovery Manifest on Arweave (§2.6) | Canonical document with recovery procedure and constants | No |
| Bounty PDA | Funds the latch and single-publication events | No (one pool, sized for one publication) |
| Reference recovery client (§2.8 / §2.10) | Open-source CLI for verification and post-cessation recovery | No |

The per-image complexity that previous draft architectures carried (per-deed Wrap C, per-deed Arweave manifest, per-deed migration log, per-deed auto-publish loop, bounty pool sized to deed count) is eliminated because `platform_DEK` is one key serving the entire archive.

### 2.2 Solana Platform-Liveness Program

A small Anchor program holds the cessation state. One PDA per Gallery deployment:

```
struct PlatformLiveness {
    authority: Pubkey,          // multi-sig signer that issues heartbeats
    last_heartbeat_ts: i64,     // Unix seconds, updated by log_heartbeat()
    threshold_seconds: i64,     // cessation window (default: 365 * 86400)
    is_dead: bool,              // monotonic latch, can only flip false -> true
}
```

Two instructions:

1. **`log_heartbeat()`** signed by `authority`. Sets `last_heartbeat_ts = Clock::get().unix_timestamp`. Cadence: monthly. Runs from Gallery's operational infrastructure as a scheduled job.

2. **`latch_dead()`** permissionless. Requires `Clock::get().unix_timestamp - last_heartbeat_ts >= threshold_seconds`. Sets `is_dead = true`. Cannot be undone. Anyone may call this; the bounty PDA pays a small SOL reward to incentivize external parties to do so promptly after the threshold elapses.

The `authority` is a 2-of-3 multi-sig (Gallery operator plus legal counsel plus independent escrow agent) to reduce false-positive risk from a single key loss while Gallery is alive.

### 2.3 Threshold-Encrypted Backup of `platform_DEK`

`platform_DEK` exists in two forms:

| Form | Purpose | Custodian | Access |
|---|---|---|---|
| Operational copy | Variant builds and platform-mediated owner Master access during Gallery's life | Gallery (AWS KMS or equivalent secure key vault) | Private to Gallery |
| Threshold-encrypted backup | Deadman switch publication target | Dual threshold networks with `ACC_v1` (requires `is_dead = true`) | Inert during operation; permissionlessly decryptable post-cessation |

At Gallery launch (not per-image, not per-deed), the platform performs the following one-time operations:

```
Gallery launch - platform_DEK threshold-encryption setup:
  1. Generate platform_DEK (one platform-wide AES-256 key)
  2. Import operational copy into AWS KMS (or equivalent secure vault)
  3. Encrypt platform_DEK with primary threshold-network BLS pubkey + ACC_v1
       -> wrap_platform_DEK_primary
  4. Encrypt platform_DEK with secondary threshold-network BLS pubkey + ACC_v1
       -> wrap_platform_DEK_secondary
  5. Upload threshold-encrypted backups to Arweave
       -> arweave_tx_platform_DEK_primary, arweave_tx_platform_DEK_secondary
  6. Record both Arweave tx ids in the Recovery Manifest (§2.6)
  7. Pin Recovery Manifest tx id in multiple stable channels
```

`ACC_v1` is platform-wide and identical for both vendors. A `solRpc` getAccountInfo condition reads the `is_dead` byte of the platform-liveness PDA and returns true when the byte equals 1. The ACC JSON is byte-for-byte canonicalized (sorted keys, fixed whitespace, UTF-8) so that both vendors validate against bit-identical conditions.

**Pre-build validation requirement.** Lit's documented Solana ACCs are typically token-balance and NFT-ownership patterns; arbitrary Anchor-account byte reads with offset parsing are not confirmed in production documentation. Before build, validate that `solRpc` ACC supports raw account-byte reads with the required offset semantics on Solana mainnet. The validation harness mints a test liveness PDA on devnet, encrypts a test payload under `ACC_v1`, latches `is_dead`, and confirms decryption succeeds via both vendors.

**Fallback architecture if validation fails.** If raw byte reads are not supported, wrap the cessation signal in a primitive that the threshold networks natively support. The Anchor program mints a single SPL token (`cessation-witness`) held at zero supply while Gallery is alive. On `latch_dead`, the program mints exactly one token to a known burn address. The ACC becomes a standard token-balance condition (supply of `cessation-witness` >= 1). This pattern is fully supported by Lit's documented ACC types and adds ~30 LOC to the Anchor program.

### 2.4 Dual-Vendor Threshold Network Strategy

Two structurally similar but operationally independent threshold networks hold the cessation-conditional copies of `platform_DEK`. Lit Protocol is the primary candidate; the secondary is selected from vetted alternates based on the independence validation below.

**Pre-build validation requirement.** Confirm the secondary vendor runs an independent node set and BLS keyset distinct from Lit. Some candidate vendors (notably Kavach) have at times consumed Lit infrastructure rather than operating parallel networks. If validation reveals shared infrastructure, swap to a different alternate before MMP. The validation harness measures node-set overlap, key-share distribution, and operational dependency graphs across the two vendors.

**Vetted alternate vendors:**

| Vendor | Network type | Independence from Lit | Maturity |
|---|---|---|---|
| Phala Network | TEE-based confidential compute | Full | Production |
| Nillion | Blind compute / threshold MPC | Full | Mainnet 2024 |
| FairBlock | Threshold encryption (Cosmos-native) | Full | Mainnet |
| Self-hosted BLS network | Operator-run threshold cluster | Full | Custom build |
| Kavach (Lighthouse) | BLS threshold (Filecoin-adjacent) | Verify before use | Production but possible shared infra with Lit |

The two backups are **OR-decryptable**. Any one vendor unlocking is sufficient to recover `platform_DEK`. This optimizes for post-cessation availability rather than pre-cessation confidentiality, which is the correct optimization because `ACC_v1` returns false while `is_dead = 0`.

| Failure mode | Recovery still works? |
|---|---|
| Primary network migration during Gallery's life | Yes. Gallery re-wraps the primary backup within the migration SLA |
| Primary network fully sunsets after Gallery's death | Yes. Secondary-vendor backup still works |
| Secondary vendor fully sunsets after Gallery's death | Yes. Primary backup still works (if not already sunset) |
| Both vendors sunset within the same post-cessation window | No. Recovery fails. Third vendor at MMP closes this |
| Both vendors migrate before Gallery's death without Gallery re-wrapping within SLA | No. Recovery fails. Migration SLA mitigates |

**Migration SLA.** On any threshold-network migration announcement, Gallery commits to re-wrapping `platform_DEK` to the new BLS pubkey within 30 days of announcement, or before the announced sunset date, whichever is earlier. Each re-wrap event appends a log entry to the Recovery Manifest (§2.6) with the new BLS pubkey, new Arweave tx id for the new backup, and timestamp. Because there is only one backup per vendor (not per-image), re-wrapping is a trivial single-key operation, not a corpus-wide loop.

### 2.5 Cessation Timer and Single-Publication Flow

The cessation threshold is set to **365 days** by default. This is conservative enough to absorb operational interruptions (legal restructuring, founder transitions, multi-month dormant phases that do not constitute actual cessation) and short enough that the post-cessation recovery completes well within either threshold network's expected continued operation.

Lifecycle:

```
T = 0 (launch):    platform_DEK generated; threshold-encrypted backups uploaded to Arweave;
                   Recovery Manifest published
T = ongoing:       Gallery calls log_heartbeat() monthly; re-wraps backups on
                   threshold-network migration events per the §2.4 SLA
T = death:         Gallery operationally ceases; heartbeats stop
T = death + 365d:  anyone calls latch_dead(); is_dead flips to true
T = death + ~370d: anyone (incentivized via bounty PDA) calls primary threshold
                   network (or secondary as fallback) for decryption; obtains
                   plaintext platform_DEK; publishes platform_DEK to a well-known
                   Arweave location and mirrors (GitHub, IPFS, public archives)
T = death + ~371d onward: platform_DEK is public; any party can independently
                   unwrap any deed's DEK_image from on-chain deed metadata and
                   decrypt the corresponding Master from Arweave
```

The publication step is permissionless and idempotent. Multiple parties may execute it; the first successful upload wins. The reference recovery client (open-source, mirrored on GitHub, npm, IPFS, Arweave) automates the latch and publication steps with a single command.

**Bounty PDA and publication funding.** The bounty PDA is seeded at Gallery launch with SOL to incentivize the latch and the publication. Structure:

```
struct CessationBounty {
    sol_balance: u64,           // pre-funded SOL reserve
    latch_caller_bounty: u64,   // SOL paid to first caller of latch_dead()
    publication_bounty: u64,    // SOL paid to first publisher of platform_DEK
    is_drained: bool,           // monotonic flag when funds exhausted
}
```

Sizing at launch is trivial because publication is a single event. Latch bounty ~$5 in SOL, publication bounty ~$50 in SOL (covers a few-KB Arweave upload via ArDrive Turbo plus a small reward). Total launch funding ~$100 in SOL. The pool sits on Solana, survives Gallery's death, and is permissionlessly claimable only after `is_dead = 1`.

**Anchor program upgrade-authority handoff.** Through MVP, Gallery retains upgrade authority on the platform-liveness program to preserve extension paths. Retaining upgrade authority indefinitely contradicts the trustless property because Gallery could rewrite cessation logic. At MMP, upgrade authority is renounced via one of three options, with the chosen option recorded in the Recovery Manifest:

| Option | Mechanism | Tradeoff |
|---|---|---|
| Hard renounce | Set upgrade authority to `None` | Maximum trustlessness; no future patches |
| Timelock renounce | Authority moved to a program-controlled PDA with a 90-day delay and public veto window | Strong trustlessness; emergency patch path with public scrutiny |
| Multi-sig handoff | Authority moved to a 5-of-9 multi-sig of named outside parties (auditors, foundations, legal escrow) | Patches possible; trust shifts to the multi-sig set rather than to Gallery |

Default recommendation is timelock renounce. The handoff transaction is itself the trustlessness milestone announced publicly at MMP launch.

### 2.6 Recovery Manifest on Arweave

A single canonical document published at Gallery launch contains all constants required for recovery without depending on Gallery's website, GitHub repository, or any operational artifact still being online at recovery time. Content schema:

```
GALLERY RECOVERY MANIFEST v1
1. Identification: protocol name, manifest version, publication timestamp
2. Cryptographic constants: ACC_v1 canonical JSON (base64), SHA256 of ACC_v1 bytes
3. Solana references: program id, platform_liveness PDA pubkey, struct layout,
   bounty PDA pubkey, mint authority pubkey
4. Primary vendor references: vendor name, network identifier, BLS pubkey, SDK
   version, Arweave tx id of threshold-encrypted platform_DEK backup
5. Secondary vendor references: equivalent fields for the secondary vendor
6. Arweave gateway list: 5+ independent gateways for retrieval fallback
7. Recovery procedure: step-by-step instructions readable without prior context
   (latch_dead -> threshold-network decrypt -> publish platform_DEK ->
   per-deed unwrap of wrap(DEK_image, platform_DEK) -> Master decryption)
8. Reference implementation: Arweave tx id of recovery client source code
9. Verification: SHA256 of this manifest; optional signatures from launch witnesses
10. Migration log: append-only via subsequent Arweave txs tracking each
    threshold-network re-wrap event of platform_DEK with new BLS pubkeys and
    new backup-tx pointers
11. Upgrade-authority handoff record: chosen MMP option (hard renounce,
    timelock renounce, or multi-sig handoff) plus the handoff Solana tx id
```

The manifest is plaintext UTF-8 markdown. Manifest Arweave tx id is hardcoded in the recovery client source, embedded in each deed's metadata at mint, and replicated to multiple stable channels at launch (GitHub mirrors, IPFS pin, transparency-log entries). Migration log entries append new manifest versions referenced from a side registry without invalidating the v1 root.

### 2.7 Permanence Risk Analysis

The platform-wide deadman switch design requires only that at least one vendor survives the interval from `T_death` through `T_death + 365d + recovery_buffer`, where `recovery_buffer` accommodates the time between latch and publication (days to weeks). The threshold-network dependency is bounded to a single window per Gallery deployment, not perpetual and not per-image.

| Required network survival post-Gallery-death | Joint failure probability |
|---|---|
| 1 month | Negligible |
| 3 months | Very low |
| 6 months | Low |
| 12 months | Low-moderate |
| 24 months | Moderate |

Setting the cessation threshold at 365 days places the recovery moment roughly 12 months post-Gallery-death. With two independent vendors and active operational re-wrapping during Gallery's life (a trivial single-key operation rather than corpus-wide), the joint-failure probability over a 12-month post-death window is small. Empirically, Lit has been operating across multiple network deployments since 2021; Phala since 2018; Nillion mainnet since 2024. A simultaneous shutdown of both selected vendors within a year of an arbitrary Gallery death event is plausible but improbable.

Residual risks not eliminated by this design:

| Residual risk | Mitigation |
|---|---|
| Both threshold vendors fail within the recovery window | Add a third vendor at MMP; accept residual at MVP |
| Gallery's heartbeat key compromised while platform alive (false cessation) | 2-of-3 multi-sig on `authority`; renewal instruction for signer rotation |
| `ACC_v1` discovered to have a flaw post-launch | Pre-launch testnet validation; SPL-token fallback ACC pattern documented in §2.3 |
| No one calls `latch_dead()` after timer expires | Bounty PDA pays small SOL reward to first caller |
| No one performs the publication step | Bounty PDA pays publication reward; reference client open-source distribution |
| Solana itself halts longer than 365 days while Gallery alive | Operationally extremely unlikely; would also halt the entire ecosystem |
| `platform_DEK` operational copy compromised during Gallery's life | Out of scope for R72; covered by R65 §3.14 platform-key custody controls |

---

### 2.8 Verification Layers

Verification spans two layers with different purposes and timing. Both are essential; neither replaces the other.

**Pre-cessation owner verification (pHash) -> post-MVP.** At Card 5 mint, the platform computes `pHash(M_pixels)` from the plaintext Master in memory and commits the value to deed metadata alongside the existing `sha256(M_pixels)` -> one additional field on the existing Solana mint transaction. A clean Thumbnail variant (aspect-preserving, unwatermarked, 500 px long-edge per R71) is attached to the COA + receipt email at Card 5; during operational life the same Thumbnail is also downloadable from the deed page. The buyer verifies by computing `pHash(emailed_Thumbnail)` locally and comparing to the on-chain `pHash(M)` within a calibrated Hamming-distance threshold. Match confirms that the variant the buyer received and the on-Arweave Master derive from the same source pixels, without decrypting the Master and without mutating the seal.

Scope: owner-facing convenience, not adversary defense. The layer detects honest platform errors (wrong file uploaded, byte corruption during archive, variant-build pipeline divergence) and gives non-destructive confirmation tied to a permanently-mailed artifact. It does not detect a malicious platform that commits a self-consistent fake pHash; the post-cessation sha256 layer addresses that case.

Implementation: pHash algorithm canonicalized in R62 -> 64-bit pHash over the Y-channel with specified resize and DCT block size, plus an empirically-calibrated Hamming threshold against the variant pipeline. Thumbnail variant aspect-preserving (no AI-driven cropping) and unwatermarked so the only transformation between Thumbnail and Master is downscale plus JPEG re-encode; discovery surfaces consume the same Thumbnail through CSS `object-fit` at display time. Thumbnail does not need Arweave persistence -> transactional email places the artifact in the buyer's permanent custody at dispatch. **Post-MVP**; R71 MVP retains the current Thumbnail variant without pHash commitment.

**Post-cessation universal verification (sha256).** Anyone fetches the auto-published plaintext Master from Arweave (per §2.5), canonicalizes per R62 §1.5, recomputes `sha256(M_pixels)`, and compares to the on-chain commitment. Gold-standard byte-identity verification and the primary purpose of the cessation recovery protocol. Permissionless, repeatable, indefinitely testable -> any party with internet access and a hash function can confirm or refute the on-chain commitment forever.

**Deferred trustless byte-identity, not operational-life byte-identity.** Pre-cessation byte-identity verification is structurally deferred rather than continuously available. Under R62's nested-envelope architecture, owners do not hold any wrap of `DEK_image`; only the platform can unwrap via `platform_DEK`. Two paths therefore exist during Gallery's operational life: (a) perceptual identity via pHash plus emailed Thumbnail (zero-cost, perceptual not cryptographic); (b) deferred cryptographic byte-identity post-cessation by recomputing sha256 against the Master that becomes universally decryptable once `platform_DEK` is published. The operational-life destructive verification path that existed under the parallel-wrap architecture is gone: owners cannot self-decrypt offline because there is no owner-held wrap of `DEK_image`.

R72 does not claim operational-life trustless byte-identity verification. The trustless claim is **deferred and unforgeable**: any commitment Gallery makes at mint is permanently testable against the post-cessation universally decryptable Master. A mismatched sha256 cannot be hidden post-cessation, and the discovery is permissionless and indefinitely repeatable. The asymmetry "perceptually verifiable now, cryptographically verifiable forever later" is the honest framing of the property R72 provides.

**Why on-demand verification beats pre-stored attestation.** Three alternatives were considered and rejected: a fourth wrap of `DEK_image` to a Lit PKP running a Verification Action (Wrap D); a multi-party operator attestation set pre-signing hashes at mint and writing them to a Solana AttestationRegistry program; a single trustless mediator (Phala or TEE-equivalent) performing both Arweave upload and hash attestation in one TEE-enclosed pipeline. All three buy earlier independent byte-identity verifiability at the cost of testability. Pre-stored attestations are only testable at the moment they are signed, after which any later check trusts the signature rather than the bytes. An attester who quietly substituted bytes during their privileged window cannot be detected by future reads of the same attestation. On-demand verification fails loudly because mismatches are discoverable forever by recomputation from the published bytes. Trust gaps are exposed by the same cryptographic primitives that constitute the commitment.

**Reference verification client.** Open-source CLI / web tool distributed via GitHub, npm, Arweave pin, and embedded in the Recovery Manifest. Reproducible builds let any party confirm the binary matches the source. The client runs both the pre-cessation pHash check (against on-chain `pHash(M)`, with the emailed Thumbnail as input) and the post-cessation sha256 check (against on-chain `sha256(M)`, with the published plaintext Master as input) under a unified interface. The pHash check is also usable as a forensic tool against a hypothetical leaked plaintext to confirm whether it perceptually matches the on-chain commitment.

---

### 2.9 Identity Verification

Image integrity verification (§2.8) confirms that bytes match the deed's commitments. Identity verification answers the complementary question -> who attests to the deed, and how does the owner confirm those identities trustlessly. Three actors -> owner, creator, platform -> with a verification dimension for each.

**Owner wallet verification.** Trivial cryptographically. The owner signs a nonce with their wallet private key; the signature verifies against `owner_wallet_address` from the deed -> standard Solana wallet-control proof. The deed-page UI exposes a "Prove ownership" button running the standard sign-message flow. No protocol addition; the mechanism is intrinsic to NFT ownership.

**Creator identity attestation -> post-MVP.** Creator wallet provisioning at signup (existing architecture) gives each creator a public `creator_wallet_pubkey`. At Card 2, the existing ESIGN ceremony is extended with a wallet-signature step -> the creator signs `{image_id, sha256(Original), pHash(Original), creator_verified_name, creation_timestamp}` with their wallet private key. The wallet signature is the cryptographic anchor; the click-wrap ESIGN remains the legal anchor under the ESIGN Act. Both coexist. At Card 5 mint, the creator signature and `creator_wallet_pubkey` are written to deed metadata.

The pubkey-to-real-identity binding is anchored by SNS (Solana Naming Service). Creators register `<creatorname>.sol` at signup and bind it to their wallet pubkey; Gallery records `creator_sns_name` in deed metadata alongside the pubkey. Owner verification chain: resolve `creator_sns_name` via SNS, match against `creator_wallet_pubkey`, verify the image signature against that pubkey, and independently cross-reference the SNS name via the creator's pre-existing public identity surfaces (X bio, personal site). Steps 1-3 are trustless and on-chain; step 4 is where human-identity anchoring lives, outside Gallery's scope.

SNS is the appropriate trustless system because it is permissionless, on-chain on Solana itself, requires no cross-chain oracle, survives Gallery cessation by construction, and the reference verification client resolves it via a single Solana account read.

Product posture: SNS registration is **strongly recommended** rather than required; verified-creator status can be gated on SNS as an incentive without making it a hard signup blocker. Cost is one-time and negligible (~$20).

**Platform identity attestation.** Gallery registers `gallery.sol` (or equivalent canonical name) and binds it to its mint authority and platform-liveness program authority. Owners verify "this deed was minted by the canonical Gallery deployment" by resolving `gallery.sol` via SNS and matching against the deed's `mint_authority`. The Recovery Manifest (§2.6) lists `gallery.sol` and its bindings. This is complementary to the Manifest, not a replacement -> the Manifest provides comprehensive recovery instructions; the SNS binding gives a single human-readable canonical anchor that survives without the Manifest. Marginal benefit, negligible cost, strict trustless property.

**Composite verification chain.** Combining §2.8 and §2.9, the owner's post-cessation verification answers four orthogonal questions with no Gallery dependency.

| Question | Mechanism |
|---|---|
| Is this deed mine? | Wallet sign-message against `owner_wallet_address` |
| Was this deed minted by Gallery? | Resolve `gallery.sol` via SNS; match `mint_authority` |
| Did the named creator sign this image? | Verify creator signature against `creator_wallet_pubkey`; cross-reference via `creator_sns_name` |
| Do the archived bytes match what was sold? | Recompute `sha256(M)` against post-cessation published bytes (or `pHash(M)` against emailed Thumbnail pre-cessation) |
| What is the deed's full provenance? | Read transfer events, state transitions, and variant-hash history via any Solana RPC (§2.10) |

All five resolve through on-chain reads and standard cryptographic primitives. The trustless archive is closed across byte-integrity, identity, and provenance dimensions.

---

### 2.10 Deed History Verification

Solana NFT mechanics intrinsically log every transfer, deed-state transition, and variant build event on-chain. R72 adds no new mechanism for history verification; it surfaces what is already there as an explicit verification dimension and ensures the reference client renders it.

**What is trustlessly readable from the deed mint address alone.**

| Element | On-chain source | What it proves |
|---|---|---|
| Mint event | Metaplex Core mint tx | Creator, original owner, mint timestamp, mint authority |
| Each transfer | Metaplex Core transfer instruction | From-wallet, to-wallet, block time; signed by previous owner |
| Number of owners | Count of transfer events + 1 | Trivially derivable |
| Deed-state transitions | Deed metadata update txs | Sealed -> opened, rights-disputed, void, burned, with timestamps |
| Variant hash history | Append-only `variant_hashes` map | Which variants existed at which owner-ordinal; prior entries immutable per Solana finality |
| License acceptance per buyer | `license_acceptance_signing_event_id` per deed update | Each buyer's per-image License Acceptance anchored by ESIGN signing event |

Any party with internet access can reconstruct the deed's full provenance from the mint address using any Solana RPC or block explorer -> no Gallery RPC, no Gallery website, no Gallery API. Survives platform cessation by construction.

**Bounded gaps.**

| Gap | Why | Mitigation |
|---|---|---|
| Price per transfer | Fiat via Stripe; not on-chain SOL | Off-chain receipts during platform life; no on-chain wash-trade detection |
| Royalty payment to creator | Stripe Connect distributes off-chain in MVP | Platform-attested receipts during life; post-MVP on-chain royalty via Metaplex Core `Royalties` plugin closes this |
| License terms text | Stored off-chain; only signing-event id on-chain | UCC Article 12 tethering per R67 §6.2 covers term continuity; the signing-event id binds each buyer to a specific terms version |

These gaps are bounded -> they don't compromise the deed-ownership, image-byte, or identity verification chains; they reflect MVP's reliance on fiat payment rails rather than a fundamental architectural limit. Post-MVP migration to on-chain royalty enforcement closes the largest gap.

**Reference verification client extension.** The §2.8 client adds a `deed-history` command that takes a deed mint address and outputs the full transfer chain, state-transition log, variant-hash evolution, and license-acceptance timeline. All data is fetched directly from a Solana RPC; no Gallery endpoint is in the loop.

---

## 3. TRUSTLESS PROPERTY

The mechanisms in §§2.1-2.10 are individually motivated by specific failure modes. Considered together, they establish a single architectural property. The archive's accessibility and verifiability depend only on a small, well-known trust set that excludes Gallery and any single third party.

### 3.1 The Claim

Deed ownership, image bytes, identity attestations, and provenance history remain accessible and verifiable using only:

1. **Solana consensus.** Validator set, proof-of-stake economic security
2. **Arweave permanence.** Endowment-funded storage
3. **Standard cryptographic primitives.** SHA-256, ECDSA, AES-256-GCM, pHash, BLS
4. **One of two threshold networks.** Required only during the post-cessation publication window for `platform_DEK` release

No Gallery operator, successor entity, website, API, or third-party verification service is required at any moment after deed issuance.

### 3.2 Trust Assumptions, Explicit

| Layer | Trust assumption | Standard? |
|---|---|---|
| Deed ownership | Solana proof-of-stake economic security; ECDSA signature security | Yes. Every Solana NFT |
| Image bytes (pre-cessation) | Gallery custody of `platform_DEK`; AES-256-GCM cipher security | No. Trust in Gallery during operational life; deferred to cessation |
| Image bytes (post-cessation) | Published `platform_DEK` plus AES-256-GCM cipher security; Arweave endowment-funded permanence | Yes. Every Arweave artifact |
| Hash commitments | SHA-256 collision resistance; pHash robustness within calibrated threshold | Yes. Every on-chain hash anchor |
| Cessation recovery | One of two threshold vendors surviving the post-cessation publication window | Bounded. Dual-vendor; third vendor at MMP |
| Identity binding | SNS resolution on Solana; creator's chosen identity surface | Yes. Standard Solana naming pattern |

Gallery appears in only one row (pre-cessation image-byte trust) and that trust is deferred to cessation by the deadman switch. No post-cessation row depends on Gallery.

### 3.3 Operational-Life Verification: Deferred, Not Continuous

The trustless property is deferred for byte-identity during operational life, not continuously available. Two verification paths exist after Card 5 mint:

| Path | Method | Cost | Catches malicious commit? | Economic viability |
|---|---|---|---|---|
| Non-destructive pHash | `pHash(emailed Thumbnail)` vs on-chain `pHash(M)` | Zero | No. Checks Gallery self-consistency only | Always viable |
| Deferred universal | After cessation publication of `platform_DEK`, anyone unwraps `DEK_image` and recomputes `sha256(M)` against the Arweave Master bytes | Zero (requires cessation) | Yes. Full independent verification | Universally viable post-cessation |

The destructive byte-identity path that existed under R62's previous parallel-wrap architecture is gone in the nested-envelope architecture. Owners do not hold any wrap of `DEK_image` during operational life; they cannot self-decrypt offline at all, which means there is no economic-loss-incurring verification path during operation. The non-destructive pHash check is the only operational-life verification, and the deferred universal check is the only cryptographically rigorous one.

R72's honest claim is that the byte-identity commitment is **unforgeable and indefinitely testable post-cessation**, not that it is verifiable on demand during operational life. Any sha256 commitment Gallery records at mint is permanently bound to the publication event. Gallery cannot retract, alter, or hide the commitment, and the discovery of a mismatch is permissionless and indefinitely repeatable by any party with internet access. The trustless property holds in the deferred sense across the full archive lifetime.

### 3.4 Bounded Out-of-Scope Gaps

The trustless property covers deed ownership, image bytes (deferred), identity attestations, and provenance history. It does not cover:

| Gap | Why | Status |
|---|---|---|
| Price per transfer | Fiat via Stripe; not on-chain SOL | Off-chain by design; no on-chain price discovery |
| Royalty payment to creator | Stripe Connect off-chain in MVP | Post-MVP on-chain royalty via Metaplex Core `Royalties` plugin closes this |
| License terms text | Stored off-chain; signing-event id anchors on-chain | UCC Article 12 tethering covers continuity (R67 §6.2) |
| `platform_DEK` operational-copy compromise during Gallery's life | Out of scope for R72; covered by R65 §3.14 platform-key custody controls | Mitigated by Gallery's standard cloud-security regime |
| Creator's future actions or commitments | Out of scope | Trustless archive covers artifacts, not external commitments |

These gaps are documented for completeness; they do not compromise the deed-ownership, post-cessation image-byte, identity, or provenance verification chains.

### 3.5 Backfill for MVP-Era Deeds

If R62's nested-envelope architecture is adopted post-MVP, MVP-era deeds minted under the previous parallel-wrap architecture need a one-time backfill to bring them under the new trustless property. The backfill re-encrypts the per-image `DEK_image` under `platform_DEK` and writes the new `wrap(DEK_image, platform_DEK)` to deed metadata via mint-authority Solana transaction. The Arweave Master bytes are unchanged (re-encryption is at the wrap layer, not the bulk-bytes layer). MVP-era deeds also receive the pHash backfill described in the original R72 draft (compute `pHash(M_pixels)` from the platform-held Master, write to deed metadata, email current owner the Thumbnail).

Cost is bounded: ~100 Solana metadata-update transactions at R71 MVP scale, each updating the wrap and pHash fields. Negligible at MVP-era corpus size.

**Optional but recommended.** The trustless property holds for MVP-era deeds without backfill via the deferred publication path (post-cessation `platform_DEK` publication still recovers the wrapped `DEK_image` from S3 metadata if Gallery's MVP-era key custody included it). Backfill is recommended for product-consistency reasons and is low-cost enough to default-on at the post-MVP upgrade window.

---

## 4. CONCLUSIONS

The design establishes a trustless archive for artifacts and deeds via a platform-wide deadman switch on top of R62's nested-envelope encryption. Accessibility and verifiability rest only on Solana consensus, Arweave permanence, standard cryptographic primitives, and a bounded post-cessation threshold-network window. Gallery's role is limited to operational-life custody of `platform_DEK`, and that custody trust is deferred to cessation by the deadman switch publication. No R72 mechanism operates per-image; all components operate at the platform layer.

**Architectural simplification versus per-image alternatives.** The previous draft architecture (per-image Wrap C, per-deed Arweave manifest, per-deed bounty pool, per-deed migration log, per-deed auto-publish loop) is collapsed into a single platform-wide publication of `platform_DEK`. Bounty PDA shrinks from ~$75K to ~$100. Migration discipline shrinks from corpus-wide re-wrapping to single-key re-wrapping. Auto-publish shrinks from per-deed Arweave uploads to one ~few-KB key publication.

**Pre-build validation tasks.** Two external-vendor capabilities are load-bearing. First, the primary threshold network's `solRpc` ACC support for raw Anchor-account byte reads with offset semantics (§2.3); fallback to an SPL-token cessation-witness pattern if unsupported. Second, the secondary vendor's independence from the primary (§2.4); swap to a vetted alternate (Phala, Nillion, FairBlock, self-hosted BLS) if validation reveals shared infrastructure.

**Self-financing recovery.** The bounty PDA seeded at Gallery launch with ~$100 in SOL funds the single `latch_dead` call and the single `platform_DEK` publication event.

**Trustless milestone.** Anchor program upgrade authority is retained through MVP for extension paths and renounced at MMP (timelock-renounce recommended). The renouncement transaction is the trustlessness milestone announced at MMP launch.

**Honest framing of byte-identity.** Operational-life byte-identity verification is deferred rather than continuous. The non-destructive pHash path catches Gallery self-consistency only; cryptographic byte-identity is deferred to post-cessation publication of `platform_DEK`, after which sha256 recompute against the Arweave Master is universally testable. R72 does not claim operational-life trustless byte-identity, only deferred trustless byte-identity (§3.3).

**Residual risks.** Joint dual-vendor failure within the post-cessation window (third vendor at MMP closes this); undetected `ACC_v1` flaws (testnet-mitigated; SPL-token fallback documented); operational-life `platform_DEK` compromise (out of scope; covered by R65 §3.14 custody controls).

**Integration work.** R62 §2.2 / §3.1 / §7.4 / §7.5 nested-architecture absorption (completed); R65 §3.14 update for `platform_DEK` custody and threshold-encrypted backup; R71 MVP scope decision; Anchor program build with liveness PDA and bounty PDA; threshold-encrypted backup of `platform_DEK` at Gallery launch; Recovery Manifest v1; reference verification client (§2.8 sha256/pHash, §2.10 deed-history) with cessation recovery automation; pre-build vendor validation harness; post-MVP §§2.8-2.9 identity additions; `gallery.sol` registration; MMP upgrade-authority renounce.

---

## 5. REFERENCES

**Cross-Document Dependencies:**
- **Document R62:** Gallery Protocol -> DEK lifecycle, dual-wrap architecture (§7.4 Storage Model, §3.1 Card 2 and Card 5)
- **Document R65:** Gallery Platform Security -> same-DEK rationale and combined-leak threat analysis (§3.14 Decryption-Key Architecture Rationale)
- **Document R71:** Gallery MVP Specification -> MVP scope boundary for whether cessation protocol ships at launch or post-MVP
- **Document P21:** Patent Analysis of Gallery -> prior identification of Lit Protocol gap for platform-liveness-gated release (§2.15)

**Analysis Code:**
- None. This is a design specification; cost and probability estimates are qualitative pending implementation.

**External References:**
All external sources cataloged in **Reference.txt** per REFERENCE_FORMAT.md. Cited entries include `arweave-2024` (Arweave permanence economics), `williams-2019` (Arweave protocol whitepaper), `lit-protocol` (Lit Protocol threshold-cryptography access control), `litprotocol-irys-integration` (Lit + permanent-storage integration pattern), `filecoin-2024` (Filecoin storage deal model), and `lighthouse-kavach-2024` (Kavach threshold-encryption SDK on Filecoin).

---

*Last Updated: 05/22/26 15:30*
