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

### 3.1 Magic provisioning trigger

The wallet is **not** provisioned via an explicit server-side `provisionForUser(user_id)` call (the §1 interface is aspirational at MVP). It is provisioned **client-side automatically** by the Magic SDK on first OAuth authentication, gated by which chain extensions are present in the Magic instance:

```ts
new Magic(pk, { extensions: [ new OAuthExtension(), new SolanaExtension({ rpcUrl }) ] })
```

The server reads the resulting wallet from Magic's admin SDK in the `/v1/auth/magic` route (during DID-token validation, immediately after OAuth callback) and persists it to `users.wallet_address`.

### 3.2 Magic integration gotchas (durable engineering notes)

The Magic API surface is shaped in non-obvious ways. Future-you will pay hours to rediscover these. Each item below is a real lesson:

| # | Gotcha | Detail |
|---|---|---|
| G-01 | **Match wallet entries by `wallet_type`, never by `network`** | Magic's admin SDK returns `meta.wallets[]` where each entry has `wallet_type` ('ETH' \| 'SOLANA' \| ...) AND `network`. The `network` field is **always `'MAINNET'`** regardless of chain. Code that filters wallets by `network === 'SOLANA'` matches nothing and falls through to `meta.publicAddress` (which is always the EVM wallet). This cost a full debug session of "Magic isn't provisioning Solana wallets" when in fact it was -- we were looking at the wrong field. |
| G-02 | **Magic admin SDK uses snake_case field names; TS types lie** | The actual JSON has `wallet_type` and `public_address` (snake_case). The `@magic-sdk/admin` TypeScript types declare `walletType` and `publicAddress` (camelCase). Don't trust the TS types -- read the raw response via `JSON.stringify` once to confirm field names before coding against them. We cast to `any[]` at the wallets filter to access the real fields. |
| G-03 | **`meta.publicAddress` at the top level is always EVM** | Even on a Magic instance with only `SolanaExtension` registered, the top-level `publicAddress` returned by `getMetadataBy*` is the EVM wallet. To get the Solana wallet, you must look inside `meta.wallets[]` and filter by `wallet_type`. Top-level `publicAddress` is legacy / EVM-first by design. |
| G-04 | **Issuer DID prefix `did:ethr:` does not preclude Solana support** | The `magic_did` (issuer DID) is always formatted as `did:ethr:0x...` even when a Solana wallet exists -- the DID format is legacy and identity-level, not chain-level. Don't gate Solana behavior on whether the DID starts with `did:solana:`; check `meta.wallets[]` instead. |
| G-05 | **`Magic(...)` constructor's `network` option is EVM-only by type system** | The `network` parameter on the Magic constructor is typed `EthNetworkConfiguration` (verified in `@magic-sdk/types/dist/types/modules/rpc-provider-types.d.ts`): only `'mainnet' \| 'goerli' \| 'sepolia'` strings or `CustomNodeConfiguration` with numeric `chainId`. There is no Solana value. The way to make Magic provision a Solana wallet is via the `SolanaExtension`, not via `network`. |
| G-06 | **Auto-provision happens only on first authentication for a Magic identity** | If a user has already authenticated to a Magic project under an EVM-only SDK config and then the SolanaExtension is added later, that user's existing identity will not be retroactively given a Solana wallet. The `@magic-ext/solana` extension exposes only signing methods (`signTransaction`, `signMessage`, `partialSignTransaction`) -- there is no client-side `getAccount()` / `provisionWallet()` to force backfill. To get a Solana wallet for an existing identity, delete it via the admin API (`POST https://api.magic.link/v1/admin/user/deletion/request`) and have the user re-authenticate. |
| G-07 | **Magic projects come in two products that share branding: Dedicated Wallet and Embedded Wallet (Newton). They are NOT interchangeable.** | The legacy `magic-sdk` + `@magic-ext/oauth2` + `magic.oauth2.loginWithRedirect` flow works only on **Dedicated Wallet** projects. Embedded Wallet (Newton) projects use a TEE-based product with a different SDK (`tee.express.magiclabs.com/v1/wallet`) and BYO Auth registration (`X-OIDC-Provider-ID`). Trying to use the legacy OAuth SDK against an Embedded Wallet project produces `Magic RPC Error: [-32600] OAuthV2 [sdk-pkce]` with no useful detail. Verify which product the project is on (the dashboard header reads "Embedded Wallet only" for Newton). |
| G-08 | **BYO Google OAuth + Magic-hosted Dedicated Wallet = Google Cloud Console setup required** | If your Dedicated Wallet project uses BYO Google OAuth (not Magic-hosted), you must register your own OAuth Client in Google Cloud Console under the relevant GCP project. The authorized redirect URI must match Magic's redirect URI exactly (Magic dashboard shows the exact URL). Magic's "Authentication" tab then takes the Google Client ID + Secret. |

### 3.3 Reference: known-good Magic admin metadata shape

For an authenticated user on a Dedicated Wallet project with `OAuthExtension` + `SolanaExtension`, `getMetadataByIssuerAndWallet(issuer, 'SOLANA')` returns approximately:

```json
{
  "issuer": "did:ethr:0xF1746C...",
  "publicAddress": "0xF1746C...",
  "email": "buyer@example.com",
  "oauthProvider": "google",
  "wallets": [
    {
      "wallet_type": "SOLANA",
      "public_address": "<solana_base58>",
      "network": "MAINNET"
    }
  ]
}
```

Note: querying with `'SOLANA'` filters `wallets[]` to only SOLANA entries; querying with `'ANY'` returns ETH + SOLANA + others. Top-level `publicAddress` is unchanged regardless of which wallet you query.

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
*Last Updated: 26/06/03 15:50*
