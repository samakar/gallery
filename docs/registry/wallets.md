# Wallets (Registry)

Magic silent wallet provisioning. INV-4: wallet primitive is Registry-owned. Called by `identity.provisionWalletIfMissing` post-CMA/MJA. Provisions a Solana keypair via Magic SDK; persists publicAddress to `users.wallet_address`; idempotent.

## 1. Interface

### 1.1 Inputs

#### provisionForUser
| Field | Type | Notes |
|---|---|---|
| user_id | UUID | from identity-verified principal |

### 1.2 Outputs

#### provisionForUser
| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| wallet_address | string | Solana base58 publicAddress |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| MAGIC_PROVISIONING_FAILED | Magic SDK call failed after retries |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | `users` row exists; `wallet_address` NULL or to be reconciled |
| Post (new wallet) | `users.wallet_address` populated with Solana base58 publicAddress |
| Post (idempotent) | re-call returns the existing wallet; no Magic API hit |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | new user; CMA captured | `provisionForUser(user_id)` | Magic provisions wallet; `users.wallet_address` populated |
| AC-02 | wallet already exists | re-call | returns existing `wallet_address`; no Magic call |
| AC-03 | Magic 503 | `provisionForUser` | `MAGIC_PROVISIONING_FAILED` |

## 2. Functional Requirements

### 2.1 Magic Silent Provisioning
Call Magic admin SDK silent wallet provisioning per R71 §3.3. Returns the Solana base58 publicAddress.

### 2.2 Idempotency
Read `users.wallet_address` first. If populated, return it (no Magic call). If null, call Magic, then persist.

### 2.3 INV-4 Compliance
This module is the canonical home for wallet creation. `identity.provisionWalletIfMissing` triggers; this module performs the work. The wallet primitive is Registry-owned.

## 3. Architecture
Magic admin SDK + Prisma `users.update`. No Solana RPC at MVP (Magic handles signing + provisioning).

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Latency (provisioning) | <= 2 s p95 (Magic call) |
| Latency (read existing) | <= 50 ms p95 |
| Idempotency | exists-check before Magic call |

## 5. Dependencies

| Dependency | Role |
|---|---|
| `@magic-sdk/admin` (TBD in package.json) | Silent wallet provisioning |
| `users` table (Prisma) | wallet_address read + write |
| identity (caller) | triggers via `provisionWalletIfMissing` |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | `@magic-sdk/admin` not yet in package.json |
| OI-02 | Solana RPC fallback if Magic unavailable -- adds complexity; TBD |
| OI-03 | Wallet rotation / key derivation policy -- MMP concern |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| identity.md §2.6 | Wallet Provisioning Trigger (caller side) |
| R71 §3.3 Magic | DID + wallet vendor contract |
| R71 §3.6 `users.wallet_address` | data model |
| Constitution INV-4 | wallet is Registry-owned; identity is trigger only |

---
*Last Updated: 05/29/26 17:00*
