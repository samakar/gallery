# Email (R62 §3.5 Record-Retention Layer)

Transactional email subsystem. **IN MVP** per R71 §1.1 for the R62 §3.5 legal-artifact subset: (a) `onboarding_creator` at sign-cma with executed CMA PDF, (b) `onboarding_buyer` at MJA capture with executed BMA/MJA PDF, (c) `coa_at_mint` at first-sale deed mint with the four-PDF certification bundle. These three variants are mandatory for launch because email functions as the buyer-retained evidence layer for ESIGN record-retention compliance and as court-admissible artifacts under state blockchain authentication statutes (R62 §3.5; Vermont 12 V.S.A. §1913). Other variants in §3.2 (`coa_at_resale`, `report_ack`, `takedown_notice`) remain out of MVP because their parent workflows are deferred -- they ship together when their workflow ships, riding the same sendEmail surface. ESP decision (Postmark) captured in ADR-0009. PDF generation is a sibling module (TBD: /docs/cert/pdf_bundle.md).

## 1. Interface

### 1.1 Inputs

Three **typed senders**, one per variant. Each wraps the private `sendEnvelope` so per-template prop type safety is enforced at compile time (preferred over the originally-spec'd `sendEmail(envelope)` discriminated-union approach -- the variant-typed shape is cheaper to use and harder to misuse).

#### sendOnboardingCreatorEmail({to, creator_display_name, cma, idempotency_key?})
`to`: single email address (creator). `cma`: `CmaPdfProps` (see /docs/cert/pdf_bundle.md §1.1). Idempotency key defaults to `onboarding_creator:<signature_id>`.

#### sendOnboardingBuyerEmail({to, buyer_display_name, bma, idempotency_key?})
`to`: single email (buyer). `bma`: `BmaPdfProps`. Idempotency key defaults to `onboarding_buyer:<signature_id>`.

#### sendCoaEmail({to[], image_id, title, creator_display_name, buyer_identifier, coa, title_document, purchase_receipt, license, idempotency_key?})
`to`: array of TWO addresses (creator + buyer; Postmark batches into one envelope). The four PDF prop bundles (`coa`, `title_document`, `purchase_receipt`, `license`) are typed per pdf_bundle.md §1.1. Idempotency key defaults to `coa:<image_id>`.

Common across all three:
| Field | Notes |
|---|---|
| stream | All three force `'transactional'`; no broadcast option at MVP |
| idempotency_key | Optional override; caller-supplied dedup token. Repeat calls with the same key return the original message_id |
| attachment generation | Each sender renders its PDF(s) internally via pdf_bundle, then attaches. Caller does NOT pre-render. |

### 1.2 Outputs

#### Success

| Field | Type | Notes |
|---|---|---|
| ok | true | |
| message_id | string | Postmark's `MessageID` -- the audit anchor; persisted on the workflow's row (e.g. `signatures.email_message_id`, `image_reports.ack_email_message_id`) |
| accepted_at | ISO 8601 | Server clock at the Postmark API success response |
| stream | string | Echoes envelope.message_stream |

#### Failure

| Field | Type | Notes |
|---|---|---|
| ok | false | |
| error_code | EmailErrorCode | Fixed taxonomy per §1.3 |
| message | string | Free-text from upstream when available; never includes envelope.props content (PII) |
| retry_after_seconds | number? | Populated on transient errors so the caller can schedule a retry |

### 1.3 Error Codes

| Code | HTTP-status-class | Trigger | Caller action |
|---|---|---|---|
| EMAIL_NOT_CONFIGURED | 503 | `POSTMARK_SERVER_TOKEN` env missing | Treat as platform fault; do NOT retry until env is fixed |
| EMAIL_INVALID_RECIPIENT | 400 | Address rejected by Postmark validation (malformed) | Surface to workflow; do NOT retry |
| EMAIL_SUPPRESSED | 400 | Recipient on Postmark suppression list (prior bounce / spam complaint / unsubscribe) | Mark `users.email_status='suppressed'`; manual ops review |
| EMAIL_ATTACHMENT_TOO_LARGE | 400 | Combined attachments exceed Postmark's 10 MB raw / 7.5 MB encoded limit | Caller must compress / split PDFs |
| EMAIL_TEMPLATE_VALIDATION | 400 | Template props don't match the variant's schema | Bug; surface at startup via type-narrowed union |
| EMAIL_RATE_LIMITED | 429 | Postmark account throughput throttle | Caller schedules retry per `retry_after_seconds`; default backoff 60s |
| EMAIL_UPSTREAM_TRANSIENT | 502 | Postmark API 5xx / network timeout | Caller schedules retry; exponential backoff capped at 1h |
| EMAIL_UPSTREAM_PERMANENT | 502 | Postmark API 4xx that isn't one of the above | Caller does NOT retry; alert on-call |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | Postmark Server Token populated; sending domain DNS-verified (SPF / DKIM / DMARC) |
| Pre | When `idempotency_key` is set, no prior success with that key (otherwise return the cached message_id) |
| Pre | All attachments total <= 10 MB raw |
| Pre | Recipients are NOT in the bounce / suppression list (caller may pre-check `users.email_status`; the typed senders do NOT pre-check today -- OI-10) |
| Post (success) | Postmark accepted the email; delivery to inbox is asynchronous and not part of this contract -- the caller's success means "queued for delivery," not "received" |
| Post (success) | `message_id` is durable; caller persists it on the originating row for audit trace |
| Post (success) | Postmark retains the full message (subject, headers, body, attachment metadata) for 45 days by default; 365 days on Pro+ plans (configurable per launch decision) |
| Post (failure, non-suppression) | No message sent; caller decides retry / surface |
| Post (suppression) | `users.email_status` updated; subsequent calls to same address return EMAIL_SUPPRESSED until manual review |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | Valid recipient + valid template + valid props | any typed sender | 200 with `message_id`; row's `email_message_id` updated |
| AC-02 | Recipient in suppression list | any typed sender | 400 EMAIL_SUPPRESSED; no message sent; `users.email_status='suppressed'` |
| AC-03 | Total attachments 12 MB | any typed sender | 400 EMAIL_ATTACHMENT_TOO_LARGE; no send |
| AC-04 | Same `idempotency_key` called twice | second call | 200 with the original `message_id` (no new send) |
| AC-05 | Postmark returns 503 (their outage) | any typed sender | 502 EMAIL_UPSTREAM_TRANSIENT with `retry_after_seconds=60`; caller schedules retry |
| AC-06 | `POSTMARK_SERVER_TOKEN` env missing | startup health check OR sendEmail | EMAIL_NOT_CONFIGURED; on-call alerted; no message sent |
| AC-07 | COA email with 4 PDFs total 8 MB sent to creator + buyer | any typed sender with `template='coa_at_mint'`, `to=[creator_email, buyer_email]` | Both recipients accepted in one call; one `message_id` returned (Postmark batches the To header) |

## 2. Functional Requirements

### 2.1 Legal Posture Per R62
This module is the operative implementation of R62 §3.5's record-retention layer:
- Onboarding email = creator/buyer-retained copy of the executed master agreement (CMA / BMA / MJA)
- COA email = both-parties-retained copy of the deed authentication bundle
- Email is admissible evidence under state blockchain authentication statutes (Vermont 12 V.S.A. §1913 explicitly cited by R62)
- The platform's role is delivery + audit-trace persistence; the parties retain the artifacts independently

Implication: deliverability into the inbox (not just queueing for delivery) is a load-bearing concern, not a UX concern. Justifies the ESP choice in ADR-0009.

### 2.2 ESP Choice
Postmark per ADR-0009. Justifications: industry-leading deliverability reputation, 45-day default audit retention (365 days on Pro+), transactional-only enforcement isolating COA email IP pool from any future broadcast use, R62-aligned legal posture. Migration cost to SES / Resend later is bounded to this module's surface; consumers (workflows / endpoints) are unaffected.

### 2.3 Module Surface Boundary
The three typed senders + `handlePostmarkWebhook` are the ONLY symbols callers invoke from email.ts. No direct Postmark SDK / fetch calls elsewhere in the codebase. Rationale: keeping all Postmark wire-format knowledge in one file lets the swap-the-ESP migration touch a single module. Lower-level `sendEnvelope` is private to email.ts.

### 2.4 No Block on Send
Callers in user-facing workflows (sign-cma, applyMintSucceeded) MUST NOT block their response on the typed senders. Pattern:
1. Workflow completes its DB transaction synchronously
2. `setImmediate(() => sendOnboardingCreatorEmail(...))` (or the appropriate variant) or job-queue-enqueue (TBD: see OI-06) fires the send
3. On send-success, an audit row is appended; on send-failure, the retry scheduler picks up

A failed COA email does NOT roll back the deed mint or sign-cma. The on-chain artifact is the load-bearing record; email is the buyer-retained copy. If email fails, the operations team re-sends out-of-band.

### 2.5 Idempotency
Callers MUST pass an idempotency_key tied to the underlying event (e.g. `'signature:' + signature_id` for onboarding, `'coa:' + deed_id` for mint emails). Prevents duplicate sends if the workflow retries.

### 2.6 Template Variable Type Safety
Each template variant has a typed props schema (TypeScript discriminated union). Compile-time enforcement prevents "template expects {creator_name} but caller passed {name}" bugs. Postmark's template engine (Mustache) is logic-less; all conditionals + formatting happen in the caller before send.

### 2.7 PII Treatment
Per identity.md §2.8.5 + image_report.md §2.6: email addresses, body content, and recipient PII MUST NOT be logged at info level. Pino bindings emit `{template, message_id, to_count, attachment_count}` only. Full envelope detail at debug level only, behind a runtime flag (off in production).

### 2.8 Suppression Handling
- On bounce / complaint webhook from Postmark, this module updates `users.email_status` to `'suppressed'`
- sendEmail short-circuits with EMAIL_SUPPRESSED on subsequent attempts to that address
- Operations dashboard surfaces suppressed users for review (template: account compromise indicator vs. legitimate bounce)
- CAN-SPAM list-unsubscribe headers on every send

## 3. Architecture

### 3.1 Flow

```
Workflow                    email.ts                Postmark            Recipient
   |                           |                       |                   |
   | DB txn commits (mint /    |                       |                   |
   | sign-cma / etc.)          |                       |                   |
   |---fire-and-forget-------->|                       |                   |
   |                           |--POST messages/email->|                   |
   |                           |<--{MessageID, ...}---|                   |
   |                           | (audit-row insert)    |                   |
   |                           |                       |--queue->deliver->|
   |                           |                       |<--bounce/open---|
   |                           |<--webhook------------|                   |
   |                           | (update suppression /  |                   |
   |                           |  enrich audit row)     |                   |
```

### 3.2 Template Inventory

| Template | R62 §3.5 mapping | Trigger | Attachments | Recipients | Stream |
|---|---|---|---|---|---|
| `onboarding_creator` | Onboarding email (CMA) | End of `POST /v1/creator/sign-cma` transaction | PDF: executed CMA; PDF: terms summary; record-retention notice (inline text). Body also carries the recovery-key link (see §3.2.1) | creator | transactional |
| `onboarding_buyer` | Onboarding email (BMA / MJA) | End of MJA capture at first purchase | PDF: executed MJA (and per-image License Acceptance bundle if applicable); PDF: terms summary; record-retention notice. Body also carries the recovery-key link (see §3.2.1) | buyer | transactional |
| `coa_at_mint` | COA email -- first sale | End of `applyMintSucceeded` in `src/registry/post_mint.ts` | 4 PDFs: Certificate of Authenticity (with thumbnail embedded inline, see §3.3), Title Document, Purchase Receipt, Per-image License Acceptance record. Email BODY also contains: (a) inline thumbnail (cid:thumbnail or `<img>` to platform CDN), (b) link to the deed page (`https://epimage.com/<image_id>/deed`), (c) routing copy noting the four PDFs are attached for retention, (d) the recovery-key link (see §3.2.1) | creator + buyer (one envelope, both `to`) | transactional |
| `coa_at_resale` | COA email -- resale / license migration | End of resale dispatch (post-MVP) | Same 4 PDFs, regenerated with new buyer's data | new buyer + (optional) seller | transactional |
| `report_ack` | Not R62 -- image_report.md OI-04 obligation | When report submitted with reporter_email | None | reporter | transactional |
| `takedown_notice` | Not R62 -- takedown subsystem | When moderator flips deed_state to taken_down (post-MVP) | None (link to takedown.md surface) | creator + current deed holder | transactional |

### 3.2.1 Recovery-Key Link (Shared Across All Three Templates)

All three Live-MVP templates carry the same one-line paragraph linking to `${PLATFORM_BASE_URL}/recovery-key`:

> *Your Epimage wallet's recovery key is held by Magic, not Epimage. You can retrieve it any time -- [here's how](.../recovery-key).*

The URL is wired in [`src/cert/email.ts`](../../src/cert/email.ts) at all three send sites. The destination is the public `/recovery-key` instructions page rendered by [`src/ui/RecoveryKey.tsx`](../../src/ui/RecoveryKey.tsx); end-to-end flow + rationale in [identity.md §2.6.1](identity.md#261-recovery-key-retrieval). Same link text + same target across templates so users see the same prompt at every touchpoint (welcome and every purchase).

### 3.3 PDF Bundle Composition (R62 §3.5)

Sibling module (TBD: pdf_bundle.md). At a glance, the four COA attachments are:

| PDF | R62 source | Generated by |
|---|---|---|
| Certificate of Authenticity | R62 §3.5 (line 315) | Per-image: **embedded thumbnail at top** (the unwatermarked Thumbnail variant, 500 px long-edge per R62 §2.2 -- fetched from Cloudinary and bytewise-embedded in the PDF so the certificate is a self-contained artifact even if the platform disappears), creator name, title, year, edition, content hash (sha256 of M+00 from variant_hashes), on-chain asset_id, Solana cluster, deed-page URL, creator's ISA signature record |
| Title Document | R62 §3.5 (line 316) | Per-transaction: parties' verified identities, transaction hash, timestamp, price, royalty percentage, on-chain deed reference; bill-of-sale equivalent |
| Purchase Receipt | R62 §3.5 (line 317) | Per-transaction: CMA version hash, BMA version hash, License Acceptance signing_event_id, NFT mint address, transaction hash, timestamp, price |
| Per-image License Acceptance record | R62 §3.5 (line 318) | Click-wrap evidence: license parameters + buyer's ESIGN signature with click-event metadata (timestamp, IP, browser fingerprint, session_token_hash, signing_event_id) |

PDFs are generated server-side at email-trigger time, attached to the envelope, NOT persisted on the platform after send (R62 puts the retention burden on the parties + Postmark's audit log, not on the platform's storage).

### 3.4 Module Layout

| File | Role |
|---|---|
| `src/cert/email.ts` | Postmark integration + the three typed senders (`sendOnboardingCreatorEmail`, `sendOnboardingBuyerEmail`, `sendCoaEmail`) + `handlePostmarkWebhook`. Public surface of the subsystem; everything else in the codebase imports from here. |
| `src/cert/email_templates.ts` | HTML body renderers (`renderOnboardingHtml`, `renderCoaHtml`) + escape helpers. One file holds every template variant; split per-variant only if a single template grows past ~80 lines (none do today). |
| `src/cert/pdf_bundle.tsx` | The six PDF generators (CMA, BMA/MJA, CoA, Title, Receipt, License) + shared subcomponents (`DocumentHeader`, `DataRow`, `SignatureBlock`, `Footer`). Single-file mirror of email_templates.ts -- consumed by the typed senders in email.ts, not called directly anywhere else. |
| `src/app/api/server.ts` | One route: `POST /webhooks/postmark/:token` for bounce / complaint callbacks. Dispatches to `handlePostmarkWebhook` in email.ts. |

Symmetry: email content lives in `email_templates.ts`, PDF content lives in `pdf_bundle.tsx`. Both are template-only files (no I/O, no DB); the integration logic stays in `email.ts`. Spec for pdf_bundle is at /docs/cert/pdf_bundle.md.

### 3.5 Webhook Integration

Postmark webhook posts to `POST /webhooks/postmark` on bounce / complaint / spam events. Handler:
1. Validates `X-Postmark-Signature` header against `POSTMARK_WEBHOOK_TOKEN` env
2. Updates `users.email_status` to `suppressed` for the bounced address
3. Inserts an audit row in (TBD: `email_events` table) with the event type + Postmark MessageID + reason
4. Returns 200 (Postmark retries on non-2xx)

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Send latency | <= 500 ms p95 for the API call to Postmark (excludes PDF generation); caller does not wait |
| Delivery time | Postmark median ~10 s end-to-end, not part of this module's SLA |
| Audit retention (Postmark side) | 45 days default; bumped to 365 days on Pro plan for production launch |
| Audit retention (platform side) | `message_id` retained indefinitely on the originating row (signatures, image_reports, etc.) |
| Attachment size | <= 10 MB raw per envelope; the COA bundle of 4 PDFs targets ~2 MB combined |
| Idempotency | `idempotency_key` ensures at-most-once semantics across caller retries |
| Retry on transient failure | Exponential backoff: 60 s, 5 min, 30 min, 2 h, 6 h; give up after 24 h and alert on-call |
| CAN-SPAM | List-Unsubscribe header on every send; one-click unsubscribe endpoint maintained (transactional emails are exempt but the header is cheap insurance) |
| GDPR / CCPA | reporter_email + recipient PII purgeable via account-deletion workflow (Postmark Server / Recipient deletion APIs) |
| Quota | Postmark Pro: 10k/mo at $15, then $1.30 per 1k; MVP volume fits in free tier (100/mo) for testing, scales to $15/mo at launch |

## 5. Dependencies

| Dependency | Role |
|---|---|
| Postmark Server (transactional stream) | Send infrastructure + 45/365-day audit retention |
| pdf_bundle (sibling module) | Generates the four COA PDFs + the onboarding agreement PDFs |
| `POSTMARK_SERVER_TOKEN` env | Server-side auth for the Postmark API |
| `POSTMARK_WEBHOOK_TOKEN` env | Signature secret for bounce / complaint webhook |
| `EMAIL_FROM_ADDRESS` env | The verified sender (e.g. `notifications@epimage.com`) |
| `users` (Prisma) | `email_status` column (post-MVP; pending schema propagation per OI-01) |
| `signatures`, `image_reports`, `purchases` (Prisma) | Persist `message_id` on the originating row for audit trace |
| `mustache` (or Postmark's template-id system) | Variable substitution into the template body |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Schema: `users.email_status` column doesn't yet exist. Needs `enum ('active' \| 'suppressed' \| 'unsubscribed')` + migration. Captured here, not at MVP build |
| OI-02 | Email events audit table: dedicated `email_events` table (message_id, type, recipient, timestamp, raw_payload) would aid forensics. Deferred -- `message_id` on origin rows is the minimum |
| OI-03 | PDF retention policy: R62 implies parties retain attachments via their inboxes. Platform-side retention of generated PDFs is OPTIONAL but valuable for re-issuance on bounce. Decision deferred to launch |
| OI-04 | Multi-language: at MVP all templates are English. R62 doesn't address multi-language record retention; check whether ESIGN compliance requires recipient-language master agreements |
| OI-05 | Unsubscribe semantics: transactional emails ARE legally required (record-retention) -- an unsubscribed user still needs to receive their CMA / COA. Reconcile with CAN-SPAM expectations; likely tag transactional class as "system-mandatory" in unsubscribe UI |
| OI-06 | Job-queue vs setImmediate for fire-and-forget send: setImmediate is sufficient at MVP volume; at scale a durable queue (BullMQ / pg-boss) handles process restart mid-send. Defer to scale-ramp |
| OI-07 | DMARC / DKIM / SPF rotation: Postmark domain key rotation policy. Document in runbook before launch |
| OI-08 | Postmark account tier: free 100/mo covers eval; first paid tier is $15/mo for 10k/mo. Cross with go-live checklist §4.8 |
| OI-09 | Inbound parsing: Postmark supports inbound email parsing (e.g. for reply-to-resolve report acks). Out of scope MVP -- deferred |
| OI-10 | Suppression pre-check: the typed senders don't query `users.email_status='suppressed'` before calling Postmark. Postmark's own suppression list catches it (returns `EMAIL_SUPPRESSED`), but we waste an API call. Pre-check is a one-line addition when traffic warrants |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| R62 §3.5 | Original spec for email delivery -- this module's authoritative source |
| R71 §1.2 | MVP deferral note + forward-binding to "Resend / Postmark / SES" |
| ADR-0009 | ESP comparison + Postmark decision rationale |
| identity.md §2.5, §2.7 | Triggers for onboarding emails (post-`sign-cma` for creators, post-MJA for buyers) |
| post_mint.ts (`applyMintSucceeded`) | Trigger for `coa_at_mint` email |
| image_report.md OI-04 | Trigger for `report_ack` (when reporter provides email) |
| takedown.md (deferred) | Trigger for `takedown_notice` email |
| go-live checklist §4.8 | Operational items: ESP account setup, sending domain DNS, PDF pipeline, hook points |
| pdf_bundle.md (TBD) | Sibling module; produces the attachments this module sends |
| Constitution INV-2 | ESIGN precedes role-row creation; the onboarding email IS the buyer-retained ESIGN copy |
| Constitution INV-10 | deed_state transitions are total; takedown email tracks the on-chain mutation |

---
*Last Updated: 26/06/07 18:15*
