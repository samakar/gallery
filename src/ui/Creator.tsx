// Creator.tsx
// Creator dashboard (R71 §3.4 row 2).
// Design ref: /docs/ui_design.md §7 (/creator route).
//
// Single page: top nav (Profile + Upload) + a fluid grid of the creator's
// images in upload order (newest first). Status (pending_review / draft / live
// / sold / taken_down) is a per-tile badge. Click a tile -> /<image-id> in
// the appropriate owner branch (editable form for draft/pending; listed
// display for live/sold).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';
import UploadDrawer, { type UploadedImage } from './UploadDrawer';
import { SignOutButton } from './SignOutButton';

interface Listing {
    image_id: string;
    title: string;
    preview_url: string;
    status: string;
    visibility: string;
    listed_price_cents: number | null;
    created_at: string;
}

export default function CreatorPage() {
    const [listings, setListings] = useState<Listing[]>([]);
    const [displayName, setDisplayName] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);

    useEffect(() => {
        Promise.all([
            api<{ listings: Listing[] }>('/v1/creator/listings'),
            api<{ profile: { display_name: string } }>('/v1/creator/profile'),
        ])
            .then(([l, p]) => {
                setListings(l.listings);
                setDisplayName(p.profile.display_name || '');
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    function onUploaded(img: UploadedImage) {
        setListings(prev => [img, ...prev]);
    }

    const title = displayName ? `${displayName} Folio` : 'Folio';

    return (
        <main className="min-h-screen mx-auto max-w-6xl px-4 py-8 lg:py-12 space-y-8">
            <TopNav title={title} onUploadClick={() => setDrawerOpen(true)} />

            {error ? (
                <div className="alert alert-error text-sm">{error}</div>
            ) : loading ? (
                <span className="loading loading-spinner" />
            ) : listings.length === 0 ? (
                <EmptyState onUploadClick={() => setDrawerOpen(true)} />
            ) : (
                <ListingsGrid listings={listings} />
            )}

            <UploadDrawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                onUploaded={onUploaded}
            />
        </main>
    );
}

function TopNav({ title, onUploadClick }: { title: string; onUploadClick: () => void }) {
    return (
        <header className="flex items-center justify-between pb-4 border-b border-base-300">
            <h1 className="text-2xl font-light tracking-tight truncate">{title}</h1>
            <nav className="flex items-center gap-2 shrink-0">
                <Link to="/creator/profile" className="btn btn-sm btn-ghost">
                    Profile
                </Link>
                <SignOutButton />
                <button type="button" className="btn btn-sm" onClick={onUploadClick}>
                    Upload
                </button>
            </nav>
        </header>
    );
}

function EmptyState({ onUploadClick }: { onUploadClick: () => void }) {
    return (
        <div className="card bg-base-200">
            <div className="card-body items-center text-center gap-4">
                <p className="text-base-content/70">No images yet.</p>
                <button type="button" className="btn btn-sm" onClick={onUploadClick}>
                    Upload your first
                </button>
            </div>
        </div>
    );
}

function ListingsGrid({ listings }: { listings: Listing[] }) {
    return (
        <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {listings.map(l => (
                <li key={l.image_id}>
                    <Link to={`/${l.image_id}`} className="block group">
                        <div className="aspect-square bg-base-200 rounded-md overflow-hidden">
                            <img
                                src={l.preview_url}
                                alt={l.title || l.image_id}
                                className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                            />
                        </div>
                        <div className="mt-2 space-y-0.5">
                            <p className="text-sm truncate">{l.title || 'Untitled'}</p>
                            <p className="text-xs text-base-content/60">
                                <StatusBadge status={l.status} />
                            </p>
                        </div>
                    </Link>
                </li>
            ))}
        </ul>
    );
}

function StatusBadge({ status }: { status: string }) {
    return <span className="badge badge-xs badge-neutral">{status.replace('_', ' ')}</span>;
}
