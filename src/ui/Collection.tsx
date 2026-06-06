// Collection.tsx
// Buyer Collection page (R71 §3.4 row 4).
// Design ref: /docs/ui_design.md §7 (/collection route).
//
// Grid of deeds the signed-in user owns. Each tile shows the Share Copy as
// thumbnail and links to the image page (where the owner sees the OwnerBar).
// Source: GET /v1/me/collection -- server joins deeds by owner_id from the
// authenticated session (Bearer DID token or x-dev-user shim).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';
import { SignOutButton } from './SignOutButton';

interface OwnedDeed {
    image_id: string;
    title: string;
    creator_display_name: string;
    share_copy_url: string;         // Share Copy thumbnail (R71 §2.7)
    asset_id: string;               // cNFT asset_id -- shown to the buyer as "deed number"
    minted_at: string;              // ISO
    deed_state: 'sealed' | 'opened' | 'rights_disputed' | 'void' | 'burned';
}

export default function CollectionPage() {
    const [deeds, setDeeds] = useState<OwnedDeed[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        api<{ deeds: OwnedDeed[] }>('/v1/me/collection')
            .then(d => { if (!cancelled) setDeeds(d.deeds); })
            .catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to load collection.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    return (
        <main className="min-h-screen mx-auto max-w-6xl px-4 py-8 lg:py-12 space-y-8">
            <header className="flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                    <h1 className="text-2xl font-light tracking-tight">Your collection</h1>
                    <p className="text-sm text-base-content/60">
                        Images you own. Tap any tile to view, share, or open the deed.
                    </p>
                </div>
                <SignOutButton />
            </header>

            {loading ? (
                <span className="loading loading-spinner" />
            ) : error ? (
                <div className="card bg-base-200">
                    <div className="card-body items-center text-center">
                        <p className="text-sm text-error">{error}</p>
                    </div>
                </div>
            ) : deeds.length === 0 ? (
                <EmptyState />
            ) : (
                <DeedGrid deeds={deeds} />
            )}
        </main>
    );
}

function EmptyState() {
    return (
        <div className="card bg-base-200">
            <div className="card-body items-center text-center gap-4">
                <p className="text-base-content/70">You don't own any images yet.</p>
                <Link to="/" className="link link-hover text-sm">
                    Browse the gallery →
                </Link>
            </div>
        </div>
    );
}

function DeedGrid({ deeds }: { deeds: OwnedDeed[] }) {
    return (
        <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {deeds.map(d => (
                <li key={d.asset_id}>
                    <Link to={`/${d.image_id}`} className="block group">
                        <div className="aspect-square bg-base-200 rounded-md overflow-hidden">
                            <img
                                src={d.share_copy_url}
                                alt={d.title}
                                className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                            />
                        </div>
                        <div className="mt-2 space-y-0.5">
                            <p className="text-sm truncate">{d.title}</p>
                            <p className="text-xs text-base-content/60 truncate">
                                {d.creator_display_name}
                            </p>
                            <p className="text-xs text-base-content/40">
                                {new Date(d.minted_at).toLocaleDateString()}
                                {d.deed_state !== 'sealed' && (
                                    <span className="ml-2 badge badge-xs badge-warning">
                                        {d.deed_state}
                                    </span>
                                )}
                            </p>
                        </div>
                    </Link>
                </li>
            ))}
        </ul>
    );
}

