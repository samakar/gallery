# Image Report (Third-Party Abuse / Safety / Rights Reports)

Anonymous-allowed third-party reporting surface on every listed-or-sold image page. A small footer link (`FooterReport` in `src/ui/Image.tsx`) opens a modal form: reason category + free-text description + optional contact email. On submit, the client mints a reCAPTCHA Enterprise token; the server verifies the token's score and persists an `image_reports` row. The moderation queue (a separate doc, deferred) consumes these rows. Distinct from `image_reviews` -- those are platform-internal moderation decisions per moderation.md; this module is the upstream surface that produces reports for moderators to act on.

## 1. Interface

### 1.1 Inputs

#### image_id
Path param. 5-char base-36 image handle. Must reference an `images` row in any status (we accept reports against `pending_review`, `live`, `sold`, `taken_down` -- past-tense reports against taken-down content remain valuable for moderator review).

#### reason
Required. One of: `rights` | `safety` | `fraud` | `quality` | `other`. Server-side whitelist in `VALID_REPORT_REASONS`.

#### description
Optional. Free text, server-side truncated to 2000 chars after trim. Empty / whitespace-only stored as `null`.

#### email
Optional even for anonymous reporters. Truncated to 254 chars. No verification performed (PII-treatment policy applies; see §3 NFRs). Signed-in reporters don't need to provide one -- the row's `reporter_user_id` FK does the linking.

#### recaptcha_token
Required. String, ~600 chars. Minted client-side by `grecaptcha.enterprise.execute(siteKey, { action: 'submit_report' })`. Expires ~2 minutes after generation -- caller must POST promptly.

### 1.2 Outputs

#### Success (HTTP 201)

| Field | Type | Notes |
|---|---|---|
| report_id | UUID | `image_reports.id` |
| submitted_at | ISO 8601 | `image_reports.created_at` |

### 1.3 Error Codes

| Code | HTTP | Trigger |
|---|---|---|
| IMAGE_NOT_FOUND | 404 | image_id does not reference a row |
| INVALID_REASON | 400 | reason not in the whitelist |
| MISSING_RECAPTCHA_TOKEN | 400 | recaptcha_token absent or empty |
| RECAPTCHA_HTTP_ERROR | 400 | Google's `assessments.create` returned non-2xx (server-log carries Google's specific reason -- often referer / API restriction misconfig) |
| RECAPTCHA_TOKEN_INVALID | 400 | `tokenProperties.valid === false` (expired, replayed, or minted for a different site key) |
| RECAPTCHA_ACTION_MISMATCH | 400 | `tokenProperties.action !== 'submit_report'` -- token replayed from a different flow |
| RECAPTCHA_LOW_SCORE | 429 | `riskAnalysis.score < RECAPTCHA_MIN_SCORE` (default 0.5). HTTP 429 (not 400) signals "ambiguous, retry"; UI surfaces a softer remediation copy |
| RECAPTCHA_NOT_CONFIGURED | 503 | Server env missing `RECAPTCHA_API_KEY`, `GOOGLE_CLOUD_PROJECT_ID`, or `VITE_RECAPTCHA_SITE_KEY` -- treat as platform fault |

Score / action details are NOT echoed to the caller (potential abuse-signal leak). Server log carries the full verdict via Pino.

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | Image row exists (any status) |
| Pre | recaptcha_token is fresh (< 2 min old) |
| Pre | Server env carries siteKey + projectId + apiKey |
| Post (success) | `image_reports` row exists with `recaptcha_score` populated and `status='open'` |
| Post (success) | `reporter_user_id` populated iff caller was Magic-authenticated |
| Post (failure) | No row written. The reCAPTCHA verdict is server-logged for audit but not persisted to DB |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | Signed-in user, valid token (score >= 0.5), valid reason | POST /v1/images/:id/report | 201 with `report_id`; row has `reporter_user_id` set, `recaptcha_score` recorded |
| AC-02 | Anonymous user, valid token, valid reason | same | 201; row has `reporter_user_id = null`; reported via the same surface as signed-in users |
| AC-03 | Anonymous user, optional `email` provided | same | 201; row carries `reporter_email`; email NOT verified, NOT surfaced publicly |
| AC-04 | reason = `'invalid'` | submit | 400 INVALID_REASON; no row written |
| AC-05 | recaptcha_token absent | submit | 400 MISSING_RECAPTCHA_TOKEN |
| AC-06 | Token minted with action `'login'` (replayed from another flow) | submit | 400 RECAPTCHA_ACTION_MISMATCH |
| AC-07 | Token returned with score 0.1 (bot-like) | submit | 429 RECAPTCHA_LOW_SCORE; UI shows softer "If you keep seeing this..." copy |
| AC-08 | Same user reports the same image twice | second submit | 201 both times. No dedupe at MVP; moderation queue UI dedupes at read time (OI-02) |
| AC-09 | RECAPTCHA_API_KEY missing from server env | submit | 503 RECAPTCHA_NOT_CONFIGURED; logged as platform fault |
| AC-10 | Description = 5000 chars of text | submit | 201; row stores description truncated to 2000 chars |

## 2. Functional Requirements

### 2.1 Anonymous-Allowed
No auth gate. `authAsync(req)` is consulted only to attribute via `reporter_user_id` when present; absence is not a rejection. This preserves the most important safety-report case: anonymous CSAM / minor-protection reports where the reporter must not be required to identify.

### 2.2 reCAPTCHA Enterprise as the Spam Gate
Per product decision the reCAPTCHA score is the **sole** anti-spam mechanism. No rate limiting per IP, no per-image dedupe, no honeypot, no per-user throttle. The argument: rate-limit + dedupe + honeypot defend against trivial floods that any motivated actor bypasses anyway; reCAPTCHA Enterprise's ML-based score catches both bot floods AND coordinated brigading more effectively. Trade-off accepted: a real spam wave could in principle pollute the report queue while reCAPTCHA learns; moderators handle backlog manually if it materializes (operational, not architectural).

### 2.3 Score Threshold
`RECAPTCHA_MIN_SCORE` env var, default `0.5`. Google's recommended starting point for "ambiguous form submissions." Tune downward if legitimate-user rejections appear in operations; tune upward if spam slips through. Threshold is checked at submit; the actual score is persisted regardless so post-hoc moderation can revisit borderline cases.

### 2.4 Action Binding
The client passes `action: 'submit_report'` to `grecaptcha.enterprise.execute`; the server's `verifyRecaptchaToken` requires the returned token's `tokenProperties.action` to match. Prevents token replay from other flows (e.g. a sign-cma token can't be replayed as a report token). The action label is exported as `RECAPTCHA_EXPECTED_ACTION` from `src/cert/recaptcha.ts`.

### 2.5 Audit Persistence
`recaptcha_score` and `recaptcha_action` are stored on every accepted row. Drives:
- Per-image score distribution analysis (moderators can sort by lowest-score reports first)
- Tuning data for the `RECAPTCHA_MIN_SCORE` threshold over time
- Post-hoc forensics if a coordinated campaign is detected

### 2.6 PII Treatment for reporter_email
Optional field; when present, treated as PII:
- Not surfaced in any public-facing UI
- Visible only to moderators in the (deferred) moderation queue UI
- Retention policy: purged after report `status` reaches a terminal state (`reviewed` | `dismissed` | `actioned`) + 90 days (OI-03)
- Never logged via Pino at info level

## 3. Architecture

### 3.1 Flow

```
Browser                          Server                      Google
  |                                |                            |
  | (open report modal)            |                            |
  |--load reCAPTCHA script-------->|                            |
  |                                                             |
  | (user submits form)                                         |
  |--grecaptcha.execute('submit_report')------------------------|
  |<---token-----------------------------------------------------|
  |                                                             |
  | POST /v1/images/:id/report                                  |
  |   { reason, description, email?, recaptcha_token }          |
  |------------------------------->|                            |
  |                                |--assessments.create------->|
  |                                |   { event: { token,        |
  |                                |     siteKey, action } }    |
  |                                |<--score + tokenProperties--|
  |                                | (if score >= 0.5 and       |
  |                                |  action matches:)          |
  |                                |   INSERT image_reports     |
  |<------HTTP 201 { report_id }---|                            |
```

### 3.2 Schema

`image_reports` table (migration `20260604160000_image_reports`):

| Column | Type | Notes |
|---|---|---|
| id | TEXT (UUID) | Primary key |
| image_id | TEXT | FK to `images.image_id`; ON DELETE RESTRICT |
| reporter_user_id | TEXT NULL | FK to `users.user_id`; ON DELETE SET NULL. NULL = anonymous |
| reporter_email | TEXT NULL | Optional self-supplied contact |
| reason | TEXT | One of the §1.1 whitelist |
| description | TEXT NULL | Truncated to 2000 chars |
| ip_address | TEXT NULL | `req.ip` at submit time |
| recaptcha_score | REAL NULL | 0.0..1.0, populated from Google's verdict |
| recaptcha_action | TEXT NULL | Captured to detect replay between actions |
| status | TEXT NOT NULL DEFAULT 'open' | 'open' \| 'reviewed' \| 'dismissed' \| 'actioned' |
| created_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | |

Indexes:
- `(image_id, created_at DESC)` -- per-image report timeline
- `(status, created_at DESC)` -- moderation queue scan

### 3.3 Server Module Layout
- `src/cert/recaptcha.ts` -- pure `verifyRecaptchaToken(token, siteKey)` helper. No DB, no Express dep. Returns a discriminated-union verdict.
- `src/app/api/server.ts` -- `POST /v1/images/:imageId/report` route glue. Calls the helper, persists the row.

### 3.4 Client Module Layout
- `src/ui/Image.tsx` `FooterReport` component -- the only consumer at MVP. Inline script loader + modal form + form-state machine (idle | submitting | success | error).

### 3.5 Footer Visibility Matrix
The Report footer renders only inside `ListingPage`, which serves four states:

| Render state | Visible? | Why |
|---|---|---|
| `public-presale` (listed, anonymous viewer) | yes | abuse reports against live listings |
| `public-postsale` (sold + public, anonymous viewer) | yes | post-sale rights claims |
| `owner` (sold + buyer viewing their own) | yes | owners can report their own (mistake, want takedown) |
| `owner-listed` (creator viewing their own listing) | yes | creators can flag concerns |
| `private-stub` (sold + private, anonymous viewer) | no | different render component; no surface |
| `owner-editable` (creator's draft) | no | pre-listing; no third party can see it yet |
| `pending_review` | no | platform's internal review takes care of it; no third-party reports for unpublished images |

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Submit latency p95 | <= 1.5 s end-to-end (script load amortized; the actual execute + verify path is ~300ms) |
| reCAPTCHA script size | ~50 KB minified, served by Google; lazy-loaded on modal open |
| Quota | reCAPTCHA Enterprise: 1M assessments/month free, then $1 per 1000 -- launch-volume report load fits comfortably in free tier |
| Audit retention | `image_reports` rows retained indefinitely; `reporter_email` purged per §2.6 |
| PII logging | `reporter_email`, `description`, `ip_address` MUST NOT be logged at info level. Pino bindings for the report route omit them; only `image_id`, `error_code`, `score`, `action` are info-logged |
| Score persistence | Every accepted report stores Google's score even if above threshold; supports post-hoc threshold tuning |

## 5. Dependencies

| Dependency | Role |
|---|---|
| reCAPTCHA Enterprise API (`recaptchaenterprise.googleapis.com`) | Score verification via `projects.assessments.create` |
| `images`, `users`, `image_reports` (Prisma) | Storage + FK integrity |
| Pino logger | Server-side audit trail of rejected reports |
| `VITE_RECAPTCHA_SITE_KEY` env | Browser-side reCAPTCHA script key |
| `RECAPTCHA_API_KEY` env | Server-side API key for Google's REST API (must NOT have HTTP referrer restrictions -- server calls have no Referer; locked to reCAPTCHA Enterprise API only) |
| `GOOGLE_CLOUD_PROJECT_ID` env | Project slug for the assessments URL path |
| `RECAPTCHA_MIN_SCORE` env (optional) | Score threshold; default 0.5 |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Moderation queue UI is not built. `image_reports` rows accumulate with `status='open'` but nothing renders them at MVP. Founder reads the table directly via Prisma Studio or psql until the dashboard ships. Same scope as moderation OI-02 |
| OI-02 | No dedupe at MVP. A user can report the same image N times and each call writes a new row. Moderation queue should aggregate by (image_id, reporter_user_id OR ip_address) at read time. Deferred to the queue-UI buildout |
| OI-03 | `reporter_email` retention: §2.6 specifies "90 days after terminal status" but no cron purges these. Manual purge at MVP; automate when status-transition events become a thing |
| OI-04 | No abuse@epimage.com email integration. The deferred moderation flow assumes moderators read DB rows; an email integration that pings on each new report would help operations but is not implemented. When email.md ships, the `report_ack` template covers reporter-confirmation (when reporter_email provided); moderator-out email is takedown.md territory |
| OI-05 | Score threshold tuning is manual. No alerting if rejection rate spikes (indicating either bot wave or false-positive surge). Operational dashboard work |
| OI-06 | reCAPTCHA quota over 1M/month assessments billed at $1/1000 -- monitoring + alert needed before launch crosses that line |
| OI-07 | Score history is captured but not displayed anywhere. Moderators reviewing a row see the score; viewers / reporters don't (intentional -- score leak is an abuse signal) |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| moderation.md | Internal-moderation (Tier 0 / Tier 1) decisions consume `image_reports.status` transitions |
| R71 §3.7 | Endpoint inventory (this endpoint is not yet captured -- add at next R71 revision pass) |
| R71 §3.6 | Schema (the `image_reports` table is not yet captured -- propagation pending, identity OI-06 pattern) |
| Go-live checklist §4.7 | abuse@epimage.com inbox setup |
| Go-live checklist §4.6 | Key hardening (the dedicated server-side `RECAPTCHA_API_KEY` already follows §4.6 guidance: Application=None + API=reCAPTCHA Enterprise only) |
| takedown.md | Downstream: moderator-decided takedowns from reports drive `images.status='taken_down'` via takedown flow |
| email.md | Optional outbound: `report_ack` template fires when reporter_email is provided (per §2.6 PII treatment); moderator-out email is the takedown-notice template |

---
*Last Updated: 26/06/04 16:00*
