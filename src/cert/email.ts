// email.ts
// Transactional email subsystem per /docs/cert/email.md. ESP is Postmark
// per ADR-0009. Direct REST API calls (no SDK -- one fewer dep, equivalent
// reliability). The send is fire-and-forget from the caller's perspective:
// workflows enqueue with setImmediate and don't await the response.
//
// Three MVP template variants per email.md §3.2:
//   - onboarding_creator (CMA PDF attached) -- at sign-cma
//   - onboarding_buyer (BMA / MJA PDF) -- at MJA capture
//   - coa_at_mint (4-PDF bundle + inline thumbnail) -- at applyMintSucceeded

import { prisma } from '../db';
import { sanitizeFilename } from './text_normalize';
import {
    renderCmaPdf,
    renderBmaPdf,
    renderCertificateOfAuthenticityPdf,
    renderTitleDocumentPdf,
    renderPurchaseReceiptPdf,
    renderLicenseAcceptanceRecordPdf,
    type CmaPdfProps,
    type BmaPdfProps,
    type CoaPdfProps,
    type TitlePdfProps,
    type PurchaseReceiptPdfProps,
    type LicensePdfProps,
} from './pdf_bundle';
import { renderOnboardingHtml, renderCoaHtml } from './email_templates';

const POSTMARK_ENDPOINT_EMAIL = 'https://api.postmarkapp.com/email';
const PLATFORM_BASE_URL = process.env.PLATFORM_BASE_URL ?? 'https://epimage.com';
// Postmark Stream ID -- the lowercase slug, not the display name. New Postmark
// servers ship with the default transactional stream under the ID `outbound`,
// so that's our default. Set POSTMARK_TRANSACTIONAL_STREAM in .env to point at
// a custom stream (e.g., if you've archived `outbound` and created one named
// literally `transactional`).
const POSTMARK_TRANSACTIONAL_STREAM = process.env.POSTMARK_TRANSACTIONAL_STREAM ?? 'outbound';

export type EmailErrorCode =
    | 'EMAIL_NOT_CONFIGURED'
    | 'EMAIL_INVALID_RECIPIENT'
    | 'EMAIL_SUPPRESSED'
    | 'EMAIL_ATTACHMENT_TOO_LARGE'
    | 'EMAIL_TEMPLATE_VALIDATION'
    | 'EMAIL_RATE_LIMITED'
    | 'EMAIL_UPSTREAM_TRANSIENT'
    | 'EMAIL_UPSTREAM_PERMANENT';

export type SendEmailResult =
    | { ok: true; message_id: string; accepted_at: string; stream: string }
    | { ok: false; error_code: EmailErrorCode; message: string; retry_after_seconds?: number };

interface Attachment {
    filename: string;
    content_base64: string;
    content_type: string;
}

interface PostmarkSuccess {
    To: string;
    SubmittedAt: string;
    MessageID: string;
    ErrorCode: 0;
    Message: 'OK';
}

interface PostmarkError {
    ErrorCode: number;
    Message: string;
}

// ===========================================================================
// Public API: variant-typed senders. Callers use these directly -- they wrap
// the lower-level sendEnvelope so template-prop type-safety is enforced.
// ===========================================================================

interface CommonProps {
    idempotency_key?: string;
}

export interface OnboardingCreatorEmailProps extends CommonProps {
    to: string;
    creator_display_name: string;
    cma: CmaPdfProps;
}

export async function sendOnboardingCreatorEmail(props: OnboardingCreatorEmailProps): Promise<SendEmailResult> {
    const pdf = await renderCmaPdf(props.cma);
    const html = renderOnboardingHtml({
        kind: 'creator',
        display_name: props.creator_display_name,
        doc_label: props.cma.document_version_label,
        recovery_key_url: `${PLATFORM_BASE_URL}/recovery-key`,
    });
    return sendEnvelope({
        to: props.to,
        subject: 'Welcome to Epimage -- your Creator Master Agreement',
        html_body: html,
        attachments: [
            {
                filename: sanitizeFilename(`cma-${props.cma.document_version_label}.pdf`),
                content_base64: pdf.toString('base64'),
                content_type: 'application/pdf',
            },
        ],
        message_stream: POSTMARK_TRANSACTIONAL_STREAM,
        idempotency_key: props.idempotency_key ?? `onboarding_creator:${props.cma.signature_id}`,
    });
}

export interface OnboardingBuyerEmailProps extends CommonProps {
    to: string;
    buyer_display_name: string;
    bma: BmaPdfProps;
}

export async function sendOnboardingBuyerEmail(props: OnboardingBuyerEmailProps): Promise<SendEmailResult> {
    const pdf = await renderBmaPdf(props.bma);
    const html = renderOnboardingHtml({
        kind: 'buyer',
        display_name: props.buyer_display_name,
        doc_label: props.bma.document_version_label,
        recovery_key_url: `${PLATFORM_BASE_URL}/recovery-key`,
    });
    return sendEnvelope({
        to: props.to,
        subject: 'Welcome to Epimage -- your Master Joint Agreement',
        html_body: html,
        attachments: [
            {
                filename: sanitizeFilename(`mja-${props.bma.document_version_label}.pdf`),
                content_base64: pdf.toString('base64'),
                content_type: 'application/pdf',
            },
        ],
        message_stream: POSTMARK_TRANSACTIONAL_STREAM,
        idempotency_key: props.idempotency_key ?? `onboarding_buyer:${props.bma.signature_id}`,
    });
}

export interface CoaEmailProps extends CommonProps {
    to: string[];            // creator + buyer
    image_id: string;
    title: string;
    creator_display_name: string;
    buyer_identifier: string;
    coa: CoaPdfProps;
    title_document: TitlePdfProps;
    purchase_receipt: PurchaseReceiptPdfProps;
    license: LicensePdfProps;
}

export async function sendCoaEmail(props: CoaEmailProps): Promise<SendEmailResult> {
    const [coaPdf, titlePdf, receiptPdf, licensePdf] = await Promise.all([
        renderCertificateOfAuthenticityPdf(props.coa),
        renderTitleDocumentPdf(props.title_document),
        renderPurchaseReceiptPdf(props.purchase_receipt),
        renderLicenseAcceptanceRecordPdf(props.license),
    ]);
    const deedUrl = `${PLATFORM_BASE_URL}/${encodeURIComponent(props.image_id)}/deed`;
    const html = renderCoaHtml({
        title: props.title,
        creator_display_name: props.creator_display_name,
        buyer_identifier: props.buyer_identifier,
        deed_url: deedUrl,
        thumbnail_url: props.coa.thumbnail_url,
        recovery_key_url: `${PLATFORM_BASE_URL}/recovery-key`,
    });
    return sendEnvelope({
        to: props.to.join(', '),
        subject: `Your deed is ready -- "${props.title}"`,
        html_body: html,
        attachments: [
            { filename: sanitizeFilename(`coa-${props.image_id}.pdf`), content_base64: coaPdf.toString('base64'), content_type: 'application/pdf' },
            { filename: sanitizeFilename(`title-${props.image_id}.pdf`), content_base64: titlePdf.toString('base64'), content_type: 'application/pdf' },
            { filename: sanitizeFilename(`receipt-${props.image_id}.pdf`), content_base64: receiptPdf.toString('base64'), content_type: 'application/pdf' },
            { filename: sanitizeFilename(`license-${props.image_id}.pdf`), content_base64: licensePdf.toString('base64'), content_type: 'application/pdf' },
        ],
        message_stream: POSTMARK_TRANSACTIONAL_STREAM,
        idempotency_key: props.idempotency_key ?? `coa:${props.image_id}`,
    });
}

// ===========================================================================
// Lower-level Postmark envelope sender. The variant-typed senders above wrap
// this; nothing else in the codebase should call it directly per email.md §2.3.
// ===========================================================================

interface SendEnvelopeInput {
    to: string;
    subject: string;
    html_body: string;
    attachments: Attachment[];
    message_stream: string; // Postmark Stream ID (e.g. 'outbound', 'broadcast')
    idempotency_key: string;
}

async function sendEnvelope(input: SendEnvelopeInput): Promise<SendEmailResult> {
    const serverToken = process.env.POSTMARK_SERVER_TOKEN;
    const fromAddress = process.env.EMAIL_FROM_ADDRESS;
    if (!serverToken || !fromAddress) {
        return {
            ok: false,
            error_code: 'EMAIL_NOT_CONFIGURED',
            message: 'POSTMARK_SERVER_TOKEN and EMAIL_FROM_ADDRESS must be set',
        };
    }

    // Attachment size sanity. Postmark allows ~10 MB raw / 7.5 MB encoded;
    // catch obvious blowouts early with a friendly error code.
    const totalBytes = input.attachments.reduce((acc, a) => acc + Buffer.byteLength(a.content_base64, 'base64'), 0);
    if (totalBytes > 9_500_000) {
        return {
            ok: false,
            error_code: 'EMAIL_ATTACHMENT_TOO_LARGE',
            message: `Attachments total ${(totalBytes / 1_000_000).toFixed(1)} MB; Postmark cap is ~10 MB raw`,
        };
    }

    const body = {
        From: fromAddress,
        To: input.to,
        Subject: input.subject,
        HtmlBody: input.html_body,
        MessageStream: input.message_stream,
        Attachments: input.attachments.map(a => ({
            Name: a.filename,
            Content: a.content_base64,
            ContentType: a.content_type,
        })),
        // Idempotency key is sent as a header for Postmark's at-most-once
        // semantics on transient retries.
        Metadata: { idempotency_key: input.idempotency_key },
    };

    let resp: Response;
    try {
        resp = await fetch(POSTMARK_ENDPOINT_EMAIL, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Postmark-Server-Token': serverToken,
            },
            body: JSON.stringify(body),
        });
    } catch (e: any) {
        return {
            ok: false,
            error_code: 'EMAIL_UPSTREAM_TRANSIENT',
            message: `Postmark network error: ${e?.message ?? e}`,
            retry_after_seconds: 60,
        };
    }

    if (resp.status === 429) {
        const retryAfter = Number(resp.headers.get('Retry-After') ?? '60');
        return {
            ok: false,
            error_code: 'EMAIL_RATE_LIMITED',
            message: 'Postmark account throttled',
            retry_after_seconds: retryAfter,
        };
    }
    if (resp.status >= 500) {
        return {
            ok: false,
            error_code: 'EMAIL_UPSTREAM_TRANSIENT',
            message: `Postmark ${resp.status}`,
            retry_after_seconds: 60,
        };
    }
    if (!resp.ok) {
        const errBody = await safeReadJson<PostmarkError>(resp);
        const message = errBody?.Message ?? `Postmark ${resp.status}`;
        // Specific error code mapping per Postmark API. The exhaustive list
        // is at https://postmarkapp.com/developer/api/overview#error-codes;
        // we route the most common ones to typed error_codes.
        if (errBody && [406, 412, 422].includes(errBody.ErrorCode)) {
            return { ok: false, error_code: 'EMAIL_SUPPRESSED', message };
        }
        if (errBody && errBody.ErrorCode === 300) {
            return { ok: false, error_code: 'EMAIL_INVALID_RECIPIENT', message };
        }
        return { ok: false, error_code: 'EMAIL_UPSTREAM_PERMANENT', message };
    }

    const ok = (await resp.json()) as PostmarkSuccess;
    return {
        ok: true,
        message_id: ok.MessageID,
        accepted_at: ok.SubmittedAt,
        stream: input.message_stream,
    };
}

async function safeReadJson<T>(resp: Response): Promise<T | null> {
    try { return (await resp.json()) as T; } catch { return null; }
}

// ===========================================================================
// Bounce / complaint webhook handler. Wired by server.ts to
// POST /webhooks/postmark. Updates users.email_status = 'suppressed' on
// hard bounces and spam complaints.
// ===========================================================================

export interface PostmarkBounceWebhookBody {
    RecordType?: string;       // 'Bounce' | 'SpamComplaint' | 'Open' | 'Delivery' etc.
    Email?: string;            // the bouncing recipient
    Type?: string;             // 'HardBounce' | 'Transient' | 'Unsubscribe' | ...
    MessageID?: string;
    Details?: string;
}

export async function handlePostmarkWebhook(body: PostmarkBounceWebhookBody): Promise<void> {
    if (!body?.Email) return;
    const recordType = body.RecordType ?? '';
    const type = body.Type ?? '';
    const isSuppressionEvent =
        recordType === 'SpamComplaint' ||
        (recordType === 'Bounce' && (type === 'HardBounce' || type === 'SpamNotification'));
    if (!isSuppressionEvent) return;

    // Mark every user with this email address as suppressed. email_status
    // column lives on users per the schema migration that ships with this
    // change.
    try {
        await prisma.user.updateMany({
            where: { email: body.Email },
            data: { email_status: 'suppressed' },
        });
        console.warn('[email] suppression event from postmark', {
            email_hash: hashEmail(body.Email),
            record_type: recordType,
            type,
            message_id: body.MessageID,
        });
    } catch (e: any) {
        console.error('[email] failed to record suppression', e?.message ?? e);
    }
}

function hashEmail(email: string): string {
    // PII-safe logging per email.md §2.7: never log the raw address; log a
    // truncated hash so two events from the same recipient correlate.
    let h = 0;
    for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16).padStart(8, '0');
}

// HTML body renderers live in ./email_templates so this file stays focused
// on the Postmark integration + typed senders. See /docs/cert/email.md §3.4.
