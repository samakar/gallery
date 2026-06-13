// SalesAgreement.tsx
// Collapsible Sales Agreement panel for the image page. Visible only to the
// creator (image author) or current deed owner -- public viewers and other
// authenticated buyers don't see it.
//
// At MVP the SALES_AGREEMENT document type from cert/legal_binder.md isn't yet
// captured as a Solana-signed event (see esign.md OI-06 -- deferred). This
// component renders the *content* of the sales agreement as it would appear
// to the parties under platform-default terms (10% royalty + 10% platform fee
// + 1/1 edition), with the price + parties + dates resolved from the current
// deed state. When SALES_AGREEMENT capture lands, this component switches its
// "Signed by" rows from "(pending capture)" to the actual signing-event IDs.

export interface SalesAgreementData {
    image_id: string;
    title: string | null;
    creator_display_name: string;
    creator_wallet: string | null;
    deed_owner_wallet: string | null;        // null pre-sale; current owner post-sale
    listed_price_cents: number | null;       // public asking price; null when not listed
    purchase_price_cents: number | null;     // sale price; non-null only to deed owner post-sale (server-gated)
    purchased_at: string | null;             // ISO; non-null post-sale
    royalty_pct: number;                     // 10 at MVP
    edition: string | null;                  // 'Unique (1 of 1)' at MVP
    creator_isa_signed_at: string | null;    // proxy for creator's SALES_AGREEMENT click until that capture ships
    sales_document_version: string | null;   // e.g., '1.0'; denormalized from binder.entries[sales].version on the parties' SALES_AGREEMENT Signature rows. Both creator-side + buyer-side rows carry the same version (mint enforces both signed under the same binder)
}

const PLATFORM_FEE_PCT_DEFAULT = 10;

function formatUsd(cents: number | null): string | null {
    if (cents == null) return null;
    return `$${(cents / 100).toFixed(2)}`;
}

export default function SalesAgreement({ data }: { data: SalesAgreementData }) {
    const title = data.title || 'Untitled';
    const creator = data.creator_display_name;
    const isPostSale = data.purchased_at != null;
    const priceLabel = isPostSale ? 'Sale price' : 'Listed price';
    const priceValue = formatUsd(data.purchase_price_cents ?? data.listed_price_cents);
    const purchasedOn = data.purchased_at
        ? new Date(data.purchased_at).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
        })
        : null;
    const creatorSignedOn = data.creator_isa_signed_at
        ? new Date(data.creator_isa_signed_at).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
        })
        : null;

    return (
        <details className="bg-base-200 rounded-md group">
            <summary className="cursor-pointer px-4 py-2 text-sm text-center list-none flex items-center justify-center select-none text-base-content/55">
                <span>Sales Agreement{data.sales_document_version && <span className="ml-1 text-base-content/40">v{data.sales_document_version}</span>}</span>
                <span className="ml-2 text-base-content/40 text-xs transition-transform group-open:rotate-180">▾</span>
            </summary>
            <div className="font-deed px-6 pb-6 pt-2 space-y-4 text-base-content/80">

                {/* Recital */}
                <p className="text-justify leading-relaxed">
                    This agreement records the per-image sale terms for <em>{title}</em>,
                    a digital photograph by <strong>{creator}</strong>, listed on the Epimage
                    Gallery. The terms below bind the creator and the buyer to the commercial
                    arrangement and the buyer's use license; the platform mediates settlement.
                </p>

                {/* Commercial terms */}
                <section className="space-y-2">
                    <h4 className="text-xs uppercase tracking-widest text-base-content/50">
                        Commercial Terms
                    </h4>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                        <dt className="text-base-content/50">{priceLabel}</dt>
                        <dd>{priceValue ?? <span className="italic text-base-content/40">Not set</span>}</dd>
                        <dt className="text-base-content/50">Edition</dt>
                        <dd>{data.edition || 'Unique (1 of 1)'}</dd>
                        <dt className="text-base-content/50">Creator royalty (per resale)</dt>
                        <dd>{data.royalty_pct}%</dd>
                        <dt className="text-base-content/50">Platform fee</dt>
                        <dd>{PLATFORM_FEE_PCT_DEFAULT}%</dd>
                        {isPostSale && (
                            <>
                                <dt className="text-base-content/50">Sale closed</dt>
                                <dd>{purchasedOn}</dd>
                            </>
                        )}
                    </dl>
                </section>

                {/* Use license summary */}
                <section className="space-y-2 pt-3 border-t border-base-300">
                    <h4 className="text-xs uppercase tracking-widest text-base-content/50">
                        Use License Summary
                    </h4>
                    <p className="text-justify leading-relaxed">
                        The buyer is granted the exclusive right to display the unique-edition
                        digital work, transfer or resell the deed, and use the work for
                        personal, non-commercial purposes. The creator retains the underlying
                        copyright; the buyer's right is to this specific edition, not to
                        reproduction or commercial exploitation of the underlying image.
                    </p>
                </section>

                {/* Parties + signatures */}
                <section className="space-y-2 pt-3 border-t border-base-300">
                    <h4 className="text-xs uppercase tracking-widest text-base-content/50">
                        Parties &amp; Signatures
                    </h4>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                        <dt className="text-base-content/50">Creator wallet</dt>
                        <dd className="font-mono truncate" title={data.creator_wallet ?? ''}>
                            {data.creator_wallet || <span className="italic text-base-content/40">Not yet provisioned</span>}
                        </dd>
                        <dt className="text-base-content/50">Creator signed</dt>
                        <dd>{creatorSignedOn || <span className="italic text-base-content/40">Pending capture</span>}</dd>
                        <dt className="text-base-content/50">Buyer wallet</dt>
                        <dd className="font-mono truncate" title={data.deed_owner_wallet ?? ''}>
                            {data.deed_owner_wallet || <span className="italic text-base-content/40">No buyer yet</span>}
                        </dd>
                        <dt className="text-base-content/50">Buyer signed</dt>
                        <dd>{isPostSale ? purchasedOn : <span className="italic text-base-content/40">No buyer yet</span>}</dd>
                    </dl>
                </section>
            </div>
        </details>
    );
}
