// DeedOnChainRecord.tsx
// Single source for the "On-chain record" field block rendered on both the
// dedicated deed page (Deed.tsx) and the collapsible Deed-of-Ownership panel
// on the image page (Image.tsx DeedPanel).
//
// Centralising here means relabeling ("Owner wallet" -> "Owner address",
// "Minted" -> "Issuance date", "SHA-256" -> "Data fingerprint", etc.) and
// behavior changes (the Permanent Archive readiness gate per arweave_ready_at)
// only happen in one file.
//
// Two visual variants:
//   - "panel"  : narrow column inside the legal-style Deed panel on the image
//                page. Tight grid, smaller text, hash cells wrap via HashCell.
//   - "page"   : wide column for the standalone deed page. Bigger text, hash
//                cells truncate (the page has more horizontal room).

import React from 'react';

export type RedactionStyle = 'asterisk' | 'dash';

export interface DeedOnChainRecordData {
    image_id: string;
    asset_id: string | null;             // cNFT asset_id ("Deed number")
    custody_state: string | null;        // 'sealed' | 'unsealed' | 'burned' | 'draft'
    legal_state: string | null;          // 'legit' | 'disputed' | 'void'
    owner_wallet: string | null;
    creator_wallet: string | null;
    arweave_uri: string | null;
    arweave_ready_at: string | null;     // ISO; null while archive is propagating
    sha256: string | null;               // sha256 of cleartext Master file (full bytes); UI label: "File fingerprint"
    image_fingerprint: string | null;    // sha256 of JPEG with metadata segments stripped; UI label: "Image fingerprint"
    content_fingerprint: string | null;  // perceptual hash (visual similarity); UI label: "Content fingerprint"
    minted_at: string | null;            // ISO; rendered as "Issuance date"
}

interface Props {
    data: DeedOnChainRecordData;
    variant?: 'panel' | 'page';
    redaction?: RedactionStyle;
    // The Solana cluster used to build the Explorer link for the Deed number
    // (e.g. 'devnet' for staging, 'mainnet-beta' for prod). Caller picks --
    // a VITE_SOLANA_NETWORK env var or constant lives at the call site.
    solanaCluster?: string;
}

const REDACTED_ASTERISK = '*******';

function Cell({ value, redaction, mono }: { value: string | null | undefined; redaction: RedactionStyle; mono?: boolean }) {
    if (value) return <>{value}</>;
    if (redaction === 'dash') return <span className="text-base-content/40">—</span>;
    return <span className={mono ? 'font-mono' : ''}>{REDACTED_ASTERISK}</span>;
}

// Hash display: shrunk monospace + break-all so a 64-char sha256 fits inside
// the panel grid on narrow screens. Used in both variants for the fingerprint
// rows; the deed page is wide enough to skip the wrap most of the time, but
// break-all is a no-op when content fits.
function HashCell({ value }: { value: string }) {
    return (
        <span className="font-mono text-[9px] leading-snug break-all">
            {value}
        </span>
    );
}

export default function DeedOnChainRecord({
    data,
    variant = 'panel',
    redaction = 'dash',
    solanaCluster = 'devnet',
}: Props) {
    const dlClass =
        variant === 'page'
            ? 'grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm'
            : 'grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs';
    const valueMono =
        variant === 'page' ? 'font-mono text-xs' : 'font-mono';

    return (
        <dl className={dlClass}>
            <dt className="text-base-content/60">Deed number</dt>
            <dd className={`${valueMono} truncate`} title={data.asset_id ?? ''}>
                {data.asset_id ? (
                    <a
                        href={`https://explorer.solana.com/address/${data.asset_id}?cluster=${solanaCluster}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link link-hover"
                    >
                        {data.asset_id}
                    </a>
                ) : (
                    <Cell value={null} redaction={redaction} mono />
                )}
            </dd>

            <dt className="text-base-content/60">Custody state</dt>
            <dd className={valueMono}><Cell value={data.custody_state} redaction={redaction} mono /></dd>

            <dt className="text-base-content/60">Legal state</dt>
            <dd className={valueMono}><Cell value={data.legal_state} redaction={redaction} mono /></dd>

            <dt className="text-base-content/60">Owner address</dt>
            <dd className={`${valueMono} truncate`} title={data.owner_wallet ?? ''}>
                <Cell value={data.owner_wallet} redaction={redaction} mono />
            </dd>

            <dt className="text-base-content/60">Creator address</dt>
            <dd className={`${valueMono} truncate`} title={data.creator_wallet ?? ''}>
                <Cell value={data.creator_wallet} redaction={redaction} mono />
            </dd>

            <dt className="text-base-content/60">Permanent Archive</dt>
            <dd className={`${valueMono} truncate`} title={data.arweave_uri ?? ''}>
                <PermanentArchiveValue
                    imageId={data.image_id}
                    url={data.arweave_uri}
                    readyAt={data.arweave_ready_at}
                    redaction={redaction}
                />
            </dd>

            <dt className="text-base-content/60">File fingerprint</dt>
            <dd className="font-mono">
                {data.sha256 ? <HashCell value={data.sha256} /> : <Cell value={null} redaction={redaction} mono />}
            </dd>

            <dt className="text-base-content/60">Image fingerprint</dt>
            <dd className="font-mono">
                {data.image_fingerprint ? <HashCell value={data.image_fingerprint} /> : <Cell value={null} redaction={redaction} mono />}
            </dd>

            <dt className="text-base-content/60">Content fingerprint</dt>
            <dd className="font-mono">
                {data.content_fingerprint ? <HashCell value={data.content_fingerprint} /> : <Cell value={null} redaction={redaction} mono />}
            </dd>

            <dt className="text-base-content/60">Issuance date</dt>
            <dd className={valueMono}>
                {data.minted_at
                    ? new Date(data.minted_at).toLocaleString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZoneName: 'short',
                    })
                    : <Cell value={null} redaction={redaction} mono />}
            </dd>
        </dl>
    );
}

// Permanent Archive value cell: displays the canonical https://arweave.net/<tx_id>
// URL as link text (proves permanence, survives platform cessation) but the
// click target is the same-origin /a/<image_id> proxy so the browser saves
// the file as <image_id>.zip instead of the bare tx_id. Gated on
// arweave_ready_at so the user never clicks during the ~5-30 min post-upload
// gateway propagation window. Per D-19.
function PermanentArchiveValue({
    imageId,
    url,
    readyAt,
    redaction,
}: {
    imageId: string;
    url: string | null;
    readyAt: string | null;
    redaction: RedactionStyle;
}) {
    if (url && readyAt) {
        return (
            <a
                href={`/archive/${encodeURIComponent(imageId)}`}
                download
                className="link link-hover"
                title={`Click to download. Canonical: ${url}`}
            >
                {url}
            </a>
        );
    }
    if (url) {
        return <span className="italic text-base-content/50">Archive upload in progress…</span>;
    }
    return <Cell value={null} redaction={redaction} mono />;
}
