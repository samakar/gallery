# ESIGN Subsystem

ESIGN-compliant clickwrap capture for the four MVP signature artifacts per INV-2: CMA, MJA, Image Signing Affirmation (ISA), per-image License Acceptance. Each signature precedes the entity it admits (CMA -> `creators`; MJA -> `owners`; ISA -> image-id assignment; License Acceptance -> deed mint). All clicks land in the `signatures` table (R71 §3.6).

## 1. Interface

### 1.1 Inputs

#### captureSignature

| Field | Type | Notes |
|---|---|---|
| user_id | UUID | auth-verified |
| document_type | enum | `CMA` \| `MJA` \| `IMAGE_SIGNING_AFFIRMATION` \| `LICENSE_ACCEPTANCE` |
| document_text | string | Fully rendered text -- sha256 -> `document_version_hash` |
| document_version_label | string | Human-readable, e.g., `CMA-v1.0` |
| image_id | TEXT(5) or null | Required for ISA + LICENSE_ACCEPTANCE; null otherwise |
| click | object | `{ ip_address, session_token_hash, clicked_at }` |

#### bundleSign(MJA, LICENSE_ACCEPTANCE)
Atomic two-document capture for first-purchase (R71 §2.4 step 4). Shared click event; distinct signing_event_ids.

### 1.2 Outputs

`{ signing_event_id, document_version_hash }` per capture. Bundle returns both.

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| ESIGN_DOCUMENT_REQUIRED | downstream caller missing a required prior signature (R71 §3.7: `MJA_REQUIRED`, `LICENSE_REQUIRED` are caller surface forms) |
| ESIGN_BUNDLE_PARTIAL_FAILURE | bundle atomicity violation (transaction roll-back) |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | `user_id` resolves to an authenticated `users` row |
| Pre (LICENSE_ACCEPTANCE) | `image_id` exists; image in `live` status |
| Post | `signatures` row inserted with `document_version_hash = sha256(document_text)` |
| Post (CMA) | caller may create `creators` row in same txn (INV-2) |
| Post (MJA) | caller may create `owners` row in same txn (INV-2) |
| Post (ISA) | caller may assign image-id + encrypt Original (INV-2) |
| Post (LICENSE_ACCEPTANCE) | caller may dispatch deed mint (INV-2) |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | authed user; CMA text rendered with legal_name | `captureSignature(CMA)` | row inserted; signing_event_id returned |
| AC-02 | first purchase | `bundleSign(MJA, LICENSE_ACCEPTANCE)` | two rows under one click event |
| AC-03 | image in `draft` (founder-approved) | `captureSignature(ISA)` | row inserted with `image_id` |
| AC-04 | returning buyer with MJA on file | second purchase | only LICENSE_ACCEPTANCE captured; MJA skipped |
| AC-05 | identical text re-signed | hash compared | byte-identical `document_version_hash` |
| AC-06 | bundle mid-failure | second insert errors | txn rolls back; `ESIGN_BUNDLE_PARTIAL_FAILURE` |

## 2. Functional Requirements

### 2.1 Document Rendering Is the Caller's Concern
ESIGN does not template. The caller supplies the fully-rendered text (CMA personalized with legal identity; License Acceptance personalized per-image via the rights subsystem). ESIGN hashes the supplied text, records the click, returns the signing_event_id.

### 2.2 Document Version Hashing
`document_version_hash = sha256(document_text)`. Both the hash and the human label persist on the `signatures` row.

### 2.3 Bundled Signing
First-purchase MJA + License Acceptance bundle under one click event. Atomic: a partial failure rolls both back.

### 2.4 Per-Image Binding
- ISA -> caller stamps `images.signing_event_id_authorship`
- LICENSE_ACCEPTANCE -> caller stamps `purchases.signing_event_id_license`
- CMA and MJA carry `image_id = NULL`

### 2.5 INV-2 Ordering

| Signature | Precedes | Pattern |
|---|---|---|
| CMA | `creators` row | one txn: capture then create |
| MJA | `owners` row | one txn; bundled with LICENSE_ACCEPTANCE on first purchase |
| ISA | image-id assignment + Original encryption | precedes R71 §2.2 step 7 |
| LICENSE_ACCEPTANCE | deed mint dispatch | `purchases.signing_event_id_license` non-NULL before Crossmint |

### 2.6 Click Metadata

| Field | Source |
|---|---|
| `clicked_at` | server-time at insert |
| `ip_address` | request remote (proxy-aware) |
| `session_token_hash` | sha256 of the DID token used to authorize |

Per ESIGN Act (*Feldman v. Google* 2007) evidentiary integrity.

### 2.7 No Email Delivery Here
COA / executed-agreement PDF delivery lives in the email subsystem (R62 §3.4). ESIGN ends at the `signatures` row insert.

## 3. Non-Functional Requirements

| Property | Specification |
|---|---|
| Determinism | identical text -> identical `document_version_hash` |
| Atomicity (bundle) | both rows commit or neither |
| Audit | every row produces a Pino `db.mutation` log line (R71 §3.6) |
| Append-only | no UPDATE / DELETE paths exposed |

## 4. Dependencies

| Dependency | Role |
|---|---|
| `signatures` table (Prisma) | append-only ledger |
| identity | resolves `user_id`; role-row creation downstream per INV-2 |
| rights | provides License Acceptance text template |
| email (R62 §3.4) | COA / PDF delivery -- out of MVP scope here |

## 5. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Persist rendered text or only hash? At MVP only the hash is stored; text is reconstructible from template + user/image state at signing time. Confirm sufficient for an ESIGN audit |
| OI-02 | Document version registry: templates + labels are hardcoded in call sites at MVP; a `document_versions` table is post-MVP |
| OI-03 | Click-event integrity scope: R62 §3.4 mentions browser fingerprint; R71 omits it. Capture or not? |

## 6. Cross-References

| Doc | Purpose |
|---|---|
| identity | DID-token resolution; role-row creation downstream of capture |
| rights | License Acceptance text template + render helpers |
| moderation | founder approval gates ISA capture (image must be `draft`) |
| R71 §2.1 step 3 | CMA |
| R71 §2.2 step 6 | ISA |
| R71 §2.4 step 4 | bundled MJA + LICENSE_ACCEPTANCE |
| R71 §3.6 `signatures` | data model |
| R71 §3.7 rows 4, 7, 14, 16 | signing endpoints |
| R62 §3.4 Contract Architecture | document text + COA email |
| Constitution INV-2 | ESIGN precedes its entity |

---
*Last Updated: 05/27/26 18:00*
