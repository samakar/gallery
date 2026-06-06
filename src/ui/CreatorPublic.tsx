// CreatorPublic.tsx
// Public creator landing page at epimage.com/c/<handle>.
// The bare /<handle> URL is supported as a legacy redirect in App.tsx.
// R62 §4.3 composition: headshot + bio (creator-presence register, NOT
// social-promotion); a grid of the creator's listings; no aggregated metrics
// (R67 §6.6); no Own this CTA on the creator page (R62 §4.3 -- listed only
// on the individual image page).

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

interface Listing {
    image_id: string;
    title: string;
    status: 'live' | 'sold';
    listed_price_cents: number | null;
    creation_date: string;
    preview_url: string;
}

interface CreatorPublic {
    handle: string;
    display_name: string;
    bio: string | null;
    headshot_url: string | null;
    listings: Listing[];
}

export default function CreatorPublicPage({ handle: handleProp }: { handle?: string } = {}) {
    const params = useParams();
    const handle = handleProp ?? params.handle;
    const [data, setData] = useState<CreatorPublic | null>(null);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        if (!handle) return;
        fetch(`/v1/creators/by-handle/${encodeURIComponent(handle)}`)
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'NOT_FOUND' : `${r.status}`))))
            .then(setData)
            .catch(e => setErr(e?.message ?? 'Failed to load.'));
    }, [handle]);

    if (err === 'NOT_FOUND') {
        return (
            <main className="min-h-screen flex items-center justify-center px-4">
                <div className="card bg-base-200">
                    <div className="card-body items-center text-center">
                        <h2 className="card-title">Creator not found</h2>
                        <p className="text-sm text-base-content/60">No creator with handle @{handle}.</p>
                        <Link to="/" className="link link-hover text-sm pt-2">← Home</Link>
                    </div>
                </div>
            </main>
        );
    }
    if (err) return <main className="min-h-screen flex items-center justify-center"><p className="text-error">{err}</p></main>;
    if (!data) return <main className="min-h-screen flex items-center justify-center"><span className="loading loading-spinner" /></main>;

    return (
        <main className="min-h-screen mx-auto max-w-5xl px-4 py-8 lg:py-10 space-y-8">
            <header className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                    {data.headshot_url ? (
                        <img
                            src={data.headshot_url}
                            alt={data.display_name}
                            className="w-20 h-20 rounded-md object-cover grayscale"
                        />
                    ) : (
                        <div className="w-20 h-20 rounded-md bg-base-200 flex items-center justify-center text-xs text-base-content/40">
                            no photo
                        </div>
                    )}
                    <div className="min-w-0">
                        <h1 className="text-2xl font-semibold tracking-tight truncate">{data.display_name}</h1>
                        <p className="text-sm text-base-content/60">{data.handle}</p>
                    </div>
                </div>
                <Link to="/" className="link link-hover text-sm shrink-0">← Home</Link>
            </header>

            {data.bio && (
                <p className="font-deed italic text-base-content/80 leading-relaxed max-w-2xl">
                    {data.bio}
                </p>
            )}

            <section className="space-y-3">
                <h2 className="text-xs uppercase tracking-widest text-base-content/50">
                    Listings ({data.listings.length})
                </h2>
                {data.listings.length === 0 ? (
                    <p className="text-sm text-base-content/50 italic">No listings yet.</p>
                ) : (
                    <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {data.listings.map(l => (
                            <li key={l.image_id}>
                                <Link to={`/${l.image_id}`} className="block group">
                                    <div className="aspect-square bg-base-200 rounded-md overflow-hidden">
                                        <img
                                            src={l.preview_url}
                                            alt={l.title}
                                            className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                                        />
                                    </div>
                                    <div className="mt-2 space-y-0.5">
                                        <p className="text-sm truncate">{l.title}</p>
                                        <p className="text-xs text-base-content/60">
                                            {l.status === 'sold'
                                                ? `Sold · ${new Date(l.creation_date).toLocaleDateString()}`
                                                : l.listed_price_cents != null
                                                    ? `$${(l.listed_price_cents / 100).toFixed(0)}`
                                                    : '—'}
                                        </p>
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </main>
    );
}
