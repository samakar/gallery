# Mint Architecture Choice -- Vendor and Standard

Decision record for the deed-mint architecture: vendor choice (self-mint vs Crossmint) and Solana NFT standard (Metaplex Core / Bubblegum cNFT). Drives the R62 §4.3 Registry revision and informs the deferred deprecation of /docs/registry/crossmint_dispatch.md.

## 1. Requirements

R62 requirements that govern this decision (evidence from the 2026-06-02 Crossmint capability probe is at /crossmint_probe_result.json):

| Req | Statement |
|---|---|
| REQ-MINT-02 | Resale path with re-keying of `enc_final` and creator + platform royalty collection MUST be platform-mediated. Cryptographic enforcement (sealed `enc_final` + platform-mediated decryption) is acceptable; on-chain transfer-freeze is **not** required |
| REQ-MINT-03 | Per-owner-changing fields MUST NOT live in Arweave metadata. Specifically the buyer monogram stays in the platform DB and is rendered server-side at Share Copy generation time. Image-bound fields (`image_id`, `title`, `arweave_master_uri`, `sha256`, `phash`) DO live in Arweave metadata and on-chain as part of the deed's identity. |
| REQ-MINT-04 | Deed permanence MUST match the Arweave Master's permanence horizon (200 years). The asset_id MUST be embedded in the Master file at upload time so each Master is self-identifying; this requires reserving the cNFT asset_id before the Arweave upload, which is achieved via a per-tree mint mutex that serializes leaf_index assignment. A current-state proof (asset_id, current owner, current root, render timestamp, platform signature) MUST be embedded in each Share Copy at render time. A full tree-state snapshot MUST be uploaded to Arweave on a defined cadence to permit tree-wide reconstruction independent of DAS providers or Solana tx archive. |

REQ-MINT-02 is enforced cryptographically (sealed `enc_final` + protected-download path requiring authenticated platform session), not via an on-chain freeze plugin. This is the architectural shape that drives the cNFT decision in §3.5.

## 2. Crossmint Tradeoff

### 2.1 What Crossmint provides

| Capability | Coverage |
|---|---|
| Fiat-billed gas | Yes -- USD invoice; platform never holds SOL |
| Async mint queue + webhook | Yes |
| Stable single API for create / read / update / burn | Yes (probe Q2 confirmed PATCH 200 on Solana) |
| Per-project standard selection via API | No -- default cNFT only; uncompressed standards (Token Metadata / Core) gated behind a per-project support ticket (probe returned `Uncompressed minting for Solana is currently not activated for this project`) |
| Per-asset soulbound plugins | No -- the Solana path we have access to is plain Bubblegum cNFT |
| Platform-held update authority | No -- Crossmint's authority key signs all updates; not transferable to a platform key via API |
| Burn API | Refused on the default collection (`Burning is only supported on ... Solana Core Compressed and Aptos`) |

### 2.2 Evaluation vs requirements

| Req | Crossmint posture |
|---|---|
| REQ-MINT-02 | Mechanically achievable. Crossmint can PATCH metadata (probe Q2 = http 200), and a buyer-signed Bubblegum delegate at mint would let Crossmint's authority transfer the leaf on resale. Off-platform transfer remains technically possible but breaks decryption (the cryptographic backstop applies regardless of vendor). |
| REQ-MINT-03 | Mechanically achievable. The platform controls the metadata payload built and submitted to Crossmint at mint; the monogram is simply omitted from that payload. |

Crossmint is mechanically capable of meeting the requirements. The disqualifiers are governance and operational:

| Concern | Detail |
|---|---|
| Tree authority lock-in | Crossmint holds the cNFT tree authority. The platform cannot call `update_metadata_v1` directly or rotate the authority without Crossmint's API. Every deed_state mutation (rights-disputed, void, burned per INV-06) routes through Crossmint's queue + signing key, with no platform-side gating on the 3-of-5 approval workflow. INV-06 enforcement becomes "we asked Crossmint to sign," which is structurally weaker than self-mint procedural enforcement on a platform-controlled tree authority. |
| Per-project standard gating | Standard changes (collection migration, plugin adoption, uncompressed mode) require a Crossmint support ticket per project (probe returned `Uncompressed minting for Solana is currently not activated for this project`). The platform is coupled to Crossmint's roadmap and SLA. |
| Marginal fiat-billing benefit on cNFT economics | At cNFT marginal cost (~$0.001 per mint, see §3.3), a 100k-mint runway costs ~$100 of SOL. The fiat-billing convenience does not justify vendor lock-in at this scale. |
| Crossmint pricing on top of SOL | Per-mint margin on top of bare-chain cost. |

### 2.3 What is given up by removing Crossmint

| Loss | Magnitude at MVP |
|---|---|
| Fiat invoicing for gas | Replaced by a small SOL treasury (~1 SOL = $150-$200 initial; quarterly refill); accounting line item, immaterial at scale |
| Async queue + webhook infra | Already operating equivalents (stale-paid sweeper, build polling per ADR-0007) |
| Crossmint uptime / support response | Replaced by direct RPC dependency -- multiple providers (Helius, Triton, public RPCs), no per-project support tickets |
| One vendor-managed surface | Replaced by @metaplex-foundation/mpl-bubblegum SDK glue (Bubblegum V2) + the procedural-multisig admin tool for INV-06 gating |

### 2.4 Decision

Drop Crossmint. The architectural costs (tree authority lock-in, per-project standard gating, vendor pricing margin on top of bare-chain cost) outweigh the fiat-billing convenience -- particularly because the SOL treasury required to self-mint cNFTs is microscopic (~$100 for 100k mints). Existing /src/registry/crossmint_dispatch.ts remains in tree until the self-mint dispatcher lands; see Open Issues OI-05.

## 3. Standard Selection -- Core vs cNFT

### 3.1 Side-by-side

| Dimension | Metaplex Core | Bubblegum cNFT |
|---|---|---|
| Storage model | One Solana account per asset | Leaf in a shared Merkle tree |
| Per-mint rent | ~0.0017 SOL (~$0.30 at $175/SOL) | ~0 (tree rent ~0.05-0.2 SOL one-time, amortized across 16k-1M leaves) |
| Per-mint tx fee | ~0.000005 SOL | ~0.000005 SOL (Merkle proof adds compute; still negligible) |
| Rent recoverable on burn | Yes (returned to original payer) | n/a -- no per-leaf rent |
| Mint address knowable upfront | Yes -- asset keypair generated locally; pubkey = mint address before submission | Yes via serialization -- asset_id = derive(tree, leaf_index); leaf_index is the tree's current num_minted, predictable inside a per-tree mint mutex (REQ-MINT-04). Parallel mints would race; serialization holds. |
| Self-certifying file metadata for 200-year permanence | Same pattern works -- embed asset_address in Master + Share Copy at generation time | Same pattern works -- embed predicted asset_id at upload time after mutex acquires the leaf_index slot |
| Throughput ceiling under REQ-MINT-04 mutex | Unlimited (no serialization needed; keypair generated locally) | ~one mint per ~5-15s per tree under serial dispatcher; shard across multiple trees to scale horizontally |
| Read path | Standard Solana RPC OR DAS | DAS-RPC required (Helius / Triton / Shyft) |
| Metadata mutability scope | Per-asset (Immutable plugin OR default mutable) | Tree-wide (is_mutable set at tree creation; all leaves inherit) |
| Metadata update mechanism | updateV1 -- single signer, no proof needed | update_metadata_v1 -- requires current Merkle proof from DAS |
| Proof staleness on update | n/a | Concurrent tree ops invalidate proofs; retry-with-refetch logic required |
| Per-asset plugins | Yes -- Royalties, PermanentFreezeDelegate, PermanentTransferDelegate, FreezeDelegate, TransferDelegate, Immutable (set per asset) | Yes via Bubblegum V2 -- same plugin set, but applied at the MPL-Core Collection level (one config covers all leaves in the collection). Collection-level scope is uniform across all our deeds, which matches our policy: every deed is soulbound the same way. |
| Platform-mediated resale path (REQ-MINT-02) | Via on-chain freeze: PermanentFreezeDelegate(frozen=true) + PermanentTransferDelegate(authority=platform). Buyer cannot transfer at all. | Via Bubblegum V2 + MPL-Core Collection plugins: PermanentFreezeDelegate(frozen=true, authority=cold multi-sig) + PermanentTransferDelegate(authority=HOT_RESALE_KEY) set at collection creation. Chain reverts buyer-initiated transfers. Plus cryptographic backstop (`enc_final` sealed to owner) as defense in depth. No buyer-signed delegation needed at mint time. |
| Per-asset update authority | Yes (update_authority field per asset) | Tree authority controls all leaves -- a single platform-held key (HOT_OPS_KEY) governs every leaf, gated by the procedural-multisig admin tool for INV-06 ops |
| Burn instruction | burnV1 -- account closes, rent reclaims to payer | burn -- removes leaf; no rent to reclaim |
| Marketplace ecosystem maturity | Newer (current Metaplex focus); growing support across Magic Eden, Tensor | Older, very mature; ubiquitous support |
| SDK | @metaplex-foundation/mpl-core | @metaplex-foundation/mpl-bubblegum |

### 3.2 Evaluation vs requirements

| Req | Core | cNFT |
|---|---|---|
| REQ-MINT-02 (platform-mediated resale path) | Passes. On-chain enforcement: PermanentTransferDelegate makes platform the only entity that can transfer; buyer cannot. | Passes. On-chain enforcement via Bubblegum V2 + MPL-Core Collection plugins (PermanentFreezeDelegate + PermanentTransferDelegate at collection creation). Buyer-initiated transfer reverts at chain layer. Cryptographic `enc_final` sealing remains as defense in depth. |
| REQ-MINT-03 (per-owner-changing fields off-Arweave) | Passes. Platform controls the metadata JSON written at mint; monogram is simply omitted and rendered server-side. | Passes. Same -- platform controls the metadata JSON. |

### 3.3 Cost model under permanence assumption

Deeds are constitutional receipts of permanently-stored Masters per INV-01. Burn is rare and governance-gated (rights-disputed -> void -> burned per INV-06). The Core rent deposit is therefore an effective expense, not recoverable working capital.

| Cumulative deeds | Core rent expense ($175/SOL) | cNFT rent expense |
|---|---|---|
| 1,000 | ~$300 | ~$10 (tree + small overhead) |
| 10,000 | ~$3,000 | ~$15 |
| 100,000 | ~$30,000 | ~$50 (multiple trees as primary fills) |
| 1,000,000 | ~$300,000 | ~$500 |

At 1M-deed scale Core is ~600x more expensive in absolute terms. Per-deed economics matter most at the entry price tier: at $20 deed price and Stripe-off-the-top revenue split (creator 90% / platform 10% of net), Solana rent on Core consumes ~16% of platform's share. At $50+ deeds it fades to ~6%. cNFT is essentially free on this axis.

### 3.4 Mint Latency

Total wall-clock time from "buyer clicks Mark my image" to full Arweave-permanent state. The buyer is not actively waiting at this moment per ADR-0007 -- the wizard has closed; the owner-state page renders "Issuing your deed..." while everything runs async. The relevant metric is total time to deed-visible-in-Collection.

| Stage | Crossmint (today, baseline) | Self-mint Core (Path 4) | Self-mint cNFT (Path 4) |
|---|---|---|---|
| Acquire per-tree mint mutex + read tree num_minted | n/a | n/a (asset keypair generated locally) | <50ms |
| Predict asset_id + build metadata JSON + Master with embedded provenance manifest | n/a | <100ms | <100ms |
| Cloudinary Master + variants compose | 2-10s | 2-10s (parallel) | 2-10s (parallel) |
| Arweave Turbo upload (10 MB encrypted Master + metadata JSON, both already include asset_id) | 5-30s | 5-15s | 5-15s |
| Submit mint tx to Solana with permanent Arweave URI | n/a (Crossmint queue) | 100-300ms | 100-300ms |
| Crossmint queue + chain settlement | 20-30s (probe Q1 measured ~28s) | n/a | n/a |
| Solana `confirmed` commitment | n/a | 1-2s | 1-2s |
| Verify real asset_id matches predicted (cNFT only) | n/a | n/a | <50ms |
| Release mint mutex (cNFT only) | n/a | n/a | <10ms |
| **Total to Arweave-permanent + deed-visible** | **~30-70s** | **~6-17s** | **~6-17s** |

Two takeaways:
- Self-mint cuts total time from ~30-70s (Crossmint baseline measured in the probe) to ~6-17s -- the Arweave upload dominates the wall-clock; chain settlement is 1-2s.
- Path 4 eliminates the previous hybrid pattern's second Solana tx (URI swap) and its DAS proof fetch + retry-on-stale logic. cNFT and Core land at the same total latency under Path 4 because the mint mutex serialization cost is amortized below the Arweave bottleneck.

### 3.5 Decision

Adopt **Bubblegum cNFT, self-minted**. Cryptographic enforcement via sealed `enc_final` + buyer-signed transfer-delegation at mint is sufficient for REQ-MINT-02; REQ-MINT-03 is satisfied by omitting the monogram from the metadata payload at mint and rendering it server-side. cNFT economics save ~16% of platform gross share at the $20 entry deed tier (rising to absolute savings of ~$300k at 1M-deed scale vs Core).

Core is documented as the alternative if a future requirement hardens REQ-MINT-02 to "on-chain transfer-freeze required" -- e.g., a regulatory regime demanding chain-readable enforcement of non-transferability, or a marketplace integration where off-platform-broken-deeds damages brand. Switching to Core requires re-mint policy + cohort migration (see Open Issues OI-06).

## 4. Resulting Architecture

| Concern | Implementation |
|---|---|
| Standard | Bubblegum V2 compressed NFT (cNFT) grouped under an MPL-Core Collection |
| Collection | One platform-managed MPL-Core Collection holding the cNFTs. Created once with `PermanentFreezeDelegate(frozen=true, authority=COLD_RECOVERY_KEY)` + `PermanentTransferDelegate(authority=HOT_RESALE_KEY)` + `Royalties(creators=[creator 90%, platform 10%])` plugins. Collection `update_authority = COLD_RECOVERY_KEY`. Plugins are collection-level under Bubblegum V2 and are *permanent* -- the soulbound posture is structurally locked at creation, not maintained by ongoing key custody. |
| Tree | One platform-managed Merkle tree under the collection (depth 14 -> 16,384 leaves; cost ~0.05 SOL). Roll a new tree per `tree_full` capacity event. At higher volume, shard mints across multiple trees (single collection or multiple) to scale beyond single-mutex throughput per OI-13. |
| Mint mutex (REQ-MINT-04) | Per-tree backend mutex held across the Path 4 reservation -> Arweave-upload -> Solana-mint window. Implementation: in-process for single-instance API; distributed lock (Redis / DB row lock) for multi-instance. Mutex hold window is dominated by Arweave upload (~5-15s) so observed throughput ceiling per tree is ~4-12 mints/minute. |
| Mint flow (Path 4 -- reserve asset_id, embed, mint once) | (1) Acquire per-tree mint mutex; (2) read tree `num_minted` -> predict leaf_index; (3) derive predicted_asset_id; (4) build Master file + Arweave metadata JSON with embedded provenance manifest (asset_id, sha256, phash, tree_root_at_mint_time, platform signature); (5) upload encrypted Master + metadata JSON to Arweave -> permanent `arweave_uri`; (6) submit `mint_v1` with `uri = arweave_uri`; (7) verify actual asset_id matches predicted (~always true if mutex held; rare race triggers re-derive + Arweave re-upload); (8) release mutex. |
| Mint signer | HOT_MINT_KEY -- single hot keypair; pays tx fees (~0.000005 SOL/mint); set as tree delegate by tree authority at tree creation; can mint new leaves but cannot transfer existing leaves or modify tree config |
| Tree authority | HOT_OPS_KEY (warm, server-held) -- can `update_metadata_v1` on any leaf; can `set_tree_delegate`. Enables routine metadata updates (`enc_final` re-key on resale, deed_state edits). INV-06 metadata-mark operations (deed_state void) gated by the procedural-multisig admin tool (3-of-5 ops approvals logged with each approver's signature) before HOT_OPS_KEY signs the on-chain tx. |
| Collection `PermanentFreezeDelegate.authority` | COLD_RECOVERY_KEY. Default state at mint: every leaf inherits `frozen=true` from the collection. The plugin itself is permanent (structural soulbound enforcement); the authority is invoked only for edge-case defensive thaw, never in routine operation. May optionally be destroyed after collection creation to make soulbound truly unrotatable -- see OI-04. |
| Collection `PermanentTransferDelegate.authority` | HOT_RESALE_KEY (warm, server-held). Bypasses freeze for routine resale transfers; single tx per resale; no buyer signature needed at any point in the resale flow. |
| Collection `update_authority` | COLD_RECOVERY_KEY. Used only to rotate warm-key plugin authorities (HOT_OPS_KEY / HOT_RESALE_KEY) if compromised. |
| Emergency posture | Single COLD_RECOVERY_KEY (hardware wallet, offline, designated officer custody). Can rotate any warm key by updating the relevant collection plugin authority. Routine ops never touch this key. |
| On-chain leaf `name` (Bubblegum required ≤32 bytes) | `"Epimage #<image_id>"` -- image_id is part of the deed's identity per REQ-MINT-03 |
| On-chain leaf `symbol` | `"EPIM"` |
| On-chain leaf `uri` | Provisional API endpoint at mint, swapped to `ar://<arweave_tx_id>` after Arweave finalizes |
| Arweave metadata JSON (publicly readable -- image-identity fields per REQ-MINT-03 + per REQ-MINT-04 manifest) | `asset_id` (the cNFT asset_id reserved at mint time per Path 4); `image_id`; `title`; `creator_display_name`; `creation_date`; `arweave_master_uri` (encrypted Master location); `enc_final` (sealed DEK for current owner; re-keyed on resale via `update_metadata_v1`); `sha256` (Master canonical-pixels hash); `phash` (perceptual hash); `tree_root_at_mint_time`; `mint_tx_signature`; `platform_signature` (ed25519 attestation by the platform signing key over the above fields); `license_signing_event_id` (audit reference) |
| Embedded provenance manifest in Master file (REQ-MINT-04) | EXIF/XMP entries inside the encrypted Master before Arweave upload: `asset_id`, `sha256`, `phash`, `tree_pubkey`, `tree_root_at_mint_time`, `mint_timestamp`, `platform_signature`. C2PA-compatible shape per /docs/deferred/drm_c2pa.md so future C2PA adoption inherits the structure. |
| Embedded ownership manifest in Share Copy (REQ-MINT-04, render-time) | Added at every Share Copy generation: `asset_id`, `current_owner_wallet`, `current_tree_root`, `current_merkle_proof`, `render_timestamp`, fresh `platform_signature`. Buyer's Share Copy carries a moment-in-time ownership snapshot. |
| Tree-state snapshot to Arweave (REQ-MINT-04, periodic) | Full tree serialization (all leaves + structure + Merkle root) uploaded to Arweave with platform tag, defined cadence per OI-12. Permits tree-wide reconstruction independent of DAS providers or Solana tx archive. |
| Platform DB only (NOT in chain or Arweave, per REQ-MINT-03) | `monogram_text` (per current owner; changes on resale -- avoids chain history of prior owners' letters and avoids `update_metadata_v1` per ownership change). Rendered into the Share Copy bytes server-side at request time from the current-owner DB record. |
| Re-keying scope on resale | Single `update_metadata_v1` updates `enc_final` to a new sealed-box bound to the new buyer's wallet pubkey. All image-identity fields stay unchanged across resales. |
| Read path | DAS-RPC required (Helius / Triton / Shyft) for `getAsset(asset_id)`, `getAssetsByOwner(buyer_wallet)`, and proof fetches for updates |
| Compromise blast radius (HOT_MINT_KEY) | Attacker can mint junk leaves to attacker wallet, drain SOL float (~1 SOL = ~$200). Cannot transfer or modify existing deeds. Rotate via tree authority. |
| Compromise blast radius (HOT_OPS_KEY / tree authority) | Attacker can update metadata on any leaf (could break `enc_final` references); can rotate tree delegate. Cannot transfer leaves (transfer delegate is HOT_RESALE_KEY, separate); cannot thaw soulbound (freeze authority is COLD_RECOVERY_KEY, separate). Detected via Pino logs + chain monitoring; rotate via COLD_RECOVERY_KEY signing a collection-authority update of HOT_OPS_KEY. |
| Compromise blast radius (HOT_RESALE_KEY / PermanentTransferDelegate authority) | Attacker can transfer leaves between wallets. Cannot re-key `enc_final` (requires HOT_OPS_KEY for `update_metadata_v1`) -- so even attacker-redirected ownership produces non-functional deeds. Master stays cryptographically safe. Rotate via COLD_RECOVERY_KEY updating the collection's PermanentTransferDelegate authority. |
| Compromise blast radius (COLD_RECOVERY_KEY) | Attacker can rotate any warm key, can thaw soulbound (if freeze authority not destroyed). Catastrophic -- but the key lives offline on a hardware wallet, not exposed to server compromise. Loss (rather than compromise) is more likely; recovery procedure documented per OI-04. |

## 5. Open Issues

> **MVP scope reminder.** Items below are tagged `[MVP]` (must ship for MVP launch), `[POST-MVP]` (deferred -- needed before specific future events occur, not before MVP), or `[OPERATIONAL]` (production-deploy hardening, not feature work). At MVP the architecture runs with single keypairs all the way down (HOT_MINT_KEY / HOT_OPS_KEY / HOT_RESALE_KEY / COLD_RECOVERY_KEY) -- **no on-chain multisig (Squads) and no procedural-multisig admin tool are needed at MVP** because the INV-06 trigger events (rights-disputed / void / burned) only occur when takedowns or resale-driven disputes happen, both of which are themselves out of MVP scope.

| ID | Issue |
|---|---|
| OI-01 | **[POST-MVP]** Procedural-multisig admin tool: scope of operations gated, approval UI, signature requirements per approver (ed25519 signed event over a canonical operation-description payload), audit log persistence format (tamper-evident; e.g., signed append-only log with periodic Merkle-root anchoring to Arweave). Owner: TBD. Needs to ship before the first INV-06 event (rights-disputed / void / burned) occurs in production -- not before MVP launch, because takedowns and resale are also out of MVP scope. Until then, single-key HOT_OPS_KEY signs all metadata updates server-side. |
| OI-02 | **[MVP]** DAS-RPC dependency. cNFT updates require DAS for proof fetching (any leaf-state mutation). Vendor list (Helius / Triton / Shyft), failover policy, ops escalation if a provider degrades. Single-provider (public devnet) is acceptable for MVP; multi-provider failover is post-MVP. |
| OI-03 | **[OPERATIONAL]** SOL treasury operational posture -- top-up cadence, page threshold (e.g., balance < 0.05 SOL on HOT_MINT_KEY or HOT_RESALE_KEY), accounting line item. For cNFT economics this is microscopic (~$100 for 100k mints). Production-deploy concern, not MVP feature work. Owner: ops. |
| OI-04 | **[OPERATIONAL]** COLD_RECOVERY_KEY custody. Single hardware wallet (Ledger / Trezor) held by a designated officer; offline storage with documented physical-access protocol. At MVP the cold key is a server-held keypair like the others (acceptable for dev/staging). Production deploy requires hardware-wallet custody. Key-loss recovery: there is none -- if lost, the platform loses rotation power over plugin authorities. Mitigation options: (a) destroy the freeze authority intentionally after collection creation so loss only impacts rotation power for transfer/tree authorities, not soulbound enforcement; (b) Shamir-split the cold key seed across 3 officers (any 2 reconstruct); (c) keep a separate, equally-cold backup key registered as a secondary update_authority. Recommended (a) + (b). |
| OI-05 | RESOLVED 2026-06-03: /src/registry/cnft_dispatch.ts shipped; first end-to-end mint succeeded on devnet. Retired /src/registry/crossmint_*.ts + /docs/registry/crossmint_*.md moved to /trash/ (delete after R62 + R71 spec-text alignment per /docs/registry/r62_r71_alignment.md). Post-mint helpers extracted to /src/registry/post_mint.ts. |
| OI-06 | RESOLVED 2026-06-03 by wipe: existing Crossmint-issued data was test-only (no real users at migration time) and was deleted via scripts/wipe_existing_deeds.ts. Migration policy moot for the actual cutover cohort; the policy options (grandfather vs burn-and-remint) remain documented here as the reference for any future vendor migration. |
| OI-07 | **[POST-MVP]** Tree-capacity rollover policy. A depth-14 Bubblegum tree holds 16,384 leaves; the dev/staging tree at depth-10 holds 1,024. At sustained MVP volume, capacity exhaustion is months-to-years away, but the rollover ceremony (create new tree, switch HOT_MINT_KEY's tree delegate target, retire the old tree) needs to be specified before it becomes urgent. Existing deeds stay in their original tree forever (or until the tree is closed). |
| OI-09 | **[MVP -- decided]** Tree-wide `is_mutable` posture. Bubblegum's mutability is tree-level. We need mutability for routine metadata updates (`enc_final` re-key on resale, deed_state edits) -- so trees must be `is_mutable: true`. Path 4 eliminates the URI-swap mutation but the resale re-key mutation still requires it. Implication: no per-leaf immutability option for buyers who might want it as a guarantee. Documented limit vs Core's per-asset Immutable plugin. |
| OI-10 | **[MVP]** Mint-mutex implementation -- in-process Node mutex shipped, sufficient for single-instance MVP. **[POST-MVP]** distributed lock (Redis SETNX with TTL, Postgres advisory lock, dedicated single-writer dispatcher service) when scaling to multi-instance. Race detection on step 7 of Path 4 must be observable in Pino logs; rare-race orphan upload handling per OI-11. |
| OI-11 | **[MVP]** Race-detection failure handling. If step 7 of Path 4 finds real_asset_id != predicted_asset_id (another mint slipped in between predict and submit), the Master upload to Arweave is orphaned (cost ~$0.07 per orphan). Options: (a) accept the orphan, re-derive asset_id from the actual leaf_index, re-upload Master with corrected manifest, mint succeeds with the second URI; (b) hard-rollback by burning the leaf and starting over (constitutional cost: deed_state must touch burn). Recommended (a) for MVP. Note: race is functionally impossible at MVP under the single-instance in-process mutex; this OI matters only post-distributed-lock. |
| OI-12 | **[POST-MVP]** Tree-state snapshot cadence under REQ-MINT-04 (embedded provenance manifest + Arweave snapshots are post-MVP -- the deed exists and is provable on-chain without snapshots). Options when ready: per-event (every mint/transfer/update writes its own Arweave entry; no gap; ~$0.0001 per event), daily (bounded 1-day gap; ~$11/year), weekly (~$1.50/year). Recommended per-event for clean per-asset 200-year story; revisit if Arweave op count becomes a bottleneck. |
| OI-13 | **[POST-MVP]** Tree sharding policy for throughput beyond single-mutex capacity. Single tree under Path 4 mutex caps at ~4-12 mints/minute (Arweave-bound). At sustained MVP volume this ceiling is unreachable; sharding is purely a scale concern. When needed: distribute mints across N trees with per-tree mutex; consistent-hash by image_id or round-robin. Trees stay independent; existing deeds never need migration. |
| OI-14 | **[POST-MVP]** Platform signing key for embedded provenance manifest -- only relevant once REQ-MINT-04 embedded manifests are implemented (post-MVP). PROVENANCE_SIGNER_KEY held server-side, separate from HOT_MINT_KEY / HOT_OPS_KEY / HOT_RESALE_KEY. Compromise blast radius: attacker can forge provenance manifests on new files but cannot affect on-chain state. Rotation policy + public-key publication path (so 200-year verifiers can find the historical pubkey). |

## 6. Cross-References

| Doc | Relation |
|---|---|
| /docs/R62_Gallery_Protocol.md §4.3 | Architecture this doc updates -- Crossmint references retired; self-mint Bubblegum V2 cNFT + MPL-Core Collection (PermanentFreezeDelegate + PermanentTransferDelegate plugins) + DAS-RPC added. R62 deed metadata schema MUST be revised to remove `monogram_text` from the Arweave object (REQ-MINT-03 -- per-owner field, rendered server-side); image-identity fields (`image_id`, `title`, `creator_display_name`, `creation_date`, etc.) remain in the Arweave object as before. |
| /docs/R71_Gallery_MVP_Specification.md §3.7 | Vendor list -- Crossmint removed; Helius/Triton DAS-RPC added; small SOL treasury line (~$100/100k mints) added |
| /docs/registry/crossmint_dispatch.md | Historical context; superseded by /docs/registry/cnft_dispatch.md (TBD per OI-05) |
| /docs/registry/crossmint_lookup.md, /docs/registry/crossmint_webhook.md | Same deprecation status as crossmint_dispatch.md |
| /docs/divergences.md | Divergence entry: shipped implementation uses Crossmint-managed cNFT; self-mint cNFT dispatcher pending per OI-05 |
| /docs/adr/adr_0001 | Build dispatch decoupled from Stripe webhook -- applies; stale-paid sweeper drives `mint_v1` via HOT_MINT_KEY (tree delegate) |
| /docs/adr/adr_0007 | Buyer-friendly retry model -- applies; sweeper retries `mint_v1` and the follow-on `update_metadata_v1` to swap URI to permanent Arweave URI |
| CLAUDE.md INV-01 | The image is the asset; the deed is the receipt -- preserved under cNFT because the buyer's wallet holds the leaf on-chain; off-platform transfer is technically possible but breaks decryption and is self-defeating |
| CLAUDE.md INV-06 | 3-of-5 multi-sig for rights-disputed/void/burned -- procedurally enforced via the admin tool described in OI-01: 3-of-5 ops approvers each sign the operation payload off-chain, HOT_OPS_KEY signs the on-chain `update_metadata_v1` (or burn) only after the threshold is met, and the signed approvals are appended to a tamper-evident audit log. Soulbound enforcement is structural via Bubblegum V2 permanent plugins; freeze authority is rarely or never invoked. |
| CLAUDE.md INV-10 | deed_state transitions total -- enforced platform-side via tree authority + audit log; OI-01 procedural admin tool is the source of truth for whether a transition was authorized |
| /crossmint_probe_result.json | Empirical evidence supporting §2.1 / §2.2 (saved 2026-06-02) |

---
*Last Updated: 26/06/03 16:10*
