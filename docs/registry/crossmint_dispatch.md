# Crossmint Dispatch (Registry)

Mint deed via the Crossmint Minting API. Embeds `arweave_uri`, `enc_final`, `sha256` + `phash` (M+00 dual anchors per R62 §4.3 / [ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md)), royalty fields from `rights.getDeedRightsParams`, and `license_acceptance_signing_event_id` into the deed metadata. Returns the Crossmint mint job id immediately; the terminal `minting → confirmed/failed` transition arrives via `crossmint_webhook`. Called by Commerce's `run_image_ops` at step (e).

## 1. Interface

### 1.1 Inputs

#### dispatch
| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | |
| buyer_wallet_pubkey | string | Solana base58 |
| arweave_uri | string | from `arweave_master` |
| sha256 | string | hex; from `arweave_master`; M+00 anchor (canonical-pixels sha256) |
| phash | string | 16-char hex; from `arweave_master` (read-through of `images.phash`); M+00 perceptual anchor per [ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md) |
| enc_final | string | base64; from `arweave_master` |
| license_signing_event_id | UUID | from per-image License Acceptance ESIGN |

### 1.2 Outputs

#### dispatch
| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| crossmint_job_id | string | from Crossmint; correlated to webhook callback |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| CROSSMINT_DISPATCH_FAILED | Crossmint API call failed after retries |
| MINT_PARAMS_INVALID | metadata payload validation failed (missing required field) |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | `arweave_master` complete; License Acceptance ESIGN captured; `rights.getDeedRightsParams` resolves |
| Post | Crossmint mint job queued; webhook will deliver terminal state |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | all inputs valid | `dispatch(...)` | `crossmint_job_id` returned |
| AC-02 | Crossmint 503 | `dispatch` | retried 3x with backoff; if all fail, `CROSSMINT_DISPATCH_FAILED` |
| AC-03 | `MINT_PARAMS_INVALID` payload | validate before API call | rejected; no API hit |

## 2. Functional Requirements

### 2.1 Mint Payload Construction (R71 §3.3 Crossmint section)

```json
{
  "recipient": "solana:<buyer_wallet_pubkey>",
  "metadata": {
    "name": "<images.title>",
    "image": "<cloudinary_listing_preview_url>",
    "attributes": [
      { "trait_type": "creator", "value": "<creators.display_name>" },
      { "trait_type": "image_id", "value": "<image_id>" },
      { "trait_type": "edition", "value": "1 of 1" }
    ],
    "properties": {
      "arweave_master_uri": "<arweave_uri>",
      "enc_final": "<enc_final>",
      "deed_state": "sealed",
      "royalty_pct": 10,
      "royalty_recipients": [{ "address": "<creator_wallet>", "share": 100 }],
      "variant_hashes": { "M+00": { "sha256": "<sha256>", "phash": "<phash>", "anchored_at": "<mint_tx_block_time>" } },
      "license_acceptance_signing_event_id": "<license_signing_event_id>"
    }
  }
}
```

### 2.2 API Call
- Crossmint Minting API client (TBD package + `process.env.CROSSMINT_API_KEY` + `process.env.CROSSMINT_COLLECTION_ID`)
- Returns mint job id; `mint_address` + `transaction_signature` arrive in webhook callback

### 2.3 Retry Policy
- Up to 3 retries with exponential backoff (1s / 4s / 16s).
- Failures are terminal (no partial mint state -- Crossmint is transactional).

### 2.4 Rights Resolution
Before dispatch, call `rights.getDeedRightsParams(image_id)` (Commerce) -- returns `royalty_pct=10`, `royalty_recipients=[{creator: 100%}]`, `edition_tier='Unique'` at MVP.

## 3. Architecture

### 3.1 Fire-and-Forget
Stateless dispatch. The webhook owns terminal state. This module exits as soon as the mint job is queued.

### 3.2 No Solana RPC at MVP
Crossmint internalizes all Solana interaction. No direct RPC at this layer.

### 3.3 Mint Fee Borne by Elanoid
Solana network fee for the mint is paid by the platform from the 10% net (R71 §2.4 step 14). Top-up monitoring is OI-01.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Latency | <= 5 s p95 (Crossmint API call) |
| Audit | Pino `crossmint.dispatch` with image_id, crossmint_job_id |
| Retry | 3 attempts, exponential backoff |

## 5. Dependencies

| Dependency | Role |
|---|---|
| Crossmint Minting API client (R71 §3.2) | mint job dispatch |
| `rights.getDeedRightsParams` (Commerce) | royalty + edition params |
| `arweave_master` (predecessor) | provides `arweave_uri`, `sha256`, `phash`, `enc_final` |
| `crossmint_webhook` (successor) | receives terminal state |
| `process.env.CROSSMINT_API_KEY` | API auth |
| `process.env.CROSSMINT_COLLECTION_ID` | collection scope |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Mint fee Elanoid funding (Solana network fee within 10% net per R71 §2.4 step 14) -- top-up monitoring at threshold; TBD |
| OI-02 | Single collection at MVP; multi-collection rotation deferred to MMP |
| OI-03 | Mint correlation key (`crossmint_job_id` vs `purchases.id`) -- pass `purchase_id` in mint metadata for webhook correlation; confirm at integration time |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| arweave_master.md | Predecessor (provides inputs) |
| crossmint_webhook.md | Successor (terminal state) |
| rights.md (Commerce) | royalty + edition params source |
| esign.md (Commerce) | License Acceptance signing_event_id source |
| run_image_ops.md | Caller (step e of the pipeline) |
| R71 §2.4 step 14 | Authoritative mint step |
| R71 §3.3 Crossmint | Vendor contract + metadata schema |
| R62 §2.3 Registry | deed metadata structure |
| R62 §3.5.1 | deed_state field at mint |
| R62 §4.3 line 493 | Firm deed-content fields: sha256 + phash dual anchors |
| **ADR-0005** | phash in deed restored to MVP per R62 §4.3 |

---
*Last Updated: 05/29/26 17:30*
