// Deed.tsx
// Deed-content page (R71 §3.4 row 5 / R62 §4.3 Firm vs TBD).
// Design ref: /docs/ui_design.md §5 (deed content composition).
//
// Two field registers:
//   * Firm fields -- IBM Plex Mono, definite typography (rendered immediately
//     from chain data + Arweave manifest).
//   * TBD fields -- italic placeholder copy ("TBD"), no weight, no decoration.
//     Reserves layout space without asserting unknown values (R62 §4.3).
//
// Source: Crossmint NFT lookup (registry/crossmint_lookup) for owner +
//   metadata fetch from arweave_uri.

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

interface DeedData {
    image_id: string;
    title: string;
    creator_display_name: string;
    creation_date: string;          // ISO -- Firm
    edition: string;                // Firm
    asset_id: string;               // Firm -- cNFT asset_id; shown to buyer as "Deed number"
    arweave_uri: string;            // Firm
    sha256: string;                 // Firm (hex)
    minted_at: string;              // ISO -- Firm
    custody_state: 'sealed' | 'unsealed' | 'burned';
    legal_state: 'legit' | 'disputed' | 'void';
    current_owner_wallet: string;   // Firm (from Crossmint lookup)
    royalty_pct: number;            // Firm
    // TBD fields (R62 §4.3) -- intentionally not auto-derived:
    appraisal_value_usd: number | null;
    last_sale_price_usd: number | null;
    provenance_chain_length: number | null;
}

const USE_MOCK = true;

export default function DeedPage() {
    const { imageId } = useParams();
    const [data, setData] = useState<DeedData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (USE_MOCK) {
            setData(makeMockDeed(imageId ?? 'abc1d'));
            setLoading(false);
            return;
        }
        // TODO: GET /v1/images/:imageId/deed (R71 §3.7 row TBD)
        // TODO: backend joins deeds + registry/crossmint_lookup.getOwner
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

// Firm register: monospaced, definite, no italics.
function FirmSection({ data }: { data: DeedData }) {
    return (
        <section className="space-y-4">
            <h2 className="text-base font-light">On-chain record</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <Firm label="Deed number" value={data.asset_id} mono truncate />
                <Firm label="Owner wallet" value={data.current_owner_wallet} mono truncate />
                <Firm label="Arweave URI" value={data.arweave_uri} mono truncate />
                <Firm label="SHA-256" value={data.sha256} mono truncate />
                <Firm label="Minted" value={new Date(data.minted_at).toISOString().slice(0, 10)} mono />
                <Firm label="Royalty" value={`${data.royalty_pct}%`} mono />
            </dl>
        </section>
    );
}

function Firm({
    label,
    value,
    mono = false,
    truncate = false,
}: {
    label: string;
    value: string;
    mono?: boolean;
    truncate?: boolean;
}) {
    return (
        <>
            <dt className="text-base-content/60">{label}</dt>
            <dd
                className={[
                    mono ? 'font-mono text-xs' : '',
                    truncate ? 'truncate' : '',
                ].join(' ')}
                title={truncate ? value : undefined}
            >
                {value}
            </dd>
        </>
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
                // cNFTs are Merkle-tree leaves, not on-chain accounts.
                // Solana Explorer's /address/ view resolves cNFT asset_ids via DAS
                // and renders the asset properly when found.
                // TODO: drive ?cluster from a VITE_SOLANA_NETWORK env var at mainnet deploy.
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

// -------------------------------------------------------------------
// DEV mock
// -------------------------------------------------------------------

function makeMockDeed(imageId: string): DeedData {
    return {
        image_id: imageId,
        title: 'After the rain',
        creator_display_name: 'Sample Creator',
        creation_date: '2026-04-15',
        edition: 'Unique',
        asset_id: 'AssetIdMock1111111111111111111111111111111',
        arweave_uri: 'https://arweave.net/abcdefghijklmnopqrstuvwxyz1234567890ABCD',
        sha256: 'a3f1c9e2b4d6f8e0a3f1c9e2b4d6f8e0a3f1c9e2b4d6f8e0a3f1c9e2b4d6f8e0',
        minted_at: '2026-05-01T14:22:00Z',
        custody_state: 'sealed',
        legal_state: 'legit',
        current_owner_wallet: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        royalty_pct: 10,
        appraisal_value_usd: null,
        last_sale_price_usd: null,
        provenance_chain_length: null,
    };
}
