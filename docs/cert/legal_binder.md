# Legal Binder (Certification function)

Subsystem-level spec for permanent on-Arweave anchoring of the platform's signed legal posture. The five signed contract types (CMA, MJA, COA, SAL, DLN) are consolidated into a single **legal binder** JSON, uploaded to Arweave at MVP launch, immutable thereafter. Every signature captured references this binder's Arweave tx_id; every deed's mint-time metadata JSON denormalizes it. The exact text any party agreed to is recoverable forever, independent of the platform's git repo, database, or operational survival.

**MVP scope**: one binder (`binder_version: 1`), uploaded once at launch. The schema includes `binder_version` + `supersedes_arweave_tx_id` fields so the format supports future revisions, but binder revisions (CMA amendments, etc.) are out of MVP scope. Post-MVP revision workflow lives in `docs/deferred/legal_binder_revisions.md` (not written yet).

## 1. Interface

### 1.1 Binder JSON Schema (the artifact on Arweave)

A single JSON document carrying every legal artifact the platform binds users to. Uploaded to Arweave at every binder revision; immutable per upload.

**Top-level fields:**

| Field | Type | Size (bytes) | Notes |
|---|---|---|---|
| `binder_version` | integer | 1-4 | Monotonic base10 counter. At MVP, always `1`. The field exists to support future revisions without a schema migration. |
| `released_at` | ISO 8601 UTC string | 24 (`YYYY-MM-DDTHH:mm:ss.sssZ`) | When this binder was uploaded to Arweave. |
| `supersedes_arweave_tx_id` | base64url string \| null | 43 (fixed) \| null | Arweave tx_id of the previous binder. At MVP always `null` (only one binder exists). |
| `entries[]` | array of entry objects | ~10-30 KB total binder size | One element per document type (`CMA`, `MJA`, `COA`, `SAL`, `DLN`). Carries the full text of every signed document. Per-entry shape in the table below. |

**Per-entry fields (one row per item in `entries[]`):**

| Field | Type | Size (bytes) | Notes |
|---|---|---|---|
| `id` | base64 opaque string | 5 (fixed; e.g., `cma37`) | The on-chain `d` field of the ESIGN Memo. Generated at binder-registration time. |
| `type` | enum (3-byte code) | 3 (fixed) | The human-readable lookup key. Matches `Signature.document_type` / Memo `t` field. Codes: `CMA` \| `MJA` \| `COA` \| `SAL` \| `DLN`. |
| `version` | string | 3-5 (e.g., `1.0`) | Format `MAJOR.MINOR`. At MVP always `1.0` for each entry. Human-only; not on-chain. |
| `released_at` | ISO 8601 UTC string | 24 (`YYYY-MM-DDTHH:mm:ss.sssZ`) | When this doc version was finalized. |
| `format` | enum string | 2-4 (`md` \| `pdf` \| `html`) | File extension; tells renderers how to interpret `content`. |
| `notes` | string | varies | Release notes / rationale for this doc's current version. |
| `content` | string | varies (often KBs) | Canonical bytes of the document. Markdown source for signed docs; base64 PDF for `format: pdf`. |
| `content_sha256` | hex string | 64 | sha256 of `content`. For binder-integrity verification; not on-chain (Arweave immutability subsumes the need). |
| `props_schema` | JSON object | ~2-150 (varies by doc type) | Declares which per-instance fields are required when this document type is signed (or rendered, for COA). See "Per-document `props_schema`" table below. Hard cap **450 bytes** on the JSON-serialized prop *values* a signer supplies (per esign.md §1.1). |

The `props_schema` field is a JSON object where keys are prop names and values are type identifiers (`"string"`, `"number"`, `"boolean"`, or richer shapes at the cost of binder size). Defines the contract for:
- the Memo `p` field on each ESIGN Solana tx capturing a signature for this document type (per [esign.md §1.1](esign.md))
- the per-deed input bag a future tool combines with the doc's `content` to reconstruct what a specific signer agreed to (for signed docs) or render a specific instance (for COA)

For signed docs: capture-time validation rejects the click if any prop required by `props_schema` is missing. For COA: render-time validation rejects the request if the deed metadata doesn't carry every required prop.

**Per-document `props_schema` at MVP:**

| `type` | `props_schema` | Role |
|---|---|---|
| `CMA` | `{}` | Creator-platform contract; signed by creator at sign-cma. Not per-image or per-deed. |
| `MJA` | `{}` | Buyer-platform contract; signed by buyer at first purchase. Not per-image or per-deed. |
| `COA` | `{ image_id, sha256_master, creation_date, creator_display_name, edition_total }` | Signed by creator at Card 1. Certificate of Authenticity: per-image attestation of authorship + originality. `edition_total` matches the image-level field on the deed metadata JSON (1 at MVP per R71 §3.6; this deed's edition ordinal is on the cNFT leaf, not in this prop). Two presentation forms from one source: (a) signed markdown (the legal commitment) + (b) rendered PDF (the buyer's delivered certificate at mint, combining the signed markdown with per-deed props). |
| `SAL` | `{ image_id, royalty_pct, edition_total, platform_fee_pct }` | Per-image bilateral sale + use license. Signed twice per image -- once by creator at Card 1 (under platform-default terms), once by buyer at Card 4. `edition_total` naming matches deed.md and the deed metadata JSON. |
| `DLN` | `{ image_id, initials, owner_wallet_address }` | Master Download Notice. Signed by deed-holder at first `/v1/deeds/:imageId/download-master`. Click-wrap gating the irreversible `sealed → unsealed` custody-state transition + the on-chain UNSEAL Memo. Buyer's typed initials are the UX confirmation artifact; the buyer's wallet co-signs the resulting Solana-tx Memo per esign.md §2.8. Prevents accidental unseals -- see [D-22](../divergences.md). |

**Critical invariants:**
- One binder = one Arweave tx = one URI. Anyone with the URI can fetch the complete signed legal posture of the platform, no joins required.
- The binder is immutable once uploaded.
- The `entries[]` array carries the full text of every signed document type (`CMA`, `MJA`, `COA`, `SAL`, `DLN`).

**Storage layers (MVP, Arweave-authoritative):**

1. **In-memory cache** (process-lifetime) -- hot read path for every ESIGN call.
2. **Two local files** at `data/` (both gitignored):
   - `data/legal_binder.json` -- the full binder JSON, byte-identical to the Arweave object. Used for clickwrap rendering, props validation, version stamping.
   - `data/legal_binder.meta.json` -- `{ arweave_tx_id, uploaded_at }`. Holds the tx_id of the local file's binder (assigned at Arweave upload time; can't live inside the binder JSON itself).

**Cold-start sequence**:
- Server boots → read both files → populate in-memory cache → ready to serve.
- If either file is missing (fresh deploy on a new machine) → query Arweave by `Binder-Version=1` tag → write both files → populate cache.
- If `legal_binder.json` is corrupt (parse error or `sha256(file) ≠ binder.binder_sha256`) → re-fetch from Arweave + rewrite both files.

Both files are produced once at MVP launch by `registerBinder(1, entries)` and then never rewritten in MVP scope.

### 1.2 Operations

| Function | Signature | Notes |
|---|---|---|
| `registerBinder` | `(binder_version, entries[]) -> { ok, arweave_tx_id, binder_sha256 }` | Constructs the binder JSON, uploads to Arweave with `App-Name=Epimage` + `Document-Type=Binder` + `Binder-Version=<integer>` tags, atomically writes both `data/legal_binder.json` and `data/legal_binder.meta.json`, populates the in-memory cache. At MVP runs once at launch with `binder_version: 1`. |
| `getActiveBinder` | `() -> { binder_version, arweave_tx_id, binder_sha256, entries[] }` | Read-fast from in-memory cache. Used by ESIGN sign-time callers (sign-cma, Card 1 COA + creator-side SAL, Card 4 buyer-side SAL, first-purchase MJA), deed-mint dispatch, and image-page clickwrap renders. Sub-millisecond for the in-memory path; first cold read pays one disk read or one Arweave fetch. |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| ARWEAVE_UPLOAD_FAILED | Turbo upload threw; transient retry by caller |
| BINDER_NOT_FOUND | `getActiveBinder` when no local files exist and no Arweave object found by tag query |
| BINDER_ENTRIES_INVALID | A required document_type missing from entries[]; or duplicate `id` within entries[] |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | `entries[]` covers all four required document_types (CMA, MJA, COA, SAL, DLN); each entry's `content` is the byte-exact final form |
| Post | The binder JSON is permanently on Arweave at `arweave_tx_id`; `data/legal_binder.json` + `data/legal_binder.meta.json` written; in-memory cache populated |
| Post (audit) | Every signature captured after launch references this binder's tx_id on `Signature.legal_binder_tx_id` (per [esign.md §2.8](esign.md)) |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | A fresh binder bundling all 4 doc types | `registerBinder(1, entries)` at launch | Arweave tx confirmed; `arweave_tx_id` returned; local files written; in-memory cache populated |
| AC-02 | A signer at any ESIGN click point | Signature captured | `Signature.legal_binder_tx_id` = `getActiveBinder().arweave_tx_id`; Solana tx Memo embeds the same tx_id |
| AC-03 | A deed mint at Card 5 | `dispatch(...)` constructs the Arweave metadata JSON | JSON includes `legal_binder_tx_id` from `getActiveBinder()` -- single URI binding all five counterparty signatures (creator's CMA + COA + SAL; buyer's MJA + SAL) for the deed |
| AC-04 | A trustless audit post-cessation | Auditor has only a deed's on-chain `uri` | Fetch metadata JSON → read `legal_binder_tx_id` → fetch binder JSON from Arweave → read `entries[]` → reconstruct exact CMA, MJA, COA, SAL, DLN bytes any signer agreed to. Zero platform involvement. |

## 2. Functional Requirements

### 2.1 Documents Covered

| document_type | Canonical format | Repo source (current) | Signed? |
|---|---|---|---|
| CMA (Creator Master Agreement) | markdown | [legal/cma.md](../../legal/cma.md) | Yes -- creator at sign-cma |
| MJA (Master Joint Agreement) | markdown | [legal/mja.md](../../legal/mja.md) | Yes -- buyer at first purchase |
| COA (Certificate of Authenticity) | markdown signed by creator + PDF rendered at mint | [legal/isa.md](../../legal/isa.md) (operative source kept under its pre-rename `isa.md` filename per the build script's FILE_MAP; content carries the creator's authenticity attestation as the signed source; rendered to PDF at Card 5 via [src/cert/pdf_bundle.tsx](../../src/cert/pdf_bundle.tsx)) | Yes -- creator signs the markdown source at Card 1 per image. Renders to PDF at mint for buyer delivery (downstream of the signature). |
| SAL (per-image bilateral sale + use license) | markdown | [legal/license_acceptance.md](../../legal/license_acceptance.md) (operative source kept under its pre-rename filename per the build script's FILE_MAP; content combines the prior license-scope text with sale-terms) | Yes -- signed by creator at Card 1 (under platform-default terms at MVP) AND by buyer at Card 4 |
| DLN (Master Download Notice) | markdown | [legal/download_notice.md](../../legal/download_notice.md) | Yes -- signed by deed-holder at first `/v1/deeds/:imageId/download-master` per D-22 |

### 2.2 Single URI per Deed

Every deed records exactly one `legal_binder_tx_id` in its Arweave metadata JSON. SAL is signed twice per image -- once by the creator at Card 1 (bundled with the COA signature in one UX click), once by the buyer at Card 4 -- producing distinct `Signature` rows. Enforcement at mint dispatch:

1. Fetch the deed's creator's `Signature` rows: CMA + COA + SAL (creator side) filtered to this image_id.
2. Fetch the deed's buyer's `Signature` rows: MJA + SAL (buyer side) filtered to this image_id.
3. All five rows carry the same `legal_binder_tx_id` (at MVP, there's only one binder, so this is trivially satisfied).
4. Embed that tx_id as `legal_binder_tx_id` in the deed's mint-time Arweave metadata JSON.

A future tool wanting to render the deed's COA fetches the binder, walks `entries[]` for `type='COA'`, and combines the signed markdown with per-deed fields from the deed's metadata JSON (title, sha256, creator_coa_signing_event_id, etc.).

### 2.3 PDF Rendering (Mechanical Format Conversion)

Binder docs are stored as markdown (`entries[type].content`). For buyer / creator delivery they're rendered to PDF as email attachments. The renderer at [src/cert/pdf_bundle.tsx](../../src/cert/pdf_bundle.tsx) does **mechanical format conversion only**: there is no per-doc renderer spec because the content + props_schema are already fully specified by the binder.

For each binder-defined doc type (CMA, MJA, COA, SAL, DLN):

```ts
async function renderBinderDocPdf(type, signedProps): Promise<Buffer> {
    const binder = await getActiveBinder();
    const entry  = binder.entries.find(e => e.type === type);
    const text   = substituteProps(entry.content, signedProps);  // ${image_id} etc.
    return markdownToPdf(text);
}
```

The caller supplies `signedProps` matching `entry.props_schema` exactly. No additional fields are accepted -- the PDF is the binder's signed bytes in PDF form, nothing more.

**Operational PDFs not in the binder** -- Title Document (bill of sale) and Purchase Receipt (transaction record) -- are per-deed business artifacts generated at mint. Their content specs live in [registry/deed.md](../registry/deed.md), not here. Same renderer module produces them; their props come from deed + purchase rows, not from the binder.

**Output conventions** (apply to all PDFs from this renderer):
- US Letter at MVP
- Self-contained: no external references (no `<img src=https://...>`; URLs are plain text)
- Deterministic given identical inputs (no `Date.now()`, no random IDs)
- Typography per R67 §5: EB Garamond headings, IBM Plex Sans body, IBM Plex Mono for hashes/IDs/URLs

### 2.4 Resale: Transfer-Tx Memo Carries Current Binder

Per the resale architecture in [registry/deed.md §2.4](../registry/deed.md), each resale's Bubblegum `transfer_v2` Solana tx carries an **SPL Memo** with the new owner's rotating state, including the **`legal_binder_tx_id`** the new owner signed under -- which may differ from the binder under which the first sale happened. On each resale:

- Buyer signs MJA + SAL under the currently-active binder.
- The same Solana tx that performs the Bubblegum transfer also emits a Memo: `{ "t":"SALE", "p":<price_cents>, "b":<legal_binder_tx_id>, "m":<monogram>, "e":<new enc_final> }`. Atomic -- either the transfer + Memo both succeed, or both revert.
- The Arweave metadata JSON's `legal_binder_tx_id` is unchanged forever (it records the first sale's binder); the current owner's `legal_binder_tx_id` lives on their tenure-start transfer Memo on Solana.

**No side-car PDA, no custom Solana program.** The SPL Memo program is a deployed standard; one Memo instruction composed atomically with the Bubblegum transfer is all that's needed. This gives the operational read story two layers: "what was the legal regime at first sale" (Arweave metadata JSON) and "what is the legal regime under the current owner" (the Memo on their tenure-start transfer tx).

### 2.4.1 Audit-Truth Path

The cryptographically-authoritative record of which binder each historical owner agreed to is constructable from just **Solana + Arweave**:

| Witness | What it proves | Where it lives |
|---|---|---|
| **1. Buyer's ESIGN Memo txs** (per [esign.md §2.8](esign.md)) | The buyer's wallet -- privkey held only by them per INV-02 -- co-signed a Solana tx whose Memo payload includes `"b": "<legal_binder_tx_id>"`. The cryptographically-unforgeable consent record. | Solana ledger forever (queryable via `getSignaturesForAddress(buyer_pubkey)` filtered for Memo-program txs co-signed with `HOT_OPS_KEY`) |
| **2. Resale-tx Memo** (per [registry/deed.md §2.4](../registry/deed.md), post-MVP) | The Bubblegum `transfer_v2` Solana tx for each resale carries an atomic SPL Memo with `"b": "<legal_binder_tx_id>"` alongside `price`, `monogram`, and the new owner's `enc_final`. Buyer co-signs the tx. | Solana ledger forever |
| **3. Bubblegum transfer log** | Each ownership transition `{slot, from, to}` is recorded as a permanent Solana event. | Solana ledger forever |

The buyer's ESIGN Memo tx (witness 1) is **always authoritative** for "what did this buyer actually agree to," because it's signed directly by the buyer's wallet at the moment of consent. At MVP, witness 2 is not yet active (resale is post-MVP); witnesses 1 + 3 alone fully cover the audit-truth.

All witnesses live on Solana or Arweave -- no platform DB involvement on the audit-truth path.

## 3. Architecture

Single Arweave URI as the agreement-stack anchor. One JSON document on Arweave (~5-15 KB) holds the canonical bytes for every counterparty-facing legal document (CMA, MJA, COA, SAL, DLN) under `entries[]`. Every deed records exactly one `legal_binder_tx_id` in its on-chain Arweave metadata JSON. To reconstruct what any signer agreed to: fetch the binder, walk `entries[]` by document_type, read the bytes. Zero platform DB involvement; zero CDN dependence. This collapses the audit surface from "five legal documents living wherever the platform stored them" to "one Arweave object that survives platform cessation."

Markdown is the canonical signed bytes; PDF is mechanical conversion only. Each `entries[type]` carries content as markdown source. Esign captures the SHA-256 of those bytes as the signature target. PDF rendering ([src/cert/pdf_bundle.tsx](../../src/cert/pdf_bundle.tsx)) is a one-way deterministic markdown-to-PDF pass driven entirely by binder content + `props_schema`-validated props -- no per-doc renderer spec, no design choices at render time. The PDF that lands in the buyer's inbox IS the signed markdown, just typeset.

Resale binder mutation is on-chain via Memo, not via Arweave rewrite. The binder URI baked into a deed's Arweave metadata JSON is permanent; it records what binder governed the FIRST sale and is never rewritten. When a resale happens (post-MVP), the new owner signs MJA + SAL under the then-current binder. The new `legal_binder_tx_id` rides on the Bubblegum `transfer_v2` SPL Memo for that transfer tx (`{ "t":"SALE", "b":"<binder_tx_id>", ... }`), atomic with the ownership transition. Walking the Bubblegum transfer log from `transfer_v2` to `transfer_v2` reconstructs every successive owner's binder.

Authoritative audit is from Solana + Arweave alone. The cryptographically load-bearing record of any user's consent to a binder is their ESIGN tx (per esign §2.8) -- a Solana tx co-signed by their wallet, carrying `"b": "<binder_tx_id>"` in the Memo payload. Because INV-02 mandates that the platform never holds buyer private keys, that signature is unforgeable without the user's device. The platform DB is a read-fast mirror; the trustless record lives on Solana. Witness chain: ESIGN tx → Bubblegum transfer log → binder JSON → original document bytes. Platform absent from the chain at every step.

Active-binder versioning is one global at MVP, per-jurisdiction at MMP. `getActiveBinder()` reads the current binder pointer; the entry-point ESIGN routes embed `binder.tx_id` on every Signature row at insert time. New binders supersede old ones via version bump (e.g., 1.0 → 1.1) -- old binders remain on Arweave (immutable), but new signatures attach to the new binder. Stale Signature rows (carrying old binder ids) trigger a re-sign UI at the next ESIGN gate, so the mint-time enforcement that "all five Signature rows share the same `legal_binder_tx_id`" naturally rolls forward as users re-engage.

Operational PDFs (Title Document, Purchase Receipt) are NOT in the binder. They're per-deed business artifacts generated at mint from the deed + purchase rows -- not legally signed documents the buyer can replay against the binder. Their content spec lives in [registry/deed.md](../registry/deed.md). Same renderer module, different prop sources. This keeps the binder strictly to "documents a counterparty agreed to."

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Immutability | The binder is a permanent Arweave object; nothing is overwritten. |
| Read latency | `getActiveBinder()` hits the in-memory cache; ≤ 1 ms p95. Cache is populated at cold start from `data/legal_binder.json` (one disk read, ~ms). Arweave is fetched only when local files are missing or corrupt. |
| Local cache durability | `data/legal_binder.json` + `data/legal_binder.meta.json` are the operational source of truth. Both atomic-written via write-temp + rename. Cross-checked at read time: `sha256(legal_binder.json) === binder.binder_sha256`. Mismatch or missing file triggers Arweave re-fetch + rewrite. |
| Upload cost (one-shot, at launch) | ~$0.0005 via Arweave Turbo (~10-30 KB binder, 4 docs combined). |
| Privacy | Binder JSON is fully public on Arweave by design (legal artifacts are public). No PII inside `entries[]`. |

## 5. Dependencies

| Dependency | Role |
|---|---|
| `@ardrive/turbo-sdk` | Arweave upload |
| In-memory active-binder cache | Fast-read cache populated from Arweave on cold start |
| `signatures` table (extended with `legal_binder_tx_id` per [esign.md §2.8](esign.md)) | Per-signature pointer to the binder the signer agreed under |
| `cert/esign.captureSignature` | Reads `getActiveBinder()` at click time; stamps URI on the row + Solana tx Memo |
| `registry/cnft_dispatch.ts buildDeedMetadataJson` | Reads `getActiveBinder()`; embeds `legal_binder_tx_id` in the deed's mint-time Arweave metadata JSON |
| Admin tool / release script (`npm run release-binder`) | Operator runs this to release a binder revision |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Binder revision workflow is post-MVP. When binder revisions are introduced (CMA amendment, COA template polish, etc.), the workflow needs: (a) `npm run release-binder` script to compose + upload + write new files; (b) listing auto-suspension for creators whose CMA/COA/SAL are under the old binder; (c) re-sign UX for existing listings; (d) `getBinderByVersion` operation for historical audit lookups. Format already supports this via `binder_version` + `supersedes_arweave_tx_id`. |
| OI-02 | Multi-language binder support (post-MVP). i18n: an entry may carry per-language `content` (e.g., `content_en`, `content_fr`). Signatures would stamp which language the signer agreed under. |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| [cert/esign.md](esign.md) | Signature capture path -- resolves `getActiveBinder()` at click time, writes URI to `Signature.legal_binder_tx_id` and Solana tx Memo |
| [cert/identity.md §2.7](identity.md) | Creator profile capture at sign-cma -- entry point for CMA signature under the current binder |
| [registry/deed.md §1.1](../registry/deed.md) | Deed schema -- `legal_binder_tx_id` field; populated from this subsystem's `getActiveBinder()` |
| [registry/deed.md §2.4](../registry/deed.md) | Resale transfer-tx Memo carries `legal_binder_tx_id` (post-MVP) |
| [registry/arweave_master.md](../registry/arweave_master.md) | Sibling Arweave upload subsystem; shares the Turbo SDK infrastructure |
| [r62_r71_alignment.md §1.3](../r62_r71_alignment.md) | Architectural commitment captured for R62 reconciliation |
| `legal/*.md` | Canonical editing surfaces for each contract document |

---

*Last Updated: 26/06/12 18:00*
