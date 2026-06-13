# ADR-0009 -- Postmark as the Transactional Email Service Provider

## Status

Accepted (2026-06-04).

## Context

R62 §3.5 makes email a legally load-bearing artifact: the onboarding email carries the executed master agreement PDF, and the COA email (sent at every deed mint, resale, and license migration) carries the four-PDF certification bundle (Certificate of Authenticity, Title Document, Purchase Receipt, Per-image License Acceptance record). The email satisfies ESIGN's record-retention requirement independently of the platform and creates admissible evidence under state blockchain authentication statutes (Vermont 12 V.S.A. §1913 explicitly cited).

R62 names **Amazon SES** as the delivery channel. R71 §1.2 defers email to post-MVP but broadens the choice -- *"When implemented: a single email module under /docs/cert/ or /docs/commerce/ that wraps a transactional ESP (Resend / Postmark / SES)."* The MVP code currently ships zero email infrastructure.

The ESP selection materially affects:
- **Deliverability into inboxes** -- the COA email is legally meaningful only if it lands in the recipient's inbox, not the spam folder
- **Audit retention** -- the ESP's message log is part of the evidence chain
- **Compliance posture** -- the ESP is part of the buyer-retained evidence layer R62 describes
- **MVP velocity** -- ESP setup time competes with other launch work
- **Developer ergonomics** -- template engine + SDK shape the email module's maintainability

The choice is between three candidates:

| Candidate | Strength | Weakness |
|---|---|---|
| Amazon SES | Cheapest at scale ($0.10/1k), R62's named choice, strong enterprise compliance reputation | Multi-hour setup, deliverability ramp-up period (sandbox -> production approval), raw SDK ergonomics |
| Resend | Best developer experience (React Email native, modern API, 3000/mo free tier), fast setup | Newer (less established deliverability track record), 3-day retention default, no stream separation, no DMARC monitoring |
| Postmark | Industry-leading deliverability (10s median, transactional-only IP pools), 45-day default retention (365 on Pro), 16-year track record, R62-aligned legal posture, stream separation, DMARC monitoring | Smaller free tier (100/mo, no mid-tier between free and $15/mo paid), Mustache templates (not React Email native), more expensive per-email at high scale |

## Decision

Adopt **Postmark Pro** as the transactional ESP.

Specifically:
- **Provider**: Postmark, billed monthly. MVP testing uses the 100-email/month free tier; launch upgrades to the Basic or Pro plan when traffic crosses 100/mo.
- **Stream**: `transactional` only. The `broadcast` stream is not used at MVP (no marketing email). Reserved separately if newsletter ever ships.
- **Sending domain**: `notifications@epimage.com` with DNS-managed SPF / DKIM / DMARC records.
- **Module surface**: Three typed senders in `src/cert/email.ts` per /docs/cert/email.md §1.1 -- `sendOnboardingCreatorEmail`, `sendOnboardingBuyerEmail`, `sendCoaEmail`. The originally-spec'd single `sendEmail(envelope)` with a discriminated-union template parameter was traded for the typed senders during implementation -- equivalent migration boundary (still one file, still no Postmark SDK leakage), better compile-time prop safety. All callers route through this surface; no direct Postmark SDK / fetch calls elsewhere in the codebase. Migration to SES later (if volume warrants) touches one file.
- **Audit anchor**: Postmark's `MessageID` persisted on the originating row (`signatures.email_message_id`, `image_reports.ack_email_message_id`, etc.) for cross-system trace.
- **Retention**: 45 days default for MVP eval; bumped to 365 days on Pro plan for production launch (cross with go-live checklist §4.8).
- **Templates**: Mustache-based, defined in code via type-narrowed template-props discriminated union. NOT React Email -- see "Boundary conditions" for rationale.

## Consequences

### Positive

- **Deliverability into inbox is best-in-class.** Postmark culled poor-quality senders from its IP pools years ago; transactional-only enforcement keeps marketing spammers off the shared infrastructure. The COA email -- which IS the legal certificate -- lands in the inbox, not the spam folder.
- **Audit retention matches R62's framing.** 45-day default with one-click upgrade to 365 days. SES default retention is event-stream only (no message body); Resend's 3-day default is short of the buyer-can-still-retrieve-it horizon a legal artifact needs.
- **Stream separation isolates transactional from any future broadcast use.** If a marketing newsletter ever launches, its deliverability problems can't pollute the COA email's IP reputation. SES requires manual IP allocation to achieve the same isolation; Resend does it at domain level (weaker).
- **DMARC monitoring is built in.** Aligns with compliance posture; one fewer ops tool to bolt on.
- **Setup time is comparable to Resend.** ~10 minutes to create the Server, verify the domain, paste the API token. SES would have taken hours (sandbox approval cycle, deliverability ramp-up coaching).
- **16-year track record.** When the platform's legal posture matters (court admissibility, regulatory queries), an established ESP is a positive signal vs. a startup ESP whose long-term operations are unproven.

### Negative

- **Free tier is small (100/mo).** Resend's 3,000/mo free tier covers more pre-launch testing. Mitigation: MVP testing volume is well under 100/mo (a handful of test sends); launch crosses to $15/mo Basic plan immediately, which is trivial cost.
- **No React Email native integration.** Postmark uses Mustache (logic-less templates). React Email's compile-time type safety + component reuse is a developer-comfort win we forgo. Mitigation in /docs/cert/email.md §2.6: the template-props discriminated union provides equivalent type safety at the call site; our actual template count (5-8 at full scope, each ~50 lines of HTML) doesn't benefit meaningfully from React's component model.
- **More expensive at high volume.** $0.0015/email vs SES's $0.0001 -- 15x markup. Crossover where SES becomes cost-favorable is around 100k emails/month. At MVP launch volume (low thousands per month) the absolute cost difference is ~$10-15/month; below the threshold where engineer time spent on migration is worth it.
- **Strict sender approval.** Postmark reviews new accounts to enforce the transactional-only policy. One-time friction at signup; not recurring.

### Operational obligations

- Postmark account provisioned with `notifications@epimage.com` as the verified sender; DNS records set up before first send.
- `POSTMARK_SERVER_TOKEN` in production `.env`; `POSTMARK_WEBHOOK_TOKEN` for bounce / complaint handler.
- Webhook endpoint `POST /webhooks/postmark` returns 200 on bounce / complaint events; updates `users.email_status='suppressed'` and inserts an audit row.
- Monthly review of Postmark Activity dashboard: bounce rate, complaint rate, suppression list size; trigger investigation if any exceeds 1%.
- Quarterly review of audit-retention setting: confirm Pro plan is still active and 365-day retention is enabled.
- On-call alert if `POSTMARK_SERVER_TOKEN` is missing at startup or if 5xx error rate from Postmark exceeds 5% in any 5-minute window.
- Annual review against R62 + ESIGN guidance: confirm Postmark continues to satisfy record-retention obligations; revisit ADR if posture changes.

## Boundary conditions

This ADR is revisited if any of the following hold:

- **Volume crosses 100,000 emails/month.** At that scale, SES's $0.10/1k pricing saves ~$130-150/month; worth the migration. Migration scope is bounded to `src/cert/email.ts`.
- **Postmark deliverability degrades materially** -- inbox placement rate falls below 95% for two consecutive months (measurable via their analytics).
- **Postmark changes terms in a way that conflicts with R62** -- e.g., reduces default retention below the buyer-retrieval horizon needed for evidence, or modifies transactional-only enforcement.
- **A compliance certification gap surfaces** -- e.g., a launch jurisdiction requires SOC 2 Type II + HIPAA, and Postmark's posture is insufficient (currently unverified; track via OI in email.md if it becomes load-bearing).
- **React Email integration becomes critical** -- e.g., 30+ templates with shared design system, where Mustache becomes the bottleneck. Migration to Resend would land cleanly through the same one-file abstraction.

Specifically NOT in scope for this ADR:
- The PDF generation pipeline (mechanical format conversion; spec absorbed into [cert/legal_binder.md §2.3](../cert/legal_binder.md))
- Inbound email parsing (Postmark supports it; deferred per email.md OI-09)
- Multi-language templates (deferred per email.md OI-04)
- Newsletter / marketing email (out of MVP scope entirely)

## References

| Reference | Purpose |
|---|---|
| R62 §3.5 | Original email-delivery spec; names SES; defines the legal-artifact framing |
| R71 §1.2 | MVP deferral + broadened ESP choice (Resend / Postmark / SES) |
| /docs/cert/email.md | Module spec consuming this ADR's decision |
| /docs/cert/legal_binder.md §2.3 | PDF rendering of binder docs (the COA attachments) |
| /docs/go_live_checklist.md §4.8 | Operational items for ESP setup |
| ESIGN Act (15 U.S.C. §7001 et seq.) | Record-retention requirement that email satisfies independently of the platform |
| Vermont 12 V.S.A. §1913 | State blockchain authentication statute cited by R62 |
| https://postmarkapp.com/pricing | Current Postmark pricing (verified 2026-06-04) |
| https://postmarkapp.com/compare/resend-alternative | Postmark's own comparison (treat as advocacy; factual claims accurate) |

---
*Last Updated: 26/06/10 12:00*
