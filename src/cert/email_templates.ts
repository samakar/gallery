// email_templates.ts
// HTML body renderers for the email subsystem per /docs/cert/email.md §3.2.
// One function per variant; sibling to pdf_bundle.tsx which holds the
// equivalent PDF generators. Imported by src/cert/email.ts -- nothing else
// in the codebase should reach in here (the typed senders in email.ts are
// the public surface).
//
// Templates are plain template literals -- React Email isn't pulled in per
// ADR-0009 §"Negative" (our body content is text-with-a-thumbnail; React's
// component model would be overkill). When a template grows past ~80 lines
// or starts sharing structure across variants, factor into shared partials
// here before reaching for a templating library.

// ---------------------------------------------------------------------------
// Onboarding (creator + buyer share one template; switches on `kind`)
// ---------------------------------------------------------------------------

export interface OnboardingHtmlProps {
    kind: 'creator' | 'buyer';
    display_name: string;
    doc_label: string;
    recovery_key_url: string;
}

export function renderOnboardingHtml(p: OnboardingHtmlProps): string {
    const agreement = p.kind === 'creator' ? 'Creator Master Agreement' : 'Master Joint Agreement';
    return `<!DOCTYPE html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #222;">
    <h1 style="font-weight: 300; font-size: 24px;">Welcome to Epimage</h1>
    <p>Hi ${escapeHtml(p.display_name)},</p>
    <p>Your ${agreement} (<code>${escapeHtml(p.doc_label)}</code>) is attached as a PDF for your records. The agreement is the legal record of your acceptance; please retain it.</p>
    <p>Your Epimage wallet's recovery key is held by Magic, not Epimage. You can retrieve it any time -- <a href="${escapeAttr(p.recovery_key_url)}">here's how</a>.</p>
    <p style="font-size: 13px; color: #666;">If you didn't sign this agreement, please contact <a href="mailto:support@epimage.com">support@epimage.com</a> immediately.</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
    <p style="font-size: 11px; color: #999;">Epimage  |  Photographic deeds</p>
</body></html>`;
}

// ---------------------------------------------------------------------------
// COA at mint -- carries inline thumbnail + clickable deed link + four-PDF
// attachment list. Per R62 §3.5 the email itself is part of the buyer-retained
// evidence layer alongside the attachments.
// ---------------------------------------------------------------------------

export interface CoaHtmlProps {
    title: string;
    creator_display_name: string;
    buyer_identifier: string;
    deed_url: string;
    thumbnail_url: string;
    recovery_key_url: string;
}

export function renderCoaHtml(p: CoaHtmlProps): string {
    return `<!DOCTYPE html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #222;">
    <h1 style="font-weight: 300; font-size: 24px;">Your deed is ready</h1>
    <p><strong>"${escapeHtml(p.title)}"</strong> by ${escapeHtml(p.creator_display_name)}</p>
    <img src="${escapeAttr(p.thumbnail_url)}" alt="" style="display: block; max-width: 100%; height: auto; border: 1px solid #ddd; margin: 16px 0;" />
    <p>Acquired by ${escapeHtml(p.buyer_identifier)}.</p>
    <p style="margin: 24px 0;">
        <a href="${escapeAttr(p.deed_url)}" style="display: inline-block; padding: 12px 20px; background: #222; color: #fff; text-decoration: none; border-radius: 4px;">View the deed page</a>
    </p>
    <p>The four-PDF certificate of authenticity bundle is attached:</p>
    <ul style="font-size: 14px; color: #555;">
        <li>Certificate of Authenticity</li>
        <li>Title Document</li>
        <li>Purchase Receipt</li>
        <li>License Acceptance Record</li>
    </ul>
    <p style="font-size: 13px; color: #666;">Please retain these PDFs for your records. They are the buyer-retained copy of the legal artifacts and are admissible as evidence under state blockchain authentication statutes.</p>
    <p style="font-size: 13px; color: #666;">Your Epimage wallet's recovery key is held by Magic, not Epimage. You can retrieve it any time -- <a href="${escapeAttr(p.recovery_key_url)}">here's how</a>.</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
    <p style="font-size: 11px; color: #999;">Epimage  |  Photographic deeds</p>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Future variants (deferred per email.md §3.2; ship with their parent workflows)
// ---------------------------------------------------------------------------

// export function renderCoaResaleHtml(p: ...): string { ... }    // out of MVP with resale
// export function renderReportAckHtml(p: ...): string { ... }    // image_report.md OI-04
// export function renderTakedownNoticeHtml(p: ...): string { ... } // out of MVP with takedown

// ---------------------------------------------------------------------------
// HTML escape helpers. Used by every template; kept here so consumers never
// hand-roll escaping (template-injection vector if forgotten).
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function escapeAttr(s: string): string {
    return escapeHtml(s);
}
