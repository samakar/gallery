# ADR-0008 -- Self-Mint Bubblegum V2 cNFT, Path 4

## Status

Accepted (2026-06-03).

## Context

R71 §3.7 and R62 §1 / §2.3 / Card 5 / §4.5 specify Crossmint Minting API as the deed-mint vendor. The shipped implementation (/src/registry/crossmint_dispatch.ts) mints plain Bubblegum cNFT (V1) under Crossmint-controlled tree authority. This was the operative path until 2026-06-02, when two things changed:

1. **Capability probe** of the Crossmint staging account (raw probe + result retained locally at /sandbox/crossmint_capability_probe.cjs + /sandbox/crossmint_probe_result.json; sandbox is gitignored per the investigation-files rule) confirmed:
   - Default Solana standard = plain Bubblegum cNFT (probe Q1)
   - Burn refused on default collection ("only on EVM, Solana Core Compressed, and Aptos")
   - Uncompressed minting requires a per-project support ticket ("Uncompressed minting for Solana is currently not activated for this project")
   - Update authority = Crossmint's, not transferable to a platform key via API
2. **Bubblegum V2** shipped collection-level permanent plugins (PermanentFreezeDelegate + PermanentTransferDelegate via MPL-Core Collection), closing the on-chain soulbound enforcement gap that originally made Crossmint the simplest path.

The combination forced an architectural reconsideration. The full analysis is in /docs/registry/deed.md.

## Decision

Adopt **self-mint Bubblegum V2 cNFT under a platform-owned MPL-Core Collection, using the Path 4 sequence**.

Specifically:

- **Standard**: Bubblegum V2 compressed NFT grouped under an MPL-Core Collection.
- **Vendor**: none. Drop Crossmint. Mint directly via `@metaplex-foundation/mpl-bubblegum` SDK with HOT_MINT_KEY (server-held tree delegate) paying SOL gas.
- **Soulbound enforcement**: Collection-level `PermanentFreezeDelegate(frozen=true, authority=COLD_RECOVERY_KEY)` + `PermanentTransferDelegate(authority=HOT_RESALE_KEY)`. Buyer cannot transfer; platform can. Soulbound posture is structural via the permanent plugin -- locked at collection creation, cannot be removed.
- **Mint sequence (Path 4)**: Per-tree mutex reserves asset_id by predicting `leaf_index = tree.num_minted` and deriving `asset_id = deriveBubblegumAssetId(tree, leaf_index)`. Arweave upload completes before mint. Single `mint_v1` instruction submits with `uri = permanent_arweave_uri`. No two-phase URI swap.
- **Authority custody**: HOT_MINT_KEY (mint only), HOT_OPS_KEY (tree authority for `update_metadata_v1`), HOT_RESALE_KEY (PermanentTransferDelegate), single COLD_RECOVERY_KEY (collection update_authority + freeze authority; offline hardware wallet, used only for emergency rotation), PROVENANCE_SIGNER_KEY (ed25519 attestation for embedded manifests).
- **INV-06 enforcement**: Procedural multisig admin tool collects 3-of-5 ops approvals before HOT_OPS_KEY signs on-chain. NOT an on-chain Squads program at MVP. CLAUDE.md INV-06 codifies this. Migration to on-chain Squads is an ADR-gated future amendment.
- **200-year permanence (REQ-MINT-04)**: Embedded provenance manifests in the encrypted Master (at upload) and in each Share Copy (at render) plus per-event Arweave tree-state snapshots. The deed's persistence horizon equals the Arweave permanence horizon (~200 years), not Solana's.
- **REQ-MINT-03 (per-owner-changing fields off-Arweave)**: Monogram stays in the platform DB, rendered server-side at Share Copy generation. Image-identity fields (image_id, title, creator_display_name, creation_date, arweave_master_uri, enc_final, sha256, phash, license_signing_event_id) live in Arweave metadata and on-chain.

## Consequences

### Positive

- INV-06 enforceable per the constitution's literal text. With Crossmint, every freeze / void / burn operation was Crossmint-signed; "3-of-5 multi-sig" was impossible to satisfy because one vendor signed everything. Self-mint with the procedural admin tool gating HOT_OPS_KEY satisfies INV-06.
- Soulbound + platform-mediated resale become chain-readable via the Bubblegum V2 collection plugin stack rather than relying on cryptographic backstop alone.
- Mint latency drops from ~30-70s (Crossmint queue + chain settlement, probe-measured ~28s for chain alone) to ~6-17s (self-mint Path 4, Arweave-bound).
- Cost economics: ~$0.001 per mint marginal cost vs Crossmint's vendor margin on top of bare-chain cost. At 1M deeds, hundreds of thousands of dollars saved.
- Standard-selection sovereignty: any future Bubblegum / Core / new-Metaplex-primitive change is a code update, not a Crossmint support ticket.
- No vendor uptime dependency for the mint path.

### Negative

- Operational responsibility: the platform now manages a SOL float (~1 SOL covers ~200k mints; microscopic but real). Treasury accounting per /docs/registry/deed.md OI-03.
- DAS-RPC dependency for proof fetching on `update_metadata_v1` and Collection reads (`getAssetsByOwner`). Multiple providers exist (Helius / Triton / Shyft); failover policy per deed.md OI-02.
- The shipped Crossmint cNFT implementation produces deeds in a Crossmint-controlled tree. Migration of those deeds is OI-06 in deed.md -- options range from grandfathered-cohort to burn-and-remint.
- New code surface: ~150 lines of @metaplex-foundation/mpl-bubblegum SDK glue + per-tree mutex management + Arweave snapshot writer + embedded provenance manifest builder + procedural multisig admin tool.

### Operational obligations

- Pino log lines per mint: `cnft.dispatch` with image_id, asset_id, tree_pubkey, leaf_index, arweave_uris, mint_tx_signature.
- Alert threshold: HOT_MINT_KEY SOL balance < 0.05 SOL pages the on-call.
- COLD_RECOVERY_KEY recovery procedure documented; key custodian rotation policy in OI-04.
- Procedural admin tool's audit log must be reviewed quarterly; periodic Merkle-root anchoring to Arweave.

## Boundary conditions

| Condition | Outcome |
|---|---|
| Buyer mints successfully via path 4 | Single mint_v1 tx with permanent Arweave URI from birth. Asset_id known at the moment of mint construction; available in `deeds` table and in Share Copy embed at render. |
| Arweave Turbo returns 402 mid-mint | ARWEAVE_UPLOAD_FAILED; mutex released; stale-paid sweeper retries per ADR-0007. |
| Solana RPC unavailable | MINT_SUBMIT_FAILED; sweeper retries. |
| Race detected (predicted asset_id != observed) | Re-derive from observed leaf_index; re-upload metadata to Arweave with corrected asset_id; resubmit mint. First Arweave upload is orphan. |
| HOT_MINT_KEY compromised | Attacker can spam-mint junk; cannot touch existing deeds. Rotate HOT_MINT_KEY via COLD_RECOVERY_KEY signing a `set_tree_delegate` update. |
| HOT_OPS_KEY compromised | Attacker can update metadata on any leaf. Cannot transfer or thaw. Rotate via COLD_RECOVERY_KEY updating the tree authority. |
| HOT_RESALE_KEY compromised | Attacker can transfer leaves. Cannot re-key enc_final (HOT_OPS_KEY-gated). Masters stay cryptographically bound to original buyers; attacker-redirected ownership produces non-functional deeds. Rotate via COLD_RECOVERY_KEY updating PermanentTransferDelegate.authority. |
| COLD_RECOVERY_KEY lost (not compromised) | No rotation possible. Mitigations: (a) destroy freeze authority intentionally after collection creation so loss only impacts rotation power for transfer/tree authorities; (b) Shamir-split the cold key seed across 3 officers (any 2 reconstruct). |

## Rejected alternatives

| Option | Why rejected |
|---|---|
| Keep Crossmint | INV-06 unenforceable at the protocol level (Crossmint signs everything). Standard-selection gated by support tickets. Authority rotation impossible without Crossmint cooperation. Cost margin on top of bare-chain. |
| Self-mint Metaplex Core | Per-asset rent at ~0.0017 SOL (~$0.30 per deed at $175/SOL) -- under the 200-year permanence requirement (REQ-MINT-04 in deed.md), this is real expense (rent is not recoverable for deeds we never burn). At 1M deeds = ~$300k. cNFT amortizes rent in one tree at ~$10-50 total. With Bubblegum V2 closing the soulbound gap, Core's only remaining advantage was per-asset plugin granularity, which our use case doesn't need (all deeds have identical policy). |
| Self-mint Bubblegum V1 (pre-V2 plugins) | Cannot enforce soulbound on-chain at leaf level. Would have required either platform-escrow (breaks INV-01) or burn-and-remint on resale (operational complexity) or relying on the buyer-signed `delegate` instruction at mint (revocable, fragile). V2 supersedes this entirely. |
| On-chain Squads multi-sig for INV-06 | High operational cost (5 hardware wallets, 5 humans coordinating per freeze event, member rotation ceremonies) for marginal benefit at MVP. Procedural admin tool + tamper-evident log satisfies INV-06's literal text. Squads remains the forward path for scale or regulated cohorts; migrating the freeze authority pubkey is a single tx if/when needed. |
| Two-phase URI swap (mint with provisional URI, then update_metadata_v1 to swap to Arweave) | Path 4 makes the mint a single tx, eliminates one Solana fee, eliminates the DAS proof fetch + retry-on-stale logic at mint time, and removes the intermediate state where the on-chain URI dereferences to our API endpoint rather than Arweave. ~3s wall-clock saved + meaningful code-surface reduction. |

## Implementation pointers

| Surface | File | Function |
|---|---|---|
| Self-mint dispatcher (target) | /src/registry/cnft_dispatch.ts (TBD) | `dispatch(...)` per /docs/registry/deed.md §1.1 |
| Embedded provenance manifest builder | /src/cert/provenance_manifest.ts (TBD) | sign + embed in Master EXIF/XMP; sign + embed in Share Copy at render |
| Arweave snapshot writer | /src/registry/arweave_snapshot.ts (TBD) | per-event Arweave object uploads with platform tag |
| Procedural multisig admin tool | /src/cert/rights_admin.ts (TBD) + UI | 3-of-5 approval workflow with ed25519-signed audit log |
| Existing Crossmint dispatcher | /src/registry/crossmint_dispatch.ts | SUPERSEDED -- remains until cnft_dispatch.ts ships |
| Existing Crossmint webhook | /src/registry/crossmint_webhook.ts | SUPERSEDED |
| Existing Crossmint lookup | /src/registry/crossmint_lookup.ts | SUPERSEDED |

## Related

| Doc | Why |
|---|---|
| /docs/registry/deed.md | Authoritative architecture analysis behind this decision |
| /docs/registry/deed.md | Self-mint dispatcher SDD |
| /docs/r62_r71_alignment.md | Pending edits to R62 and R71 that follow from this decision |
| /docs/divergences.md D-14 | Records the shipped-vs-target gap until cnft_dispatch.ts ships |
| CLAUDE.md (Invariants section) | INV-06 (procedural multisig) maps to this ADR's enforcement model. INV-11 and INV-12 are NOT in the operative invariants list -- they were drafted in an earlier constitution stub and intentionally not promoted; INV-12 (Bubblegum V2 standard) is recorded as a decision in this ADR rather than as an invariant, and INV-11 (200-year permanence) lives in deed.md REQ-MINT-04 |
| /docs/registry/crossmint_dispatch.md | Predecessor (SUPERSEDED) |
| /docs/registry/crossmint_lookup.md, /docs/registry/crossmint_webhook.md | Predecessor (SUPERSEDED) |
| ADR-0001 | Build dispatch decoupled from Stripe webhook -- continues to apply; dispatch target shifts from Crossmint to the self-mint dispatcher |
| ADR-0007 | Buyer-friendly retry model -- continues to apply; sweeper retries the self-mint dispatcher |
| ADR-0005 | phash in deed -- continues to apply; phash remains in deed metadata under the new schema |
| /sandbox/crossmint_probe_result.json (gitignored; retained locally) | Empirical evidence supporting the Crossmint disqualification; key findings inlined in Context §1 above |

---

*Last Updated: 26/06/12 20:45*
