# cNFT Dispatch (Registry)

Mint deed via self-signed Bubblegum V2 instruction. Reserves the cNFT asset_id under a per-tree mutex (Path 4 per /docs/registry/mint_architecture.md §4), builds the Arweave metadata JSON + the encrypted Master with the embedded provenance manifest, uploads to Arweave, and submits `mint_v1` to Solana with the permanent Arweave URI. Returns the asset_id and the Solana tx signature synchronously when `confirmed` commitment is reached. Called by Commerce's `run_image_ops` at step (e). Replaces /docs/registry/crossmint_dispatch.md.

## 1. Interface

### 1.1 Inputs

#### dispatch

| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | |
| buyer_wallet_pubkey | string | Solana base58 |
| arweave_metadata | object | JSON to be uploaded; schema per /docs/registry/mint_architecture.md §4 (image_id, title, creator_display_name, creation_date, arweave_master_uri, enc_final, sha256, phash, license_signing_event_id, tree_root_at_mint_time, mint_tx_signature, platform_signature, asset_id) |
| encrypted_master | Buffer | Encrypted bytes already containing the embedded provenance manifest (EXIF/XMP) |
| royalty_pct | int | 10 |
| royalty_recipients | [{ address, share }] | from `rights.getDeedRightsParams` |

### 1.2 Outputs

#### dispatch

| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| asset_id | string | cNFT asset_id; equals predicted_asset_id verified post-confirm |
| mint_tx_signature | string | Solana tx signature |
| arweave_master_uri | string | permanent Arweave URI of the encrypted Master |
| arweave_metadata_uri | string | permanent Arweave URI of the deed metadata JSON |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| MINT_MUTEX_TIMEOUT | per-tree mutex not acquired within configured timeout |
| ARWEAVE_UPLOAD_FAILED | Arweave Turbo upload failed after retries |
| MINT_SUBMIT_FAILED | Solana RPC rejected `mint_v1` |
| MINT_NOT_CONFIRMED | Solana did not reach `confirmed` commitment within timeout |
| RACE_DETECTED | observed asset_id != predicted (resolution path per OI-04) |
| MINT_PARAMS_INVALID | metadata payload validation failed (missing required field) |
| SIGNATURE_VERIFY_FAILED | platform_signature over the metadata payload failed self-check before upload |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | `arweave_metadata.enc_final` is sealed to `buyer_wallet_pubkey`; License Acceptance ESIGN captured; `rights.getDeedRightsParams` resolves; HOT_MINT_KEY balance > minimum threshold |
| Post | cNFT minted to `buyer_wallet_pubkey` under the platform Bubblegum V2 tree; on-chain `uri = arweave_metadata_uri`; `deeds` row inserted with `asset_id` + `mint_tx_signature` + `arweave_master_uri`; an Arweave snapshot entry for this state change has been queued per REQ-MINT-04 |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | all inputs valid; tree has capacity | `dispatch(...)` | `asset_id` returned; on-chain owner == `buyer_wallet_pubkey`; on-chain uri == `arweave_metadata_uri` |
| AC-02 | tree has no capacity | `dispatch(...)` | dispatcher routes to next tree per sharding policy (OI-03); deed mints under that tree's mutex |
| AC-03 | Solana RPC unavailable | `dispatch(...)` | `MINT_SUBMIT_FAILED`; mutex released; sweeper retries per ADR-0007 |
| AC-04 | Arweave Turbo returns 402 | `dispatch(...)` | `ARWEAVE_UPLOAD_FAILED`; mutex released; sweeper retries |
| AC-05 | observed leaf_index != predicted at step 7 | `dispatch(...)` | `RACE_DETECTED`; re-derive asset_id from observed leaf_index; rebuild metadata; re-upload to Arweave; resubmit mint (orphan original upload accepted) |
| AC-06 | dispatch succeeds | `dispatch(...)` | exactly one Arweave snapshot entry for this state change is queued |

## 2. Functional Requirements

### 2.1 Path 4 Sequence

```
1. Acquire per-tree mint mutex (in-process for single-instance; distributed lock for multi-instance per OI-02)
2. Query tree account -> current num_minted = N
3. predicted_asset_id = deriveBubblegumAssetId(tree_pubkey, N)
4. Build Arweave metadata JSON with predicted_asset_id field + remaining schema (REQ-MINT-03 minimal -- no monogram)
5. Sign metadata.platform_signature with PROVENANCE_SIGNER_KEY (ed25519)
6. Upload encrypted_master + metadata JSON to Arweave Turbo -> arweave_master_uri + arweave_metadata_uri (parallel uploads)
7. Construct mint_v1 instruction with uri = arweave_metadata_uri; submit signed by HOT_MINT_KEY (tree delegate)
8. Await Solana `confirmed` commitment
9. Extract observed_leaf_index from tx logs; verify deriveBubblegumAssetId(tree_pubkey, observed_leaf_index) == predicted_asset_id; if not, raise RACE_DETECTED and follow AC-05
10. Persist `deeds` row (asset_id, owner_wallet, arweave_master_uri, arweave_metadata_uri, mint_tx_signature, minted_at)
11. Queue Arweave snapshot entry for this mint event per REQ-MINT-04 (OI-05)
12. Release mint mutex
```

### 2.2 Mint Payload Construction

Bubblegum V2 `mint_v1` instruction:

```ts
mintV1({
  treeAuthority,                   // PDA derived from merkleTree
  leafOwner: buyer_wallet_pubkey,  // recipient
  leafDelegate: buyer_wallet_pubkey, // default; collection-level PermanentTransferDelegate provides platform transfer power
  merkleTree,                      // the tree this collection is under
  payer: HOT_MINT_KEY,
  treeDelegate: HOT_MINT_KEY,      // authorized to mint into this tree
  metadata: {
    name: "Epimage #<image_id>",   // REQ-MINT-03 image-identity
    symbol: "EPIM",
    uri: arweave_metadata_uri,
    sellerFeeBasisPoints: 1000,    // 10% royalty
    primarySaleHappened: false,
    isMutable: true,               // tree-level; required for enc_final re-key on resale
    creators: [
      { address: creator_wallet, share: 90, verified: false },
      { address: platform_wallet, share: 10, verified: true },
    ],
    collection: { verified: true, key: COLLECTION_PUBKEY },
  },
})
```

### 2.3 Retry Policy

- Arweave upload: 3 retries, exponential backoff (1s / 4s / 16s)
- Solana submit: single attempt; failure raises MINT_SUBMIT_FAILED to caller (sweeper handles retry per ADR-0007)
- Race detection at step 9: single re-derive + retry (AC-05); if the second attempt also races, raise RACE_DETECTED to caller

### 2.4 Rights Resolution

Before dispatch, call `rights.getDeedRightsParams(image_id)` (Commerce) -- returns `royalty_pct=10`, `royalty_recipients=[{creator: 90%, platform: 10%}]`, `edition_tier='Unique'` at MVP.

### 2.5 Embedded Provenance Manifest

The caller is responsible for embedding the manifest into the encrypted Master before passing it in (REQ-MINT-04). The dispatcher does not modify image bytes; it only signs the metadata-side manifest and uploads.

## 3. Architecture

### 3.1 Per-Tree Mutex

In-process Node mutex at MVP (single API instance). Distributed lock (Redis SETNX with TTL, or Postgres advisory lock) when scaled out per OI-02.

### 3.2 Arweave Snapshot Hook

The dispatcher queues a per-event Arweave snapshot for the mint state change. The snapshot writer is a separate worker that consumes the queue and uploads tagged Arweave entries; details in a separate SDD (TBD) referenced from OI-05.

### 3.3 Tree Sharding

At MVP a single tree handles all mints. When the active tree approaches capacity (16,384 leaves at depth 14), the dispatcher routes new mints to a freshly-rolled tree under the same collection. Existing deeds stay in their original tree forever.

### 3.4 Mint Fee Borne by Platform

Solana network fee (~5000 lamports per `mint_v1`) paid by HOT_MINT_KEY from the platform's SOL float. ~1 SOL covers ~200k mints. Top-up monitoring per /docs/registry/mint_architecture.md OI-03.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Latency | <= 17 s p95 total (Arweave upload + Solana confirmed); ~6 s p50 |
| Throughput per tree | ~4-12 mints/minute (Arweave-bound under mutex) |
| Audit | Pino `cnft.dispatch` with image_id, asset_id, tree_pubkey, leaf_index, arweave_uris, mint_tx_signature |
| Race detection rate | < 0.1% under single-instance mutex; logged + recovered per AC-05 |

## 5. Dependencies

| Dependency | Role |
|---|---|
| @metaplex-foundation/mpl-bubblegum (Bubblegum V2) | mint_v1 instruction construction |
| @ardrive/turbo-sdk | Arweave Turbo bundler client |
| Solana RPC (Helius / Triton / public) | tx submission + confirmation polling |
| DAS-RPC (Helius / Triton / Shyft) | tree state read for predicted_asset_id derivation (not required at mint; required for update flows) |
| `rights.getDeedRightsParams` (Commerce) | royalty + edition params |
| `crypto.sealDekToWallet` (Certification) | seal DEK to buyer wallet pubkey -> enc_final (caller is responsible) |
| `process.env.PLATFORM_TREE_PUBKEY` | active Bubblegum tree |
| `process.env.PLATFORM_COLLECTION_PUBKEY` | MPL-Core Collection grouping the cNFTs |
| `process.env.HOT_MINT_KEY` | tree delegate keypair (server-held) |
| `process.env.PROVENANCE_SIGNER_KEY` | ed25519 keypair for platform_signature in the metadata manifest |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Mint fee top-up cadence + alert threshold (HOT_MINT_KEY balance) -- mirrors mint_architecture.md OI-03 |
| OI-02 | Distributed mutex implementation when scaled to multi-instance API -- mirrors mint_architecture.md OI-10 |
| OI-03 | Tree-capacity rollover policy -- when to roll a new tree; mirrors mint_architecture.md OI-07, OI-13 |
| OI-04 | Race detection failure handling -- mirrors mint_architecture.md OI-11; settle on (a) re-derive + re-upload + retry, or (b) hard-rollback via burn; recommend (a) |
| OI-05 | Arweave snapshot writer module (separate SDD) -- ingests state change events from this dispatcher's queue, uploads tagged Arweave entries per REQ-MINT-04 |
| OI-06 | PROVENANCE_SIGNER_KEY rotation + public-key publication path for 200-year verifiers -- mirrors mint_architecture.md OI-14 |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| /docs/registry/mint_architecture.md | Architecture this dispatcher implements (Path 4, Bubblegum V2 + MPL-Core Collection, REQ-MINT-02 / -03 / -04) |
| /docs/registry/crossmint_dispatch.md | Predecessor (SUPERSEDED) |
| /docs/registry/arweave_master.md | Predecessor for the Arweave upload mechanics; this dispatcher consumes its outputs |
| /docs/commerce/run_image_ops.md | Caller (step e of the pipeline) |
| /docs/commerce/rights.md | royalty + edition params source |
| /docs/cert/esign.md | License Acceptance signing_event_id source |
| /docs/adr/adr_0001 | Build dispatch decoupled from Stripe webhook -- applies |
| /docs/adr/adr_0007 | Buyer-friendly retry model -- applies; sweeper retries this dispatcher |
| /docs/adr/adr_0008 | Self-mint Bubblegum V2 decision record |
| R71 §2.4 step 14 | Authoritative mint step (pending alignment per /docs/registry/r62_r71_alignment.md) |
| R62 §2.3 Registry | deed metadata structure (pending alignment) |
| R62 §3.5.1 | deed_state field at mint (pending alignment) |
| ADR-0005 | phash in deed |

---
*Last Updated: 26/06/03 01:00*
