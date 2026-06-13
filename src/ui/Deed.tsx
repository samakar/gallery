// Deed.tsx
// Deed-content page (R71 §3.4 row 5 / R62 §4.3 Firm vs TBD).
// Design ref: /docs/ui_design.md §5 (deed content composition).
//
// Two field registers:
//   * Firm fields -- IBM Plex Mono, definite typography (rendered immediately
//     from chain data + Arweave manifest).
//   * TBD fields -- italic placeholder copy ("TBD"), no weight, no decoration.
//     Reserves layout space without asserting unknown values (R62 §4.3).

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import DeedOnChainRecord from './DeedOnChainRecord';

interface DeedData {
    image_id: string;
    title: string;
    creator_display_name: string;
    creator_wallet_address: string | null; // Firm; null only if creator wallet not provisioned yet
    creation_date: string;          // ISO -- Firm
    edition: string;                // Firm
    asset_id: string;               // Firm -- cNFT asset_id; shown to buyer as "Deed number"
    arweave_uri: string;            // Firm (canonical permanent URL)
    arweave_ready_at: string | null; // null until arweave_ready_sweeper confirms the gateway can serve the bytes
    sha256: string;                 // Firm (hex sha256 of the cleartext Master file; UI label: "File fingerprint")
    minted_at: string;              // ISO -- Firm (rendered as "Issued")
    custody_state: 'sealed' | 'unsealed' | 'burned';
    legal_state: 'legit' | 'disputed' | 'void';
    current_owner_wallet: string;   // Firm (Owner address)
    royalty_pct: number;            // Firm
    // TBD fields (R62 §4.3) -- intentionally not auto-derived:
    appraisal_value_usd: number | null;
    last_sale_price_usd: number | null;
    provenance_chain_length: number | null;
}

export default function DeedPage() {
    const { imageId } = useParams();
    const [data, setData] = useState<DeedData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!imageId) { setLoading(false); return; }
        fetch(`/v1/images/${encodeURIComponent(imageId)}/deed`)
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
            .then((d: DeedData) => setData(d))
            .catch(() => setData(null))
            .finally(() => setLoading(false));
    }, [imageId]);

    if (loading) {
        return (
            <main className="min-h-screen flex items-center justify-center">
                <span className="loading loading-spinner" />
            </main>
        );
    }
    if (!data) {
        return (
            <main className="min-h-screen flex items-center justify-center px-4">
                <div className="card bg-base-200">
                    <div className="card-body">
                        <h2 className="card-title">No deed</h2>
                        <p className="text-base-content/60">
                            No deed for <code>{imageId}</code>.
                        </p>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen mx-auto max-w-3xl px-4 py-8 lg:py-12 space-y-8">
            <Header data={data} />
            <FirmSection data={data} />
            <TbdSection data={data} />
            <Footer data={data} />
        </main>
    );
}

function Header({ data }: { data: DeedData }) {
    return (
        <header className="space-y-1 pb-6 border-b border-base-300">
            <p className="text-xs uppercase tracking-widest text-base-content/50">Deed of ownership</p>
            <h1 className="text-2xl font-light tracking-tight">{data.title}</h1>
            <p className="text-sm text-base-content/70">
                {data.creator_display_name} · {new Date(data.creation_date).getFullYear()} · {data.edition}
            </p>
            <p className="text-xs text-base-content/50 mt-2">
                Custody: <span className="font-mono">{data.custody_state}</span>
                {' · '}
                Legal: <span className="font-mono">{data.legal_state}</span>
            </p>
        </header>
    );
}

// Firm register: monospaced, definite, no italics. The on-chain field block
// is the shared component (DeedOnChainRecord) -- same source as the panel on
// the image page so labels and the Permanent Archive readiness gate stay
// consistent across surfaces. The royalty row stays here because the deed
// page exposes it; the image-page panel renders it in a prose paragraph.
function FirmSection({ data }: { data: DeedData }) {
    return (
        <section className="space-y-4">
            <h2 className="text-base font-light">On-chain record</h2>
            <DeedOnChainRecord
                variant="page"
                data={{
                    image_id: data.image_id,
                    asset_id: data.asset_id,
                    custody_state: data.custody_state,
                    legal_state: data.legal_state,
                    owner_wallet: data.current_owner_wallet,
                    creator_wallet: data.creator_wallet_address,
                    arweave_uri: data.arweave_uri || null,
                    arweave_ready_at: data.arweave_ready_at,
                    sha256: data.sha256 || null,
                    image_fingerprint: null,
                    content_fingerprint: null,
                    minted_at: data.minted_at,
                }}
            />
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <dt className="text-base-content/60">Royalty</dt>
                <dd className="font-mono text-xs">{data.royalty_pct}%</dd>
            </dl>
        </section>
    );
}

// TBD register: italic placeholder. R62 §4.3 -- reserve the slot without
// asserting unknown values. Slots stay until appraisal / market data exists.
function TbdSection({ data }: { data: DeedData }) {
    return (
        <section className="space-y-4">
            <h2 className="text-base font-light">Market</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <Tbd label="Appraisal" value={data.appraisal_value_usd} format="usd" />
                <Tbd label="Last sale" value={data.last_sale_price_usd} format="usd" />
                <Tbd
                    label="Provenance chain"
                    value={data.provenance_chain_length}
                    format="count"
                />
            </dl>
        </section>
    );
}

function Tbd({
    label,
    value,
    format,
}: {
    label: string;
    value: number | null;
    format: 'usd' | 'count';
}) {
    const rendered =
        value === null
            ? null
            : format === 'usd'
                ? `$${value.toLocaleString()}`
                : `${value} owners`;
    return (
        <>
            <dt className="text-base-content/60">{label}</dt>
            <dd
                className={
                    rendered === null
                        ? 'italic text-base-content/40'
                        : 'font-mono text-xs'
                }
            >
                {rendered ?? 'TBD'}
            </dd>
        </>
    );
}

function Footer({ data }: { data: DeedData }) {
    return (
        <footer className="pt-6 border-t border-base-300 flex items-center justify-between">
            <Link to={`/${data.image_id}`} className="link link-hover text-sm">
                ← Back to image
            </Link>
            <a
                href={`https://explorer.solana.com/address/${data.asset_id}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="link link-hover text-xs text-base-content/60"
            >
                Inspect asset on chain ↗
            </a>
        </footer>
    );
}
