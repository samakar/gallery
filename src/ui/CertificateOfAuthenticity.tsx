// CertificateOfAuthenticity.tsx
// Collapsible Certificate of Authenticity panel for the image page. Single
// source for the on-screen CoA -- the PDF variant of the same artifact lives
// in src/cert/pdf_bundle.tsx (renderCertificateOfAuthenticityPdf).

export interface CertificateOfAuthenticityData {
    image_id: string;
    title: string | null;
    creator_display_name: string;
    creation_date: string | null;   // ISO
    edition: string | null;
    isa_signed_at: string | null;   // ISO; creator's Card 1 ESIGN affirmation
    deed_asset_id: string | null;   // if set, deed exists -> ISA implied even if isa_signed_at is null
    coa_document_version: string | null; // e.g., '1.0'; denormalized from binder.entries[coa].version on the creator's COA Signature row
}

export default function CertificateOfAuthenticity({ data }: { data: CertificateOfAuthenticityData }) {
    const creator = data.creator_display_name;
    const title = data.title || 'Untitled';
    const creationDate = data.creation_date
        ? new Date(data.creation_date).toLocaleDateString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric',
        })
        : '—';
    const esignedAt = data.isa_signed_at
        ? new Date(data.isa_signed_at).toLocaleString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
        })
        : null;

    return (
        <details className="bg-base-200 rounded-md group">
            <summary className="cursor-pointer px-4 py-2 text-sm text-center list-none flex items-center justify-center select-none text-base-content/55">
                <span>Certificate of Authenticity{data.coa_document_version && <span className="ml-1 text-base-content/40">v{data.coa_document_version}</span>}</span>
                <span className="ml-2 text-base-content/40 text-xs transition-transform group-open:rotate-180">▾</span>
            </summary>
            <div className="font-deed px-6 pb-6 pt-2 space-y-4 text-base-content/80">
                <p className="text-justify leading-relaxed">
                    This is to certify that the digital photograph identified herein,
                    titled <em>{title}</em>, is an original and authentic work created
                    by <strong>{creator}</strong> on {creationDate}, and offered through
                    the Epimage Gallery as a unique (1 of 1) limited edition.
                </p>

                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs pt-2 border-t border-base-300">
                    <span className="text-base-content/50">Title</span>
                    <span>{title}</span>
                    <span className="text-base-content/50">Creator</span>
                    <span>{creator}</span>
                    <span className="text-base-content/50">Creation date</span>
                    <span>{creationDate}</span>
                    <span className="text-base-content/50">Edition</span>
                    <span>{data.edition || 'Unique (1 of 1)'}</span>
                    <span className="text-base-content/50">Image ID</span>
                    <span className="font-mono">{data.image_id}</span>
                    <span className="text-base-content/50">eSigned by creator</span>
                    <span>
                        {esignedAt
                            ? esignedAt
                            : data.deed_asset_id
                                // Deed exists -> the creator HAS signed by definition
                                // (the deed could not mint without the Card 1 ESIGN
                                // affirmation per R62 §3.4). Specific timestamp
                                // missing only when the signature event ID didn't
                                // get linked to the image row (legacy / seed data).
                                ? <span>Affirmed by creator</span>
                                : <span className="text-base-content/40">Pending creator signature</span>}
                    </span>
                </div>
            </div>
        </details>
    );
}
