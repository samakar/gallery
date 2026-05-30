# Deed State (Registry)

`deeds.deed_state` field mirrors the on-chain state. At MVP all deeds are `'sealed'` -- there's no Master download surface (Card 7 deferred) and no multi-sig adjudication active. Forward-compat enum exists for `opened`, `rights_disputed`, `void`, `burned`. Mutations to the latter three require 3-of-5 multi-sig per INV-06 (MMP).

## 1. Interface

### 1.1 Inputs

#### getDeedState
| Field | Type | Notes |
|---|---|---|
| mint_address | string | Solana base58 |

### 1.2 Outputs

#### getDeedState
| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| deed_state | enum | `'sealed'` at MVP; forward-compat: `'opened'` \| `'rights_disputed'` \| `'void'` \| `'burned'` |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| DEED_NOT_FOUND | `mint_address` not in `deeds` table |

### 1.4 Pre / Post Conditions

Pure read at MVP. No mutations.

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | minted deed | `getDeedState(mint_address)` | returns `'sealed'` |
| AC-02 | unknown mint | same | `DEED_NOT_FOUND` |

## 2. Functional Requirements

### 2.1 MVP: `sealed` Only
All MVP deeds are minted at `deed_state='sealed'` by `crossmint_dispatch` + `crossmint_webhook`. No transitions are active at MVP because:
- Deed-holder Master download (Card 7) is deferred → no `sealed → opened`
- Multi-sig adjudication is deferred → no `rights_disputed`, `void`, `burned` transitions

### 2.2 Forward-Compat State Machine (MMP)

| From | To | Trigger | Requires |
|---|---|---|---|
| `sealed` | `opened` | Card 7 deed-holder Master download | (MMP) -- exclusive of resale per R62 §3.5.1 |
| `sealed` / `opened` | `rights_disputed` | DMCA / Take It Down Act / RoP / court order | 3-of-5 multi-sig (INV-06) |
| `rights_disputed` | `sealed` / `opened` | Counter-notice prevails OR investigation clears | 3-of-5 multi-sig |
| `rights_disputed` | `void` | Investigation confirms takedown valid | 3-of-5 multi-sig; buyer refund per R62 §4.9 |
| `sealed` / `opened` | `burned` | Catastrophic invalidation (CSAM post-mint, criminal seizure) | 3-of-5 multi-sig; immediate platform suspension; §2258A NCMEC |

### 2.3 INV-06 Multi-Sig Enforcement (MMP)
3-of-5 multi-sig signer set authorizes mutations to `rights_disputed`, `void`, `burned`. Not active at MVP; the surface (`transitionTo`) is not exported until activation.

### 2.4 INV-10 Totality
Any unspecified transition is a bug, not a default. MVP guard: only `crossmint_webhook` writes `deed_state` (sets to `'sealed'` at mint).

## 3. Architecture

### 3.1 MVP: Read-Only Mirror
On-chain is authoritative; `deeds.deed_state` mirrors for fast reads without per-request Solana RPC. The only writer is `crossmint_webhook` at mint time.

### 3.2 MMP: Multi-Sig Authorized Mutations
A future `transitionTo(mint_address, new_state, multi_sig_proof)` surface; out of MVP scope.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Latency (`getDeedState`) | <= 10 ms (Prisma read) |
| INV-06 enforcement | at write time (MMP only) |
| INV-10 totality | static check on the enum (caller exhaustive switch) |

## 5. Dependencies

| Dependency | Role |
|---|---|
| `deeds` table (Prisma) | row state |
| Solana / Crossmint update API (MMP only) | mutation surface |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Multi-sig signer set composition + key custody -- MMP |
| OI-02 | `rights_disputed` adjudication flow per R62 §4.9 -- MMP |
| OI-03 | `burned` terminal -- refund mechanics for the buyer -- MMP |
| OI-04 | Card 7 Master-download `sealed → opened` flow -- MMP; depends on the deferred Master-download UI |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| crossmint_webhook.md | Sets `deed_state='sealed'` at mint (only writer at MVP) |
| takedown.md (Cert) | Source of `rights_disputed` triggers (deferred to MMP per cert/takedown OI-04) |
| R71 §3.6 `deeds.deed_state` | data model |
| R71 §3.8 | forward-compat states noted |
| R62 §3.5.1 | full state machine (sealed/opened + lifecycle states) |
| Constitution INV-06 | Multi-sig requirement |
| Constitution INV-10 | Total transitions |

---
*Last Updated: 05/29/26 17:00*
