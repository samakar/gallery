# Crossmint Lookup (Registry)

NFT lookup against Crossmint's NFT API to verify on-chain ownership. Used by Commerce's `renderer` for per-request ownership gating on deed-holder Share Copy downloads. No direct Solana RPC at MVP (Crossmint internalizes).

## 1. Interface

### 1.1 Inputs

#### getOwner
| Field | Type | Notes |
|---|---|---|
| mint_address | string | Solana base58 NFT address |

### 1.2 Outputs

#### getOwner
| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| current_owner_wallet | string | Solana base58; on-chain truth |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| CROSSMINT_LOOKUP_FAILED | API call failed after retries |
| NFT_NOT_FOUND | `mint_address` not known to Crossmint (could indicate transfer to a non-Crossmint-tracked wallet or a stale `mint_address`) |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | `mint_address` is a Solana base58 string; `CROSSMINT_API_KEY` set |
| Post | no DB writes; pure read |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | valid mint | `getOwner(mint_address)` | `current_owner_wallet` returned |
| AC-02 | unknown mint | same | `NFT_NOT_FOUND` |
| AC-03 | API 503 | same | retried 3x with backoff; if all fail, `CROSSMINT_LOOKUP_FAILED` |

## 2. Functional Requirements

### 2.1 Crossmint NFT Lookup
- Call Crossmint's NFT lookup endpoint with `mint_address`.
- Returns current on-chain owner wallet.
- Retries 3 times with exponential backoff (1s / 4s / 16s).

### 2.2 No Solana RPC at MVP
Per R71 §3.3, Crossmint internalizes Solana RPC. renderer relies on this for per-request ownership gating without the platform running a Solana node.

### 2.3 Fresh Per Request
No caching at MVP -- ensures wallet transfers (post-MVP resale) immediately revoke prior owner's access. OI-01 considers a short cache for load reduction at scale.

## 3. Architecture

### 3.1 Stateless API Call
No DB writes; no in-memory cache at MVP. Each call hits Crossmint.

### 3.2 Consumed by renderer
The renderer's `serveShareCopyDownload` calls `getOwner` before issuing signed URLs.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Latency | <= 500 ms p95 (Crossmint NFT lookup) |
| Caching | none at MVP (per §2.3) |
| Audit | Pino `crossmint.lookup` with `mint_address`, `duration_ms` |
| Secrets | `CROSSMINT_API_KEY` -- never logged |

## 5. Dependencies

| Dependency | Role |
|---|---|
| Crossmint NFT API client (R71 §3.2) | lookup endpoint |
| `process.env.CROSSMINT_API_KEY` | API auth |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Short-lived (~30 s) cache to reduce Crossmint API load -- adds staleness risk on transfers; deferred |
| OI-02 | Fallback to direct Solana RPC if Crossmint unavailable -- adds operational complexity; TBD |
| OI-03 | Multi-network support (testnet vs mainnet) -- env config; TBD at integration time |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| renderer.md (Commerce) | Consumer -- per-request ownership gating |
| R71 §3.3 Crossmint NFT lookup | Vendor contract |
| R71 §3.7 row 20 | signed-download endpoint that consumes this lookup |
| Constitution INV-02 | Platform MUST NOT hold buyer private keys -- ownership check uses on-chain truth |

---
*Last Updated: 05/29/26 17:00*
