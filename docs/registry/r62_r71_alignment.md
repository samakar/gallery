# R62 + R71 Alignment to deed.md

Captured list of surgical edits R62 and R71 require to align with the decision recorded in /docs/registry/deed.md (consolidated 2026-06-07: Bubblegum V2 cNFT, self-mint, Path 4, embedded provenance manifest, procedural multisig). No edits applied yet -- this doc exists so the alignment work can be staged and reviewed.

Each row gives the file, the location (section or line), the current text, and the replacement. Edits are mechanical except where flagged "DECIDE FIRST" (architectural choices captured in /docs/registry/deed.md but not yet reconciled into the older spec text).

## 1. R62 Edits

### 1.1 Mechanical

| Ref | Find | Replace |
|---|---|---|
| §1 line 29 | `Deed (Solana pNFT)` | `Deed (Bubblegum V2 cNFT under MPL-Core Collection)` |
| §1 line 31 | `Solana, Arweave, wallet, Crossmint, the on-chain doubly-nested encryption` | `Solana, Arweave, wallet, the on-chain doubly-nested encryption` (Crossmint removed) |
| §2.3 (Master Image paragraph, around line 142) | `via the Metaplex Core UpdateDelegate plugin` | `via Bubblegum V2 update_metadata_v1 signed by HOT_OPS_KEY (procedural-multisig gated per deed.md OI-01)` |
| §3.1 Card 5 (line 237) | `Issues the deed directly to the buyer's wallet via the Crossmint API (single-step deed issuance)` | `Issues the deed to the buyer's wallet via Bubblegum V2 mint_v1 signed by HOT_MINT_KEY (tree delegate). Single Solana tx per Path 4: asset_id reserved under per-tree mutex; Arweave upload completes before mint; mint posts with the permanent Arweave URI` |
| §3.1 Card 8 (line 240) | `writes the new enc_final to deed metadata via the Metaplex Core UpdateDelegate plugin` | `writes the new enc_final to deed metadata via Bubblegum V2 update_metadata_v1 signed by HOT_OPS_KEY` |
| §3.5.1 line 371 | `authorized platform multi-sig signer` | `the platform tree authority (HOT_OPS_KEY) signing after the procedural-multisig admin tool collects 3-of-5 ops approvals per deed.md OI-01` |
| §4.5 line 552 column header | `Stripe + Crossmint + Backend` | `Stripe + Backend` |
| §4.5 line 552 body | `Card 5 DEED transfers the deed to the new buyer via the Metaplex Core transfer plugin` | `Card 5 DEED transfers the deed to the new buyer via the Collection PermanentTransferDelegate signed by HOT_RESALE_KEY (Bubblegum V2 collection plugin; bypasses freeze)` |
| §4.5 line 552 body | `writes the new enc_final to deed metadata via Metaplex Core UpdateDelegate` | `writes the new enc_final to deed metadata via Bubblegum V2 update_metadata_v1 signed by HOT_OPS_KEY` |
| §3.5.1 + everywhere `opened` appears as a deed_state value | `opened` | `unsealed` (R71 / deed.md rename for clearer sealed ↔ unsealed symmetry; semantics unchanged -- deed-holder Master extraction marks the column) |
| §3.5.1 + everywhere `rights-disputed` / `rights_disputed` appears as a deed_state value | `rights-disputed` (hyphen) / `rights_disputed` (underscore) | `disputed` (R71 / deed.md rename: drop the "rights" prefix; the dispute could be DMCA, RoP, Take It Down Act, or court-ordered, not necessarily a rights claim; semantics unchanged -- dispute-in-progress state pending 3-of-5 multi-sig adjudication) |
| §3.5.1 deed-state model: single column with values `sealed`/`opened`/`rights-disputed`/`void`/`burned` | Single state machine conflating custody (what platform can do) and legal (adjudication outcome) | Split into **two orthogonal state machines** per deed.md §2.3: **custody_state** = `sealed` → `unsealed` → `burned` (terminal); **legal_state** = `legit` → `disputed` → `void` (terminal). Voluntary owner-burn lives naturally on the custody axis (custody → burned; legal stays `legit`) without faking a dispute. Adjudicated terminations: legal `legit → disputed → void`, then sweeper transitions `custody → burned` after per-reason compliance hold (CSAM 90d, DMCA 14d, RoP 14d, Take It Down Act 0d, court order per order, criminal seizure per LE, regulatory per regulator, voluntary 0d). Cloudinary source + derivatives, local encrypted Master, `dek_wrapped`, `arweave_uri`, `enc_final_unwrapped` are all deleted from platform-controlled storage at `custody → burned`. On-chain operation per `termination_method` audit field (`update_metadata_v1` keeps the leaf as tombstone OR Bubblegum `burn` removes the leaf; `burn` typically used for CSAM/criminal). Arweave bytes remain (out of platform control). Invariant: `custody='burned' AND legal='disputed'` is never valid -- enforced at the multi-sig admin tool boundary. |

### 1.2 DECIDE FIRST -- architectural choices

| ID | R62 location | Conflict | Resolution options |
|---|---|---|---|
| F-01 | §2.3 / Card 5 / Card 6 / Card 7 / Card 8 -- per-owner variant sha256 chain ({M, E, M+N, E+N'}) recorded on deed metadata via mint-authority Solana transaction per download / per personalization / per resale | deed.md schema lists only `sha256` (Master canonical-pixels) and `phash`. The per-owner variant chain isn't in the new schema. | (a) Keep the chain on-chain via update_metadata_v1 per event -- add explicit row to deed.md §4. (b) Move the chain to platform DB only; rewrite R62 Cards 5-8. (c) Keep on-chain but only the M (Master) anchor; drop the per-owner E/M+N/E+N' anchors. Recommend (b) at MVP -- per-owner artifacts are already platform-rendered; recording their sha256 on-chain per render is operational overhead with weak value. |
| F-02 | §2.3 -- deed metadata names `image_spec` block (7-field tech spec) and `sale_record` append-only price-history chain | deed.md schema does not enumerate these as discrete blocks. | (a) Add both as named blocks under the metadata JSON schema in deed.md §4. (b) Subsume image_spec into the existing image-identity fields (title, etc.) and move sale_record to platform DB only. Recommend (a) -- image_spec is image-identity (REQ-MINT-03 allows); sale_record is interesting because it's append-only price history and adding it on every resale is just another `update_metadata_v1` chain. Both fit under the existing JSON URI pattern. |
| F-03 | §2.2 line 93 + Card 6 -- monogram is "immutable for this (deed, owner) pair to preserve single-version artifacts"; implies durable per-owner storage. R62 Card 6 records {E: sha256(E_pixels)} (variant hash including monogram) to deed metadata. | deed.md REQ-MINT-03 says monogram stays in platform DB, not in Arweave or on-chain. Direct conflict. | (a) R62 updates: monogram is durable in platform DB only; "immutability for the (deed, owner) pair" is a DB-level guarantee, not an on-chain one. (b) Mint_architecture.md REQ-MINT-03 softens: monogram is in Arweave metadata for the current owner, replaced via update_metadata_v1 on each resale (paying one extra Solana tx per resale to record the new owner's monogram). Recommend (a) -- REQ-MINT-03's rationale (avoid public chain history of prior owners' letters; avoid per-resale update_metadata_v1 just for personalization) holds. |

### 1.3 New material -- additions R62 lacks entirely

The following deed.md elements have no R62 counterpart and need new paragraphs (or §§) in R62 §2.3 Registry:

| Topic | Where in R62 | What to add |
|---|---|---|
| Bubblegum V2 collection plugin stack (PermanentFreezeDelegate + PermanentTransferDelegate + Royalties) | §2.3 between current Master Image and Image-ID paragraphs | One paragraph describing the collection-level plugin configuration, authorities (HOT_RESALE_KEY for transfer delegate, COLD_RECOVERY_KEY for freeze delegate and collection update_authority), and that the soulbound posture is structural (permanent plugin) |
| Path 4 asset_id reservation via per-tree mutex | §2.3 deed mint paragraph | One paragraph describing the per-tree mutex, predict-then-mint sequence, race-detection step |
| Embedded provenance manifest (REQ-MINT-04) -- in Master at upload, in Share Copy at render | §2.2 Master Image storage (Commerce) + §2.3 Registry | Master-side: EXIF/XMP manifest with asset_id, sha256, phash, mint_tx_signature, platform_signature. Share Copy-side: render-time manifest with current owner, root, proof, render timestamp, signature. C2PA-compatible shape. |
| Per-event Arweave tree-state snapshots (REQ-MINT-04) | §2.3 Registry | One paragraph describing the snapshot policy: every state change writes its own Arweave object with tag, permits tree-wide reconstruction independent of DAS providers or Solana tx archive |
| DAS-RPC dependency for cNFT proofs | §2.3 Registry | One sentence noting Helius / Triton / Shyft are the DAS providers for proof fetching during update_metadata_v1, with failover policy per deed.md OI-02 |
| COLD_RECOVERY_KEY / PROVENANCE_SIGNER_KEY custody | §2.3 Registry or §7 security | One paragraph describing the key roster (HOT_MINT_KEY, HOT_OPS_KEY, HOT_RESALE_KEY, COLD_RECOVERY_KEY, PROVENANCE_SIGNER_KEY) and rotation paths |

## 2. R71 Edits

### 2.1 Mechanical

| Ref | Find | Replace |
|---|---|---|
| §3.7 vendor list -- Crossmint row | `Crossmint Minting API \| Crossmint \| One-of-one NFT deed mint; deed metadata carries the Arweave URI and the doubly-nested enc_final per R62 §2.3 Registry deed-bound decryption-key architecture; collection management` | (DELETE entire row) |
| §3.7 -- Crossmint paragraph (around line 258, starts "Crossmint. The platform calls the Crossmint Minting API...") | (entire paragraph + sample JSON) | Replace with: `Self-mint via Bubblegum V2. The platform calls @metaplex-foundation/mpl-bubblegum directly at the end of runImageOps (§3.9), after the Master is on Arweave and the deed metadata JSON is finalized. HOT_MINT_KEY (tree delegate) signs mint_v1 with uri = permanent Arweave URI per the Path 4 sequence in /docs/registry/deed.md §4. Mint signature appears on Solana in 1-2 seconds at confirmed commitment.` |
| §3.7 -- Backend dependency rows | `Crossmint Minting API client` | `@metaplex-foundation/mpl-bubblegum SDK (Bubblegum V2)` |
| §3.7 -- Add new vendor rows | n/a | Add: `Helius / Triton / Shyft DAS-RPC \| (vendor list) \| DAS proof fetching for cNFT update_metadata_v1 and Collection reads; failover across providers per deed.md OI-02. Free tiers cover MVP volumes.` |
| §3.7 -- Add SOL treasury line | n/a | Add: `SOL treasury (~$100 per 100k mints at $175/SOL) for HOT_MINT_KEY tx fees. Top-up cadence + alert threshold per deed.md OI-03.` |
| §2.4 step 14 / Card 5 references to Crossmint | any "Crossmint" mention | "platform mint dispatcher" or "self-mint via Bubblegum V2" |

### 2.2 New material

R71 §3.7 also picks up by reference the Bubblegum V2 collection plugin stack, COLD_RECOVERY_KEY custody, and procedural-multisig admin tool -- but R71 is implementation-spec, so a one-line pointer to deed.md is enough rather than reproducing the architecture.

## 3. Sequencing

1. **DECIDE F-01, F-02, F-03** before any edits land. These are architectural reconciliations, not wording cleanup.
2. **R62 surgical edits** (1.1 mechanical + 1.2 once decided + 1.3 new material).
3. **R71 surgical edits** (2.1 + 2.2).
4. Update this doc's status to "applied" or delete it.

## 4. Cross-References

| Doc | Purpose |
|---|---|
| /docs/registry/deed.md | Source of truth for the decisions captured here |
| /docs/R62_Gallery_Protocol.md | Target of section 1 |
| /docs/R71_Gallery_MVP_Specification.md | Target of section 2 |
| /docs/divergences.md | Records the shipped-vs-target gap until edits land |
| /docs/adr/adr_0008_self_mint_bubblegum_v2.md | Formal decision record (TBD) |

---
*Last Updated: 26/06/03 00:50*
