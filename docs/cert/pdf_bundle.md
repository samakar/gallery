# PDF Bundle (Onboarding + COA Attachment Generators)

Sibling to /docs/cert/email.md. Generates the six PDFs that email attaches: two master-agreement PDFs at onboarding (CMA, BMA/MJA) and the four-PDF COA bundle at first-sale mint (Certificate of Authenticity, Title Document, Purchase Receipt, License Acceptance Record). Per R62 §3.5, both parties retain these PDFs independently of the platform; they are the record-retention layer that satisfies ESIGN. Built with @react-pdf/renderer per ADR-0009-adjacent decision (single library across all six templates; the Document-Page-Text DSL is consistent with the React component idioms already used in the UI codebase).

## 1. Interface

### 1.1 Inputs

#### renderCmaPdf(props)
| Field | Type | Notes |
|---|---|---|
| signature_id | UUID | `signatures.id` of the CMA `signatures` row |
| signed_at | ISO 8601 | clicked_at from the signature row |
| document_version_label | string | e.g. `CMA-1.0-demo-2026-06-01` |
| document_version_hash | string (sha256 hex) | content anchor |
| legal_name | string | signed-by party identity |
| legal_address | JSON | street/city/state/postal/country |
| entity_type | string | `individual` | `llc` | `corp` |
| ip_address | string | click event metadata |
| body | string | rendered CMA text (the same text that was hashed) |

#### renderBmaPdf(props)
Same shape as CMA, with `legal_name = buyer's name`, document_type = `MJA` per the bundle, plus the per-image License Acceptance signing_event_id of the buyer's first-purchase License click.

#### renderCertificateOfAuthenticityPdf(props)
| Field | Type | Notes |
|---|---|---|
| image_id | string (5-char base-36) | |
| title | string | from `images.title` |
| creator_display_name | string | |
| creator_youtube_handle | string | for self-contained provenance reference |
| creation_date | ISO 8601 | `images.creation_date` |
| edition | string | `Unique` at MVP |
| asset_id | string | cNFT asset_id (Solana DAS) |
| solana_cluster | string | `mainnet` or `devnet` |
| sha256 | string (hex) | content hash of M+00 from variant_hashes |
| arweave_uri | string | encrypted Master Arweave URI |
| isa_signature_id | UUID | `signatures.id` of the creator's ISA |
| deed_page_url | string | `https://epimage.com/<image_id>/deed` |
| thumbnail_url | string | Cloudinary URL for the 500px Thumbnail variant -- fetched server-side and byte-embedded; the certificate is self-contained |
| minted_at | ISO 8601 | `Deed.minted_at` |

#### renderTitleDocumentPdf(props)
| Field | Type | Notes |
|---|---|---|
| transaction_signature | string | Solana on-chain mint tx signature |
| timestamp | ISO 8601 | mint block time |
| price_cents | int | `Purchase.amount_gross_cents` |
| royalty_pct | number | `images.royalty_pct` (10 at MVP) |
| creator_legal_name | string | from `creators.legal_name` |
| buyer_legal_name | string | from `creators` row indirectly; or `users.email` placeholder + monogram when no legal name |
| asset_id | string | |
| solana_cluster | string | |

#### renderPurchaseReceiptPdf(props)
| Field | Type | Notes |
|---|---|---|
| cma_version_hash | string | from `signatures.document_version_hash` for the creator's CMA |
| bma_version_hash | string | from buyer's MJA signature row |
| license_signing_event_id | UUID | per-image License Acceptance |
| asset_id | string | |
| transaction_signature | string | |
| timestamp | ISO 8601 | |
| price_cents | int | |
| creator_net_cents | int | 90% of price (`Purchase.amount_creator_net_cents`) |
| platform_net_cents | int | 10% (`Purchase.amount_platform_net_cents`) |

#### renderLicenseAcceptanceRecordPdf(props)
| Field | Type | Notes |
|---|---|---|
| signature_id | UUID | License Acceptance `signatures` row |
| document_version_label | string | License-1.0 or similar |
| document_version_hash | string | content anchor |
| clicked_at | ISO 8601 | |
| ip_address | string | |
| session_token_hash | string | from `signatures` |
| license_params | JSON | field-of-use, territory, term, commercial-use, etc. (R62 §3.5 line 318) |
| buyer_legal_name | string | |
| image_id | string | |
| title | string | for cross-reference |

### 1.2 Outputs

Each `renderXxxPdf(props)` returns `Promise<Buffer>` -- a binary PDF stream ready to attach to a Postmark envelope. Caller is responsible for naming the attachment (e.g. `coa-<image_id>.pdf`).

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| PDF_THUMBNAIL_FETCH_FAILED | The thumbnail URL didn't return a valid image (network / 404). Fallback: render the certificate WITHOUT the thumbnail and log the omission. The legal artifact still binds. |
| PDF_GENERATION_FAILED | @react-pdf/renderer threw mid-render (font load failure, invalid props). Caller does NOT retry without input fix |

### 1.4 Pre/Post Conditions

| Type | Condition |
|---|---|
| Pre | All required props populated. Caller validates upstream; PDF module trusts inputs |
| Pre | Custom fonts (EB Garamond for gallery register; IBM Plex Mono for hashes/URIs) registered at module load |
| Pre | For CoA: `thumbnail_url` is reachable from the server's network |
| Post (success) | Buffer is a valid PDF parseable by Acrobat / Preview / Foxit |
| Post (success) | Page count is deterministic per template (no overflow into unexpected pages) |
| Post (thumbnail-fetch failure) | CoA rendered without the thumbnail; warning logged; caller can decide to retry or accept |

## 2. Functional Requirements

### 2.1 Typography Register
Per R62 §4 + R67 §5: gallery-register surfaces use EB Garamond Italic (the Epimage wordmark register); all other text uses IBM Plex Mono for hashes / IDs / URIs and a clean sans for body. The PDFs are gallery-register documents (formal certificate aesthetic), so:
- Headings: EB Garamond Regular
- Body: IBM Plex Sans
- Hashes / IDs / URLs: IBM Plex Mono (so they're scannable and unambiguous)

Fonts registered once at module load via `Font.register`; bundled with the deployment (no runtime font fetch).

### 2.2 Self-Contained Artifact
Per R62 §3.5: each PDF is self-contained -- no external references that could break. Thumbnails are byte-embedded (not `<img src="https://...">`). URLs in the body are plain text (not hyperlinks that need clickable resolution). The PDF is readable indefinitely without network access.

### 2.3 Determinism
For audit / reproducibility: the same input props produce a byte-identical PDF. Avoid:
- `Date.now()` in templates (use the `signed_at` / `minted_at` props)
- random IDs in the PDF
- shipping fonts that get updated server-side without versioning

### 2.4 Hashes and IDs in Mono
Every sha256 hash, transaction signature, asset_id, and signing_event_id is rendered in IBM Plex Mono so visual comparison against the on-chain data is unambiguous.

### 2.5 Page Size
US Letter (8.5" x 11") at MVP. International addresses noted as OI.

## 3. Architecture

### 3.1 Module Layout

- `src/cert/pdf_bundle.tsx` -- one file. Exports the six `renderXxxPdf` functions and the shared subcomponents (`DocumentHeader`, `DataRow`, `SignatureBlock`, `Footer`). Templates are inline JSX inside this file (per CLAUDE.md "MVP code minimal and concise" memory). Splits into separate files only when individual templates exceed ~150 lines.
- `src/cert/email_templates.ts` -- sibling file holding the HTML email body renderers. Same role for emails as pdf_bundle.tsx is for PDFs; consumed by `src/cert/email.ts` and not called directly elsewhere. Spec: /docs/cert/email.md §3.4.
- `src/cert/fonts/` -- bundled font files (EBGaramond-Regular.ttf, IBMPlexSans-Regular.ttf, IBMPlexMono-Regular.ttf). Registered once at module-import time. Not yet shipped -- the PDFs currently use @react-pdf/renderer's bundled Helvetica/Courier defaults until the .ttf files are dropped in.

### 3.2 Shared Components

Inline React components reused across the six templates:
- `<DocumentHeader brand title subtitle />` -- Epimage wordmark, document type label, eyebrow text
- `<SignatureBlock signature_id signed_by signed_at ip_address />` -- the legally-binding click-event metadata table
- `<HashRow label hash />` -- monospace truncated hash with full value below
- `<DataRow label value mono />` -- generic label/value pair, monospace optional
- `<EmbeddedThumbnail src />` -- fetches the thumbnail bytes, wraps in `<Image>` from @react-pdf/renderer

### 3.3 Thumbnail Fetch
The CoA template fetches the thumbnail server-side at render time:
```ts
const imgResp = await fetch(thumbnail_url);
const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
// pass imgBuffer to @react-pdf/renderer <Image src={imgBuffer} />
```
On fetch failure, the template renders a placeholder ("Thumbnail unavailable -- see deed page for the image") and continues. The certificate's legal binding does not depend on the thumbnail presence.

## 4. Non-Functional Requirements

| Property | Spec |
|---|---|
| Render latency | <= 800 ms p95 per PDF on a 1 vCPU server. The COA bundle (4 PDFs) renders in <= 3.5 s wall-clock when generated in parallel via Promise.all |
| Output size | CoA with embedded thumbnail ~150-300 KB; other PDFs ~30-80 KB each. Total COA bundle ~500-700 KB -- comfortably under Postmark's 10 MB envelope cap |
| Determinism | Same input -> byte-identical PDF |
| Font subsetting | @react-pdf/renderer subsets fonts to only used glyphs by default; keeps output small |
| Cold start | Font registration happens at module import (first call pays ~200 ms; subsequent calls free) |

## 5. Dependencies

| Dep | Role |
|---|---|
| @react-pdf/renderer | All rendering |
| EB Garamond, IBM Plex Sans, IBM Plex Mono (Google Fonts SIL OFL) | Bundled fonts |
| fetch (global, Node 18+) | Thumbnail byte-fetch |
| email.md (consumer) | Calls these renderers and attaches results to Postmark envelopes |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | International addresses: legal_address shape supports international, but PDF rendering uses US-Letter page size. Out of MVP -- A4 toggle deferred |
| OI-02 | Long titles / display names that overflow expected column widths -- truncate vs wrap policy not specified. Inline cap at 80 chars; revisit if real data overflows |
| OI-03 | The CoA's `creator_youtube_handle` provides creator-provenance context but isn't strictly required by R62 §3.5 line 315. Including it for buyer-side reference; revisit if creators object to it appearing in the legal artifact |
| OI-04 | Thumbnail fetch failure currently logs + renders without thumbnail. Decide whether to: (a) accept reduced certificate, (b) retry once with backoff, (c) hard-fail the COA email send so it can retry later. Default at MVP: accept reduced certificate, log for ops review |
| OI-05 | Locale: dates rendered in `YYYY-MM-DD` UTC at MVP. Multi-locale formatting deferred |
| OI-06 | Reproducibility: same-input determinism not formally tested. Snapshot test against fixture PDFs is post-MVP work |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| email.md | Consumer; calls these renderers and attaches outputs |
| R62 §3.5 | Authoritative content spec for the four COA PDFs (lines 313-321) |
| identity.md §2.7 | Source of the `legal_name`, `legal_address`, `entity_type` data |
| post_mint.ts (applyMintSucceeded) | Trigger for CoA bundle generation |
| ADR-0009 | ESP decision; this module produces what ADR-0009's chosen ESP delivers |
| R67 §5 | Typography register guidance (EB Garamond reserved for gallery register; mono for hashes) |
| Constitution INV-2 | ESIGN precedes role-row creation; these PDFs are the buyer-retained copy of the ESIGN artifacts |

---
*Last Updated: 26/06/05 12:00*
