# ESIGN Subsystem

ESIGN-compliant signature capture for the MVP signature document types per INV-2: CMA, MJA, COA, SAL, DLN. SAL is signed **twice per image** -- once by the creator at Card 1 (under platform-default terms at MVP) and once by the buyer at Card 4. DLN is signed by the deed-holder at first `/v1/deeds/:imageId/download-master` and gates the irreversible `sealed → unsealed` custody transition (D-22). Each signature precedes the entity it admits (CMA -> `creators`; MJA -> `owners`; COA + creator's SAL -> image-id assignment; buyer's SAL -> deed mint; DLN -> the seal-break event).

**Capture method.** Each signature is recorded as a Solana transaction co-signed by the user's wallet and the platform's `HOT_OPS_KEY`, NOT as a DB-only clickwrap. The user's wallet signature on the tx is the cryptographically unforgeable act of consent (only the user's wallet privkey can produce it, per INV-02). Memo payload, schema fields, and mechanism in §1.1 + §2.8.

## 1. Interface

### 1.1 Inputs

One row per logical field of a signature event, shown across all three layers it appears on: caller's `captureSignature(...)` call, persisted `signatures` row, and on-chain SPL Memo. ESIGN's internal job is the mapping across these columns.

| Caller field | Memo key | Type | Size (hard max, bytes) | Notes |
|---|---|---|---|---|
| `user_id` | -- | UUID | 36 (fixed; string form `8-4-4-4-12` hex) | Auth-verified. Caller-only; never reaches Memo (no PII on-chain). |
| `document_type` | `t` | enum (3-byte code) | 3 (fixed) | Codes: `CMA` \| `MJA` \| `COA` \| `SAL` \| `DLN`. 3 bytes is the size budget on the wire; longer forms are not used. Caller provides; ESIGN validates `entries[document_id].type === document_type` defensively. Strictly redundant with `document_id` (the binder maps id -> type) but kept on the Memo as a 3-byte quick filter for explorers / marketplaces. |
| `document_id` | `d` | base64 opaque id | 5 (fixed; e.g., `ab3kf`) | Stable opaque id generated at binder-registration time. Resolved by `binder.entries[document_id]`. |
| (derived from binder) | -- | -- | -- | `document_version` -- e.g., `1.0`. NOT supplied by the caller and NOT on the Memo. Server reads `binder.entries[document_id].version` at insert time and stamps it on the `signatures` row for fast UI display ("Sales Agreement v1.0") without per-render binder lookup. |
| `legal_binder_tx_id` | `b` | base64url string | 43 (fixed; the Arweave tx_id only -- the `https://arweave.net/` prefix is dropped, reconstructed on-read by string-concat) | The cryptographic anchor for the audit-truth path (see [legal_binder.md §2.4.1](legal_binder.md)). Caller typically supplies `getActiveBinder().arweave_tx_id`; ESIGN rejects stale tx_ids with `STALE_BINDER_SIGNATURE`. |
| `props` | `p` | JSON object | **450 (hard max)** -- the architectural ceiling for any document's per-instance props. Derived from SPL Memo's ~566-byte single-instruction limit minus all other fixed Memo fields. | Per-document-type instance fields matching the binder's `entries[document_id].props_schema`. Empty `{}` for CMA / MJA; `{ image_id }` for COA's authorship props (~20 bytes); `{ image_id, royalty_pct, edition, platform_fee_pct }` for SAL (~87 bytes); COA render-time props (~180 bytes). Documents whose per-instance data would exceed 450 bytes must split: keep bulk content in the binder template, reference it by id in props. Validated at §2.8 step 2; rejected with `ESIGN_PROPS_MISSING` if required keys absent, `ESIGN_PROPS_TOO_LARGE` if JSON-serialized length > 450. |
| `click.ip_address` | -- | string | 45 (IPv6 max; IPv4 fits in 15) | Caller-only; persisted on the `signatures` row for ESIGN Act audit + fraud forensics. Never on-chain (privacy). |
| `click.clicked_at` | `c` | ISO 8601 UTC | 24 (fixed; `YYYY-MM-DDTHH:mm:ss.sssZ`) | Server-captured at the moment the user's click reaches the API. **Distinct from Solana's tx `blockTime`**: `blockTime` records when the tx was confirmed on-chain (1-5+ seconds after the click, depending on broadcast + slot timing). For ESIGN Act evidentiary purposes the click moment is the legally meaningful timestamp -- the act of consent -- not the confirmation moment. |

**Total Memo budget** (sum of fixed Memo-key bytes + JSON syntax `{"t":"...","d":"...","b":"...","p":...,"c":"..."}` ≈ 25 bytes):

```
syntax    ~25 bytes
t          3 bytes
d          5 bytes
b         43 bytes
c         24 bytes
          ---------
fixed   ~100 bytes
p     up to 450 bytes
          ---------
max    ~550 bytes  (under SPL Memo single-instruction limit of ~566 bytes; ~16 bytes safety margin)
```

**Total Memo size by document_type**:

| document_type | Memo size |
|---|---|
| CMA, MJA | ~102 bytes (empty `p`) |
| COA (signed, authorship props) | ~120 bytes |
| SAL | ~187 bytes |
| COA (render-time props, not signed) | ~280 bytes |
| Theoretical maximum (any doc, max `p`) | ~550 bytes |

**On the Memo specifically.** Each ESIGN Solana tx carries a single SPL Memo instruction with the abbreviated-key JSON above (`t`, `d`, `b`, `p`, `c`). Tx signers: `[HOT_OPS_KEY (payer), user_wallet (consent)]`. The user's wallet signature is the cryptographically-unforgeable consent (INV-02-enforced); the platform's signature pays the ~$0.000005 fee.

**Why `p` is a typed object.** Different document types bind to different per-instance contexts. COA + SALES_AGREEMENT bind to an image; other doc types may bind to a channel, a deed, or nothing at all. Defining the prop shape *inside the binder* means new doc types can be added (post-MVP, via a binder revision) without extending the Memo schema or migrating Solana txs -- adding the new doc + its `props_schema` to the binder is sufficient. The binder's `props_schema` is the source of truth for validating `p` both at sign-time (capture rejects if required props are missing) and at audit-time.

#### bundleSign
- **Card 1 creator click** (`bundleSign(COA, SALES_AGREEMENT_creator_side)`): atomic two-document capture binding the creator's per-image affirmation + creator's sale-terms agreement under the same click event.
- **First-purchase buyer click** (`bundleSign(MJA, SALES_AGREEMENT_buyer_side)`): atomic two-document capture for first-purchase (R71 §2.4 step 4) -- buyer's master agreement + per-image sale-terms acceptance.

In both cases: shared click metadata; distinct `signing_event_id`s and distinct Solana txs (one per document).

### 1.2 Outputs

`{ signing_event_id, solana_tx_signature, confirmation_status: 'pending' }` per capture. Bundle returns both. `signing_event_id` is the row UUID (used by callers as a non-async lookup key); `solana_tx_signature` is the Solana tx signature returned on broadcast. Callers proceed immediately on broadcast; a background sweeper flips `confirmation_status` to `'confirmed'` (or `'failed'` on rare broadcast errors). See §2.8.

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| ESIGN_DOCUMENT_REQUIRED | downstream caller missing a required prerequisite signature (R71 §3.7: `MJA_REQUIRED`, `LICENSE_REQUIRED` are caller surface forms) |
| ESIGN_BUNDLE_PARTIAL_FAILURE | bundle atomicity violation (DB transaction roll-back) |
| ESIGN_PROPS_MISSING | caller-supplied props do not satisfy `props_schema_for(document_type)` from the active binder (per §2.8 step 2) |
| ESIGN_PROPS_TOO_LARGE | caller-supplied props JSON-serialize to > 450 bytes -- the architectural hard cap derived from SPL Memo's per-instruction limit. Document types whose per-instance data would exceed this must reshape (e.g., move bulk content into the binder template, reference by id in props) |
| STALE_BINDER_SIGNATURE | caller's `legal_binder_tx_id` does not match `getActiveBinder().arweave_tx_id`. At MVP this is dormant (only one binder exists); activates post-MVP when binder revisions land. |
| ESIGN_WALLET_NOT_PROVISIONED | user has no Solana wallet yet (e.g., CMA capture attempted before Magic provisioning completed) |
| ESIGN_USER_REFUSED | user declined to sign the Solana tx in Magic's modal |
| ESIGN_SOLANA_BROADCAST_FAILED | Solana RPC rejected the tx (rare; usually a temporary network issue) |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | `user_id` resolves to an authenticated `users` row |
| Pre (Solana-tx capture) | `users.wallet_address` is non-null (Magic wallet provisioned). Sign-cma provisions on the same flow -- the dispatcher waits for `magic.user.getInfo().wallets.solana.publicAddress` before building the CMA tx |
| Pre (SALES_AGREEMENT) | `image_id` exists; image in `live` status |
| Post (broadcast) | Solana tx broadcast accepted; `signatures` row inserted with `solana_tx_signature` populated + `confirmation_status='pending'` + `legal_binder_tx_id` matches the caller-supplied value |
| Post (confirmation; async, via sweeper) | `confirmation_status` flips to `'confirmed'` with `confirmed_at` stamped, typically within 1-2 seconds of broadcast |
| Post (CMA) | caller may create `creators` row in same DB txn (INV-2); Solana confirmation is NOT a prereq for the role-row creation -- the broadcast is sufficient evidence of intent |
| Post (MJA) | caller may create `owners` row in same DB txn (INV-2) |
| Post (COA) | caller may assign image-id + encrypt Original (INV-2) |
| Post (SALES_AGREEMENT) | caller may dispatch deed mint (INV-2) |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | authed user with Solana wallet; CMA text rendered with legal_name | `captureSignature(CMA)` | Solana tx broadcast accepted; row inserted with `solana_tx_signature` + `confirmation_status='pending'`; `signing_event_id` returned |
| AC-02 | first purchase | `bundleSign(MJA, SALES_AGREEMENT_buyer)` | **two separate Solana txs broadcast** (one per signature; same click event); two DB rows inserted |
| AC-03 | image in `draft` (founder-approved); creator at Card 1 | `bundleSign(COA, SALES_AGREEMENT_creator)` | two rows inserted (COA + creator's SALES_AGREEMENT); two Solana txs broadcast; both filtered to the image_id; SALES_AGREEMENT `p` field carries platform-default royalty/edition values from the active binder |
| AC-04 | returning buyer with MJA on file | second purchase | only SALES_AGREEMENT_buyer captured; MJA skipped |
| AC-05 | identical document re-signed | binder entry resolved | same `legal_binder_tx_id` + `document_id` pair; new Solana tx (each click is a distinct event even when document is unchanged) |
| AC-06 | bundle DB-mid-failure | second DB insert errors | DB txn rolls back; `ESIGN_BUNDLE_PARTIAL_FAILURE` returned; broadcast txs continue to confirm on Solana (cannot un-broadcast) and are reconciled by the sweeper into orphan-tx state |
| AC-07 | user clicks "I agree" but declines Magic's signing modal | `captureSignature(...)` | `ESIGN_USER_REFUSED` returned; no DB row inserted; no Solana tx broadcast |
| AC-08 | broadcast Solana tx fails to confirm within 60 seconds | sweeper observes timeout | `confirmation_status` flips to `'failed'`; downstream callers (e.g. mint dispatch) treat as unsigned per INV-2 |

## 2. Functional Requirements

### 2.1 Canonical Bytes Come From the Binder, Not the Caller
ESIGN does not accept rendered document text from the caller. The caller supplies `legal_binder_tx_id` + `document_id` + `props`; ESIGN fetches the binder (cached), reads `entries[document_id].content` as the canonical bytes the user is signing. Personalization (creator name, address, image_id, etc.) lives in `props` -- the binder stores templates; render-time substitution produces what the user sees, while the binder-stored template + the signer's props together prove what they agreed to.

### 2.2 Cryptographic Pinning of the Signed Bytes
The pair `(legal_binder_tx_id, document_id)` cryptographically pins the exact bytes the user signed: the tx_id resolves to an Arweave-immutable binder JSON, and `document_id` resolves within that binder to one fixed `entries[]` slot whose `content` is the canonical text. No document_version_hash is recorded -- it would be redundant since the binder is immutable on Arweave and the content_sha256 is derivable from the binder itself at audit time.

### 2.3 Bundled Signing
First-purchase MJA + Sales Agreement bundle under one click event. The bundle is a single UX click that **fires two Solana txs** -- one per document -- sharing the same click metadata in the DB.

The bundle's atomicity guarantee applies to the DB transaction: both `signatures` rows commit or neither. On Solana, the two txs broadcast independently. If the second broadcast fails after the first succeeded, the DB rolls back and the orphan first tx becomes a stale on-chain signature event with no DB referent -- harmless (each tx is just a Memo on Solana, not a state change), reconciled by the sweeper.

### 2.4 Per-Image Binding
- COA -> caller stamps `images.signing_event_id_coa`
- SALES_AGREEMENT (creator side) -> caller stamps `images.signing_event_id_sales_agreement_creator`
- SALES_AGREEMENT (buyer side) -> caller stamps `purchases.signing_event_id_sales_agreement_buyer`
- CMA and MJA carry `image_id = NULL`

### 2.5 INV-2 Ordering

| Signature | Precedes | Pattern |
|---|---|---|
| CMA | `creators` row | one txn: capture then create |
| MJA | `owners` row | one txn; bundled with SALES_AGREEMENT (buyer side) on first purchase |
| COA | image-id assignment + Original encryption | precedes R71 §2.2 step 7; bundled with SALES_AGREEMENT (creator side) at Card 1 |
| SALES_AGREEMENT (creator side) | image-id assignment + listing visibility | bundled with COA at Card 1 |
| SALES_AGREEMENT (buyer side) | deed mint dispatch | `purchases.signing_event_id_sales_agreement_buyer` non-NULL before mint |

### 2.6 Click Metadata

| Field | Source | On-chain? |
|---|---|---|
| `clicked_at` | server-time when the user's click reaches the API | YES (Memo `c` field) -- captures the act-of-consent moment, distinct from the tx's `blockTime` which records when the tx confirmed on-chain (1-5+ seconds later) |
| `ip_address` | request remote (proxy-aware) | NO (privacy) |

Per ESIGN Act (*Feldman v. Google* 2007) evidentiary integrity. The Solana tx signature alone is legally sufficient as the act of consent; click metadata adds defense-in-depth for ESIGN audits but is not load-bearing for the signature's validity.

### 2.7 No Email Delivery Here
COA / executed-agreement PDF delivery lives in the email subsystem (R62 §3.4). ESIGN ends at the Solana tx broadcast + `signatures` row insert.

### 2.8 Solana-tx Capture Mechanism

Each `captureSignature` invocation:

1. **Resolve binder + entry.** Fetch the binder by `legal_binder_tx_id` from the in-memory cache. Read `entries[document_id]` -> returns `{ type, content, content_sha256, props_schema, version }`. Validate `entry.type === document_type` (defense in depth) and `legal_binder_tx_id === getActiveBinder().arweave_tx_id` (reject stale clicks with `STALE_BINDER_SIGNATURE` -- dormant at MVP since only one binder exists).
2. **Validate caller-supplied props against `props_schema_for(document_type)`.** Reject with `ESIGN_PROPS_MISSING` if any required key is absent. For COA + SALES_AGREEMENT the caller supplies `{ image_id }`; for CMA + MJA the caller supplies `{}`.
3. **Build the Memo payload** per the unified field schema in §1.1 -- abbreviated-key JSON: `{ t: <document_type>, d: <document_id>, b: <legal_binder_tx_id>, p: <props>, c: <clicked_at> }`. Reject with `ESIGN_PROPS_TOO_LARGE` if the JSON-serialized payload exceeds 566 bytes (the SPL Memo per-instruction limit).
4. **Build the Solana transaction.**
   - Payer: `HOT_OPS_KEY` (platform pays the ~$0.000005 SOL fee; user is charged $0)
   - Instructions: `MemoProgram` with the JSON payload
   - Required signers: `[HOT_OPS_KEY, user_wallet]`
5. **Have the user wallet sign.** Magic SDK: `magic.solana.signTransaction(...)`. Returns the user-signed serialized tx. **This is the cryptographic act of consent** -- only the user can produce a valid signature against the wallet pubkey on `users.wallet_address`. If the user dismisses Magic's modal, throw `ESIGN_USER_REFUSED`.
6. **Sign + broadcast.** Platform side adds `HOT_OPS_KEY`'s signature; submit via Solana RPC (Helius in production for sub-slot latency). Receive `tx_signature` on broadcast acceptance.
7. **Insert the DB row.** `Signature` row with `solana_tx_signature = <tx_sig>`, `confirmation_status = 'pending'`, click metadata from the request, and `document_version = binder.entries[document_id].version` (denormalized from the binder fetched in step 1 for fast UI display). INV-2 ordering preserved: caller proceeds to create the role row in the same DB transaction; Solana confirmation runs in the background.
8. **Return** `{ signing_event_id, solana_tx_signature, confirmation_status: 'pending' }`.

### 2.9 Confirmation Sweeper

A background worker (`signature_confirmation_sweeper`) runs every 5 seconds:

- Selects `Signature` rows where `confirmation_status='pending' AND created_at > now() - interval '60 sec'`.
- For each, calls Solana RPC `getSignatureStatuses([tx_sig])`.
- If the response is `confirmed` or `finalized`: update `confirmation_status='confirmed'`, stamp `confirmed_at = now()`.
- If `created_at` is older than 60 seconds AND the tx has not appeared on Solana: update `confirmation_status='failed'`. Log a warning; downstream callers re-check before treating the signature as valid.

Confirmation is async by design -- the UX returns success on broadcast (~50-200ms with Helius), and downstream operations like role-row creation, image-id assignment, and deed mint dispatch are sequenced against the broadcast (not confirmation). This trades a ~1-2 second window where a `'pending'` signature could in principle fail to confirm against perceived latency. Risk mitigated by the sweeper's `'failed'` flip + downstream re-check, and by the fact that broadcast-accepted txs almost always confirm on a healthy network.

### 2.10 `signatures` Row Schema

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key; this is the `signing_event_id` returned to callers |
| `user_id` | UUID | Auth-verified signer |
| `document_type` | enum | 3-byte code matching the Memo `t` field |
| `document_id` | string (5) | Base64 opaque id matching the Memo `d` field |
| `document_version` | string | E.g., `1.0`, `1.1`. Denormalized from `binder.entries[document_id].version` at insert time. Recoverable from the binder fetch but stored here for fast UI display ("Sales Agreement v1.1") without a per-render binder round-trip. Not on the Memo -- Arweave-derivable. |
| `legal_binder_tx_id` | string (43) | Base64url tx_id matching the Memo `b` field |
| `props` | JSON | Per-document instance fields matching the Memo `p` field |
| `ip_address` | string | Click metadata; never on-chain |
| `clicked_at` | DateTime | Server-time at insert; matches the Memo `c` field |
| `solana_tx_signature` | string | base58 Solana tx signature; populated on broadcast |
| `confirmation_status` | enum string | `pending` \| `confirmed` \| `failed`. Default `pending` |
| `confirmed_at` | DateTime? | Stamped when sweeper sees confirmation |

## 3. Architecture

Two-row capture per click. Each esign click commits one DB row (`signatures` table; UUID primary key = `signing_event_id`) AND broadcasts one Solana Memo tx co-signed by the signer's wallet. The DB row is the read-fast surface (sub-ms join by UUID for UI, deed metadata, binder lookups); the Solana tx is the trustless on-chain anchor (any verifier can reconstruct the click independently of the platform). Both must succeed or the API returns failure; downstream callers (deed mint, role-row creation) consume the `signing_event_id` and re-check `confirmation_status` before treating the signature as load-bearing.

Canonical bytes come from the binder, not the caller. The `legal_binder_tx_id` input points to the Arweave-resident binder JSON; the API fetches that binder and derives the document bytes from `binder.entries[document_id]`. The caller never supplies the body. This collapses the trust surface: a malicious or buggy caller cannot substitute alternative legal text under a real user's click.

Memo schema is fixed and compact. The Solana Memo payload is JSON `{ t, d, b, p, c }`: `t` = 3-byte document_type code, `d` = base64 opaque document_id, `b` = base64url binder tx_id, `p` = per-document props, `c` = click timestamp. Memo is rate-limited and size-capped on Solana; this shape stays under both limits for every supported document type. PII (IP address, user agent) is never on-chain -- it lives only on the DB row.

Confirmation is async by design. Broadcast returns success at ~50-200ms; the `signature_confirmation_sweeper` (in-process worker, 5-second tick) polls Solana RPC `getSignatureStatuses` and flips `confirmation_status` to `confirmed` or `failed`. Downstream pipelines (deed dispatch, role-row insert) are sequenced against broadcast, not confirmation -- accepting a ~1-2 second window where a `'pending'` signature could fail. Mitigations: sweeper's `'failed'` flip + downstream re-check before any operation depending on the signature treats it as valid.

Bundled signing minimizes click count. On first creator action the platform captures CMA + COA in one click; on first purchase, the buyer captures MJA + SAL in one click; subsequent purchases capture SAL alone (MJA is per-buyer-lifetime). This pattern is enforced at the route layer (`captureSignature` accepts an array of document_type entries) and produces one DB row + one Solana tx per logical document, all sharing the same `clicked_at` timestamp.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Determinism | identical `(legal_binder_tx_id, document_id)` -> identical bytes; Solana tx signature varies per click (slot + nonce) |
| Atomicity (bundle DB) | both rows commit or neither |
| Audit | every row produces a Pino `db.mutation` log line (R71 §3.6); every Solana tx is permanent ledger |
| Append-only | no UPDATE / DELETE paths exposed; the only mutating field on a row is `confirmation_status` flipping `pending -> confirmed` / `pending -> failed` |
| Perceived latency (broadcast) | <= 200ms p95 (~50-100ms RPC round-trip; broadcast acknowledgement is the user-facing finish line, not Solana confirmation) |
| Confirmation latency (async, sweeper) | <= 2 seconds p95 with Helius; <= 5 seconds p99 |
| Cost per ESIGN | ~$0.000005 SOL (Solana base fee + Memo); platform-paid; ~$0.00002 per deed (4 sig events: CMA, COA, MJA, LICENSE) |
| Privacy | Click metadata (IP) is DB-only; on-chain Memo carries only document_type code / document_id / binder tx_id / props / clicked_at -- no PII |

## 5. Dependencies

| Dependency | Role |
|---|---|
| `signatures` table (Prisma) | append-only ledger of click metadata + Solana tx pointers + confirmation status |
| identity | resolves `user_id`; provides `users.wallet_address` (Magic-provisioned); role-row creation downstream per INV-2 |
| legal_binder | provides the active binder URI + per-document hash via `getActiveBinder()` |
| rights | provides Sales Agreement text template |
| email (R62 §3.4) | COA / PDF delivery -- out of MVP scope here |
| Magic SDK (client) | `magic.solana.signTransaction(...)` produces the user-wallet signature on each ESIGN tx |
| Solana RPC (server) | broadcast the signed tx, fetch confirmation status; Helius in production for sub-slot latency, devnet public RPC at MVP |
| Solana Memo Program | the canonical "carry arbitrary JSON on a Solana tx" instruction; no custom program needed at MVP |
| `signature_confirmation_sweeper` worker | flips `confirmation_status` async post-broadcast |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Click-event integrity scope: R62 §3.4 mentions browser fingerprint; R71 omits it. Capture or not? Currently uncaptured. |
| OI-02 | **Bundle-atomicity vs Solana-broadcast-atomicity** for bundleSign(MJA, SALES_AGREEMENT). DB rows are atomic; Solana broadcasts are not (each tx is independent on the chain). If the second Solana tx fails to broadcast after the first succeeds, the DB rolls back -- the orphan first tx becomes an unreferenced on-chain signature event. Harmless in isolation (it's just a Memo), but if combined volume becomes noisy, consider batching both Memos into one Solana tx (one tx with two Memo instructions, both user-signed). |
| OI-03 | **MVP scope choice.** Full Solana-tx capture for all four signature types adds ~4 wallet-prompt confirmations to a buyer's first-purchase flow. MVP could ship Solana-tx capture only for the **high-stakes one-time signatures** (CMA at sign-cma, MJA at first purchase -- both single events per user lifetime) and defer COA + SAL (per-image, higher-volume) to post-MVP. Click metadata + the binder reference continue to anchor the deferred ones at MVP. |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| identity | DID-token resolution; Magic Solana wallet provisioning (prereq for Solana-tx capture); role-row creation downstream of capture |
| legal_binder | binder architecture + `getActiveBinder()` -- the document version registry consumed at signing time |
| rights | Sales Agreement text template + render helpers |
| moderation | founder approval gates COA capture (image must be `draft`) |
| registry/deed.md | `creator_coa_signing_event_id`, `creator_sales_agreement_signing_event_id`, and `buyer_sales_agreement_signing_event_id` fields in the deed metadata JSON; the Solana tx signatures recorded here are referenced from deed.md via the `signing_event_id`s; the binder URI denormalized to the deed JSON matches the one in the ESIGN tx Memos |
| Magic SDK `magic.solana.signTransaction` | wallet-side signature on each ESIGN Solana tx |
| Solana Memo Program | the on-chain instruction carrying the ESIGN payload |
| R71 §2.1 step 3 | CMA |
| R71 §2.2 step 6 | COA |
| R71 §2.4 step 4 | bundled MJA + SALES_AGREEMENT (buyer side) -- first purchase |
| R71 §3.6 `signatures` | data model; full schema in §2.10 |
| R71 §3.7 rows 4, 7, 14, 16 | signing endpoints |
| R62 §3.4 Contract Architecture | document text + COA email |
| Constitution INV-02 | platform MUST NOT hold buyer privkeys -- the property that makes the user's wallet signature on each ESIGN tx unforgeable |
| Constitution INV-2 | ESIGN precedes its entity |

---
*Last Updated: 26/06/12 18:00*
